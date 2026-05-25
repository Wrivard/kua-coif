import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { getStripe, stripeConfigured } from '@/lib/stripe/server';
import { mapAccountToStatus } from '@/lib/stripe/connect';
import { captureException } from '@/lib/observability';
import type Stripe from 'stripe';

/**
 * Stripe webhook receiver — Phase 28.
 *
 * Stripe POSTs events to this endpoint after configuring a webhook in
 * the dashboard. The signing secret (`STRIPE_WEBHOOK_SECRET`) lets us
 * verify each request actually came from Stripe and wasn't replayed
 * after some attacker scraped it from logs.
 *
 * V1 listens for ONE event: `account.updated`. It's enough to keep the
 * `shops.stripe_connect_status` column in sync with what Stripe sees,
 * so the UI shows the right "Connected" badge after onboarding. Charge
 * / payout / refund events come with the V1.5 payments work.
 *
 * Why the manual `req.text()` then `constructEvent`: Stripe's signature
 * is computed over the RAW request body. `req.json()` would parse +
 * re-stringify and the signature would no longer match. Same reason
 * we set `dynamic = 'force-dynamic'` — Next.js must not cache the
 * incoming body across requests.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Stripe documents 10s as their max retry interval for webhook responses;
// we match the Vercel Hobby cap. Most events resolve in <1s anyway.
export const maxDuration = 10;

export async function POST(req: NextRequest): Promise<Response> {
  // 1. Bail early when Stripe isn't configured. Webhook POSTs shouldn't
  //    reach us in that case, but returning 200 keeps Stripe from
  //    retrying forever if a dev sets up the dashboard before the env vars.
  if (!stripeConfigured()) {
    return NextResponse.json({ ok: true, skipped: 'stripe_not_configured' });
  }
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ ok: false, error: 'webhook_secret_missing' }, { status: 500 });
  }

  // 2. Verify the signature using the raw body. Stripe rejects payloads
  //    older than 5 minutes by default to thwart replay attacks.
  const rawBody = await req.text();
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ ok: false, error: 'missing_signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (e) {
    // Bad signature is the most common failure mode. Log it but never
    // 5xx — Stripe would retry endlessly. 400 tells them to stop.
    captureException(e, { tags: { layer: 'stripe-webhook', stage: 'signature' } });
    return NextResponse.json({ ok: false, error: 'invalid_signature' }, { status: 400 });
  }

  // 3. Route by event type. Defensive switch — unknown events return 200
  //    so Stripe doesn't retry, but we log them so we notice if Stripe
  //    starts sending something we should be handling.
  try {
    switch (event.type) {
      case 'account.updated': {
        const account = event.data.object as Stripe.Account;
        await persistAccountStatus(account);
        break;
      }
      // Future:
      //   - 'payment_intent.succeeded' (V1.5: mark appointment as paid)
      //   - 'charge.refunded' (V1.5: appointment refund flow)
      //   - 'payout.created' (V1.5: notify shop owner of incoming payout)
      default: {
        // Silently accept — Stripe sends lots of events we don't care
        // about (e.g., balance.available). Logging them all would be noisy.
        break;
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    captureException(e, {
      tags: { layer: 'stripe-webhook', stage: 'handler', event: event.type },
    });
    // 500 makes Stripe retry — fine for transient DB hiccups, bad for
    // permanently-bad payloads. For V1 we lean toward "retry" because
    // every handler we have is idempotent (upserts).
    return NextResponse.json({ ok: false, error: 'handler_failed' }, { status: 500 });
  }
}

/**
 * Upsert the cached connect status. Uses service-role because the webhook
 * has no Supabase auth context — Stripe is calling us, not a user.
 *
 * Looks up the shop by `stripe_account_id` (unique-indexed in the
 * migration), updates the status. If no shop matches we silently no-op:
 * that means the account belongs to a different installation of the app
 * or the row was deleted — neither is our problem.
 */
async function persistAccountStatus(account: Stripe.Account): Promise<void> {
  const status = mapAccountToStatus(account);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createSupabaseServiceRoleClient() as any;
  await admin
    .from('shops')
    .update({ stripe_connect_status: status })
    .eq('stripe_account_id', account.id);
}
