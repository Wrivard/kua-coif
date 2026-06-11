# Plan 031: Premium motion — exit choreography, sliding tab indicator, tab keyboard, glow restraint

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report — do not improvise.
> When done, update this plan's row in `plans/README.md` (unless a reviewer told
> you they maintain the index).
>
> **Drift check (run first)**: `git diff --stat 9e6ce12..HEAD -- components/ui/modal.tsx components/ui/drawer.tsx components/ui/toast.tsx components/ui/tabs.tsx components/ui/toggle.tsx components/ui/empty-state.tsx app/globals.css`
> If any in-scope file changed, compare the excerpts below against the live code.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (exit animations must not race the close; gated behind animation end with a reduced-motion instant path)
- **Depends on**: **plan 029** (the sliding-indicator and any tinted motion read best
  after the token fix; not strictly blocking, but land 029 first). Touches
  `app/globals.css` — coordinate with 029 (run after it to avoid a keyframe-block conflict).
- **Category**: tech-debt (UX polish)
- **Planned at**: commit `9e6ce12`, 2026-06-10

## Why this matters

The app's surfaces "arrive with mass and vanish with none" — the clearest
clean-but-not-premium tell. Modals, drawers, and toasts have a choreographed
entrance but disappear instantly (`app/globals.css:486-488` comment: "dialog.close()
is instant, so there is no exit animation"; toasts are removed from state on dismiss
with no exit). The tab indicator teleports between tabs (`tabs.tsx:39` is a
`border-b-2` color swap with `transition-colors` only). The Tabs primitive announces
`role="tablist"`/`tab` but has no arrow-key handling or roving tabindex (a11y
expectation it sets and then breaks). The toast close button lacks the
`focus-visible` ring its Modal/Drawer siblings have. And the accent glow — documented
as a hover cue — sits statically on resting states (toggle ON, empty-state halo),
so it stops signaling anything. These are the highest feel-per-line premium fixes,
all state-transition-motivated and reduced-motion safe (the global override at
`globals.css:529-538` already forces near-zero durations under reduced motion).

## Current state

- `components/ui/modal.tsx` — native `<dialog ref={dialogRef}>`; the panel has
  `animate-modal-content` (entrance, `globals.css:473-480`). An effect near the top
  of the file syncs the `open` prop to `dialogRef.current.showModal()/.close()` —
  **read it**; the close path is instant.
- `components/ui/drawer.tsx` — same `<dialog>` pattern, panel `animate-drawer-right/left`
  (`globals.css:489-516`); instant close.
- `components/ui/toast.tsx:48-70` — `ToastProvider` keeps `toasts` state; `dismiss(id)`
  filters the toast OUT immediately (no exit). `:86-96` — `ToastItem` has `animate-toast-in`
  (slide-in, `globals.css:465-467`). `:112-119` — the close button has hover styles but
  **no `focus-visible:ring`** (Modal/Drawer close buttons have
  `focus-visible:ring-2 focus-visible:ring-focus`).
- `components/ui/tabs.tsx:21-62` — `role="tablist"` + per-button `role="tab"`
  `aria-selected`, active style `border-accent text-accent-text` via `transition-colors`;
  **no `onKeyDown`, no roving `tabIndex`, no sliding indicator**. Used on the calendar
  view switcher, barbers tabs, commissions scope tabs.
- `components/ui/toggle.tsx:29` — the ON state carries a static `shadow-accent-glow`.
  `components/ui/empty-state.tsx:44` — a static `shadow-accent-glow` halo.
- `app/globals.css:455-538` — keyframes (`kua-modal-sheet-in`, `kua-modal-content-in`,
  `kua-drawer-in-*`, `kua-fade-in`, `kua-slide-in-from-right`) + the
  `prefers-reduced-motion` override. There are NO exit keyframes yet.
- The repo animates with GSAP (`@gsap/react`); the only existing GSAP usage is
  `components/ui/route-reveal.tsx` (a `gsap.matchMedia` reduced-motion pattern to copy
  for the tab indicator if you go the GSAP route). A measured CSS-transform indicator
  is also acceptable and simpler.

Convention: motion lives in `globals.css` keyframes + `animate-*` classes; durations
~180–240ms `cubic-bezier(0.22, 1, 0.36, 1)`; reduced motion is honored globally, so
CSS-class exits are auto-safe, but any JS-driven close MUST have an explicit instant
path when `matchMedia('(prefers-reduced-motion: reduce)').matches`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all pass (245) |
| Lint | `pnpm lint` | exit 0 |
| Format | `pnpm format:check` | exit 0 |
| Build | `NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key pnpm build` | exit 0 |

## Scope

**In scope**: `components/ui/modal.tsx`, `components/ui/drawer.tsx`,
`components/ui/toast.tsx`, `components/ui/tabs.tsx`, `components/ui/toggle.tsx`,
`components/ui/empty-state.tsx`, `app/globals.css`.

**Out of scope**:
- The app-level static-glow sites (booking-wizard, appointments-*, clients-client,
  auth/layout, reschedule) — those belong to their owning plans (035/032/033/039);
  this plan trims only the two PRIMITIVE-level glows (toggle, empty-state).
- The shadow-hue discipline (CRAFT-06) — deferred; it sweeps shared app files and
  would conflict with the reactive/booking/token plans. Note it, don't do it here.
- Any behavior/data change. Token definitions (plan 029).

## Git workflow

- Branch: `advisor/031-premium-motion`. Commits per step, e.g.
  `polish(ui): exit choreography for modal/drawer/toast`.
- Co-Authored-By footer. Do NOT push unless instructed.

## Steps

### Step 1: Exit keyframes (globals.css)

Add reverse keyframes (transform + opacity only): `kua-fade-out` (200ms),
`kua-sheet-out` (mobile sheet down, 180ms), `kua-modal-content-out` (scale/opacity,
160ms), `kua-drawer-out-right/left` (slide out, 200ms), `kua-toast-out` (fade + 4px
slide, 160ms), all `cubic-bezier(0.4, 0, 1, 1)` (ease-in for exits). Add the matching
`.animate-*-out` / `dialog[data-closing] > …` selectors. (The global reduced-motion
override already collapses these to ~0ms.)

**Verify**: `pnpm build` → exit 0; the new classes appear in compiled CSS.

### Step 2: Gate Modal + Drawer close behind the exit (CRAFT-09)

In `modal.tsx` and `drawer.tsx`, change the close path: instead of calling
`dialog.close()` immediately, set a `closing` state that adds `data-closing` (and the
`.animate-*-out` class) to the `<dialog>`/panel, listen for `animationend` on the
panel, then call `dialog.close()` and clear `closing`. Provide an INSTANT path: if
`window.matchMedia('(prefers-reduced-motion: reduce)').matches`, close immediately
(no animation wait). Ensure backdrop-click, Esc (the dialog's native `cancel` event),
and the close button all route through this same closing flow, and that re-opening
clears any stale `closing` state.

**Verify**: dev server: closing a modal/drawer plays a brief exit, then unmounts;
Esc and backdrop-click animate too; with OS "reduce motion" on, close is instant; no
double-close or stuck-open.

### Step 3: Animated toast dismissal + focus ring (CRAFT-09)

In `toast.tsx`: on dismiss, first mark the item `closing` (apply `.animate-toast-out`),
and remove it from `toasts` state on `animationend` (or a fallback timeout matching the
duration) instead of filtering it out instantly. Add
`focus-visible:ring-2 focus-visible:ring-focus` to the close button (`:112-119`) to
match Modal/Drawer.

**Verify**: dev server: a toast fades/slides out on auto-expire and on manual close;
the close button shows a focus ring on keyboard focus; reduced-motion → instant removal.

### Step 4: Sliding tab indicator + keyboard (CRAFT-09 + X-02)

In `tabs.tsx`:
- Replace the per-button `border-b-2 border-accent` active style with ONE
  absolutely-positioned underline element inside the tablist, moved to the active
  tab's measured `left`/`width` (via a `ref` map + `useLayoutEffect`, transformed with
  a CSS transition `~250ms ease-out`, OR GSAP per `route-reveal.tsx`). Keep the active
  text color (`text-accent-text`). Falls back to instant under reduced motion.
- Add keyboard support: roving `tabIndex` (`tabIndex={active ? 0 : -1}` on each tab),
  and an `onKeyDown` on the tablist handling `ArrowLeft`/`ArrowRight` (move + focus the
  next/prev non-disabled tab and call `onChange`), `Home`/`End`.

**Verify**: dev server: switching tabs slides the underline (no teleport); ArrowLeft/
Right move focus AND selection across the calendar view switcher; Tab key enters/leaves
the tablist as one stop; reduced-motion → instant.

### Step 5: Trim the primitive-level static glow (CRAFT-07, primitives only)

Remove the static `shadow-accent-glow` from `toggle.tsx:29` (ON state) and
`empty-state.tsx:44` (halo) — rely on `bg-accent` + `shadow-sm` (toggle) / the subtle
surface (empty-state). Do NOT touch the app-level glow sites (other plans own them).

**Verify**: dev server: an ON toggle and an empty-state no longer emit a permanent
halo; the primary-button HOVER glow (`button.tsx`) is unaffected.

## Test plan

- No new unit tests (motion + a11y interaction; not vitest-friendly). If a Tabs RTL
  test exists, add arrow-key assertions (fire `keyDown` ArrowRight → `onChange` called
  with the next value).
- Manual matrix: modal/drawer/toast exit animations (+ reduced-motion instant); tab
  underline slide + keyboard; toast focus ring; no resting glows.
- `pnpm test` → 245 pass.

## Done criteria

- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm format:check` exit 0
- [ ] `pnpm build` exits 0
- [ ] `pnpm test` exits 0 (245)
- [ ] Modal/Drawer/Toast play an exit animation, instant under reduced motion (manual)
- [ ] Tabs: sliding indicator + ArrowLeft/Right/Home/End keyboard nav (manual)
- [ ] Toast close button has a focus-visible ring
- [ ] `grep -n "shadow-accent-glow" components/ui/toggle.tsx components/ui/empty-state.tsx` → no matches
- [ ] No out-of-scope file modified (`git status`)
- [ ] `plans/README.md` row updated

## STOP conditions

- The Modal/Drawer `open` prop and the animated close fight each other (parent sets
  `open=false` and unmounts before the exit plays) — if the exit can't complete
  without the parent keeping the component mounted, STOP and report the contract
  needed (the parents may need to keep rendering until an `onClosed` callback).
- The tab indicator measurement is wrong on first paint / resize (SSR hydration) —
  if `useLayoutEffect` can't position it reliably, fall back to the `transition-colors`
  border for the indicator and report (ship keyboard + exits regardless).
- Removing a primitive glow reveals that some screen relied on it for state legibility
  — unlikely, but if an ON toggle becomes ambiguous, STOP.

## Maintenance notes

- **Reviewer**: verify EVERY animated close has a reduced-motion instant path and
  cannot leave a dialog stuck open; check the tab indicator on resize and with a
  disabled tab in the set.
- **Deferred (note, don't do here)**: CRAFT-06 shadow-hue discipline (warm shadows
  should be public-surface only; in-app inputs/toast/chart use warm by mistake) and
  the app-level static-glow trim — both sweep shared files; fold them into the plans
  that own those files (032/033/035/039) or a dedicated late sweep.
- If a Dropdown/Popover primitive is added later, give it the same exit treatment.
