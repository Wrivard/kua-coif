/**
 * Loyalty program orchestration — Phase 43.
 *
 * Called from `updateAppointment` when the status transitions to
 * 'completed'. We look up the shop's loyalty config, decide whether the
 * transaction qualifies, and bump the client's counter (and balance if
 * the goal is hit).
 *
 * Configurable per shop in `/settings/loyalty`:
 *   - enabled                   — gate flag
 *   - type                      — 'transaction' (count visits) or 'value' (sum spent)
 *   - goal_count                — visits needed for a reward
 *   - min_transaction_amount    — minimum $ for a visit to qualify
 *   - reward_amount             — reward in dollars granted at goal
 *   - include_product_sales     — currently ignored (V1.5 retail integration)
 *   - include_tips              — same
 *
 * V1 only implements `type='transaction'`. `type='value'` (loyalty by
 * spend) lands in V1.5 once the booking flow surfaces tip + tax.
 *
 * Best-effort by design: a loyalty update failure must NEVER fail the
 * underlying appointment status update. Errors are captured to Sentry.
 */

import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { captureException } from '@/lib/observability';

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createSupabaseServiceRoleClient() as any;
  const res = await admin
    .from('loyalty_program')
    .select(
      'enabled, type, goal_count, min_transaction_amount, reward_amount, include_product_sales, include_tips',
    )
    .eq('shop_id', shopId)
    .maybeSingle();
  const row = res.data as LoyaltyConfig | null;
  if (!row || !row.enabled || row.goal_count <= 0) return null;
  // V1 only supports transaction-based; value-based comes V1.5.
  if (row.type !== 'transaction') return null;
  return row;
}

/**
 * Award loyalty progress for a completed appointment.
 *
 * Idempotency: callers should only invoke this on the actual
 * unpaid→completed transition, not on every save. Hooking it into
 * `updateAppointment` is fine because that action is what flips the
 * status; if it gets called twice for the same status flip, the second
 * call increments the counter twice — defensive but rare.
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

    // Below the minimum transaction amount → no progress.
    if (totalAmount < config.min_transaction_amount) return;

    // Pull current counter + balance.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseServiceRoleClient() as any;
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

    const nextCounter = client.loyalty_counter + 1;
    const goalReached = nextCounter >= config.goal_count;
    const rewardCents = goalReached ? Math.round(config.reward_amount * 100) : 0;

    await admin
      .from('clients')
      .update({
        loyalty_counter: goalReached ? 0 : nextCounter,
        loyalty_balance_cents: client.loyalty_balance_cents + rewardCents,
      })
      .eq('id', clientId);

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
