# Plan 030: Extract a Callout/Alert primitive and end the inline-alert drift

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report — do not improvise.
> When done, update this plan's row in `plans/README.md` (unless a reviewer told
> you they maintain the index).
>
> **Drift check (run first)**: `git diff --stat 9e6ce12..HEAD -- components/ui tailwind.config.ts app/globals.css`
> If `components/ui/badge.tsx`, `tailwind.config.ts`, or `app/globals.css`
> changed, compare the excerpts below against the live code before proceeding.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (a new presentational primitive + mechanical replacement; markup semantics preserved)
- **Depends on**: **plan 029** (REQUIRED — the alert tints/rings use opacity-modified
  token classes that only render after 029's `<alpha-value>` fix; building Callout
  before 029 ships a primitive that renders a stray blue ring).
- **Category**: tech-debt
- **Planned at**: commit `9e6ce12`, 2026-06-10

## Why this matters

The most-repeated composition in the app — a tinted inline alert/callout — has no
primitive, so ~25 sites hand-roll `border-{status}/30 bg-{status}/10 …` with
drifting radius (`rounded` 8px vs `rounded-md` 6px vs `rounded-lg` 12px), drifting
shadow (none vs `shadow-sm` vs `shadow-warm-sm`), and drifting tint strength. Every
instance is slightly different, and (until plan 029) all of them are silently
broken. One `<Callout>` primitive built on the Badge token recipe collapses the
drift into a single, kitchen-sink-policed component.

## Current state

- `components/ui/badge.tsx:31-41` — the token recipe to mirror (variant → tint):
  ```ts
  accent:  'bg-accent-subtle text-accent-text ring-1 ring-inset ring-accent/20',
  success: 'bg-success-subtle text-success     ring-1 ring-inset ring-success/20',
  warning: 'bg-warning-subtle text-warning     ring-1 ring-inset ring-warning/20',
  danger:  'bg-danger-subtle  text-danger      ring-1 ring-inset ring-danger/20',
  info:    'bg-info-subtle    text-info        ring-1 ring-inset ring-info/20',
  default: 'bg-bg-surface-2   text-text-secondary ring-1 ring-inset ring-border',
  ```
- `components/ui/index.ts` — barrel exports for all primitives (Callout will be added).
- An exemplar inline alert (one of ~25), `app/[locale]/(auth)/login/login-form.tsx:62-69`:
  ```tsx
  {state && !state.ok && !state.fieldErrors ? (
    <p role="alert" className="border-danger/30 bg-danger/10 rounded-lg border px-3 py-2 text-xs text-danger shadow-sm">
      {tErr(state.errorCode satisfies AuthErrorCode)}
    </p>
  ) : null}
  ```
- The other inline-alert sites flagged by the audit (verify each before editing):
  `(auth)/setup-password/setup-password-form.tsx:59,108,116,124`,
  `(auth)/reset-password/reset-password-form.tsx:67,116,124,132`,
  `(auth)/forgot-password/forgot-password-form.tsx:28,51,59,67`,
  and (owned by OTHER plans — leave for them, see Out of scope)
  `settings/notifications/notifications-client.tsx`, `settings/widget/widget-client.tsx`,
  `book/[shopSlug]/booking-payment-section.tsx`, `clients/[id]/page.tsx`, `finances/page.tsx`.

Convention: primitives are function components in `components/ui/*.tsx`, exported
from `index.ts`, exercised in `app/[locale]/(app)/kitchen-sink/page.tsx`. Radius
token scale is `2xs/xs/sm/lg/xl` (+ `md` alias after 029); lock Callout to
`rounded-lg`. `cn()` from `@/lib/utils` merges classes.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all pass (245) |
| Lint | `pnpm lint` | exit 0 |
| Format | `pnpm format:check` | exit 0 |
| Build | `NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key pnpm build` | exit 0 |

## Scope

**In scope**:
- NEW `components/ui/callout.tsx`
- `components/ui/index.ts` (export it)
- `app/[locale]/(app)/kitchen-sink/page.tsx` (showcase all variants)
- Adopt Callout at the SELF-OWNED alert sites only: the four `(auth)/*-form.tsx`
  files + `settings/widget/widget-client.tsx` (not owned by another UI/UX plan).
- `messages/*` only if a new a11y/label key is genuinely needed (likely none —
  the alerts already supply their text).

**Out of scope** (owned by other plans — they adopt Callout when they touch the file,
to keep plans file-disjoint and parallel-safe):
- `settings/notifications/notifications-client.tsx` (plans 032/039)
- `book/[shopSlug]/booking-payment-section.tsx` (plan 036)
- `finances/page.tsx` (plan 039), `clients/[id]/page.tsx` (plan 040)
- Do NOT change the Badge primitive. Do NOT touch token definitions (plan 029).

## Git workflow

- Branch: `advisor/030-callout-primitive`.
- Commits: `feat(ui): Callout/Alert primitive`, then `refactor(auth): adopt Callout`.
- Co-Authored-By footer. Do NOT push unless instructed.

## Steps

### Step 1: Build the Callout primitive

Create `components/ui/callout.tsx`:
- Props: `variant?: 'default' | 'accent' | 'success' | 'warning' | 'danger' | 'info'`
  (default `'default'`), `icon?: ReactNode`, `title?: ReactNode`, `className?`,
  `children`, and the rest of `HTMLAttributes<HTMLDivElement>`.
- Variant styles = the Badge recipe above (`bg-{v}-subtle text-{v}[-text] ring-1 ring-inset ring-{v}/20`).
- Base: `rounded-lg px-3 py-2 text-sm` (+ `flex gap-2` when an icon is present).
- a11y: set `role="alert"` for `danger`/`warning`, `role="status"` otherwise
  (allow an explicit `role` override via rest props).
- Keep it presentational — no state, no toasts.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Export + showcase

Add `export { Callout } from './callout';` to `components/ui/index.ts` (keep the
alphabetical-ish ordering). Add a "Callouts" section to the kitchen-sink rendering
every variant (with and without icon/title) so future drift is visible.

**Verify**: `pnpm build` → exit 0; the kitchen-sink renders all variants with their
correct tints (post-029) and `rounded-lg`.

### Step 3: Adopt at the self-owned sites

Replace the hand-rolled alert markup in the four `(auth)/*-form.tsx` files and
`settings/widget/widget-client.tsx` with `<Callout variant="danger">…</Callout>`
(or the matching variant). Preserve each site's conditional rendering and its text
expression exactly; only the wrapper element changes. Keep `role="alert"` behavior
(Callout supplies it for danger/warning).

**Verify**: `grep -rn "bg-danger/10\|bg-success/10\|bg-warning/10" app/[locale]/(auth)`
→ no remaining hand-rolled alerts in the auth forms. `pnpm build` → exit 0.

## Test plan

- No new unit test required for a presentational primitive. If a snapshot/RTL test
  exists for an auth form, update it to expect the Callout wrapper.
- Manual: kitchen-sink shows all variants correctly tinted in light + dark; a failed
  login renders the Callout (not a stray-blue or untinted box).
- `pnpm test` → 245 pass.

## Done criteria

- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm format:check` exit 0
- [ ] `pnpm build` exits 0
- [ ] `pnpm test` exits 0 (245)
- [ ] `components/ui/callout.tsx` exists and is exported from `index.ts`
- [ ] Kitchen-sink shows all Callout variants
- [ ] The four auth forms + widget-client use `<Callout>` (no hand-rolled alert markup remains in them)
- [ ] No out-of-scope file modified (`git status`)
- [ ] `plans/README.md` row updated

## STOP conditions

- Plan 029 has NOT landed (the drift check shows token classes still bare `var()`):
  STOP — building Callout now bakes in the blue-ring bug. Confirm 029 is merged first.
- An auth form's alert carries logic beyond display (e.g. it also gates focus) —
  preserve that; if the Callout swap would drop it, STOP and report.

## Maintenance notes

- **Reviewer**: confirm Callout uses the Badge token recipe (no new hardcoded
  colors) and a single locked radius.
- **Remaining adoptions** (deliberately deferred to keep plans file-disjoint): when
  plans 032/039 touch `notifications-client.tsx`, 036 touches
  `booking-payment-section.tsx`, 039 touches `finances/page.tsx`, and 040 touches
  `clients/[id]/page.tsx`, each should swap its inline alerts to `<Callout>`. Track
  this so the drift doesn't quietly return.
- A follow-up could add an `onDismiss` affordance for dismissible callouts; not needed now.
