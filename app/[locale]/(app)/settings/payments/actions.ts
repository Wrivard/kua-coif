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
import { captureException } from '@/lib/observability';
import { paymentProfileSchema } from './schema';

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
      return ok({ url });
    } catch (e) {
      captureException(e, {
        tags: { layer: 'stripe-connect', action: 'openStripeDashboard' },
      });
      return err('UNEXPECTED');
    }
  },
});
