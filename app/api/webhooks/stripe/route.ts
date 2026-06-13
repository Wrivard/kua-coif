import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { getStripe, stripeConfigured } from '@/lib/stripe/server';
import { mapAccountToStatus } from '@/lib/stripe/connect';
import { mapIntentStatus, markRefundedByIntent } from '@/lib/stripe/payments';
import { sendSlackDisputeNotification } from '@/lib/notifications/slack';
import { captureException } from '@/lib/observability';
// Aliased: this file has a local `shopLocale` variable for the resolved value.
import { shopLocale as toShopLocale } from '@/lib/i18n-locale';
import type Stripe from 'stripe';

/**
 * Stripe webhook receiver â€” Phase 28.
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
 * we set `dynamic = 'force-dynamic'` â€” Next.js must not cache the
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
    // Misconfiguration: STRIPE_SECRET_KEY is set (stripeConfigured passed) but
    // the signing secret is missing, so we can't verify ANY event. Each one
    // 500s and Stripe drops it after the 3-day retry window â€” a silent,
    // multi-day payment/refund desync. Capture so it surfaces on the very
    // first event instead of going unnoticed.
    captureException(
      new Error(
        '[stripe-webhook] STRIPE_WEBHOOK_SECRET missing â€” incoming events cannot be verified',
      ),
      { tags: { layer: 'stripe-webhook', stage: 'config' } },
    );
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
    // 5xx â€” Stripe would retry endlessly. 400 tells them to stop.
    captureException(e, { tags: { layer: 'stripe-webhook', stage: 'signature' } });
    return NextResponse.json({ ok: false, error: 'invalid_signature' }, { status: 400 });
  }

  // 3. Phase B â€” event-ID dedupe. Stripe retries failed deliveries for
  //    up to 3 days; without this guard, the same event can arrive
  //    twice and we'd re-apply the handler.
  //
  //    Phase B SR (audit fix) â€” the original check was
  //    `data.length === 0 && !error`, which assumed Supabase would
  //    return an empty array on conflict. Reality: Postgres raises
  //    a unique_violation (code 23505) and Supabase forwards it as
  //    `{ data: null, error: { code: '23505', ... } }`. So the old
  //    check fell through to the handler and the dedupe never
  //    actually held â€” idempotency was nominal.
  //
  //    Correct pattern: branch on `error.code === '23505'`. Any other
  //    error is a real DB problem; we log it but proceed to the
  //    handler ("fail open" â€” better to risk processing an event
  //    twice than drop a `charge.refunded` and leave money out of
  //    sync).
  const admin = createSupabaseServiceRoleClient();
  const dedupeRes = await admin
    .from('stripe_events')
    .insert({ id: event.id, event_type: event.type })
    .select('id');
  const dedupeError = (dedupeRes as { error: { code?: string; message?: string } | null }).error;
  if (dedupeError) {
    if (dedupeError.code === '23505') {
      // Already processed â€” Stripe retried an event we already saw.
      // At-most-once delivery semantics held; return 200 immediately
      // so Stripe stops retrying.
      // FIN-BE-02: skip ONLY if a prior delivery actually COMPLETED. A row with
      // processed_at null is a lock from a delivery whose handler did not finish
      // (transient failure) -> re-process on this retry instead of losing the
      // money event. (processed_at lands in db/types.ts on the next post-deploy
      // `pnpm db:types` regen; cast until then.)
      const existing = (await admin
        .from('stripe_events')
        .select('*')
        .eq('id', event.id)
        .maybeSingle()) as unknown as { data: { processed_at: string | null } | null };
      if (existing.data?.processed_at) {
        return NextResponse.json({ ok: true, skipped: 'already_processed' });
      }
    }
    // Some other DB issue (timeout, connection blip, RLS mis-grant).
    // Log it for visibility but proceed to the handler â€” we'd rather
    // re-process an event than miss one.
    // Only a genuine non-23505 DB error is worth logging; a 23505 with
    // processed_at null already fell through above (a legitimate re-process).
    if (dedupeError.code !== '23505') {
      captureException(
        new Error(`[stripe-webhook] dedupe insert failed: ${dedupeError.message ?? 'unknown'}`),
        {
          tags: { layer: 'stripe-webhook', stage: 'dedupe' },
          extra: { eventId: event.id, eventType: event.type, code: dedupeError.code ?? '' },
        },
      );
    }
  }

  // 4. Route by event type. Defensive switch â€” unknown events return 200
  //    so Stripe doesn't retry, but we log them so we notice if Stripe
  //    starts sending something we should be handling.
  try {
    switch (event.type) {
      case 'account.updated': {
        const account = event.data.object as Stripe.Account;
        await persistAccountStatus(account);
        break;
      }
      // Phase 38 â€” payment lifecycle.
      case 'payment_intent.succeeded':
      case 'payment_intent.payment_failed':
      case 'payment_intent.processing':
      case 'payment_intent.canceled': {
        const intent = event.data.object as Stripe.PaymentIntent;
        await persistPaymentStatus(intent);
        break;
      }
      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        // `payment_intent` is a string when retrieved from a webhook
        // event. Refund events always carry it for refunds tied to an
        // intent (not legacy charges).
        const intentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : null;
        if (intentId) {
          // FIN — payment_status is binary (no partial state). Only a FULL
          // refund flips to 'refunded': netRevenue/excludeRefunded treat
          // 'refunded' as zero revenue, so marking a partial would erase the
          // whole booking's revenue + the barber's commission. Guard: a falsy
          // amount ⇒ treat as full (preserve the prior behavior).
          const fullyRefunded = !charge.amount || charge.amount_refunded >= charge.amount;
          if (fullyRefunded) {
            await persistRefundForIntent(intentId);
          } else {
            captureException(
              new Error('[stripe-webhook] partial refund needs manual reconciliation'),
              {
                tags: { layer: 'stripe-webhook', stage: 'partial-refund' },
                extra: {
                  intentId,
                  chargeId: charge.id,
                  amount: charge.amount,
                  amountRefunded: charge.amount_refunded,
                },
              },
            );
          }
        }
        break;
      }
      // Phase H â€” refund failures.
      //
      // `charge.refunded` fires when we ASK Stripe for a refund. But the
      // money movement is async (especially for ACH/SEPA destinations):
      // the refund can FAIL hours later if the destination account
      // rejects it (closed account, frozen, etc.). When that happens
      // Stripe fires `charge.refund.updated` with `refund.status='failed'`
      // and the money returns to the platform. Without handling this,
      // `payment_status` stays at 'refunded' forever even though the
      // customer never got their money back â€” silent correctness bug.
      //
      // On 'failed' we flip payment_status back to 'paid' so the admin
      // drawer surfaces the row as needing attention. Owner can then
      // re-try the refund via a different method.
      case 'charge.refund.updated': {
        const refund = event.data.object as Stripe.Refund;
        const intentId = typeof refund.payment_intent === 'string' ? refund.payment_intent : null;
        if (intentId && refund.status === 'failed') {
          await revertRefundForIntent(intentId, refund.id);
        }
        break;
      }
      // Phase B â€” chargeback / dispute lifecycle.
      case 'charge.dispute.created':
      case 'charge.dispute.updated':
      case 'charge.dispute.closed': {
        const dispute = event.data.object as Stripe.Dispute;
        await persistDispute(dispute, event.type === 'charge.dispute.created');
        break;
      }
      // Phase H â€” Stripe Radar fraud signal.
      //
      // Fires hours-to-days BEFORE the bank actually disputes the
      // charge, giving us a window to refund proactively (avoid the
      // chargeback fee + the dispute response burden). We don't refund
      // automatically here â€” that's a product decision per shop â€”
      // but we log to Sentry with `severity:fraud-warning` so the
      // owner can investigate in the Stripe dashboard.
      //
      // Future: surface this as a shop-side alert ("we got a fraud
      // warning on this booking â€” review before the appointment").
      case 'radar.early_fraud_warning.created': {
        const warning = event.data.object as Stripe.Radar.EarlyFraudWarning;
        const chargeId =
          typeof warning.charge === 'string' ? warning.charge : (warning.charge?.id ?? null);
        captureException(new Error(`[stripe-webhook] Radar fraud warning: ${warning.id}`), {
          tags: { layer: 'stripe-webhook', stage: 'fraud-warning' },
          extra: {
            warningId: warning.id,
            chargeId,
            actionable: warning.actionable,
            fraudType: warning.fraud_type,
          },
        });
        break;
      }
      // Future:
      //   - 'payout.created' (notify shop owner of incoming payout)
      default: {
        // Silently accept â€” Stripe sends lots of events we don't care
        // about (e.g., balance.available). Logging them all would be noisy.
        break;
      }
    }
    // FIN-BE-02: handler completed -> mark the event processed so a future
    // Stripe retry skips it. Best-effort: the handler already succeeded, so a
    // failed bookkeeping write must not 500 (that would needlessly re-run a
    // successful money handler); worst case processed_at stays null and a retry
    // re-processes (handlers are idempotent). processed_at lands in db/types.ts
    // on the next post-deploy regen; cast until then.
    const markRes = await admin
      .from('stripe_events')
      .update({ processed_at: new Date().toISOString() } as never)
      .eq('id', event.id);
    const markError = (markRes as { error: { message?: string } | null }).error;
    if (markError) {
      captureException(
        new Error(`[stripe-webhook] mark-processed failed: ${markError.message ?? 'unknown'}`),
        {
          tags: { layer: 'stripe-webhook', stage: 'mark-processed' },
          extra: { eventId: event.id, eventType: event.type },
        },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    captureException(e, {
      tags: { layer: 'stripe-webhook', stage: 'handler', event: event.type },
    });
    // Phase B â€” 500 still triggers Stripe retry, but the dedupe row
    // above guarantees we won't double-process on the retry. Trade-off
    // is that a permanently-broken handler will silently no-op on
    // every subsequent retry attempt â€” Sentry tags surface the issue
    // so we notice before the 3-day retry window closes.
    return NextResponse.json({ ok: false, error: 'handler_failed' }, { status: 500 });
  }
}

/**
 * Upsert the cached connect status. Uses service-role because the webhook
 * has no Supabase auth context â€” Stripe is calling us, not a user.
 *
 * Looks up the shop by `stripe_account_id` (unique-indexed in the
 * migration), updates the status. If no shop matches we silently no-op:
 * that means the account belongs to a different installation of the app
 * or the row was deleted â€” neither is our problem.
 */
async function persistAccountStatus(account: Stripe.Account): Promise<void> {
  const status = mapAccountToStatus(account);
  const admin = createSupabaseServiceRoleClient();
  await admin
    .from('shops')
    .update({ stripe_connect_status: status })
    .eq('stripe_account_id', account.id);
}

/**
 * Update the appointment's payment_status from a PaymentIntent event.
 * Looked up by the intent ID (unique-indexed in the appointment_payments
 * migration). No-op when no row matches â€” happens during partial
 * deploys or for intents we didn't create (Stripe's webhook is per
 * project, not per intent).
 */
async function persistPaymentStatus(intent: Stripe.PaymentIntent): Promise<void> {
  const status = mapIntentStatus(intent.status);
  const admin = createSupabaseServiceRoleClient();
  // Phase H â€” capture the count so we can warn when 0 rows match.
  // A 0-row match for `payment_intent.succeeded` is suspicious: either
  // (a) the appointment hasn't been inserted yet (race with the
  // booking action), (b) the PI belongs to a different KÃ¼a install,
  // or (c) the row was deleted (Loi 25 anonymization). Phase A SR
  // pre-flips to 'paid' at insert, so case (a) is mostly closed â€”
  // but `payment_intent.processing` can still race. We log to Sentry
  // with the intent ID so an operator can grep the audit_log + Stripe
  // dashboard and reconcile manually.
  const updateRes = await admin
    .from('appointments')
    .update({ payment_status: status })
    .eq('payment_intent_id', intent.id)
    .select('id');
  const matched = ((updateRes.data as Array<{ id: string }> | null) ?? []).length;
  if (matched === 0 && (status === 'paid' || status === 'pending')) {
    captureException(new Error(`[stripe-webhook] orphan PI: ${intent.id} (${status})`), {
      tags: { layer: 'stripe-webhook', stage: 'orphan-pi', status },
      extra: {
        intentId: intent.id,
        amount: intent.amount,
        destination:
          typeof intent.transfer_data?.destination === 'string'
            ? intent.transfer_data.destination
            : null,
      },
    });
  }
}

/**
 * Mark an appointment refunded. Triggered by `charge.refunded` (Stripe
 * dashboard-initiated refunds also fire this event, so we get them for
 * free).
 */
async function persistRefundForIntent(intentId: string): Promise<void> {
  const admin = createSupabaseServiceRoleClient();
  // Same shared writer the app-side refund call-sites use, so the webhook and
  // synchronous writes can never drift apart.
  await markRefundedByIntent(admin, intentId);
}

/**
 * Phase H â€” undo a refund that failed async. Triggered by
 * `charge.refund.updated` with `refund.status='failed'`. Flips
 * `payment_status` back to 'paid' so the admin drawer surfaces the
 * row as needing attention. Also alerts via Sentry so the operator
 * notices before the customer complains.
 *
 * Why not also flip cancelled appointments back to 'booked' on failed
 * refund: the cancel was an independent decision (admin clicked
 * Cancel & Refund, customer self-cancelled). The refund failing
 * doesn't un-cancel the appointment â€” just means the money is still
 * with us instead of moved back. Owner can refund again via a
 * different mechanism (wire, check, in-person credit).
 */
async function revertRefundForIntent(intentId: string, refundId: string): Promise<void> {
  const admin = createSupabaseServiceRoleClient();
  await admin
    .from('appointments')
    .update({ payment_status: 'paid' })
    .eq('payment_intent_id', intentId)
    .eq('payment_status', 'refunded'); // only flip back if WE said refunded
  captureException(new Error(`[stripe-webhook] refund failed: ${refundId} on ${intentId}`), {
    tags: { layer: 'stripe-webhook', stage: 'refund-failed' },
    extra: { intentId, refundId },
  });
}

/**
 * Phase B â€” persist a Stripe dispute and (on first creation) fire a
 * Slack alert to the shop owner.
 *
 * The dispute may not be tied to any KÃ¼a appointment (a refund-gone-
 * wrong on a manual charge, a dispute on a long-cancelled appointment
 * whose row was hard-deleted, etc.). We try to link via the PaymentIntent
 * â†’ appointment join, but fall back to a NULL `appointment_id` when no
 * row matches. The dispute row still gets recorded so the owner sees
 * the alert and can investigate via the Stripe dashboard URL.
 *
 * Shop resolution: every dispute carries a `charge.application` field
 * which is null on direct charges and the Connect app ID on destination
 * charges (our model). The `charge.destination` field carries the
 * connected account ID directly. We use the latter to find the
 * matching shop row.
 *
 * Upsert pattern: ON CONFLICT (stripe_dispute_id) DO UPDATE so a
 * `charge.dispute.updated` event refreshes the status / evidence_due_by
 * fields on the existing row.
 */
async function persistDispute(dispute: Stripe.Dispute, isCreated: boolean): Promise<void> {
  const admin = createSupabaseServiceRoleClient();

  // Charge is always a string ID on the webhook event (no expansion).
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge.id;
  // PaymentIntent is the bridge to our appointment row.
  const intentId =
    typeof dispute.payment_intent === 'string'
      ? dispute.payment_intent
      : (dispute.payment_intent?.id ?? null);

  // 1. Find the appointment + shop. Both can be null â€” see jsdoc.
  let shopId: string | null = null;
  let appointmentId: string | null = null;
  let slackWebhookUrl: string | null = null;
  let shopName: string | null = null;
  let shopLocale: 'fr' | 'en' = 'fr';

  if (intentId) {
    const apptRes = await admin
      .from('appointments')
      .select('id, shop_id, shop:shops(name, slack_webhook_url, default_language)')
      .eq('payment_intent_id', intentId)
      .limit(1);
    const row = ((apptRes.data as Array<{
      id: string;
      shop_id: string;
      shop: {
        name: string;
        slack_webhook_url: string | null;
        default_language: string | null;
      } | null;
    }> | null) ?? [])[0];
    if (row) {
      appointmentId = row.id;
      shopId = row.shop_id;
      shopName = row.shop?.name ?? null;
      slackWebhookUrl = row.shop?.slack_webhook_url ?? null;
      shopLocale = toShopLocale(row.shop?.default_language);
    }
  }

  // Phase H â€” fallback resolution via charge.destination when no
  // appointment matched (Loi 25 anonymization, hard-deleted rows, etc).
  // The dispute object embeds the underlying charge; we retrieve it
  // from Stripe to read `transfer_data.destination`, which is the
  // connected account ID. That maps 1:1 to shops.stripe_account_id.
  //
  // Why not expand the charge inline on the dispute webhook payload:
  // Stripe doesn't expand by default and our `event.data.object` is
  // the dispute, not the charge. Retrieving is one extra API call per
  // orphan dispute â€” rare enough to be fine.
  if (!shopId && chargeId) {
    try {
      const stripe = getStripe();
      const charge = await stripe.charges.retrieve(chargeId);
      // Stripe deprecated the top-level `destination` field in favor
      // of `transfer_data.destination` for Connect destination charges.
      // We only use the new shape (which is what `createDepositPaymentIntent`
      // mints), so this is the only candidate.
      const accountId =
        typeof charge.transfer_data?.destination === 'string'
          ? charge.transfer_data.destination
          : (charge.transfer_data?.destination?.id ?? null);
      if (accountId) {
        const shopRes = await admin
          .from('shops')
          .select('id, name, slack_webhook_url, default_language')
          .eq('stripe_account_id', accountId)
          .limit(1);
        const shopRow = ((shopRes.data as Array<{
          id: string;
          name: string;
          slack_webhook_url: string | null;
          default_language: string | null;
        }> | null) ?? [])[0];
        if (shopRow) {
          shopId = shopRow.id;
          shopName = shopRow.name;
          slackWebhookUrl = shopRow.slack_webhook_url;
          shopLocale = toShopLocale(shopRow.default_language);
        }
      }
    } catch (e) {
      // Stripe retrieve failed â€” fall through to the orphan branch
      // below. The disputeId still ends up in Sentry.
      captureException(e, {
        tags: { layer: 'stripe-webhook', stage: 'dispute-fallback-retrieve' },
        extra: { disputeId: dispute.id, chargeId },
      });
    }
  }

  // Without a shop we can't satisfy the NOT NULL on disputes.shop_id.
  // Log + skip â€” Sentry surfaces the orphan for investigation.
  if (!shopId) {
    captureException(new Error('[disputes] no matching shop for dispute'), {
      tags: { layer: 'stripe-webhook', kind: 'dispute-orphan' },
      extra: { disputeId: dispute.id, chargeId, intentId },
    });
    return;
  }

  // 2. Upsert the dispute row.
  await admin
    .from('disputes')
    .upsert(
      {
        shop_id: shopId,
        appointment_id: appointmentId,
        stripe_dispute_id: dispute.id,
        stripe_charge_id: chargeId,
        stripe_payment_intent_id: intentId,
        amount_cents: dispute.amount,
        currency: dispute.currency,
        reason: dispute.reason,
        status: dispute.status,
        evidence_due_by: dispute.evidence_details?.due_by
          ? new Date(dispute.evidence_details.due_by * 1000).toISOString()
          : null,
      },
      { onConflict: 'stripe_dispute_id' },
    )
    .select('id');

  // 3. On creation only, fire the Slack alert. `charge.dispute.updated`
  //    and `.closed` don't re-notify â€” the owner already knows; status
  //    changes are visible via the upserted row + the dashboard URL.
  if (isCreated && slackWebhookUrl) {
    void sendSlackDisputeNotification(slackWebhookUrl, {
      shopName: shopName ?? 'Unknown shop',
      locale: shopLocale,
      amount: dispute.amount / 100,
      reason: dispute.reason,
      evidenceDueByIso: dispute.evidence_details?.due_by
        ? new Date(dispute.evidence_details.due_by * 1000).toISOString()
        : null,
      stripeDashboardUrl: `https://dashboard.stripe.com/payments/${intentId ?? chargeId}`,
    });
  }
}
