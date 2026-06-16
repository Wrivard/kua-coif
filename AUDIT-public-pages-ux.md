# Round-3 audit — public client-facing pages UX

Scope: the token-gated pages real **clients** open from SMS/email — `/[locale]/me`,
`/receipt`, `/review`, `/reschedule`, `/unsubscribe` — plus the embeddable widget
(`/[locale]/embed/[shopSlug]` + `public/widget.js`). Lens: client-facing trust/clarity,
mobile-first, a11y (contrast/focus/ARIA), i18n (fr default), empty/error/loading states,
misleading labels, flow friction. Every row was confirmed against the code; token/security
integrity and the back-office are out of scope.

Findings priorisés (9 genuine, verified):

| # | page | sév | titre | file:line | effort | fix 1-ligne |
|---|------|-----|-------|-----------|--------|-------------|
| 1 | /me cancel dialog | HIGH | Destructive confirm button reads **« Annuler »** — the universal *dismiss* word — so a customer backing out can trigger the irreversible, possibly non-refundable cancellation (the dismiss button is « Garder ») | `app/[locale]/me/[token]/me-client.tsx:318` | S | Relabel the confirm to an unambiguous « Confirmer l’annulation »; keep « Garder » as dismiss |
| 2 | /me self-cancel | MED | Cancel button always rendered even when the shop sets `customer_cancellations=false`; the customer passes the red confirm dialog then is rejected by a toast. The flag is fetched + resolved (`resolved.customer_cancellations`) but never passed to the client | `app/[locale]/me/[token]/page.tsx:98` → `me-client.tsx:238` | S | Thread the resolved flag per appt; hide/disable Cancel when self-cancel is off |
| 3 | /receipt | MED | Totals footer labels the **booking channel** as « Méthode · En ligne / Au salon », conflating booking source with *payment method* on a money document a client keeps | `app/[locale]/receipt/[token]/receipt-client.tsx:271` | S | Rename the `method` label to « Réservation »/« Source » (or surface the real payment method) |
| 4 | /me mobile | MED | Primary actions « Déplacer »/« Reçu » are 32px-tall (`h-8`) touch targets — under the ~44px mobile floor — on the main phone-opened surface (review stars were deliberately bumped to 48px; these were not) | `app/[locale]/me/[token]/me-client.tsx:228,234` | S | Bump to `h-10` so hit area ≥44px |
| 5 | /reschedule a11y | MED | Date-strip and slot buttons signal the selected state **by colour only** (no `aria-pressed`/`aria-selected`), so screen-reader/keyboard users can’t tell which date or slot is chosen (WCAG 1.4.1, 4.1.2) | `app/[locale]/reschedule/[token]/reschedule-client.tsx:216,278` | S | Add `aria-pressed={active}` to both button sets |
| 6 | widget embed modal | MED | The modal dialog’s accessible name is hardcoded English `aria-label="Booking widget"` (and the iframe `title="Küa booking widget"`) even though `locale` is in scope — a FR visitor’s screen reader announces the dialog in English (breaks fr-default / no-hardcoded-English) | `public/widget.js:310,125` | S | Localise both strings from `locale` |
| 7 | /me pending state | LOW | A single `useTransition` drives **both** the Loi-25 export and appointment cancel, so triggering one spins/disables the other (the Download button shows a spinner while you cancel a RDV; cross-action lock) | `app/[locale]/me/[token]/me-client.tsx:54,242,277` | S | Split into per-action transitions/pending flags |
| 8 | /reschedule clarity | LOW | The 14-day date strip shows only weekday + day-number with **no month label**, so across a month boundary « 1 » vs « 30 » is ambiguous | `app/[locale]/reschedule/[token]/reschedule-client.tsx:227` | S | Add a month header (or include the month on the boundary day) |
| 9 | /receipt a11y | LOW | The receipt renders **no heading element** — shop name and « Reçu » are `<p>`s — so assistive tech gets no document outline / `<h1>` | `app/[locale]/receipt/[token]/receipt-client.tsx:167,190` | S | Promote the shop name (or « Reçu ») to an `<h1>` |

## Verified clean / deliberately excluded (not findings)

- **Error / not-found / loading states** across all five token segments + embed are solid: branded `TokenLinkInvalid`, scoped embed `error.tsx`/`not-found.tsx`/empty "call us" card, layout-matched skeletons. No dead-end generic 404s.
- **i18n parity**: every token-page string flows through `pages.*` in fr+en; review/comment/name fields are correctly marked « (optionnel) ». The *only* hardcoded English on these surfaces is row #6.
- **Receipt tax breakdown** (TPS/TVQ) is genuinely missing, but it is already an open, planned item — `plans/045-spike-receipt-tax-breakdown.md` / `plans/045-OUTPUT-receipt-tax-design.md` — so it is **not** re-reported here.
- **Token security** (revocation via `*_link_version`, GET-no-mutate on `/unsubscribe`, 404-don’t-distinguish) is intentionally untouched per scope.
- `bg-[var(--accent-subtle)]` on `/unsubscribe` and `text-accent-text` on the embed empty state were checked against `globals.css`/`tailwind.config.ts` — both tokens exist; **not** dead classes.
