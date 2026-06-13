/**
 * Shared finance aggregation helpers — the SINGLE definition of the
 * "net of refunds" rule (FIN-UX-01) used by BOTH `/finances` and
 * `/finances/today`, so the two surfaces can never drift.
 *
 * Business rule (user-arbitrated): a completed appointment whose online
 * payment was fully refunded (`payment_status === 'refunded'`) contributes
 * ZERO to revenue, the commission base, category, trend, and tipout. Every
 * other status (paid / unpaid / pending / failed) stays in the base — only
 * refunds are netted out. Tips are tracked separately and never enter the
 * commission base.
 */

/** Drop fully-refunded appointments from a list of completed appointments. */
export function excludeRefunded<T extends { payment_status: string }>(appts: T[]): T[] {
  return appts.filter((a) => a.payment_status !== 'refunded');
}

/**
 * Sum `total_amount` (dollars) over the non-refunded appointments. This is the
 * net revenue figure AND the per-barber commission/tipout base — pass a single
 * barber's appointments to get their net base (a barber whose only appointment
 * was refunded nets 0, so they earn no commission).
 */
export function netRevenue<T extends { payment_status: string; total_amount: number | null }>(
  appts: T[],
): number {
  return excludeRefunded(appts).reduce((s, a) => s + Number(a.total_amount ?? 0), 0);
}

/**
 * Sum of deposits KEPT on no-shows — the money retained when a client doesn't
 * show for an online-paid appointment — in dollars. A forfeited no-show deposit
 * is NOT service revenue (different nature + potentially distinct TPS/TVQ
 * treatment), so it is tracked on its own line and never folded into revenue.
 *
 * A forfeited deposit = `status === 'no_show'` AND `payment_status === 'paid'`
 * AND `(deposit_amount_cents ?? 0) > 0`. The amount is `deposit_amount_cents`
 * (the online-charge snapshot: deposit base + online tip); summed, then /100.
 */
export function forfeitedDeposits<
  T extends { status: string; payment_status: string; deposit_amount_cents: number | null },
>(appts: T[]): number {
  return (
    appts
      .filter(
        (a) =>
          a.status === 'no_show' &&
          a.payment_status === 'paid' &&
          (a.deposit_amount_cents ?? 0) > 0,
      )
      .reduce((s, a) => s + (a.deposit_amount_cents ?? 0), 0) / 100
  );
}
