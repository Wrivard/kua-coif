'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import { err, ok, type Result } from '@/lib/server-actions/result';
import { captureException } from '@/lib/observability';
import { logAuditAction } from '@/lib/audit-log';
import { verifyToken } from '@/lib/security/signed-tokens';
import { effectiveLoyaltyBalanceCents } from '@/lib/business/loyalty';
import { stripeConfigured } from '@/lib/stripe/server';
import { refundPaymentIntentFull } from '@/lib/stripe/payments';
import { sendEmail } from '@/lib/email/send';
import { AppointmentCancellation } from '@/lib/email/templates/appointment-cancellation';

/**
 * Phase 68 — Self-service Loi 25 export.
 *
 * Mirrors the admin-side `exportClientData` action but token-gated
 * (no user session). Returns the same JSON shape so the customer can
 * archive it or feed it to another platform if they want.
 *
 * Rate limit: 10 / hour / IP — exports are expensive (full appointment
 * scan) and one customer rarely needs more than that.
 */

const schema = z.object({
  token: z.string().trim().min(10).max(4096),
});

export type ExportMyDataInput = z.infer<typeof schema>;

function clientIp(): string {
  const h = headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? 'unknown';
}

export type SelfExport = {
  exported_at: string;
  client: {
    id: string;
    first_name: string;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    created_at: string;
    loyalty_balance_cents: number;
  };
  appointments: Array<{
    id: string;
    start_at: string;
    end_at: string;
    status: string;
    total_amount: number;
    payment_status: string;
    barber_display_name: string | null;
    services: Array<{ name: string; price_snapshot: number }>;
  }>;
};

export async function exportMyData(raw: ExportMyDataInput): Promise<Result<SelfExport>> {
  try {
    const ip = clientIp();
    const rl = await checkRateLimit(`me-export:${ip}`, { max: 10, windowMs: 60 * 60 * 1000 });
    if (!rl.allowed) return err('RATE_LIMITED');

    const parsed = schema.safeParse(raw);
    if (!parsed.success) return err('INVALID_INPUT');

    const payload = verifyToken(parsed.data.token, 'me');
    if (!payload) return err('INVALID_INPUT');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createSupabaseServiceRoleClient() as any;

    const clientRes = await supabase
      .from('clients')
      // Loop 35 self-review — include `loyalty_balance_expires_at` so
      // the /me self-export shows the effective (post-expiry) balance
      // rather than the raw column value. A customer seeing "$10"
      // here that's actually expired would be confused on their next
      // booking attempt.
      .select(
        'id, shop_id, first_name, last_name, email, phone, created_at, loyalty_balance_cents, loyalty_balance_expires_at, anonymized_at',
      )
      .eq('id', payload.resourceId)
      .limit(1);
    const client = ((clientRes.data as Array<{
      id: string;
      shop_id: string;
      first_name: string;
      last_name: string | null;
      email: string | null;
      phone: string | null;
      created_at: string;
      loyalty_balance_cents: number | null;
      loyalty_balance_expires_at: string | null;
      anonymized_at: string | null;
    }> | null) ?? [])[0];
    if (!client || client.anonymized_at) return err('NOT_FOUND');

    const effectiveBalanceCents = await effectiveLoyaltyBalanceCents({
      clientId: client.id,
      balanceCents: client.loyalty_balance_cents ?? 0,
      expiresAt: client.loyalty_balance_expires_at,
    });

    const apptRes = await supabase
      .from('appointments')
      .select(
        'id, start_at, end_at, status, total_amount, payment_status, barber:barbers(display_name), services:appointment_services(price_snapshot, service:services(name))',
      )
      .eq('client_id', client.id)
      .order('start_at', { ascending: false });

    type ApptJoin = {
      id: string;
      start_at: string;
      end_at: string;
      status: string;
      total_amount: number;
      payment_status: string;
      barber: { display_name: string } | null;
      services: Array<{ price_snapshot: number; service: { name: string } | null }> | null;
    };
    const appointments = ((apptRes.data as ApptJoin[] | null) ?? []).map((a) => ({
      id: a.id,
      start_at: a.start_at,
      end_at: a.end_at,
      status: a.status,
      total_amount: a.total_amount,
      payment_status: a.payment_status,
      barber_display_name: a.barber?.display_name ?? null,
      services: (a.services ?? [])
        .filter((s) => s.service)
        .map((s) => ({ name: s.service!.name, price_snapshot: s.price_snapshot })),
    }));

    await logAuditAction({
      shopId: client.shop_id,
      actorId: '00000000-0000-0000-0000-000000000000',
      action: 'custom',
      entity: 'clients',
      entityId: client.id,
      diff: { loi25_self_export: true, appointments_count: appointments.length },
    });

    return ok({
      exported_at: new Date().toISOString(),
      client: {
        id: client.id,
        first_name: client.first_name,
        last_name: client.last_name,
        email: client.email,
        phone: client.phone,
        created_at: client.created_at,
        loyalty_balance_cents: effectiveBalanceCents,
      },
      appointments,
    });
  } catch (e) {
    captureException(e, { tags: { layer: 'self-export' } });
    return err('UNEXPECTED');
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Phase G — customer self-cancel.
//
// Closes the refund-policy gate loop end-to-end. Before this action, the
// `mins_cancel_before_appt` policy only mattered for admin-initiated
// cancellations (Phase D); a customer had no way to cancel without
// calling the salon. Now the customer can cancel their own appointments
// via the /me/[token] page they got in the booking confirmation email:
//
//   - Outside the no-refund window (now < start_at - mins_cancel_before)
//     → cancel + automatic Stripe refund (when payment_status='paid')
//   - Inside the no-refund window
//     → cancel WITHOUT refund (per policy); customer is informed via
//       the action's return value so the UI can show the right message
//
// Security model: the `/me` token is `kind: 'me' / resourceId: client_id`
// and shared across all of a customer's appointments (same as the
// existing Loi 25 self-export). We verify the appointment's `client_id`
// matches the token's `resourceId` so a leaked token still only affects
// THAT customer (defense-in-depth IDOR check).
//
// Rate limit: 10 cancels per hour per IP — a real customer would only
// cancel 1-2 appointments at most; the cap throttles automation abuse.
// ─────────────────────────────────────────────────────────────────────────

const cancelSchema = z.object({
  token: z.string().trim().min(10).max(4096),
  appointment_id: z.string().uuid(),
  // Phase H — customer's locale, threaded from the /me URL path so the
  // cancellation email arrives in the right language. Defaults to FR
  // (the project's default + Quebec context) when the wizard didn't
  // forward it (older builds, hand-crafted POSTs).
  locale: z.enum(['fr', 'en']).optional().default('fr'),
});

export type CancelMyAppointmentInput = z.infer<typeof cancelSchema>;

export type CancelMyAppointmentResult = {
  /** True when the appointment was cancelled (action always succeeds when this is set). */
  cancelled: true;
  /** True when the deposit was refunded automatically. False when the
   *  policy forbids refund within the cutoff window OR when no PI was
   *  attached to the appointment. */
  refunded: boolean;
  /** True when the cancellation happened inside the no-refund window.
   *  The UI uses this to show "your deposit isn't refundable per the
   *  policy" copy instead of "fully refunded". */
  withinNoRefundWindow: boolean;
  /** Minutes of `mins_cancel_before_appt` that applied — surfaced for
   *  the UI so it can render the policy threshold in the message. */
  minsCancelBefore: number;
};

export async function cancelMyAppointment(
  raw: CancelMyAppointmentInput,
): Promise<Result<CancelMyAppointmentResult>> {
  try {
    const ip = clientIp();
    const rl = await checkRateLimit(`me-cancel:${ip}`, { max: 10, windowMs: 60 * 60 * 1000 });
    if (!rl.allowed) return err('RATE_LIMITED');

    const parsed = cancelSchema.safeParse(raw);
    if (!parsed.success) return err('INVALID_INPUT');

    const payload = verifyToken(parsed.data.token, 'me');
    if (!payload) return err('INVALID_INPUT');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createSupabaseServiceRoleClient() as any;

    // Resolve appointment + verify it belongs to the token's client.
    // This is the IDOR gate: a leaked token must not let the holder
    // cancel another customer's bookings even if they know the UUID.
    const apptRes = await supabase
      .from('appointments')
      .select(
        'id, shop_id, barber_id, client_id, start_at, status, payment_status, payment_intent_id',
      )
      .eq('id', parsed.data.appointment_id)
      .limit(1);
    const appt =
      ((apptRes.data as Array<{
        id: string;
        shop_id: string;
        barber_id: string;
        client_id: string | null;
        start_at: string;
        status: 'booked' | 'confirmed' | 'arrived' | 'completed' | 'cancelled' | 'no_show';
        payment_status: 'unpaid' | 'pending' | 'paid' | 'refunded' | 'failed' | null;
        payment_intent_id: string | null;
      }> | null) ?? [])[0] ?? null;
    if (!appt) return err('NOT_FOUND');
    if (appt.client_id !== payload.resourceId) return err('NOT_FOUND');

    // Already in a terminal state — nothing to do. We return NOT_FOUND
    // (rather than a specific "already cancelled" error) so a leaked
    // token can't enumerate appointment states.
    if (appt.status !== 'booked' && appt.status !== 'confirmed') {
      return err('NOT_FOUND');
    }
    // Past appointments can't be cancelled — the customer should
    // contact the salon to discuss any no-show or reschedule.
    if (new Date(appt.start_at).getTime() <= Date.now()) {
      return err('INVALID_INPUT', { appointment: 'already_started' });
    }

    // Resolve the cancel policy + refund-policy window — same precedence
    // as the admin-side `cancelAppointment` (Phase D): barber override
    // beats shop default. 0 minutes = "no policy" = refund always
    // proceeds.
    //
    // Phase H — `customer_cancellations` is also pulled here. When the
    // shop disabled customer-initiated cancels (toggle off in
    // /settings/barbers), the customer must contact the salon — the
    // /me self-cancel surface MUST honor that or it bypasses the
    // owner's explicit "no" decision.
    const settingsRes = await supabase
      .from('barber_settings')
      .select('scope, barber_id, mins_cancel_before_appt, customer_cancellations')
      .eq('shop_id', appt.shop_id);
    const settingsRows =
      (settingsRes.data as Array<{
        scope: 'shop' | 'barber';
        barber_id: string | null;
        mins_cancel_before_appt: number;
        customer_cancellations: boolean | null;
      }> | null) ?? [];
    const override = settingsRows.find(
      (r) => r.scope === 'barber' && r.barber_id === appt.barber_id,
    );
    const fallback = settingsRows.find((r) => r.scope === 'shop');
    const resolvedSettings = override ?? fallback;
    const minsBefore = resolvedSettings?.mins_cancel_before_appt ?? 0;

    // Phase H — explicit "no customer cancels" check. Defaults to TRUE
    // (allowed) when the column is null so a shop that never touched
    // the toggle keeps the default behavior. Only `false` blocks.
    const customerCancellationsAllowed = resolvedSettings?.customer_cancellations !== false;
    if (!customerCancellationsAllowed) {
      return err('INVALID_INPUT', { cancellation: 'not_allowed' });
    }

    // Is the customer past the cancellation window?
    const startMs = new Date(appt.start_at).getTime();
    const cutoffMs = startMs - minsBefore * 60_000;
    const withinNoRefundWindow = minsBefore > 0 && Date.now() >= cutoffMs;

    // Auto-refund only when (a) the appointment was actually paid,
    // (b) we have a PI to refund against, (c) Stripe is configured,
    // and (d) the customer is OUTSIDE the no-refund window. Inside
    // the window the policy says the salon keeps the deposit.
    let refunded = false;
    if (
      !withinNoRefundWindow &&
      appt.payment_status === 'paid' &&
      appt.payment_intent_id &&
      stripeConfigured()
    ) {
      try {
        await refundPaymentIntentFull({ paymentIntentId: appt.payment_intent_id });
        refunded = true;
        // The webhook handler flips payment_status='refunded' on
        // charge.refunded — we don't pre-write it here to avoid a
        // double-write race. The customer sees a "refund issued"
        // message; the row stays 'paid' for a few seconds until the
        // webhook lands.
      } catch (e) {
        // Refund failure is logged but doesn't block the cancel.
        // The salon owner can retry manually via the admin drawer.
        captureException(e, {
          tags: { layer: 'me-self-cancel', step: 'stripe-refund' },
          extra: { appointmentId: appt.id },
        });
      }
    }

    // Mark the appointment cancelled.
    const updateRes = await supabase
      .from('appointments')
      .update({ status: 'cancelled' })
      .eq('id', appt.id);
    if (updateRes.error) return err('UNEXPECTED');

    // Audit-log everything we did, including the policy state at the
    // time so an out-of-policy retroactive review can reconstruct what
    // the customer experienced.
    await logAuditAction({
      shopId: appt.shop_id,
      actorId: '00000000-0000-0000-0000-000000000000', // anonymous self-service
      action: 'update',
      entity: 'appointments',
      entityId: appt.id,
      diff: {
        status: 'cancelled',
        source: 'self-service',
        refunded,
        within_no_refund_window: withinNoRefundWindow,
        mins_cancel_before_appt: minsBefore,
        ip,
      },
    });

    // Best-effort cancellation email + revalidate the /me page so
    // the cancelled appointment drops out of the upcoming list on
    // refresh. The dispatcher itself gates on
    // `notification_automations.cancellation`, so we don't double-gate.
    try {
      // Phase G SR — dead-code cleanup. The IDOR check earlier
      // (`appt.client_id !== payload.resourceId → NOT_FOUND`) guarantees
      // `appt.client_id` is the payload's UUID by the time we get here.
      // The original `?? '00000000-...'` fallback was unreachable. The
      // assertion documents the invariant for TS narrowing and any
      // future reader.
      if (!appt.client_id) {
        throw new Error('unreachable: client_id null after IDOR check');
      }
      const [clientRes, servicesRes, shopRes] = await Promise.all([
        supabase.from('clients').select('first_name, email').eq('id', appt.client_id).single(),
        supabase
          .from('appointment_services')
          .select('services(name)')
          .eq('appointment_id', appt.id),
        supabase.from('shops').select('name, timezone, phone').eq('id', appt.shop_id).single(),
      ]);
      const customer = clientRes.data as { first_name: string; email: string | null } | null;
      const shop = shopRes.data as {
        name: string;
        timezone: string;
        phone: string | null;
      } | null;
      const services = (
        (servicesRes.data as Array<{ services: { name: string } | null }> | null) ?? []
      )
        .map((r) => r.services?.name)
        .filter((n): n is string => Boolean(n))
        .map((name) => ({ name }));
      if (customer?.email && shop) {
        // Phase H — locale comes from the /me URL path so the email
        // arrives in the customer's chosen language. The subject line
        // also switches; the rest of the template handles locale
        // itself.
        const emailLocale = parsed.data.locale;
        await sendEmail({
          shopId: appt.shop_id,
          kind: 'cancellation',
          to: customer.email,
          subject:
            emailLocale === 'fr' ? `Annulation — ${shop.name}` : `Cancellation — ${shop.name}`,
          template: AppointmentCancellation({
            locale: emailLocale,
            shop: { name: shop.name, phone: shop.phone, timezone: shop.timezone },
            client: { firstName: customer.first_name },
            appointment: { startAt: appt.start_at, services },
            reason: null,
          }),
          tags: [
            { name: 'kind', value: 'cancellation' },
            { name: 'source', value: 'self-service' },
          ],
        });
      }
    } catch (e) {
      // Swallow — the cancel itself succeeded.
      captureException(e, { tags: { layer: 'me-self-cancel', step: 'email' } });
    }

    revalidatePath(`/[locale]/me/[token]`, 'page');

    return ok({
      cancelled: true,
      refunded,
      withinNoRefundWindow,
      minsCancelBefore: minsBefore,
    });
  } catch (e) {
    captureException(e, { tags: { layer: 'me-self-cancel' } });
    return err('UNEXPECTED');
  }
}
