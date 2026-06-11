# Plan 041: Public-surface i18n consolidation + scoped message catalog

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report. When done, update this
> plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 9e6ce12..HEAD -- "app/[locale]/layout.tsx" "app/[locale]/(app)/finances/today/close-out-client.tsx" "app/[locale]/unsubscribe/[token]" messages/fr.json messages/en.json`
> Compare each "Current state" excerpt against the live code; on a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (a missed namespace throws `MISSING_MESSAGE` at runtime — needs a per-surface smoke pass)
- **Depends on**: run LAST among the surface plans — **037** (reschedule), **039** (marketing),
  **043** (review), **044** (/me), **045** (receipt) each migrate THEIR surface's inline copy
  to next-intl as part of their work. This plan does the catalog scoping + close-out + a
  residual sweep of whatever inline-`isFr` remains (so the plans stay file-disjoint).
- **Category**: tech-debt
- **Planned at**: commit `9e6ce12`, 2026-06-10

## Why this matters

Two i18n debts hurt the public surfaces:

- **The entire message catalog ships on every document load.** `app/[locale]/layout.tsx`
  calls `getMessages()` with no namespace selection and feeds it to
  `NextIntlClientProvider`, so `messages/fr.json` (~81KB) / `en.json` (~75KB) embed in the
  HTML of every full load — including the mobile-first booking page and SMS-opened token
  pages, which need only a few namespaces. It grows with every feature.
- **Inline `isFr ? {} : {}` copy maps bypass next-intl** on the client-facing token surfaces
  and the marketing clients (English fallbacks that silently render to FR salons, hand-rolled
  `.replace('{count}', …)` instead of ICU, and a hardcoded `'America/Toronto'`). Most of these
  are migrated by the owning surface plans; this plan sweeps the residue and the standalone
  `close-out-client.tsx` (`finances/today/close-out-client.tsx:27-28` hardcodes `'Imprimer'/'Print'`).

## Current state

- `app/[locale]/layout.tsx` — `const messages = await getMessages();` →
  `<NextIntlClientProvider messages={messages}>` (full catalog). next-intl v4 supports passing a
  `pick`ed subset.
- `app/[locale]/(app)/finances/today/close-out-client.tsx:27-28` —
  `const printLabel = isFr ? 'Imprimer' : 'Print';` (component-code string, not in messages).
- `app/[locale]/unsubscribe/[token]/unsubscribe-client.tsx:~42-108` — inline `isFr` map (this
  token surface is NOT owned by another plan).
- The other inline-`isFr` surfaces are migrated by their owners (verify they're done before the
  residual sweep): `me-client.tsx` (plan 044), `reschedule-client.tsx` (037), `review-form-client.tsx`
  (043), `receipt-client.tsx` (045), `review-campaign-client.tsx`/`winback-client.tsx` (039).

Convention: strings live in `messages/{fr,en}.json` under a namespace; `useTranslations('ns')`
in client components; `tests/i18n-parity.test.ts` fails the build on a key present in one locale
but not the other. Timezone comes from the shop row, never hardcoded.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all pass (245); i18n-parity green |
| Lint / Format | `pnpm lint` · `pnpm format:check` | exit 0 |
| Build | `… pnpm build` | exit 0 |
| Find residual inline maps | `grep -rn "isFr ?" "app/[locale]" --include=*.tsx` | shrinking to ~0 on client surfaces |

## Scope

**In scope**: `app/[locale]/layout.tsx` and any public-surface layout (`book`, `embed`, token
segments) for catalog scoping (PERF-09); `finances/today/close-out-client.tsx` (FIN-04);
`unsubscribe/[token]/unsubscribe-client.tsx` (residual UX-09); `messages/{fr,en}.json`; and a
final residual sweep of any remaining client-surface `isFr ?` maps the owning plans missed.

**Out of scope**: re-migrating surfaces the owning plans already did (037/039/043/044/045) — only
sweep what's LEFT. The admin shell can keep the full catalog (scope only the public layouts).

## Git workflow

- Branch: `advisor/041-public-i18n`. Commit per area; e.g.
  `perf(i18n): scope the message catalog on public layouts`, `refactor(i18n): close-out + unsubscribe to next-intl`.
- Co-Authored-By footer. Do NOT push unless instructed.

## Steps

### Step 1: Scope the message catalog on public layouts (PERF-09)

For the public-facing layouts (`book`, `embed`, and the token segments), pass a `pick`ed subset
of namespaces (e.g. `pages.booking`, `pages.tokenLink`, `common`, `actionErrors`) to
`NextIntlClientProvider` instead of the full catalog. The admin `(app)` shell keeps the full
catalog. Smoke EACH public surface for `MISSING_MESSAGE` after scoping.

**Verify**: `pnpm build` → exit 0; the booking page HTML no longer embeds admin namespaces
(spot-check the payload). No runtime `MISSING_MESSAGE` on book / embed / each token page.

### Step 2: close-out + unsubscribe to next-intl (FIN-04 + residual UX-09)

Move `close-out-client.tsx`'s hardcoded labels to `pages.finances.today.*` and use
`useTranslations`. Migrate `unsubscribe-client.tsx`'s inline `isFr` map to a `pages.unsubscribe.*`
namespace. Both locales; keep the register (tu/vous) consistent with the sibling token pages.

**Verify**: `grep -n "isFr ?" close-out-client.tsx unsubscribe-client.tsx` → none. i18n-parity green.

### Step 3: Residual sweep

`grep -rn "isFr ?" "app/[locale]" --include=*.tsx` — for any remaining client-surface map NOT
owned by an in-flight plan, migrate it. If a hit belongs to a surface plan that hasn't landed
yet, LEAVE it (note it) — don't create a conflict.

**Verify**: the grep is empty on landed surfaces; `pnpm test` → 245 pass, parity green.

## Test plan

- `tests/i18n-parity.test.ts` is the gate (every new key in both files). Add a smoke render for
  a scoped public surface if the harness supports it.
- Manual: load `/en/book/<slug>`, each `/en/<token>` page, and a scoped surface — no missing-key
  console errors; EN renders English.
- `pnpm test` → 245 pass.

## Done criteria

- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm format:check` / `pnpm build` exit 0
- [ ] `pnpm test` exits 0 (245); i18n-parity green
- [ ] Public layouts pass a scoped (picked) catalog; admin keeps full
- [ ] `grep -rn "isFr ?" "app/[locale]" --include=*.tsx` empty on landed surfaces
- [ ] No hardcoded timezone introduced; close-out + unsubscribe use next-intl
- [ ] No out-of-scope (owned-by-another-plan, not-yet-landed) file modified (`git status`)
- [ ] `plans/README.md` row updated

## STOP conditions

- Scoping a layout throws `MISSING_MESSAGE` for a namespace you can't identify — STOP; widen the
  pick for that surface rather than guessing (a missed key is a runtime crash).
- A residual `isFr` map belongs to a surface plan still in flight — LEAVE it; do not edit a file
  another plan owns.

## Maintenance notes

- **Reviewer**: the catalog scoping is the risky part — verify every public surface renders with
  no missing keys in BOTH locales.
- A future lint rule could ban inline `isFr ?` copy maps on client components to prevent regression.
- If a public surface later needs a new namespace, add it to that layout's `pick` list.
