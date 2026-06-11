# Plan 035: Booking flow — kill the false dead-ends (closed-day, abort-race, hardcoded availability)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report — do not improvise.
> When done, update this plan's row in `plans/README.md` (unless a reviewer told
> you they maintain the index).
>
> **Drift check (run first)**: `git diff --stat 9e6ce12..HEAD -- "app/[locale]/book/[shopSlug]/booking-wizard.tsx" "app/[locale]/book/[shopSlug]/page.tsx" messages/fr.json messages/en.json`
> If any in-scope file changed, compare the "Current state" excerpts against the
> live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S-M
- **Risk**: LOW (display-default + error-state changes; the server still validates everything; no money path here — that's plan 036)
- **Depends on**: none. **Plan 036 (booking money-path) edits the SAME
  `booking-wizard.tsx` and MUST run after this** (sequential — they share the file).
- **Category**: bug
- **Planned at**: commit `9e6ce12`, 2026-06-10

## Why this matters

The public booking flow — the app's revenue surface — funnels real customers into
false dead ends that read as "this shop has nothing", driving abandonment at the
highest-intent step:

- **Closed-day first impression**: the slot step always opens on *today*
  (`booking-wizard.tsx:296`), even when today is closed. Québec salons commonly
  close Sun–Mon, so a large share of visitors land on "Aucun créneau disponible ce
  jour-là" + a waitlist CTA for a day the shop isn't even open.
- **Abort-race false "fully booked"**: the slot fetch maps BOTH aborted requests
  and HTTP errors to an empty array (`booking-wizard.tsx:564` `.catch(() => setSlots([]))`,
  and no `r.ok` check), so fast date-switching on mobile, a 429 from the
  rate-limited slots route, or a network blip all render as "fully booked" (with a
  waitlist CTA users may actually use).
- **Hardcoded "Available today"**: every barber card shows
  `t('steps.barber.availableToday')` unconditionally (`booking-wizard.tsx:1359`) —
  a customer picks a barber on vacation, then hits an empty slot screen. The UI
  lied two steps earlier.
- **Stale slot on back-nav**: returning to step 3 re-fetches slots but keeps a
  now-possibly-taken `startTime`, and `canAdvance` only checks non-null — a silent
  path into a guaranteed conflict at submit.
- **FR metadata on EN pages**: `generateMetadata` hardcodes French
  (`page.tsx:32-33`) regardless of locale — EN share links/tabs/Google snippets
  show French.

All fixes are display/validation only; the server-side booking validation is the
source of truth and is unchanged.

## Current state

- `app/[locale]/book/[shopSlug]/booking-wizard.tsx:290-296` — initial state:
  ```ts
  const dateValid = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam);
  return { step: 1, /* … */ date: dateValid ? dateParam : today, startTime: null, /* … */ };
  ```
- `booking-wizard.tsx:553-567` — slot fetch effect:
  ```ts
  useEffect(() => {
    if (state.step !== 3) return;
    setSlots(null); setSlotLoading(true);
    const ctl = new AbortController();
    fetch(`/api/book/${shopSlug}/slots?date=${state.date}&barber=${state.barberId ?? 'any'}&duration=${totalDuration}`, { signal: ctl.signal })
      .then((r) => r.json())                 // ← no r.ok check
      .then((data) => setSlots(data.slots ?? []))
      .catch(() => setSlots([]))             // ← abort + error both → "fully booked"
      .finally(() => setSlotLoading(false));
    return () => ctl.abort();
  }, [state.step, state.date, state.barberId, shopSlug, totalDuration]);
  ```
- `booking-wizard.tsx:1353-1363` — barber cards: `subtitle={t('steps.barber.availableToday')}` on every `b`.
- `booking-wizard.tsx:1655-1666` — `DateStrip` computes per-day `closed` from
  `hours`/`daysOff`: `const closed = !h?.enabled || daysOff.includes(iso);`. The
  wizard receives `hours: BookingHours[]` and `daysOff` (passed down to DateStrip).
  This is the exact logic to reuse for picking the initial open day.
- `booking-wizard.tsx:1124-1165` — step nav (Continue/Confirm) lives in-card; a
  separate sticky bottom bar (`:1151-1165`) shows subtotal/duration only, and only
  for `state.step < 4`.
- `app/[locale]/book/[shopSlug]/page.tsx:20-40` — `generateMetadata` hardcodes
  `${shop.name} · Réserver en ligne` / `Réserve ton rendez-vous chez …`; it never
  reads `params.locale`. (The `as any` on line 23 is plan-023 territory — DO NOT
  touch it here.)

Conventions: i18n strings live in `messages/fr.json` + `messages/en.json` under
`pages.booking.*`, BOTH required (the `tests/i18n-parity.test.ts` fails the build
on a missing key). Slot-fetch state uses `useState`. Shop timezone math via
`shopIsoDate(date, timezone)` (already imported).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all pass (245); i18n-parity green |
| Lint | `pnpm lint` | exit 0 |
| Format | `pnpm format:check` | exit 0 |
| Build | `NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key pnpm build` | exit 0 |

## Scope

**In scope**:
- `app/[locale]/book/[shopSlug]/booking-wizard.tsx` (BUG-05/04/06/08 + DIR-03)
- `app/[locale]/book/[shopSlug]/page.tsx` (BUG-07 — `generateMetadata` only)
- `messages/fr.json` + `messages/en.json` (new keys, both locales)

**Out of scope**:
- `submit()` ordering / payment / `failBooking` / field-error recovery — that's
  **plan 036** (do not pre-empt it; it touches the same file after this).
- The slots API route (`app/api/book/[shopSlug]/slots/route.ts`) — read-only here.
- The `as any` cast on `page.tsx:23` (plan 023).
- Per-day availability density in the date strip (that's the spike, plan 042).

## Git workflow

- Branch: `advisor/035-booking-false-dead-ends`.
- One commit per step; conventional commits, e.g.
  `fix(booking): open the slot step on the first non-closed day`.
- Co-Authored-By footer. Do NOT push unless instructed.

## Steps

### Step 1: Open the slot step on the first non-closed day (BUG-05)

Add a helper that returns the first bookable ISO date within the 14-day window,
reusing the DateStrip closed-logic:

```ts
function firstBookableIso(hours: BookingHours[], daysOff: string[], today: string, timezone: string): string {
  const ref = new Date(`${today}T12:00:00Z`);
  for (let i = 0; i < 14; i++) {
    const iso = shopIsoDate(addDays(ref, i), timezone);
    const weekday = new Date(`${iso}T00:00:00`).getDay();
    const h = hours.find((hh) => hh.weekday === weekday);
    if (h?.enabled && !daysOff.includes(iso)) return iso;
  }
  return today; // all 14 closed — fall back, the empty state will show
}
```

Use it for the initial `date` when there is no valid `?date=` param, AND when the
`?date=` param points at a closed day. Confirm `hours`/`daysOff` are in scope where
the initial state is built; if the initial-state builder cannot see them, set the
corrected date in a one-shot mount `useEffect` instead (document which path you took).

**Verify**: `pnpm typecheck` → exit 0. Dev server with a shop closed today: the
slot step opens on the next open day, not an empty "today".

### Step 2: Distinguish slot-fetch error from "no availability" (BUG-04 + BUG-08)

Add a `slotError` state. Rewrite the effect:

```ts
.then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
.then((data: { slots?: string[] }) => {
  setSlots(data.slots ?? []);
  // BUG-08: drop a now-stale selection so Continue can't funnel into a conflict.
  if (state.startTime && !(data.slots ?? []).includes(state.startTime)) {
    setState((s) => ({ ...s, startTime: null }));
  }
})
.catch((e) => { if (ctl.signal.aborted) return; setSlotError(true); })  // aborts are silent
.finally(() => { if (!ctl.signal.aborted) setSlotLoading(false); });
```

Reset `slotError` to `false` at the top of the effect (next to `setSlots(null)`).
In the slot-step render: when `slotError`, show a distinct "Impossible de charger
les disponibilités — réessayer" with a retry control (re-run the effect, e.g. bump
a `retryNonce` in its deps); show the empty-state + waitlist CTA ONLY on a
confirmed empty 200 (`slots` is `[]` and `!slotError && !slotLoading`).

**Verify**: `pnpm typecheck` → exit 0. Dev server: throttle/kill the network on the
slot step → "couldn't load, retry", NOT "fully booked". Fast date-switching no
longer flashes the empty state.

### Step 3: Stop claiming every barber is "Available today" (BUG-06)

Replace the hardcoded `subtitle={t('steps.barber.availableToday')}` on the
per-barber `BarberCard` (`:1359`) with a neutral, true subtitle — add
`pages.booking.steps.barber.pickTimeNext` ("Choisis un créneau ensuite" / "Pick a
time next") to both message files, or pass `subtitle={undefined}`. Keep the "any
barber" card's `anyHint`. (A real per-barber availability hint is plan 042 — do
not build it here.)

**Verify**: `grep -n "availableToday" app/[locale]/book` → no remaining usage on
the per-barber card. i18n-parity green.

### Step 4: Localize booking metadata (BUG-07)

In `page.tsx:generateMetadata`, branch the title/description on `params.locale`
(use `getTranslations({ locale, namespace: 'pages.booking.meta' })` from
`next-intl/server`, or an inline fr/en map). Add `pages.booking.meta.title` /
`.description` keys (with a `{name}` placeholder) to both message files. Keep the
`shop.description` override when present.

**Verify**: `pnpm build` → exit 0. `/en/book/<slug>` `<title>` is English;
`/fr/book/<slug>` is French. i18n-parity green.

### Step 5 (polish): Mobile sticky CTA (DIR-03)

Below the `sm:` breakpoint, surface the primary action in the sticky bar so the
user never scrolls to find Continue/Confirm: merge the nav button into the sticky
summary bar on mobile (keep the in-card nav for `sm:` and up), and ensure step 4
(currently no sticky) also gets a sticky Confirm on mobile. Bump slot-time buttons
from `h-10` to `h-11` (44px touch target). Keep desktop layout unchanged.

**Verify**: dev server at 375px width: Continue/Confirm is reachable without
scrolling on every step; desktop unchanged. `pnpm build` → exit 0.

## Test plan

- The booking action has a vitest suite (`book/[shopSlug]/actions.test.ts`); this
  plan changes the CLIENT wizard, not the action, so no action-test changes are
  expected. If a wizard unit test exists, extend it; otherwise rely on the manual
  matrix.
- Manual matrix (dev server): closed-today shop opens on next open day; network
  kill → retry not "fully booked"; barber card shows no false availability;
  back-nav with a taken slot clears the selection; EN page has EN metadata; mobile
  CTA reachable.
- `pnpm test` → 245 pass, i18n-parity green.

## Done criteria

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0 (245); i18n-parity passes with the new keys present in BOTH files
- [ ] `pnpm lint` + `pnpm format:check` exit 0
- [ ] `pnpm build` exits 0; `/en/book/<slug>` metadata is English
- [ ] `grep -n "availableToday" "app/[locale]/book/[shopSlug]/booking-wizard.tsx"` → no per-barber usage
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` row updated

## STOP conditions

- `hours`/`daysOff` are NOT reachable where the initial date is computed AND a
  mount effect would cause a visible flash — report; do not hoist large state.
- The slot-fetch retry mechanism causes an infinite refetch loop — STOP (the
  `retryNonce` dep is mis-wired).
- Adding the metadata keys breaks i18n-parity for an unrelated namespace — STOP;
  you touched the wrong JSON section.
- You find yourself editing `submit()` or the payment section — that's plan 036;
  STOP and leave it.

## Maintenance notes

- **Reviewer**: confirm aborts are silent (no error UI on fast date-switching) and
  that the waitlist CTA shows ONLY on a confirmed empty 200, never on error.
- Plan 036 (money-path) builds on this file next — it adds prevalidate-before-charge
  and field-error recovery. Land 035 first to minimize its diff.
- Plan 042 (spike) will add real per-day availability density to the date strip —
  the neutral barber subtitle from Step 3 becomes a real "next available" hint then.
- The 14-day horizon is hardcoded in DateStrip; a shop with a longer
  `days_book_in_advance` is under-served (noted by the audit; out of scope here).
