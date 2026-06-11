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
  clientId: string;
  totalAmount: number;
}): Promise<void> {
  try {
    const config = await resolveLoyaltyConfig(shopId);
    if (!config) return;

    // Below the minimum transaction amount â†’ no progress.
    if (totalAmount < config.min_transaction_amount) return;

    // Pull current counter + balance.
    const admin = createSupabaseServiceRoleClient();
    const cRes = await admin
      .from('clients')
      .select('loyalty_counter, loyalty_balance_cents')
      .eq('id', clientId)
      .single();
    const client = cRes.data as {
      loyalty_counter: number;
      loyalty_balance_cents: number;
    } | null;
    if (!client) return;

    const { nextCounter, goalReached, rewardCents } = computeLoyaltyProgress({
      type: config.type,
      currentCounter: client.loyalty_counter,
      goalCount: config.goal_count,
      rewardAmount: config.reward_amount,
      totalAmount,
    });

    // Loop 35 (P1.92) â€” extend the balance expiry to one year out
    // whenever a reward is granted. A regular customer's clock keeps
    // resetting; an inactive customer's runs out. No change to the
    // expiry timestamp when no reward is granted on this visit.
    const patch: {
      loyalty_counter: number;
      loyalty_balance_cents: number;
      loyalty_balance_expires_at?: string;
    } = {
      loyalty_counter: nextCounter,
      loyalty_balance_cents: client.loyalty_balance_cents + rewardCents,
    };
    if (rewardCents > 0) {
      const oneYearOut = new Date();
      oneYearOut.setUTCFullYear(oneYearOut.getUTCFullYear() + 1);
      patch.loyalty_balance_expires_at = oneYearOut.toISOString();
    }

    await admin.from('clients').update(patch).eq('id', clientId);

    // Lightweight breadcrumb so we can debug a "did the customer get
    // their reward?" question without trawling audit log.
    if (goalReached && rewardCents > 0) {
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
