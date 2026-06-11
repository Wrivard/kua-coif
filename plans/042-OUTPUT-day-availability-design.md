# 042 OUTPUT — Per-day availability density: design

> Spike output for plan 042 (2026-06-11, executed at `b8d037d`). Design only —
> nothing here is shipped. The measurement probe was a temporary vitest file
> (deleted after measuring; numbers reproduced in §3).

## TL;DR

- **No STOP**: worst-case 14-day summary compute is **~575 ms** with the
  route's current per-candidate shape — under the ~1s STOP line — and drops to
  **~26 ms** once the inputs are bucketed per (day, barber) and the timezone
  conversion is hoisted to once per day. **Precomputation (materialized
  per-day table) is NOT needed.**
- The expensive mistake would be the client looping 14× `GET /slots` (14
  round-trips, 28 live DB queries, half the 30/min rate-limit budget). The
  design is a **single-pass `summary=days` mode on the existing slots route**:
  same 2 live queries, windowed over the whole strip instead of one day.
- Short-circuit ("stop at first open slot") is a nice accelerator on open days
  (~17× on the seed shape) but is **not a worst-case shield**: a fully-booked
  day never short-circuits. The bucketing is what bounds the worst case.

## 1. Endpoint design

Extend the existing route (`app/api/book/[shopSlug]/slots/route.ts`) with a
summary mode rather than adding a second public route (same rate-limit bucket,
same cached config, same validation):

```
GET /api/book/[shopSlug]/slots?summary=days&from=YYYY-MM-DD&days=14&barber=<uuid|any>&duration=<min>
```

Response (`cache-control` per §2):

```json
{
  "days": { "2026-06-11": "open", "2026-06-12": "full", "2026-06-14": "closed", … },
  "nextAvailable": "2026-06-11",
  "barber_id": "<resolved-uuid>"
}
```

- `days` values: `'open' | 'limited' | 'full' | 'closed'`. `closed` covers
  weekday-disabled, explicit day off, AND days beyond the shop's booking
  horizon (see §5). `full` = open that day but zero acceptable slots.
- `nextAvailable` = first `open|limited` day in range, else `null` — powers the
  chip (§4) without a second request.
- Validation mirrors the slot mode: `from` must match `YYYY-MM-DD`, `days`
  clamped to **1..30** in V1 (the strip needs 14; 30 covers a "show more"
  page), `duration` same bounds as today.
- **Algorithm (single pass, this is the perf contract):**
  1. Resolve shop + barber from the per-shop Data Cache exactly as today.
  2. Run the SAME two live queries, but windowed `[from, from+days)` instead
     of one day (same total rows as 14 one-day calls; one round-trip each).
  3. Bucket appointments by `(shopIsoDate(start_at), barber_id)` and blocked
     by day (shop-wide blocks fan into every barber's bucket) — one linear
     scan. Hoist the timezone conversion to **one `combineShopDateTime(date,
     '00:00')` per day**; every candidate instant is `midnight + m*60_000`.
     (The current per-candidate `combineShopDateTime` is the measured CPU
     hotspot — §3.)
  4. Per day: skip instantly if closed/day-off/beyond-horizon; otherwise walk
     candidates at `client_booking_interval_min` against the day's bucket
     only, **stop at the first acceptable slot** (`open`) — or, if the
     `limited` tier ships, count up to `L` then stop (early-exit at `L`, never
     full enumeration).
- `limited` threshold, if kept (open product question, §6): `< L` remaining
  slots with **L = 3** flat. A percentage-of-window threshold reads as
  pressure-marketing; a small flat number is honest ("book soon, it's
  thinning").
- **`barber=any` semantics — pre-existing inconsistency to resolve**: the slot
  mode currently resolves `any` to the FIRST confirmed bookable barber
  (`route.ts:69-71`), not the union. V1 of the summary MUST mirror whatever
  the slot grid shows (strip and grid must never disagree), so V1 = same
  first-barber resolution. The honest fix — union across bookable barbers for
  BOTH modes — is flagged in §6 and was what the probe measured as worst case
  (so the union is already known to be affordable).

## 2. Caching strategy

Measured compute (§3) says the summary does not NEED a server cache to be
viable — the recommendation is phased:

- **V1: no server-side cache.** Per-request cost is the same 2 windowed live
  queries the slot mode already pays per day-tap, plus ≤30 ms CPU. Send
  `cache-control: private, max-age=60` so the browser absorbs strip re-renders
  (wizard step back/forward) without a refetch. Keep the slot mode `no-store`
  as today.
- **V2 (only if telemetry asks): TTL cache ≈60s** via `unstable_cache` keyed
  `(shopId, barberId, duration, from, days)`, `revalidate: 60`. It composes
  with plan 017's Data Cache cleanly — config reads inside are already
  tag-cached; the wrapper only memoizes the volatile part. Do NOT try to
  tag-bust on every booking (appointments mutate constantly — public bookings,
  admin creates, realtime cancels — a tag would bust on every write and buy
  nothing over a 60s TTL). Accept the staleness window: the strip is a density
  HINT, the slot grid and the booking action remain the truth (both re-check
  live; the action enforces `checkAvailability` server-side).
- **Rate limit composition**: one summary request covers the whole strip, so a
  normal wizard session costs 1 summary + 1 slots per date tap — comfortably
  inside 30/min. Count the summary in the SAME `slots:{ip}` bucket (it's the
  same surface; a separate bucket would double the scrape budget). The strip
  must fetch the summary ONCE per (barber, duration) pair — not per day
  render — and reuse it while the user taps days.

## 3. Compute-cost measurement (real numbers, temporary probe)

Method: temporary vitest probe (deleted) reproducing the route's loop
faithfully — including the per-candidate `combineShopDateTime` — over
deterministic synthetic schedules; median of 7 runs after JIT warmup, Node 22,
dev machine. "Union" = summary across ALL barbers (worst-case honest `any`).

| Scenario (14-day strip unless noted) | Median |
|---|---|
| A1 — seed-realistic naive: Axum (4 barbers, Tue–Sat 10:00–19/20/17, interval 30, 45-min service, ~70% booked, 297 rows), full enumeration | **14.5 ms** |
| A2 — seed-realistic + short-circuit | **0.9 ms** |
| B1 — stress naive: 10 barbers, 7d/7 12h, interval 5, 30-min service, **100% full** (3 360 rows) | **575 ms** |
| B2 — stress + short-circuit (full days ⇒ never exits early) | **574 ms** |
| B3 — stress, **bucketed per (day,barber) + hoisted tz** | **26 ms** |
| C — 365-day horizon, stress shape, route-faithful loop | **1 802 ms** |
| C2 — 365-day horizon, bucketed | **63 ms** |

Verdicts:

- **Naive is acceptable for realistic shops** (14.5 ms) but NOT as the
  worst-case contract: a configured-pathological shop (many barbers, interval
  5, long hours, fully booked) costs ~575 ms of pure CPU per request — too hot
  for a public endpoint under load, though under the ~1s STOP line.
- **Short-circuit is mandatory but insufficient** — it collapses the common
  case (A2: 0.9 ms) and does nothing for the full-day worst case (B2 ≈ B1).
- **The bucketing + tz-hoist is the real fix** (×22 on the worst case) and
  must be in the V1 endpoint. With it, even a 365-day horizon is 63 ms —
  which retires the precomputation/materialized-table option entirely.
- DB side: the summary adds zero queries over a single day-tap today (still
  2 live queries, just windowed wider). Expected end-to-end ≈ DB round-trips
  (~50–150 ms on Supabase) + ≤30 ms CPU.

## 4. UI design — both strips

States per day chip (booking `DateStrip`, `booking-wizard.tsx:1944`, and the
reschedule strip, `reschedule-client.tsx:173-205`):

| State | Visual | Interaction | A11y (never color-only) |
|---|---|---|---|
| `open` | dot under the day number: `bg-success` | tappable (as today) | `aria-label`: « jeudi 18 juin — disponibilités » |
| `limited` (if kept) | dot `bg-warning` | tappable | « … — encore quelques places » |
| `full` | **no dot**, number at `opacity-60`, NOT `disabled` | tappable — lands on the slot grid's honest empty state + waitlist CTA (plan 035's work) | « … — complet » + visible `–` glyph in the dot slot |
| `closed` | as today: `opacity-40` + `disabled` | not tappable | « … — fermé » |
| beyond horizon | same as `closed` | not tappable | « … — trop loin pour réserver en ligne » |

- `full` stays tappable on purpose: the empty-slot state carries the waitlist
  form (Phase 57) — a disabled chip would amputate that funnel.
- **« Prochaine dispo » chip**: rendered above the strip when the SELECTED day
  is `full`/`closed` — `Prochaine dispo : jeu. 18 juin` — one tap sets
  `value`/`date` to `nextAvailable` and scrolls the chip's day into view
  (`scrollIntoView({ inline: 'center' })`). This is the single
  highest-conversion piece; if scope must be cut, ship the chip alone (it
  only needs `nextAvailable`, not the full map).
- Loading: strip renders instantly from config (closed days are known
  client-side today); dots/dim arrive when the summary resolves — no skeleton,
  no layout shift (reserve the dot's 4px slot always). On summary fetch error:
  degrade to today's behavior (closed-only knowledge), never block the strip.
- Reschedule strip parity: it currently knows NOTHING (renders 14 raw days —
  not even closed). The summary call (`barber=<appointment.barberId>`,
  `duration=<appointment.durationMin>`) gives it closed+full+dots in one
  fetch at mount. Same components/states as booking; extract a shared
  `DayChip` only if the build finds the two strips diverging (they differ in
  width/tokens today — don't force-unify in this pass).
- i18n: all new strings (`nextAvailable` chip, the four sr-only state labels)
  go through next-intl fr+en — the build plan must list the exact keys under
  `pages.book.dateStrip.*` and the reschedule namespace.

## 5. Horizon note (14 days vs `days_book_in_advance`)

- Engine truth: a slot beyond `now + days_book_in_advance` is rejected
  (`TOO_FAR_IN_ADVANCE`, `availability.ts:155`); default 30 (seed: 30), max
  365. The 14-day strip under-serves a 60–365-day shop and OVER-serves a
  7-day shop (days 8–14 all reject — today they render as normal tappable
  days and produce empty slot grids: a false-positive UX the summary fixes
  for free, since those days come back `closed`).
- Recommendation: the summary **honors the horizon server-side** (days beyond
  ⇒ `closed`, skipped before any compute — free) and the response is correct
  for any `days ≤ 30` window. The STRIP stays 14 days in V1 (denser already
  thanks to dots; a longer strip is a swipe-fatigue problem, not a data
  problem). A V2 "later dates →" affordance can page the strip by +14 days up
  to the shop's horizon using the same endpoint (`from` advances) — that's
  when `days_book_in_advance > 14` shops get their tail, with C2 (§3) proving
  even a 365-day sweep stays cheap if a full-horizon "next available" search
  is ever wanted.

## 6. Open questions + phased build order

Open questions (decide before/while building):

1. **`limited` tier: keep or cut?** Honesty risk (urgency-marketing smell) vs
   genuine signal. Cutting it removes the count loop entirely (pure
   short-circuit) and one color from the legend. Recommendation: V1 ships
   `open/full/closed` only; add `limited` later if salons ask.
2. **`any` = first-barber vs union** (pre-existing): strip and grid must agree
   (V1: both first-barber). The union is measured-affordable (B3) — fixing
   BOTH modes to union is a separate small plan with its own conversion
   upside ("any" shops currently hide every other barber's availability).
3. **Staleness honesty**: with the V2 60s TTL, a just-taken slot can show
   `open` for up to a minute. Accepted (density ≠ promise; grid + action
   re-check live). Revisit only if support tickets say otherwise.
4. **Widget reuse** (plan 038): the embed strip should consume the same
   endpoint; confirm the embed's CSP/origin story allows it before promising.
5. **Telemetry**: count summary requests + p95 duration (the existing route
   logging path) so the V2 cache decision is data-driven, not vibes.

Phased build order (each phase shippable alone):

1. **Endpoint** — `summary=days` mode in the slots route with bucketing +
   tz-hoist + short-circuit + horizon skip; vitest parity tests asserting the
   summary agrees with the slot mode day-by-day on seeded shapes (the probe's
   sanity check, kept as a real test this time).
2. **Booking strip** — dots/dim/sr-only states + « Prochaine dispo » chip +
   single summary fetch per (barber, duration); fr+en keys.
3. **Reschedule strip** — same states from the same endpoint (barber fixed to
   the appointment's).
4. **Later (separate plans)** — `limited` tier if wanted, strip paging for
   long-horizon shops, `any`-union fix for both modes, widget adoption, V2
   TTL cache if telemetry demands.
