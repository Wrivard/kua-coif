/**
 * Loyalty program orchestration â€” Phase 43.
 *
 * Called from `updateAppointment` when the status transitions to
 * 'completed'. We look up the shop's loyalty config, decide whether the
 * transaction qualifies, and bump the client's counter (and balance if
 * the goal is hit).
 *
 * Configurable per shop in `/settings/loyalty`:
 *   - enabled                   â€” gate flag
 *   - type                      â€” 'transaction' (count visits) or 'value' (sum spent)
 *   - goal_count                â€” visits needed for a reward
 *   - min_transaction_amount    â€” minimum $ for a visit to qualify
 *   - reward_amount             â€” reward in dollars granted at goal
 *   - include_product_sales     â€” currently ignored (V1.5 retail integration)
 *   - include_tips              â€” same
 *
 * Both `type='transaction'` (count qualifying visits) and `type='value'`
 * (accumulate dollars spent toward a dollar goal) are implemented. In
 * value mode `loyalty_counter` stores cumulative CENTS spent (not a visit
 * count) and `goal_count` is read as the dollar goal; product/tips
 * inclusion flags remain deferred (the caller decides what totalAmount
 * includes).
 *
 * Best-effort by design: a loyalty update failure must NEVER fail the
 * underlying appointment status update. Errors are captured to Sentry.
 */

import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { captureException } from '@/lib/observability';

/**
 * Loop 35 (P1.92) â€” return the effective loyalty balance for a row
 * fetched with `loyalty_balance_cents` + `loyalty_balance_expires_at`.
 *
 * Lazy expiry: when the row has a balance but the expiry has passed,
 * zero the row in the DB and return 0. Callers must pass the
 * `clientId` so the helper can patch â€” and the DB write is best-
 * effort (a write failure shouldn't fail the booking, the next
 * lookup will retry).
 *
 * Pass `loyalty_balance_expires_at = null` to treat as "never
 * expires" â€” that's the legacy state of rows from before Loop 35.
 * Those won't auto-expire until the next reward is granted (which
 * sets the timestamp).
 */
export async function effectiveLoyaltyBalanceCents(args: {
  clientId: string;
  balanceCents: number;
  expiresAt: string | null;
}): Promise<number> {
  if (args.balanceCents <= 0) return 0;
  if (!args.expiresAt) return args.balanceCents;
  const expiresAt = new Date(args.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) return args.balanceCents;
  if (expiresAt.getTime() > Date.now()) return args.balanceCents;

  // Expired â€” zero the row so subsequent reads agree, then return 0.
  try {
    const admin = createSupabaseServiceRoleClient();
    await admin
      .from('clients')
      .update({ loyalty_balance_cents: 0, loyalty_balance_expires_at: null })
      .eq('id', args.clientId);
  } catch (e) {
    captureException(e, {
      tags: { layer: 'loyalty', stage: 'expire' },
      extra: { clientId: args.clientId },
    });
    // Fall through â€” return 0 even if the patch failed, so the caller
    // doesn't accidentally apply an expired credit.
  }
  return 0;
}

type LoyaltyConfig = {
  enabled: boolean;
  type: 'transaction' | 'value';
  goal_count: number;
  min_transaction_amount: number;
  reward_amount: number;
  include_product_sales: boolean;
  include_tips: boolean;
};

/**
 * Resolve the shop's loyalty config. Returns null when disabled,
 * misconfigured (goal=0), or when the row doesn't exist.
 */
async function resolveLoyaltyConfig(shopId: string): Promise<LoyaltyConfig | null> {
  const admin = createSupabaseServiceRoleClient();
  const res = await admin
    .from('loyalty_program')
    .select(
      'enabled, type, goal_count, min_transaction_amount, reward_amount, include_product_sales, include_tips',
    )
    .eq('shop_id', shopId)
    .maybeSingle();
  const row = res.data as LoyaltyConfig | null;
  if (!row || !row.enabled || row.goal_count <= 0) return null;
  return row;
}

/**
 * Pure reward calculation (no I/O) â€” the unit-testable core of the loyalty
 * engine. Transaction mode counts qualifying visits (+1 each, reset on a
 * hit). Value mode accumulates dollars spent â€” `currentCounter` carries
 * cumulative CENTS and `goalCount` is read as the dollar goal â€” carrying
 * the remainder past the goal so a large ticket keeps its progress. At
 * most one reward is granted per completion.
 */
export function computeLoyaltyProgress(args: {
  type: 'transaction' | 'value';
  currentCounter: number;
  goalCount: number;
  rewardAmount: number;
  totalAmount: number;
}): { nextCounter: number; goalReached: boolean; rewardCents: number } {
  let nextCounter: number;
  let goalReached: boolean;
  if (args.type === 'value') {
    const spentCents = Math.round(args.totalAmount * 100);
    const goalCents = Math.round(args.goalCount * 100);
    const accumulated = args.currentCounter + spentCents;
    goalReached = goalCents > 0 && accumulated >= goalCents;
    nextCounter = goalReached ? accumulated - goalCents : accumulated;
  } else {
    const incremented = args.currentCounter + 1;
    goalReached = incremented >= args.goalCount;
    nextCounter = goalReached ? 0 : incremented;
  }
  const rewardCents = goalReached ? Math.round(args.rewardAmount * 100) : 0;
  return { nextCounter, goalReached, rewardCents };
}

/**
 * Award loyalty progress for a completed appointment.
 *
 * Idempotency: callers should only invoke this on the actual
 * unpaidâ†’completed transition, not on every save. Hooking it into
 * `updateAppointment` is fine because that action is what flips the
 * status; if it gets called twice for the same status flip, the second
 * call increments the counter twice â€” defensive but rare.
 *
 * Reward logic: when (counter + 1) >= goal_count, grant the reward and
 * reset to 0. The "+ 1" is the current visit. Reset means a client
 * who hits 5/5 starts back at 0/5 for the next reward cycle.
 */
export async function awardLoyaltyOnCompletion({
  shopId,
  appointmentId,
  clientId,
  totalAmount,
}: {
  shopId: string;
  appointmentId: string;
  clientId: string | null;
  totalAmount: number;
}): Promise<void> {
  // Walk-ins (POS-lite stage 1) carry no client row — nothing to accrue
  // against, and the accrue_loyalty RPC below would otherwise get a null id.
  if (!clientId) return;
  try {
    const config = await resolveLoyaltyConfig(shopId);
    if (!config) return;

    // Below the minimum transaction amount â†’ no progress.
    if (totalAmount < config.min_transaction_amount) return;

    // SM-05 + SM-06 - apply the accrual atomically + idempotently SQL-side.
    // The accrue_loyalty RPC (migration 20260613160000) claims
    // `appointments.loyalty_awarded_at` so a re-fired completion is a no-op,
    // locks the client row so a concurrent booking debit (debit_loyalty_balance)
    // can't be lost, and writes the counter/balance relative to the locked row.
    // It mirrors computeLoyaltyProgress (kept above as the unit-tested
    // reference). Returns the reward cents granted (0 = none / already awarded).
    const admin = createSupabaseServiceRoleClient();
    const accrued = await admin.rpc('accrue_loyalty', {
      p_appointment_id: appointmentId,
      p_client_id: clientId,
      p_type: config.type,
      p_goal_count: config.goal_count,
      p_reward_cents: Math.round(config.reward_amount * 100),
      p_total_cents: Math.round(totalAmount * 100),
    });
    if (accrued.error) {
      captureException(accrued.error, {
        tags: { layer: 'loyalty', stage: 'accrue-rpc' },
        extra: { shopId, appointmentId, clientId },
      });
      return;
    }
    const rewardCents = accrued.data ?? 0;

    // Lightweight breadcrumb so we can debug a "did the customer get
    // their reward?" question without trawling audit log.
    if (rewardCents > 0) {
      captureException(
        new Error(`[loyalty] reward granted: client ${clientId} += ${rewardCents}c`),
        {
          tags: { layer: 'loyalty', event: 'reward-granted' },
          extra: { shopId, appointmentId, rewardCents },
        },
      );
    }
  } catch (e) {
    captureException(e, {
      tags: { layer: 'loyalty', stage: 'award' },
      extra: { shopId, appointmentId, clientId },
    });
  }
}
