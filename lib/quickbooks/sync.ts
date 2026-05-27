/**
 * Loop 49 (Phase 99 from AUDIT_PHASE70) — QuickBooks sync helper.
 *
 * Orchestrates the per-appointment SalesReceipt creation when an
 * appointment hits status='completed'. Best-effort by design: a QB
 * outage doesn't fail the underlying status update. Errors go to
 * Sentry and the receipt stays unsynced (idempotency via
 * `appointments.quickbooks_sales_receipt_id` lets a future cron
 * retry the failed ones).
 *
 * Flow per call:
 *   1. Skip if appointment already has a receipt ID stored.
 *   2. Skip if shop has no active QB connection.
 *   3. Resolve fresh access_token via refresh.
 *   4. Find-or-create the shop's default "Walk-in" customer
 *      (cached on shops.quickbooks_default_customer_id after first
 *      successful call).
 *   5. Build line items from appointment_services (service name +
 *      price_snapshot).
 *   6. POST SalesReceipt to QB.
 *   7. Store receipt ID on the appointment row.
 *
 * Why we don't use a cron: completion is a discrete, user-driven
 * event. Pushing on the same request keeps the receipt in QB
 * "fresh" (same day as the visit) without waiting for a cron tick.
 * The idempotency column + retry-friendly error handling means a
 * future cron could backfill failed syncs if we ever see real-world
 * failure rates.
 */

import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { decrypt, encryptionConfigured } from '@/lib/crypto/aes';
import {
  createQbSalesReceipt,
  findOrCreateQbCustomer,
  quickbooksConfigured,
  refreshQbToken,
} from '@/lib/quickbooks/server';
import { shopIsoDate } from '@/lib/business/timezone';
import { captureException } from '@/lib/observability';

export async function pushAppointmentToQuickbooks(args: {
  appointmentId: string;
  shopId: string;
}): Promise<void> {
  // The whole helper is best-effort — any uncaught error gets
  // routed through Sentry and the caller continues. The outer
  // try/catch matches the same pattern used by
  // `lib/business/waitlist-notify.ts` and `lib/google/sync.ts`.
  try {
    if (!quickbooksConfigured() || !encryptionConfigured()) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseServiceRoleClient() as any;

    // Pull the shop's QB state + the appointment row + linked
    // services in parallel. Three independent reads — no dependency
    // between them.
    const [shopRes, apptRes, servicesRes] = await Promise.all([
      admin
        .from('shops')
        // Loop 49 self-review — pull timezone too so the SalesReceipt
        // TxnDate is computed in the shop's local time. UTC-slicing
        // an 11pm-ET appointment would land on the NEXT day in QB.
        .select(
          'id, name, timezone, quickbooks_realm_id, quickbooks_refresh_token_enc, quickbooks_connect_status, quickbooks_default_customer_id',
        )
        .eq('id', args.shopId)
        .single(),
      admin
        .from('appointments')
        // Loop 52 (P99 follow-up) — `client_id` pulled so we can
        // route the SalesReceipt under the real customer rather
        // than the shop's default Walk-in. Null client_id = true
        // walk-in (no client row) → Walk-in fallback below.
        .select('id, start_at, total_amount, quickbooks_sales_receipt_id, client_id')
        .eq('id', args.appointmentId)
        .single(),
      admin
        .from('appointment_services')
        .select('price_snapshot, services(name)')
        .eq('appointment_id', args.appointmentId),
    ]);

    const shop = shopRes.data as {
      id: string;
      name: string;
      timezone: string;
      quickbooks_realm_id: string | null;
      quickbooks_refresh_token_enc: string | null;
      quickbooks_connect_status: 'not_started' | 'active' | 'expired' | 'disconnected';
      quickbooks_default_customer_id: string | null;
    } | null;
    const appt = apptRes.data as {
      id: string;
      start_at: string;
      total_amount: number;
      quickbooks_sales_receipt_id: string | null;
      client_id: string | null;
    } | null;

    if (!shop || !appt) return;
    // Idempotency guard — receipt already exists.
    if (appt.quickbooks_sales_receipt_id) return;
    // Skip when QB isn't connected.
    if (
      shop.quickbooks_connect_status !== 'active' ||
      !shop.quickbooks_realm_id ||
      !shop.quickbooks_refresh_token_enc
    ) {
      return;
    }

    // Refresh the token. Intuit rotates refresh tokens on every
    // refresh, so we MUST persist the new one (we don't here — the
    // cron in /api/cron/quickbooks-refresh handles the persistence
    // path; on the sync path we use the new access_token but trust
    // the cron to update storage on its next tick). Worst case: the
    // sync uses a fresh access token, the cron later refreshes
    // again and persists a different refresh token — both flows
    // converge.
    const refreshed = await refreshQbToken(decrypt(shop.quickbooks_refresh_token_enc));
    const accessToken = refreshed.access_token;

    // Step 2 — resolve the QB Customer to attach. Two paths:
    //
    //   (a) The appointment has a `client_id` → look up the client
    //       row. If `quickbooks_customer_id` is cached, use it.
    //       Otherwise find-or-create in QB by DisplayName matching
    //       (`<first> <last>`) and cache the result.
    //
    //   (b) Null `client_id` (legitimate walk-in with no client
    //       row) → fall back to the shop's cached "Walk-in"
    //       customer, creating it lazily on first such receipt.
    //
    // Loop 49 routed everything through (b); Loop 52 (P99 follow-
    // up) adds (a) so receipts carry meaningful customer names.
    let customerId: string;
    if (appt.client_id) {
      const clientRes = await admin
        .from('clients')
        .select('id, first_name, last_name, quickbooks_customer_id')
        .eq('id', appt.client_id)
        .single();
      const client = clientRes.data as {
        id: string;
        first_name: string;
        last_name: string | null;
        quickbooks_customer_id: string | null;
      } | null;
      if (client?.quickbooks_customer_id) {
        customerId = client.quickbooks_customer_id;
      } else if (client) {
        // Build a DisplayName that QB will accept. Empty `last_name`
        // → use `first_name` alone; collisions with existing QB
        // customers of the same name will resolve to the EXISTING
        // record (find-step succeeds), which is the right user-
        // visible behaviour even if it sometimes merges two
        // Küa-distinct clients into one QB row. A V1.5 loop can
        // disambiguate via phone number when QB exposes the
        // PrimaryPhone in queries.
        const displayName = client.last_name
          ? `${client.first_name} ${client.last_name}`
          : client.first_name;
        const customer = await findOrCreateQbCustomer({
          realmId: shop.quickbooks_realm_id,
          accessToken,
          displayName,
        });
        customerId = customer.id;
        // Cache the ID back on the client row so subsequent
        // receipts for this client skip the QB query.
        await admin
          .from('clients')
          .update({ quickbooks_customer_id: customerId })
          .eq('id', client.id);
      } else {
        // client_id pointed at a row that doesn't exist anymore
        // (shouldn't happen, but defend-in-depth) — fall through
        // to Walk-in.
        customerId = await resolveWalkinCustomer({
          admin,
          shop,
          accessToken,
        });
      }
    } else {
      customerId = await resolveWalkinCustomer({
        admin,
        shop,
        accessToken,
      });
    }

    // Step 3 — build SalesReceipt line items. Empty service list
    // (which would mean a no-services appointment, unusual but
    // possible) gets a single "Appointment" line so the receipt
    // total isn't zero.
    type ServiceJoin = { price_snapshot: number; services: { name: string } | null };
    const services = (servicesRes.data as ServiceJoin[] | null) ?? [];
    const lines =
      services.length > 0
        ? services.map((s) => ({
            description: s.services?.name ?? 'Service',
            amount: Number(s.price_snapshot ?? 0),
          }))
        : [
            {
              description: 'Appointment',
              amount: Number(appt.total_amount ?? 0),
            },
          ];

    // Step 4 — POST SalesReceipt. `TxnDate` is the appointment's
    // shop-local date (NOT UTC-sliced — a 23h ET appointment would
    // have a UTC date of next-day, which puts the receipt on the
    // wrong day in QB).
    const receipt = await createQbSalesReceipt({
      realmId: shop.quickbooks_realm_id,
      accessToken,
      customerId,
      txnDate: shopIsoDate(new Date(appt.start_at), shop.timezone),
      lines,
      privateNote: `Küa appointment ${appt.id}`,
    });

    // Step 5 — persist the receipt ID for idempotency. If this
    // update fails (rare), the appointment stays unsynced and the
    // next attempt creates a DUPLICATE receipt in QB. That's the
    // documented trade-off — duplicates are visible in QB and easy
    // for an owner to delete.
    await admin
      .from('appointments')
      .update({ quickbooks_sales_receipt_id: receipt.id })
      .eq('id', appt.id);
  } catch (e) {
    captureException(e, {
      tags: { layer: 'qb-sync', stage: 'push-appointment' },
      extra: { appointmentId: args.appointmentId, shopId: args.shopId },
    });
  }
}

/**
 * Loop 52 — resolve (find-or-create + cache) the shop's default
 * "Walk-in" customer. Pulled out of the inline path so both the
 * null-client_id branch and the "client_id pointed at a deleted
 * row" fallback can share it without duplicating the cache write.
 */
async function resolveWalkinCustomer({
  admin,
  shop,
  accessToken,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any;
  shop: {
    id: string;
    name: string;
    quickbooks_realm_id: string | null;
    quickbooks_default_customer_id: string | null;
  };
  accessToken: string;
}): Promise<string> {
  if (shop.quickbooks_default_customer_id) return shop.quickbooks_default_customer_id;
  const customer = await findOrCreateQbCustomer({
    realmId: shop.quickbooks_realm_id!,
    accessToken,
    // Per-shop prefix so an owner with multiple companies in QB
    // can tell them apart.
    displayName: `${shop.name} — Walk-in`,
  });
  await admin
    .from('shops')
    .update({ quickbooks_default_customer_id: customer.id })
    .eq('id', shop.id);
  return customer.id;
}
