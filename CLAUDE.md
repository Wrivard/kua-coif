# CLAUDE.md — agent brief for kua-coiffure

> This file is auto-loaded as INSTRUCTIONS into every AI session on this repo.
> Keep it current and truthful — a wrong claim here misleads every future agent.
> It describes the system **as it is now**, not as it was originally specced.
> The original build spec lives at `docs/archive/SPEC-original.md`.

## 1. What this is

Multi-tenant SaaS to run hair salons / barbershops in Québec (brand **Küa**).
Each tenant is a **shop** with barbers, clients, services, products, a calendar
of appointments, and a public booking page. Three surfaces:

- **Back-office** (`app/[locale]/(app)/…`) — admin/manager/barber console.
- **Public booking** (`app/[locale]/book/[shopSlug]`) — anonymous client flow.
- **Embeddable widget** (`WIDGET-SPEC.md`) + token-gated public pages
  (`/me`, `/receipt`, `/review`, `/reschedule`, `/unsubscribe`).

Bilingual **fr + en**, French default (Québec).

## 2. Stack (verify against `package.json` before relying on a version)

- **Next.js 14 App Router** (14.2.35) + **TypeScript strict**.
- **Supabase**: Postgres + Auth + Storage, **Row Level Security**. Multi-tenant
  by `shop_id`; a member sees only their shops. Types in `db/types.ts`
  (regenerate with `pnpm db:types:local` / `:remote`).
- **Stripe Connect** — deposits / PaymentIntents / Elements (`lib/stripe/*`).
- **next-intl v4** (`messages/fr.json`, `messages/en.json`), fr default.
- **Tailwind** with CSS-variable tokens (`app/globals.css`). **Light + dark
  themes, light is the default** (`lib/theme.ts`: explicit choice → system →
  light). Do not reintroduce a hardcoded `dark` class.
- date-fns / date-fns-tz (shop timezone math, `lib/business/timezone.ts`),
  react-hook-form + zod, @dnd-kit, recharts, react-virtual (list windowing).
  There is **no react-query and no react-table** in this repo — do not add
  them; use React Server Components + server actions and plain tables.
- Integrations: Resend/nodemailer (email), Twilio (SMS), Upstash (rate limit),
  Sentry (observability), Google Calendar + QuickBooks (OAuth sync).

## 3. Non-negotiables for agents

- **pnpm ONLY.** Never run `npm …`. `pnpm-lock.yaml` is the single source of
  truth — `ci.yml` (Loop 41) switched off npm because a parallel
  `package-lock.json` kept drifting and breaking `npm ci`. `engines.node >= 22`,
  `packageManager: pnpm@9.15.0`.
- **Verification gates** before claiming done (all must pass):
  `pnpm typecheck` · `pnpm test` · `pnpm lint` · `pnpm format:check` ·
  `pnpm build`. `build` needs placeholder Supabase env:
  `NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co`
  `NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key`.
- **Conventional commits with a scope** (`fix(audit): …`, `feat(security): …`).
- **i18n**: every UI string goes through next-intl in **both** `fr` AND `en` —
  `tests/i18n-parity.test.ts` fails the build on a missing key. No hardcoded
  user-facing strings.
- **Tenant scoping**: every shop-scoped query carries
  `.eq('shop_id', activeShopId)` (resolve via `lib/auth/server.ts`). The
  **service-role client bypasses RLS** — when you use it (public flows, crons),
  you own the scoping; never let it leak cross-tenant rows.
- **Audit**: money / consent / compliance / public-anon-flow trails go through
  **`logDurableAudit`** (service-role, PII-redacted, `lib/audit-log.ts`).
  `logAuditAction` is a runtime **no-op** (its user-session insert is dropped by
  `audit_log` RLS) — documentation-only next to trigger-captured mutations.
- **New tables ship per-command RLS** policies (separate select/insert/update/
  delete), not a single `for all` — see
  `supabase/migrations/20260610100000_catalog_rls_per_command.sql`.
- **No secrets** in logs, errors, or docs. Mask SIN / tax-id / tokens.

## 4. Map & exemplars

- `app/[locale]/(app)/…` — authed console (calendar, clients, services,
  products, barbers, finances, settings). `app/[locale]/book/…` — public
  booking. `app/api/…` — webhooks (Stripe, Twilio, Google) + cron endpoints.
- `lib/business/` — pure domain logic (availability, pricing, timezone,
  commissions, loyalty). `lib/data/` — cached reads. `lib/security/` — tokens,
  Turnstile, cron auth. `lib/stripe`, `lib/google`, `lib/quickbooks`,
  `lib/email`, `lib/sms` — integrations.
- Pattern exemplars to copy, not reinvent:
  - **Server actions**: `lib/server-actions/with-action.ts` (`withAction`
    wraps auth + role gate + zod + typed result; `minRole`).
  - **Cached reads**: `lib/data/calendar-config.ts`, `lib/auth/server.ts`
    (React `cache` / `unstable_cache`).
  - **Signed public tokens** (versioned, revocable): `lib/security/signed-tokens.ts`.
- **`plans/README.md`** is the living tracker for in-flight work; each
  `plans/NNN-*.md` is a self-contained executable plan. Check it before
  starting cross-cutting work. (Changing a convention here means updating
  THIS file in the same change.)

## 5. Where the rest lives

- **Original build spec + exact seed values**: `docs/archive/SPEC-original.md`.
  Its **ANNEXE — Partie 2 (SEED exact)** stays authoritative for the seed
  data values that `supabase/seed.sql` implements (shop "Axum barbershop",
  taxes, services, products, barbers, etc.).
- Setup + first login: `README.md`. Deploy + secrets + DR: `DEPLOY.md`.
  Standing decisions: `DECISIONS.md`. Clients feature notes:
  `FEATURE_CLIENTS.md`. Widget: `WIDGET-SPEC.md`.
