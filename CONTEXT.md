# kua-coiffure — domain glossary

The shared, opinionated vocabulary for this codebase. One canonical word per
concept; competing words are listed under `_Avoid_`. This is a glossary, not a
spec — it says what each term IS, never how it is implemented. Decisions and
their trade-offs live in `DECISIONS.md`; the system map lives in `CLAUDE.md`.

> Seeded 2026-06-13 from a money-semantics grill. Extend it as new terms are
> sharpened; keep definitions to one or two sentences.

## Language

### Money & revenue

**Revenue**:
The sum of collected service totals over *completed* appointments, with
fully-refunded ones removed. Tips are never included.
_Avoid_: gross revenue (it is net of refunds — "gross" is misleading), sales, takings.

**Completed**:
An appointment that was actually rendered (`status = completed`). It is the only
state that produces revenue, commission, and loyalty. A no-show or cancellation
never produces revenue.
_Avoid_: done, finished, closed.

**Refunded**:
An appointment whose online payment was *fully* reversed. The model is binary —
there is no partial-refund state; a partial reversal is a manual-reconciliation
event, not a represented status.
_Avoid_: partially refunded, voided, charged back (a chargeback/dispute is a separate concept).

**Tip**:
A gratuity, tracked on its own and never part of revenue or the commission base.
An online tip is captured with the online charge; a cash tip lands in the drawer.
_Avoid_: gratuity, service charge.

**Online charge**:
The amount actually captured by the card processor at booking time = deposit
portion + online tip. In full-payment mode it is the whole total + tip; in
deposit mode it is the deposit + tip; it is zero for pay-in-shop.
_Avoid_: deposit (the stored field is named for the deposit case but holds the whole online charge — calling the field a "deposit" is a misnomer).

**Forfeited deposit**:
Money kept when a client no-shows a deposit-paid appointment. It is a no-show
fee, not service revenue, and is tracked as its own line (its tax treatment may
differ from a service sale).
_Avoid_: no-show revenue, kept deposit folded into revenue.

**Service total**:
An appointment's collected service amount *after* promo and loyalty discounts.
This is what feeds revenue and the commission base.
_Avoid_: confusing it with the list-price line snapshot (see *List price*).

**List price**:
The per-service price captured at booking *before* promo/loyalty discounts. It
feeds the per-category breakdown, so category totals will exceed revenue whenever
a discount applied — the two are deliberately different numbers.
_Avoid_: service price, the price (ambiguous against *Service total*).

**Commission base**:
A single barber's revenue (the same net-of-refunds rule, scoped to that barber).
Tips never enter it; a barber whose only appointment was refunded earns nothing.
_Avoid_: payout, gross pay, sales total.

### Loyalty

**Loyalty counter**:
A per-client progress meter whose meaning depends on the program mode — in
*transaction* mode it counts qualifying visits toward a visit goal; in *value*
mode it accumulates cents spent toward a dollar goal.
_Avoid_: points, visits (only correct in transaction mode), stamps.

**Loyalty balance**:
A client's earned reward credit (in cents) redeemable against a future booking.
It expires lazily and is not reversed if the earning appointment is later refunded.
_Avoid_: loyalty points, store credit, wallet.

**Reward**:
The credit granted to the loyalty balance when the counter reaches its goal; one
reward at most per completed appointment, after which the counter resets (or
carries the remainder, in value mode).
_Avoid_: prize, bonus, discount (a promo code is a different concept).
