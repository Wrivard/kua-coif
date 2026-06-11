# Plan 029: Token system truth-up — make the `<alpha-value>` opacity utilities actually render

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` (unless a reviewer told you they maintain the index).
>
> **Drift check (run first)**: `git diff --stat 9e6ce12..HEAD -- tailwind.config.ts app/globals.css components/ui/badge.tsx components/ui/button.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (type-only at the config level, but ~70 currently-dead opacity classes start rendering at once — the app's appearance shifts TOWARD its intended design; needs a both-themes visual + AA re-pass)
- **Depends on**: none (this is the keystone other premium plans build on — 030, 031 depend on THIS)
- **Category**: tech-debt
- **Planned at**: commit `9e6ce12`, 2026-06-10

## Why this matters

The Tailwind color tokens are defined as bare `var(--x)` strings. In Tailwind v3
an opacity modifier (`bg-bg-base/80`, `ring-accent/20`, `bg-danger/10`,
`border-success/30`) can only be generated when the color carries the
`<alpha-value>` placeholder — so **every opacity-modified token utility in the
codebase silently fails to compile**. The team already learned this for borders
(`app/globals.css:42-43` comment: "Tailwind 3 cannot apply opacity modifiers to
`rgba()` variables — all four steps have alpha baked in") but never applied the
fix to the accent/status/surface colors. Consequences, all silent (the classes
look correct in source):

- `components/ui/page-header.tsx:37` — the sticky header on every screen wants a
  frosted `bg-bg-base/80` veil; it renders **transparent** (backdrop-blur only),
  hurting legibility over scrolled content.
- `components/ui/badge.tsx:33-41` — every badge variant's `ring-{variant}/20` is
  dropped, so badges fall back to Tailwind's **default translucent blue** inset
  ring (a stray off-brand accent, in both themes).
- The calendar live-update / stale-socket pills (`appointments-calendar.tsx:876,888`
  `border-success/30 bg-success/10`, `border-warning/30 bg-warning/10`) render
  with no tint; ~20 hand-rolled auth/settings alerts lose their semantic tint;
  accent hover beats (`hover:border-accent/40`) never fire.

One config-level fix lights up ~70 designed-but-dead sites at once. This plan
also finishes two adjacent token gaps the prior contrast pass left (danger
button below AA in dark; `text-accent` on tinted surfaces below AA) and locks
the radius scale so it can't drift.

## Current state

- `tailwind.config.ts:8-53` — the `colors` map. Every entry is a bare var:
  ```ts
  'bg-base': 'var(--bg-base)',
  'bg-surface': 'var(--bg-surface)',
  'bg-surface-2': 'var(--bg-surface-2)',
  accent: { DEFAULT: 'var(--accent)', /* …hover/active/fg/text/subtle/ring */ },
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)',
  ```
- `tailwind.config.ts:54-62` — `borderRadius` scale maps `2xs/xs/sm/DEFAULT/lg/xl`
  (2/4/6/8/12/16). **`md` is NOT mapped**, so `rounded-md` (used in ~70 sites,
  e.g. `appointments-calendar.tsx:855`, `components/ui/modal.tsx`) silently
  resolves to Tailwind's stock 6px — works by coincidence (== `--radius-sm`),
  but retuning `--radius-sm` would fork the UI.
- `app/globals.css:19-101` — the light-theme `:root` token block. The colors that
  need channels are **hex** today: `--accent: #4f7d5e` (:63), `--success: #15803d`
  (:86), `--warning: #b45309` (:88), `--danger: #dc2626` (:90), `--info: #2563eb`
  (:92); surfaces `--bg-base: #ffffff` (:25), `--bg-surface: #fafafa` (:26),
  `--bg-surface-2: #f5f5f5` (:27). The dark theme mirrors these in a second block
  (search `[data-theme='dark']` / the dark `:root` ~line 200+) with DIFFERENT hex
  values — the audit cites dark `--danger: #ef4444`.
- The `-subtle` tokens (`--accent-subtle`, `--success-subtle`, …) and the four
  `--border*` steps are **already** rgba-baked and used as named steps — leave
  them alone.
- `components/ui/button.tsx:66-70` — danger variant `bg-danger text-white` +
  `enabled:hover:opacity-90`; there is no `--danger-hover/-active/-fg` family
  (accent has one at `globals.css:63-66` — copy that structure).
- `components/ui/button.tsx:31-33` — stale comment claims "the Küa brand is
  purple-led" (it is sage since the rebrand).
- Accent text-on-tint token already exists: `--accent-text: #3a5e46`
  (`globals.css:74`), exposed as `text-accent-text`. The audit found `text-accent`
  (the lighter fill color) used on tinted surfaces where it fails AA:
  `app/[locale]/book/[shopSlug]/booking-wizard.tsx:1232-1233`,
  `app/[locale]/test-embed/page.tsx:71`.

Convention: the token system is the single source of truth (`globals.css:17`
"rebrand by editing the `--accent` block"). Keep that — ADD channel vars
alongside the hex, do not delete the hex (direct `var(--accent)` consumers like
`--accent-glow` and the focus ring must keep working).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Lint | `pnpm lint` | exit 0 (if it crashes with `a.getScope is not a function`, rebuild: `Remove-Item node_modules -Recurse -Force; pnpm install --frozen-lockfile` — known stale-canary issue) |
| Format | `pnpm format:check` | exit 0 |
| Tests | `pnpm test` | all pass (no test asserts on token CSS; should be unaffected) |
| Build | `NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key pnpm build` | exit 0 |
| Confirm classes now compile | after build: `Select-String -Path .next/static/css/*.css -Pattern 'bg-danger\\/10','ring-accent\\/20','bg-bg-base\\/80' -SimpleMatch` | each pattern is FOUND (was absent before) |

## Scope

**In scope** (the only files you should modify):
- `tailwind.config.ts` — color map → `rgb(var(--x-rgb) / <alpha-value>)`; radius `md`/`2xl` aliases.
- `app/globals.css` — add `--x-rgb` channel triplets (both themes); add `--danger-hover/-active/-fg` (both themes); delete the unused `--focus-ring-bg` (CRAFT-10).
- `components/ui/button.tsx` — danger variant uses the new token family; fix the stale "purple-led" comment.
- `app/[locale]/book/[shopSlug]/booking-wizard.tsx` and `app/[locale]/test-embed/page.tsx` — `text-accent` → `text-accent-text` on the cited tinted labels only (CRAFT-05).
- `app/[locale]/(app)/kitchen-sink/page.tsx` — fix the stale "dashed border" empty-state copy (CRAFT-10).

**Out of scope** (do NOT touch):
- The `-subtle` tokens and `--border*` steps (already alpha-baked correctly).
- Any `bg-{x}-subtle` / `ring-{x}-ring` usage — they already work; do not rewrite them to modifier syntax.
- The `--appt-purple` token — flagged for retirement elsewhere (CRAFT-10), but it has color-mapping consumers; verify-then-delete is plan 031's call, NOT here.
- Component layout, spacing, motion (other plans). This plan changes only how
  color/opacity/radius tokens resolve.

## Git workflow

- Branch: `advisor/029-token-alpha-value-truth-up`.
- One commit per step; conventional commits with scope, e.g.
  `fix(tokens): enable <alpha-value> opacity modifiers on color tokens`.
- Co-Authored-By footer per repo convention. Do NOT push unless instructed.

## Steps

### Step 1: Add RGB channel triplets to the token blocks (both themes)

In `app/globals.css`, in BOTH the light `:root` block and the dark theme block,
add a channel triplet next to each color that has opacity-modifier usage, WITHOUT
removing the existing hex var. Light-theme values (compute the dark ones from
that block's own hex):

```css
/* Channel triplets so Tailwind can inject <alpha-value> (Tailwind 3 can't
   parse alpha out of a hex-valued var). Keep the hex vars above for direct
   var() consumers (glows, focus ring). */
--bg-base-rgb: 255 255 255;
--bg-surface-rgb: 250 250 250;
--bg-surface-2-rgb: 245 245 245;
--accent-rgb: 79 125 94;       /* #4f7d5e */
--success-rgb: 21 128 61;      /* #15803d */
--warning-rgb: 180 83 9;       /* #b45309 */
--danger-rgb: 220 38 38;       /* #dc2626 (light) — use the dark block's hex in the dark block */
--info-rgb: 37 99 235;         /* #2563eb */
```

**Verify**: `pnpm format:check` → exit 0 (or run `pnpm format` then re-check).
`grep -c "\-rgb:" app/globals.css` → at least 16 (8 per theme × 2 themes).

### Step 2: Repoint the Tailwind color map at the channel vars

In `tailwind.config.ts:8-53`, change ONLY these entries to the `<alpha-value>`
form (leave every other entry, and all `-subtle`/`-ring`/`-text` sub-keys, as
bare `var()`):

```ts
'bg-base': 'rgb(var(--bg-base-rgb) / <alpha-value>)',
'bg-surface': 'rgb(var(--bg-surface-rgb) / <alpha-value>)',
'bg-surface-2': 'rgb(var(--bg-surface-2-rgb) / <alpha-value>)',
accent: {
  DEFAULT: 'rgb(var(--accent-rgb) / <alpha-value>)',
  // hover/active/fg/text/subtle/subtle-strong/ring stay as bare var(--…)
  ...
},
success: 'rgb(var(--success-rgb) / <alpha-value>)',
warning: 'rgb(var(--warning-rgb) / <alpha-value>)',
danger: 'rgb(var(--danger-rgb) / <alpha-value>)',
info: 'rgb(var(--info-rgb) / <alpha-value>)',
```

**Verify**: `pnpm typecheck` → exit 0. Then build and confirm the previously-dead
classes now exist in the compiled CSS:
`NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key pnpm build` → exit 0, then
`Select-String -Path .next/static/css/*.css -Pattern 'bg-bg-base\/80','ring-accent\/20','bg-danger\/10' -SimpleMatch` → all three FOUND.

### Step 3: Lock the radius scale (CRAFT-08)

In `tailwind.config.ts` `borderRadius` (lines 54-62), add aliases so the ~70
`rounded-md` and the stray `rounded-2xl`/`rounded-t-2xl` usages resolve through
the token scale instead of Tailwind stock values (zero visual change today,
makes the scale enforceable):

```ts
md: 'var(--radius-sm)',    // 6px — was Tailwind stock 6px by coincidence
'2xl': 'var(--radius-xl)', // 16px — match the documented top of the scale
```

**Verify**: `pnpm build` → exit 0; spot-check that a `rounded-md` element
(e.g. the calendar nav buttons) is visually unchanged.

### Step 4: Danger button token family + AA (CRAFT-04)

In `app/globals.css`, mirror the accent token structure (`globals.css:63-66`)
for danger, in BOTH themes. In the DARK theme, white-on-`#ef4444` is ~3.76:1
(below AA 4.5:1) — give danger a dark-theme foreground that clears AA the way
accent does (`--accent-fg`):

```css
/* light */            /* dark (mirror with the dark block's red) */
--danger-hover: #b91c1c;   --danger-hover: #dc2626;
--danger-active: #991b1b;  --danger-active: #b91c1c;
--danger-fg: #ffffff;      --danger-fg: #18181b;   /* dark near-black on the brighter red → AA */
```

Add `danger` sub-keys (`hover`/`active`/`fg`) to the Tailwind color map (as bare
`var()`), then in `components/ui/button.tsx:66-70` change the danger variant to
`bg-danger text-danger-fg … hover:bg-danger-hover active:bg-danger-active`
(replace `text-white` + `hover:opacity-90`). Also fix the stale comment at
`button.tsx:31-33` ("purple-led" → the sage brand).

**Verify**: `pnpm typecheck` → exit 0. Manually confirm (dev server, dark theme)
the danger button text clears AA against its fill (use a contrast checker; target
≥ 4.5:1).

### Step 5: `text-accent` → `text-accent-text` on tinted surfaces (CRAFT-05)

The fill-accent color on a tinted surface fails AA; the repo already ships the
fix token. Swap ONLY the cited sites: `booking-wizard.tsx:1232-1233` (the
uppercase label inside the `bg-accent-subtle` panel) and `test-embed/page.tsx:71`.
Do NOT blanket-replace `text-accent` everywhere — on a plain white/`bg-base`
surface `text-accent` is fine.

**Verify**: `grep -rn "text-accent[^-]" app/[locale]/book app/[locale]/test-embed`
→ the two cited sites now read `text-accent-text`; no other change.

### Step 6: Hygiene (CRAFT-10)

Delete the unused `--focus-ring-bg` token from both theme blocks (`globals.css:81`
and its dark mirror — confirm zero consumers first: `grep -rn "focus-ring-bg" app components tailwind.config.ts` should return only the definitions). Fix the
kitchen-sink stale copy at `app/[locale]/(app)/kitchen-sink/page.tsx:359` ("dashed
border" — the empty state no longer uses one).

**Verify**: `grep -rn "focus-ring-bg" app components` → no matches after deletion.
`pnpm typecheck` → exit 0.

## Test plan

- No new unit tests (this is CSS-token plumbing; vitest does not render CSS).
  The compiled-CSS grep in Step 2 IS the regression gate for the core fix.
- Manual visual QA (REQUIRED — this is the risk surface), in BOTH light and dark:
  1. A `PageHeader` shows a frosted (semi-opaque) veil when content scrolls under it.
  2. Badges (kitchen-sink has all variants) show their VARIANT-tinted ring, not a blue ring.
  3. The calendar live-update / stale pills show their green/amber tint.
  4. An auth error alert (trigger a bad login) shows a red-tinted background.
  5. The danger button (a ConfirmDialog) text is readable in dark.
- `pnpm test` → unchanged pass count (currently 245).

## Done criteria

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm build` exits 0; compiled CSS contains `bg-bg-base/80`, `ring-accent/20`, `bg-danger/10` (Step 2 grep)
- [ ] `pnpm lint` + `pnpm format:check` exit 0
- [ ] `pnpm test` exits 0 (245 pass)
- [ ] Hex vars retained (`grep -c "\-\-accent: #" app/globals.css` ≥ 1) AND channel vars added
- [ ] Both-theme visual QA checklist (Test plan) confirmed by the executor
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- After Step 2, a previously-dead class is STILL absent from the compiled CSS —
  the channel-var wiring is wrong; report rather than hand-editing 70 call sites.
- The visual QA surfaces a NEW contrast regression (newly-visible tint drops text
  below AA) you can't resolve by token tuning — report with a screenshot; do not
  silence it by reverting the alpha fix.
- The dark-theme block's hex values differ from what this plan assumed — use the
  ACTUAL dark hex for the triplets; if a value is missing entirely, STOP.
- Lint crashes with `a.getScope is not a function` — that's the known stale
  eslint canary; rebuild node_modules (Commands table) and continue, do not
  `--no-verify`.

## Maintenance notes

- **Reviewer**: scrutinize the dark-theme channel triplets (wrong RGB = wrong
  color only in dark, easy to miss) and the both-theme screenshots. This is a
  "the whole app shifts slightly" PR — review it visually, not just by diff.
- Going forward, a NEW color token MUST ship its `-rgb` triplet if any opacity
  modifier will use it. Consider a follow-up ESLint/stylelint guard that flags
  `bg-{token}/NN` where `{token}` lacks a channel var.
- Plans 030 (Callout primitive) and 031 (premium motion: glow/shadow/tabs) assume
  these opacity utilities now render — they MUST land after this.
- Deferred out of this plan: the `--appt-purple` retirement (needs a
  consumer-census; folded into 031), and converting the ~25 inline alerts to a
  primitive (that's plan 030).
