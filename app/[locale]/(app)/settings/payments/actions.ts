'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { logAuditAction } from '@/lib/audit-log';
import { stripeConfigured } from '@/lib/stripe/server';
import {
  createDashboardLoginLink,
  createExpressAccount,
  createOnboardingLink,
  fetchAccountStatus,
} from '@/lib/stripe/connect';
import { quickbooksConfigured, revokeQbToken } from '@/lib/quickbooks/server';
import { decrypt, encryptionConfigured } from '@/lib/crypto/aes';
import { captureException } from '@/lib/observability';
import { paymentProfileSchema, paymentModeSchema } from './schema';

const PATH = '/settings/payments';

/**
 * Resolve the origin of the current request so we can build absolute
 * return/refresh URLs for Stripe onboarding links. Falls back to
 * NEXT_PUBLIC_SITE_URL when the headers aren't reliable (e.g., local dev
 * behind a proxy).
 */
function siteOrigin(): string {
  const h = headers();
  const fromHeader = h.get('origin') ?? h.get('referer');
  if (fromHeader) {
    try {
      return new URL(fromHeader).origin;
    } catch {
      // fall through
    }
  }
  return process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
}

export const updatePaymentProfile = withAction({
  schema: paymentProfileSchema,
  minRole: 'owner',
  run: async (input, ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createSupabaseServerClient() as any;
    const { error } = await sb
      .from('payment_profiles')
      .upsert({ shop_id: ctx.shopId, ...input }, { onConflict: 'shop_id' });
    if (error) return err('UNEXPECTED');
    // Audit log purposefully omits the input payload — payment profiles can
    // include sensitive data even though our schema only allows safe fields.
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'payment_profiles',
    });
    revalidatePath(PATH);
    return ok({ ok: true });
  },
});

/**
 * Phase D — flip the shop between three payment modes:
 *
 *   - 'full'    : booking widget charges the entire service price upfront
 *   - 'deposit' : booking widget charges the per-service deposit
 *   - 'none'    : booking widget skips PaymentElement, owner collects in-shop
 *
 * Guard: switching INTO 'full' or 'deposit' requires Stripe Connect to
 * be `active`. Switching to 'none' always works regardless of Connect
 * status (lets a shop opt out of online payment without disconnecting
 * Stripe entirely). The widget's `createBookingPaymentIntent` action
 * has its own runtime guards, so a stale UI can't cause a customer-facing
 * error — they'd just see the "shop not connected" branch.
 */
export const updatePaymentMode = withAction({
  schema: paymentModeSchema,
  minRole: 'owner',
  run: async (input, ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseServiceRoleClient() as any;
    // Guard: 'full' / 'deposit' need Stripe Connect active.
    if (input.payment_mode !== 'none') {
      const statusRes = await admin
        .from('shops')
        .select('stripe_connect_status')
        .eq('id', ctx.shopId)
        .single();
      const status = (statusRes.data as { stripe_connect_status: string } | null)
        ?.stripe_connect_status;
      if (status !== 'active') return err('INVALID_INPUT', { payment_mode: 'stripe_required' });
    }
    const { error } = await admin
      .from('shops')
      .update({ payment_mode: input.payment_mode })
      .eq('id', ctx.shopId);
    if (error) return err('UNEXPECTED');
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'shops',
      entityId: ctx.shopId,
      diff: { payment_mode: input.payment_mode },
    });
    revalidatePath(PATH);
    return ok({ ok: true });
  },
});

// ---------------------------------------------------------------------------
// Stripe Connect — Phase 28
//
// All three actions short-circuit with a clear errorCode when Stripe is
// not configured (env vars absent). The UI gates the buttons behind
// `stripeConfigured()` so this is mostly defensive.
// ---------------------------------------------------------------------------

/**
 * Kick off (or resume) Stripe Connect onboarding. Returns a Stripe-hosted
 * URL the client should redirect to. The link is one-time-use and expires
 * after ~5 min — never persist it.
 */
export const startStripeConnect = withAction<never, { url: string }>({
  minRole: 'owner',
  run: async (_input, ctx) => {
    if (!stripeConfigured()) return err('UNEXPECTED');

    // Read the shop + owner email. Service-role for the shop read so we
    // can write the new stripe_account_id back without RLS friction.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseServiceRoleClient() as any;
    const shopRes = await admin
      .from('shops')
      .select('id, name, email, stripe_account_id')
      .eq('id', ctx.shopId)
      .single();
    const shop = shopRes.data as {
      id: string;
      name: string;
      email: string | null;
      stripe_account_id: string | null;
    } | null;
    if (!shop) return err('NOT_FOUND');

    try {
      let accountId = shop.stripe_account_id;

      // First-time onboarding → create the Express account and persist
      // its ID. Subsequent calls reuse the same account so the user can
      // resume an interrupted onboarding without losing partial state.
      if (!accountId) {
        const account = await createExpressAccount({
          email: shop.email ?? `noreply+${shop.id}@kua.quebec`,
          shopName: shop.name,
        });
        accountId = account.id;
        await admin
          .from('shops')
          .update({ stripe_account_id: accountId, stripe_connect_status: 'pending' })
          .eq('id', shop.id);
        await logAuditAction({
          shopId: ctx.shopId,
          actorId: ctx.userId,
          action: 'insert',
          entity: 'shops',
          entityId: shop.id,
          diff: { stripe_account_id: accountId },
        });
      }

      const origin = siteOrigin();
      const url = await createOnboardingLink({
        accountId,
        returnUrl: `${origin}${PATH}?stripe=return`,
        refreshUrl: `${origin}${PATH}?stripe=refresh`,
      });
      return ok({ url });
    } catch (e) {
      captureException(e, {
        tags: { layer: 'stripe-connect', action: 'startStripeConnect' },
      });
      return err('UNEXPECTED');
    }
  },
});

/**
 * Pull fresh account state from Stripe and persist the mapped status.
 * Used after the user returns from onboarding (the webhook may not have
 * fired yet) and for a manual "Refresh status" button.
 */
export const refreshStripeStatus = withAction<never, { status: string }>({
  minRole: 'owner',
  run: async (_input, ctx) => {
    if (!stripeConfigured()) return err('UNEXPECTED');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseServiceRoleClient() as any;
    const shopRes = await admin
      .from('shops')
      .select('stripe_account_id')
      .eq('id', ctx.shopId)
      .single();
    const shop = shopRes.data as { stripe_account_id: string | null } | null;
    if (!shop?.stripe_account_id) return err('NOT_FOUND');

    try {
      const { status } = await fetchAccountStatus(shop.stripe_account_id);
      await admin.from('shops').update({ stripe_connect_status: status }).eq('id', ctx.shopId);
      // Loop 30 (P2.104) — Stripe status writes to the shop row, so it
      // belongs in the audit log alongside the other shop edits.
      await logAuditAction({
        shopId: ctx.shopId,
        actorId: ctx.userId,
        action: 'update',
        entity: 'shops',
        entityId: ctx.shopId,
        diff: { stripe_connect_status: status, source: 'stripe-refresh' },
      });
      revalidatePath(PATH);
      return ok({ status });
    } catch (e) {
      captureException(e, {
        tags: { layer: 'stripe-connect', action: 'refreshStripeStatus' },
      });
      return err('UNEXPECTED');
    }
  },
});

/**
 * Generate a one-time login link to the connected Stripe Express
 * dashboard so the shop owner can manage their account, see payouts,
 * etc. Only meaningful once `stripe_connect_status === 'active'`.
 */
export const openStripeDashboard = withAction<never, { url: string }>({
  minRole: 'owner',
  run: async (_input, ctx) => {
    if (!stripeConfigured()) return err('UNEXPECTED');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseServiceRoleClient() as any;
    const shopRes = await admin
      .from('shops')
      .select('stripe_account_id')
      .eq('id', ctx.shopId)
      .single();
    const shop = shopRes.data as { stripe_account_id: string | null } | null;
    if (!shop?.stripe_account_id) return err('NOT_FOUND');

    try {
      const url = await createDashboardLoginLink(shop.stripe_account_id);
      // Loop 30 (P2.104) — opening the Stripe dashboard gives the owner
      // direct access to money movement (payouts, refunds, disputes),
      // so the audit trail records that a session was minted. We log
      // the fact, never the URL itself (it's a bearer credential).
      await logAuditAction({
        shopId: ctx.shopId,
        actorId: ctx.userId,
        action: 'update',
        entity: 'shops',
        entityId: ctx.shopId,
        diff: { stripe_dashboard_login_link_generated: true },
      });
      return ok({ url });
    } catch (e) {
      captureException(e, {
        tags: { layer: 'stripe-connect', action: 'openStripeDashboard' },
      });
      return err('UNEXPECTED');
    }
  },
});

// ---------------------------------------------------------------------------
// QuickBooks Connect — Phase 35
// ---------------------------------------------------------------------------

/**
 * Disconnect the shop's QuickBooks connection. Revokes the token on
 * Intuit's side (so it's no longer valid even if leaked from our DB),
 * then nulls out the local columns.
 *
 * No-op when Intuit's revoke call fails — we still want the local
 * disconnect to succeed (user intent is explicit).
 */
export const disconnectQuickbooks = withAction<never, { ok: true }>({
  minRole: 'owner',
  run: async (_input, ctx) => {
    if (!quickbooksConfigured()) return err('UNEXPECTED');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseServiceRoleClient() as any;
    const shopRes = await admin
      .from('shops')
      .select('quickbooks_refresh_token_enc')
      .eq('id', ctx.shopId)
      .single();
    const shop = shopRes.data as { quickbooks_refresh_token_enc: string | null } | null;

    if (shop?.quickbooks_refresh_token_enc && encryptionConfigured()) {
      try {
        const refreshToken = decrypt(shop.quickbooks_refresh_token_enc);
        await revokeQbToken(refreshToken);
      } catch (e) {
        captureException(e, {
          tags: { layer: 'qb-connect', action: 'disconnect-revoke' },
        });
        // Continue — local disconnect below still proceeds.
      }
    }

    const { error } = await admin
      .from('shops')
      .update({
        quickbooks_realm_id: null,
        quickbooks_refresh_token_enc: null,
        quickbooks_connect_status: 'disconnected',
      })
      .eq('id', ctx.shopId);
    if (error) return err('UNEXPECTED');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'shops',
      entityId: ctx.shopId,
      diff: { quickbooks_disconnected: true },
    });
    revalidatePath(PATH);
    return ok({ ok: true });
  },
});
