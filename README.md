# kua-coiffure

Plateforme SaaS de gestion pour salons de coiffure / barbershops (back-office + page de réservation publique + widget intégrable). Inspirée de Squire, marque Küa.

> **Spec** : [`CLAUDE.md`](./CLAUDE.md) — cahier des charges complet (design system, schéma de données, 18 écrans + booking, annexe seed exact).
> **Architecture** : [`ARCHITECTURE.md`](./ARCHITECTURE.md) — plan global, checklist go-live.
> **Audit** : [`AUDIT.md`](./AUDIT.md) — état production-ready, optimisations priorisées (Phase 3).
> **Décisions** : [`DECISIONS.md`](./DECISIONS.md) — journal des arbitrages produit/technique.
> **Déploiement** : [`DEPLOY.md`](./DEPLOY.md) — checklist Vercel + Supabase live.
> **Widget** : [`WIDGET-SPEC.md`](./WIDGET-SPEC.md) — spec du widget embarquable (Phase 10).

## État

| Phase | Statut |
|---|---|
| 0 Bootstrap + 1 Design system | ✅ |
| 2 DB schema + RLS + seed Axum | ✅ |
| 3 Auth Supabase + boundaries + headers | ✅ |
| 3.5 Hardening (rate limit + observability stub + CI) | ✅ |
| 4 CRUD (Services, Barbers, Clients, Products, CSV) | ✅ |
| 5 Calendrier Side by Side + moteur dispo testé | ✅ |
| 6 Settings (Taxes, Discounts, Loyalty, Waiting, Promo, Password, Shop) | ✅ |
| 6b Barber Settings grille + User Settings invitations | ✅ |
| 7 Finances (Commissions + Payments UI) | ✅ |
| 8 Booking public (wizard 5 étapes) | ✅ |
| 9 Polish (CSP, sitemap, Schema.org, /privacy + /terms) | ✅ |
| **10a** Widget intégrable (route `/embed`, `widget.js`, admin live preview) | ✅ |
| **10b** Wizard UX polish (pro-first, slot icons, order recap, primary banner) | ✅ |
| **11** Supabase advisors hotfix (search_path, FK indexes, init-plan, extensions schema) | ✅ |
| **12** Perf optimizations (calendar memoization, ISR sur /book + /embed, next/image avatar) | ✅ |
| **13** Sentry actif (DSN-gated, prêt à activer) | ✅ |
| **14** Playwright e2e (booking, signup, calendar) | ✅ |
| **16** Routes manquantes (`/no-shop`, `/forgot-password`, `/reset-password`) | ✅ |
| **17** Audit log read UI + docs refresh | ✅ |
| V1.1+ (Stripe Connect, Realtime calendar, Resend, Turnstile, Upstash) | Différé |

56 tests Vitest + 3 spec files Playwright e2e. 41 routes back-office + booking public + widget embed + 3 API routes.

## Stack

- **Next.js 14.2** App Router + TypeScript strict
- **Tailwind CSS** avec tokens couleur en CSS vars (rebrand = 4 lignes)
- **Supabase** (Postgres + Auth + RLS + Storage)
- **next-intl** (FR par défaut, EN supporté)
- **react-hook-form** + **zod** + **@tanstack/react-query**
- **@dnd-kit** (drag — V1.2 sur calendrier) · **papaparse** (CSV) · **date-fns-tz** (timezone shop)
- **@sentry/nextjs** (dormant tant que pas de DSN, voir [Sentry](#sentry-observability))
- **Vitest** (unit + business) + **@playwright/test** (e2e)

## Démarrer en local

```bash
# 1. Variables d'environnement
cp .env.example .env.local
# … puis remplir NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY, SUPABASE_PROJECT_REF.

# 2. Dépendances
npm install

# 3. Dev
npm run dev       # http://localhost:3000 → redirige vers /fr

# 4. Vérifs
npm run build
npm run typecheck
npm run lint
npm run format:check
npm test                # 56 tests Vitest
npm run test:e2e        # Playwright (headless) — boote `npm run dev` auto
npm run test:e2e:ui     # Playwright (mode interactif)
```

Première installation Playwright (par machine) :

```bash
npx playwright install chromium
```

## Variables d'environnement

| Nom | Scope | Obligatoire | Note |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | ✅ | URL projet Supabase (ex. `https://abc.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | ✅ | Clé publique (`sb_publishable_…`) |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only | ✅ | Bypass RLS — booking public + admin actions |
| `NEXT_PUBLIC_SITE_URL` | client + server | ✅ en prod | Pour sitemap / robots / OG / Sentry replays |
| `SUPABASE_PROJECT_REF` | CLI local | ⛔ prod | Utilisé par `npm run db:*` uniquement |
| `NEXT_PUBLIC_SENTRY_DSN` | client + server | ⛔ | Active Sentry browser quand renseigné |
| `SENTRY_DSN` | server-only | ⛔ | Active Sentry server/edge (fallback sur `NEXT_PUBLIC_SENTRY_DSN`) |
| `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT` | build-time | ⛔ | Activent l'upload source-maps (sinon Sentry montre du minifié) |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | server-only | ⛔ | Active le rate limit Upstash (shared sliding-window au lieu de l'in-memory per-instance). Free tier 10k cmd/jour. |

Toutes les vars `NEXT_PUBLIC_*` sont **bakées au build time** — un redeploy est nécessaire après changement Vercel.

## Base de données — appliquer les migrations

Deux flows possibles.

### A. Local avec Docker (recommandé pour le dev)

```bash
# Docker Desktop installé et démarré
npm run db:start         # lance Postgres + Studio + Auth en local
npm run db:reset         # applique migrations + seed.sql
npm run db:types:local   # codegen db/types.ts
npm run db:test          # joue supabase/tests/*.sql (incl. rls_cross_shop)
```

L'URL locale s'affiche dans le terminal (par défaut `http://127.0.0.1:54321`). Renseigne-la dans `.env.local`.

### B. Cloud (Supabase Studio) via MCP ou CLI

Voir [`DEPLOY.md`](./DEPLOY.md) pour le flow MCP (recommandé — c'est ce qui a déployé la prod actuelle), ou le flow CLI traditionnel :

```bash
SUPABASE_PROJECT_REF=xxxxxxx npm run db:link
npm run db:push                  # applique les 4 migrations dans /supabase/migrations
# Puis copie-colle supabase/seed.sql dans le SQL Editor Supabase
npm run db:types:remote          # regénère db/types.ts depuis le schéma live
```

Le seed est idempotent par run mais pas par état : pour le rejouer, supprime d'abord le shop : `delete from public.shops where alias = 'axum';` (cascade).

## Déployer sur Vercel

Voir [`DEPLOY.md`](./DEPLOY.md) — checklist concrète post-Phase 11.

## Sentry (observability)

L'app est wirée pour Sentry mais **dormante** tant que `NEXT_PUBLIC_SENTRY_DSN` n'est pas renseigné. Aucun coût runtime quand off. Pour activer :

1. Crée un projet Sentry gratuit (5k events/mois) sur sentry.io.
2. Copie le DSN dans `NEXT_PUBLIC_SENTRY_DSN` (Vercel Preview + Production).
3. (Optionnel) Ajoute `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT` pour uploader les source-maps (sinon Sentry affiche du JS minifié).
4. Redeploy. Le prochain page load capture les erreurs.

## Widget intégrable

Le booking est **également servi en widget iframe** pour intégration sur le site du salon :

```html
<div data-kua-widget="axum"></div>
<script src="https://kua-coif.vercel.app/widget.js" async></script>
```

Customisation par shop via `/settings/widget` (thème, ordre des étapes, origines whitelistées). Détails : [`WIDGET-SPEC.md`](./WIDGET-SPEC.md).

## Structure

```
app/
  globals.css                  # tokens couleur (CSS vars) — UNIQUE source de vérité du design
  global-error.tsx             # ultime fallback bilingue
  robots.ts · sitemap.ts       # SEO public
  api/
    health/route.ts            # ping monitoring (uptime / Supabase status)
    export/[entity]/route.ts   # CSV export whitelistée
    book/[shopSlug]/slots/     # slots disponibles pour le wizard public
  [locale]/                    # routes localisées (fr|en)
    layout.tsx · error.tsx · loading.tsx · not-found.tsx
    (auth)/login · signup · forgot-password · reset-password
    no-shop/                   # landing post-signup quand pas membre d'un shop
    (app)/                     # shell back-office (sidebar + page header)
      page.tsx                 # /  → Appointments + calendrier
      clients|services|barbers|products|support|marketing|finances/
      settings/{shop,users,barbers,taxes,payments,commissions,password,
                discounts,loyalty,waiting-list,promo-codes,widget,audit-log}/
      kitchen-sink/
    book/[shopSlug]/           # booking public (hors shell, hors auth, ISR 60s)
    embed/[shopSlug]/          # widget iframe (hors shell, dynamic theme, postMessage resize)
    privacy · terms            # Loi 25 Quebec
components/
  ui/                          # primitives design system (~27)
  providers/                   # QueryProvider
db/
  rows.ts                      # row types manuels (en attendant codegen complet)
  enums.ts · types.ts          # enums + Database type (codegen Supabase)
lib/
  auth/                        # server.ts (requireUser…) + actions.ts + errors.ts + rate-limit.ts
  business/                    # taxes · timezone · availability · commissions · tips · widget-config
  server-actions/              # withAction wrapper + Result type + revalidate helper
  supabase/                    # client browser/server/middleware/service-role
  audit-log.ts · nav-items.ts · observability.ts · utils.ts
messages/                      # fr.json (défaut) + en.json
public/
  widget.js                    # snippet embed pour sites tiers
sentry.client.config.ts
sentry.server.config.ts
sentry.edge.config.ts
instrumentation.ts             # Sentry boot hook
supabase/
  config.toml
  migrations/{init_schema,rls,indexes_triggers,widget_config,advisors_hotfix}.sql
  seed.sql                     # données Axum exactes (annexe)
  tests/rls_cross_shop.sql     # régression isolation tenant
tests/
  e2e/{booking,auth,calendar}.spec.ts
i18n.ts · middleware.ts · next.config.mjs · tailwind.config.ts
vitest.config.ts · playwright.config.ts
.github/workflows/ci.yml       # build + lint + typecheck + format:check sur PR/main
```

## Sécurité

- **RLS** sur les 26 tables (`force row level security`), test multi-shop dans [`supabase/tests/rls_cross_shop.sql`](supabase/tests/rls_cross_shop.sql).
- **Auth** : Supabase email/password, middleware refresh-session, `safeRedirectTarget()` anti open-redirect.
- **Rate limiting** : auth signin 5/10min, signup 3/10min, forgot-password 3/10min, reset-password 5/10min, public booking 10/10min, slots API 30/min. Bascule auto sur Upstash Redis (sliding-window partagé multi-instance) quand `UPSTASH_REDIS_REST_URL` est renseigné, sinon fallback in-memory per-process.
- **Honeypot** sur la booking page publique.
- **Headers** : CSP avec `frame-ancestors *` réservé aux routes `/embed/*`, strict ailleurs · X-Frame-Options DENY · nosniff · Referrer-Policy strict · Permissions-Policy off camera/mic/geo · HSTS 1 an.
- **Aucune donnée sensible affichée en clair** (SIN, Tax ID) — badges « Provided / Not Provided ».
- **Audit log** : 7 tables instrumentées via trigger SQL Phase 2 + `logAuditAction()` côté code, surface admin sur `/settings/audit-log`.

## Différé V1.1+

- **Stripe Connect** : intégration paiement réelle (UI déjà câblée).
- **Resend** : emails de confirmation customisés.
- **Cloudflare Turnstile** : protection bot sur signup + booking.
- **Realtime calendar** : Supabase Realtime sur `appointments` pour les barbiers multi-écrans.
- **Drag-and-drop calendrier** : reprogrammation des RDV (édition par modal en V1).
- **Per-shop CSP `frame-ancestors` whitelist** pour `/embed` (V1 : permissif `*`).
