/**
 * Stripe Connect Express helpers — Phase 28.
 *
 * Onboarding flow (no charges yet, V1.5 will add PaymentIntents):
 *
 *   1. Shop owner clicks "Connect Stripe" in /settings/payments.
 *      → Server Action calls `createOrGetConnectAccount(shopId, email)`.
 *        - If shop has no stripe_account_id, we create an Express account
 *          and persist the ID on `shops`.
 *        - If we already have an ID, reuse it (lets users continue an
 *          interrupted onboarding).
 *   2. Server Action calls `createOnboardingLink(accountId, returnUrl, refreshUrl)`.
 *      Returns a Stripe-hosted URL that we redirect the user to.
 *   3. User completes KYC on Stripe's pages.
 *   4. Stripe redirects to `returnUrl` regardless of success/failure.
 *   5. Stripe fires the `account.updated` webhook in the background.
 *      The handler in `app/api/webhooks/stripe/route.ts` calls
 *      `mapAccountToStatus()` and persists the new status. The
 *      /settings/payments page re-renders with the fresh badge.
 *
 * No charges code here. When V1.5 adds the booking-pays-deposit flow,
 * those helpers go into `lib/stripe/payments.ts` alongside this one.
 */
import type Stripe from 'stripe';
import { getStripe } from './server';

export type StripeConnectStatus = 'not_started' | 'pending' | 'restricted' | 'active';

/**
 * Derive our enum from the Stripe account state. The dashboard exposes
 * dozens of flags; the three that actually matter for "can this shop
 * accept charges and receive payouts" are `details_submitted`,
 * `charges_enabled`, and `payouts_enabled`. Mapping:
 *
 *   - details NOT submitted    → 'pending'    (user bailed mid-onboarding)
 *   - details YES, both flags  → 'active'
 *   - anything else            → 'restricted' (Stripe accepted but still
 *                                wants something — TOS, ID upload, etc.)
 */
export function mapAccountToStatus(account: Stripe.Account): StripeConnectStatus {
  if (!account.details_submitted) return 'pending';
  if (account.charges_enabled && account.payouts_enabled) return 'active';
  return 'restricted';
}

/**
 * Create a new Stripe Express account, or return the existing one if the
 * shop already started onboarding. The caller is responsible for
 * persisting the returned ID on `shops.stripe_account_id` after the FIRST
 * successful creation.
 *
 * `country` defaults to 'CA' (Canada) since V1's shop is Quebec-based.
 * Future multi-country support: read it from `shops.country` instead.
 *
 * `email` should be the owner's email — Stripe uses it for receipts and
 * Connect dashboard access.
 */
export async function createExpressAccount({
  email,
  country = 'CA',
  shopName,
}: {
  email: string;
  country?: string;
  shopName?: string;
}): Promise<Stripe.Account> {
  const stripe = getStripe();
  return stripe.accounts.create({
    type: 'express',
    country,
    email,
    business_profile: shopName
      ? {
          name: shopName,
          // V1 hardcodes "hair salon" MCC; V1.1 could derive from
          // shops.industry (Phase 23).
          mcc: '7230', // Beauty / Barber shops
        }
      : undefined,
    capabilities: {
      // Card payments only — the rest (ACH, SEPA, etc.) come with the
      // V1.5 payments work.
      card_payments: { requested: true },
      transfers: { requested: true },
    },
  });
}

/**
 * Generate a Stripe-hosted onboarding URL. The link is single-use and
 * expires after ~5 minutes — always call this fresh, never store it.
 *
 * `returnUrl` is hit when the user successfully completes (or quits
 * mid-flow — Stripe doesn't distinguish). `refreshUrl` is hit if the
 * link itself expires before the user finishes, so we can mint a new
 * one and continue.
 */
export async function createOnboardingLink({
  accountId,
  returnUrl,
  refreshUrl,
}: {
  accountId: string;
  returnUrl: string;
  refreshUrl: string;
}): Promise<string> {
  const stripe = getStripe();
  const link = await stripe.accountLinks.create({
    account: accountId,
    return_url: returnUrl,
    refresh_url: refreshUrl,
    type: 'account_onboarding',
  });
  return link.url;
}

/**
 * Fetch the live account state from Stripe and map to our status enum.
 * Used by the "Refresh status" button + as fallback when the webhook
 * hasn't fired yet (the return_url redirect can race the webhook).
 */
export async function fetchAccountStatus(
  accountId: string,
): Promise<{ status: StripeConnectStatus; account: Stripe.Account }> {
  const stripe = getStripe();
  const account = await stripe.accounts.retrieve(accountId);
  return { status: mapAccountToStatus(account), account };
}

/**
 * Generate a one-time login link to the Stripe Express dashboard so the
 * shop owner can see payouts, manage their bank account, etc. without
 * us having to rebuild that whole UI.
 */
export async function createDashboardLoginLink(accountId: string): Promise<string> {
  const stripe = getStripe();
  const link = await stripe.accounts.createLoginLink(accountId);
  return link.url;
}
