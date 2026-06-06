/**
 * Stripe payment reconciliation — a safety net for missed webhooks.
 *
 * The webhook (/api/webhooks/stripe) keeps `appointments.payment_status` in
 * sync with Stripe. But a dropped/undelivered `payment_intent.succeeded`
 * (or `.payment_failed` / `.canceled`) leaves a row stuck at 'pending'
 * even though Stripe long since settled the intent. Stripe retries failed
 * deliveries for 3 days, so misses are rare — this cron is the belt to the
 * webhook's braces.
 *
 * Scope (V1): rows still at 'pending' that carry a payment_intent_id, whose
 * start_at is within the lookback window. 'pending' is the only status that
 * is genuinely transient and webhook-derived, so it drops out of the set
 * once resolved — no fixed-cap tail-starvation, and the set is normally
 * near-empty. We re-retrieve each PaymentIntent and re-derive the canonical
 * status the webhook would have written; only rows that actually differ are
 * updated. Refund reconciliation ('paid' -> 'refunded') is intentionally
 * out of V1: the `charge.refunded` webhook plus the synchronous
 * markRefundedByIntent write at every app refund call-site already cover it.
 *
 * Idempotent and best-effort by design — re-deriving from Stripe's source
 * of truth never double-applies, and a single row's failure is captured to
 * Sentry without aborting the run.
 */
import type Stripe from 'stripe';
import { mapIntentStatus } from './payments';
import { captureException } from '@/lib/observability';

export type PaymentStatus = ReturnType<typeof mapIntentStatus>;

/**
 * Max rows reconciled per run. Bounds the sequential Stripe retrieves so
 * the serverless function stays under the Hobby 10s maxDuration. The
 * 'pending' set is normally tiny; this only bites a pathological backlog,
 * which the next run continues (resolved rows drop out of the query).
 */
export const RECONCILE_BATCH_LIMIT = 40;

/** Lookback on start_at so an abandoned-pending row isn't retried forever. */
export const RECONCILE_LOOKBACK_DAYS = 30;

/**
 * Pure decision: given the current DB status and the live PaymentIntent
 * status, what status SHOULD the row have, and is that a change? Mirrors
 * the webhook's persistPaymentStatus (mapIntentStatus).
 */
export function reconcileDecision(args: {
  current: PaymentStatus;
  intentStatus: Stripe.PaymentIntent.Status;
}): { canonical: PaymentStatus; changed: boolean } {
  const canonical = mapIntentStatus(args.intentStatus);
  return { canonical, changed: canonical !== args.current };
}

type ReconcileRow = {
  id: string;
  payment_intent_id: string;
  payment_status: PaymentStatus;
};

export type ReconcileSummary = {
  checked: number;
  updated: number;
  failed: number;
  capped: boolean;
};

export async function reconcileStripePayments({
  sb,
  stripe,
  lookbackDays = RECONCILE_LOOKBACK_DAYS,
  limit = RECONCILE_BATCH_LIMIT,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any;
  stripe: Stripe;
  lookbackDays?: number;
  limit?: number;
}): Promise<ReconcileSummary> {
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  const res = await sb
    .from('appointments')
    .select('id, payment_intent_id, payment_status')
    .eq('payment_status', 'pending')
    .not('payment_intent_id', 'is', null)
    .gte('start_at', since)
    .limit(limit + 1);

  const rows = (res.data as ReconcileRow[] | null) ?? [];
  const capped = rows.length > limit;
  const batch = capped ? rows.slice(0, limit) : rows;

  let updated = 0;
  let failed = 0;

  for (const row of batch) {
    try {
      const intent = await stripe.paymentIntents.retrieve(row.payment_intent_id);
      const { canonical, changed } = reconcileDecision({
        current: row.payment_status,
        intentStatus: intent.status,
      });
      if (!changed) continue;

      await sb.from('appointments').update({ payment_status: canonical }).eq('id', row.id);
      updated += 1;
      // A reconciled row means a webhook was missed — surface each one so a
      // systemic delivery problem is visible, not just silently patched.
      captureException(
        new Error(`[stripe-reconcile] ${row.id}: ${row.payment_status} -> ${canonical}`),
        {
          tags: { layer: 'stripe-reconcile', from: row.payment_status, to: canonical },
          extra: { appointmentId: row.id, intentId: row.payment_intent_id },
        },
      );
    } catch (e) {
      failed += 1;
      captureException(e, {
        tags: { layer: 'stripe-reconcile', stage: 'reconcile-row' },
        extra: { appointmentId: row.id, intentId: row.payment_intent_id },
      });
    }
  }

  if (capped) {
    captureException(
      new Error(`[stripe-reconcile] batch capped at ${limit} rows — more remain for the next run`),
      { tags: { layer: 'stripe-reconcile', stage: 'capped' } },
    );
  }

  return { checked: batch.length, updated, failed, capped };
}
