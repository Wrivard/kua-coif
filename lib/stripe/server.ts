/**
 * Stripe SDK factory — Phase 28.
 *
 * Activation:
 *   1. Create a Stripe account (https://dashboard.stripe.com/register).
 *   2. Test mode: copy the test Secret Key from the dashboard, set
 *      `STRIPE_SECRET_KEY=sk_test_...` in `.env.local` + Vercel Preview.
 *   3. Live mode (when ready to charge real cards): replace with
 *      `sk_live_...` in Vercel Production. Keep test mode in Preview so
 *      PR builds don't bill real shops.
 *   4. Webhook signing secret (Phase 28c): create a webhook endpoint in
 *      the Stripe dashboard pointing at
 *      `https://<your-domain>/api/webhooks/stripe`, copy the signing
 *      secret to `STRIPE_WEBHOOK_SECRET`.
 *
 * Until `STRIPE_SECRET_KEY` is set, every helper in `lib/stripe/*`
 * short-circuits with a "not configured" result. The UI in
 * `/settings/payments` reads `stripeConfigured()` to decide whether to
 * show the Connect button at all.
 *
 * Note on API versions: pinning to a specific date keeps Stripe from
 * silently changing response shapes on us. Bump it deliberately when we
 * audit a new release.
 */
import Stripe from 'stripe';

// Pin the API version. Stripe rejects unknown versions, so updating this
// requires checking https://docs.stripe.com/upgrades for the latest
// stable date string. Typed as `any` because stripe@22 dropped the
// `LatestApiVersion` type alias but still validates the date string.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const API_VERSION = '2025-09-30.clover' as any;

let cachedClient: Stripe | null = null;

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/**
 * Singleton Stripe client. Throws if the env var is missing — callers
 * should gate via `stripeConfigured()` first.
 *
 * The Stripe SDK is heavy (~200KB minified) so we lazy-instantiate via
 * the module-level cache. The cache is per-process which is exactly what
 * we want on Vercel (one client per warm function instance).
 */
export function getStripe(): Stripe {
  if (cachedClient) return cachedClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('[stripe] STRIPE_SECRET_KEY is missing — Stripe is not configured.');
  }
  cachedClient = new Stripe(key, {
    apiVersion: API_VERSION,
    // Identify ourselves in Stripe's request logs — makes debugging
    // production issues much easier when Stripe support asks.
    appInfo: {
      name: 'kua-coiffure',
      version: '1.0.0',
    },
    // Default of 80s plus the 10s Vercel Hobby cap on serverless functions
    // means a single Stripe call could exceed our budget. Cap at 15s so
    // we error fast and the user sees a real error message instead of a
    // function timeout.
    timeout: 15_000,
    maxNetworkRetries: 2,
  });
  return cachedClient;
}
