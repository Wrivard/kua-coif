/**
 * Stripe.js browser singleton — Phase 56.
 *
 * The `@stripe/stripe-js` SDK is async-loaded so the script tag only
 * goes out when something actually needs Stripe. We cache the Promise
 * at module scope so multiple Elements providers on the same page
 * share one Stripe instance.
 *
 * `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is the publishable key — safe
 * to expose, scoped per-environment. When absent, `stripeClientConfigured()`
 * returns false and the booking wizard treats deposit collection as
 * disabled (pay-at-shop fallback).
 *
 * Pattern lifted from the official Stripe docs:
 * https://stripe.com/docs/stripe-js/react#elements-provider
 */

import { loadStripe, type Stripe } from '@stripe/stripe-js';

let stripePromise: Promise<Stripe | null> | null = null;

export function getStripeClient(): Promise<Stripe | null> {
  if (stripePromise) return stripePromise;
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!key) {
    // Resolve to null rather than throwing so callers can branch on
    // the resolved value. Branch happens in `stripeClientConfigured()`
    // before invocation in normal flow.
    stripePromise = Promise.resolve(null);
    return stripePromise;
  }
  stripePromise = loadStripe(key);
  return stripePromise;
}

export function stripeClientConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
}
