# kua-coiffure

Plateforme SaaS de gestion pour salons de coiffure / barbershops (back-office + page de réservation publique). Inspirée de Squire, marque Küa.

> **Spec** : [`CLAUDE.md`](./CLAUDE.md) — cahier des charges complet (design system, schéma de données, 18 écrans + booking, annexe seed exact).
> **Audit** : [`AUDIT.md`](./AUDIT.md) — état production-ready, optimisations priorisées.
> **Décisions** : [`DECISIONS.md`](./DECISIONS.md) — journal des arbitrages produit/technique.
> **Architecture** : [`ARCHITECTURE.md`](./ARCHITECTURE.md) — plan global, checklist go-live.

## État

| Phase | Statut |
|---|---|
| 0 Bootstrap + 1 Design system | ✅ |
| 2 DB schema + RLS + seed Axum | ✅ |
| 3 Auth Supabase + boundaries + headers | ✅ |
| 3.5 Hardening (rate limit + observability + CI) | ✅ |
| 4 CRUD (Services, Barbers, Clients, Products, CSV) | ✅ |
| 5 Calendrier Side by Side + moteur dispo testé | ✅ |
| 6 Settings (Taxes, Discounts, Loyalty, Waiting, Promo, Password, Shop) | ✅ |
| 7 Finances (Commissions + Payments UI) | ✅ |
| 8 Booking public (wizard 5 étapes) | ✅ |
| 9 Polish (CSP, sitemap, Schema.org, /privacy + /terms) | ✅ |
| **6b** Barber Settings grille + User Settings invitations | Différé V1.1 |
| **9b** Playwright e2e + Lighthouse CI + Sentry actif | Différé (besoin d'une URL Vercel live) |

44 tests Vitest (taxes · availability · cancellation · commissions cumulative & non-cumul · tips). 38 routes + booking public + 3 API routes. Middleware 105 kB.

## Stack

- **Next.js 14.2** App Router + TypeScript strict
- **Tailwind CSS** avec tokens couleur en CSS vars (rebrand = 4 lignes)
- **Supabase** (Postgres + Auth + RLS + Storage)
- **next-intl** (FR par défaut, EN supporté)
- **react-hook-form** + **zod** + **@tanstack/react-query**
- **@dnd-kit** (drag — V1.1 sur calendrier) · **papaparse** (CSV) · **date-fns-tz** (timezone shop)
- **Vitest** + `@testing-library/react` (44 tests)

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
npm test          # 44 tests Vitest
```

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

### B. Cloud (Supabase Studio), sans Docker

```bash
# 1. Crée un projet sur supabase.com (gratuit)
# 2. Notes-toi : Project URL + anon key + service-role key + project ref

# 3. Lie le repo à ton projet
SUPABASE_PROJECT_REF=xxxxxxx npm run db:link

# 4. Pousse les migrations
npm run db:push

# 5. Exécute le seed (SQL Editor → coller supabase/seed.sql)
#    OU psql "$SUPABASE_DB_URL" -f supabase/seed.sql

# 6. Regénère les types
npm run db:types:remote
```

Le seed est idempotent par run mais pas par état : pour le rejouer, supprime d'abord le shop : `delete from public.shops where alias = 'axum';` (cascade).

## Déployer sur Vercel

Le moyen le plus rapide d'avoir une URL Chrome publique.

```bash
# 1. Crée un compte Vercel (gratuit) si pas déjà fait.
# 2. Import Project → choisis Wrivard/kua-coif.
# 3. Framework Preset : Next.js (détecté automatiquement).
# 4. Renseigne les Environment Variables (Production + Preview + Development) :
#
#       NEXT_PUBLIC_SUPABASE_URL       https://<ref>.supabase.co
#       NEXT_PUBLIC_SUPABASE_ANON_KEY  <anon key>
#       SUPABASE_SERVICE_ROLE_KEY      <service role key>
#       NEXT_PUBLIC_SITE_URL           https://<your-vercel-domain>
#
#    (SUPABASE_PROJECT_REF n'est utile que pour les commandes CLI locales.)
#
# 5. Deploy. Vercel détecte la CI GitHub Actions et chaque push sur main
#    re-déploie automatiquement.
```

**Domaine custom** : Settings → Domains, ajoute ton domaine. Vercel gère TLS via Let's Encrypt.

**Supabase auth callback URLs** : dans Supabase Dashboard → Authentication → URL Configuration, ajoute :
- Site URL : `https://<your-domain>`
- Redirect URLs : `https://<your-domain>/**`

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
    (auth)/login + signup
    (app)/                     # shell back-office (sidebar + page header)
      page.tsx                 # /  → Appointments + calendrier
      clients|services|barbers|products|support|marketing|finances/
      settings/{shop,users,barbers,taxes,payments,commissions,password,
                discounts,loyalty,waiting-list,promo-codes}/
      kitchen-sink/
    book/[shopSlug]/           # booking public (hors shell, hors auth)
    privacy · terms            # Loi 25 Quebec
components/
  ui/                          # 27 primitives design system
  features/shell/              # PagePlaceholder, …
  providers/                   # QueryProvider
db/
  rows.ts                      # row types manuels (en attendant codegen)
  enums.ts · types.ts          # enums + Database placeholder
lib/
  auth/                        # server.ts (requireUser…) + actions.ts + errors.ts + rate-limit.ts
  business/                    # taxes · timezone · availability · commissions · tips (purs, testés)
  server-actions/              # withAction wrapper + Result type
  supabase/                    # client browser/server/middleware/service-role
  audit-log.ts · nav-items.ts · observability.ts · utils.ts
messages/                      # fr.json (défaut) + en.json
supabase/
  config.toml
  migrations/{init_schema,rls,indexes_triggers}.sql
  seed.sql                     # données Axum exactes (annexe)
  tests/rls_cross_shop.sql     # régression isolation tenant
i18n.ts · middleware.ts · next.config.mjs · tailwind.config.ts · vitest.config.ts
.github/workflows/ci.yml       # build + lint + typecheck + format:check sur PR/main
```

## Sécurité

- **RLS** sur les 26 tables (`force row level security`), test multi-shop dans [`supabase/tests/rls_cross_shop.sql`](supabase/tests/rls_cross_shop.sql).
- **Auth** : Supabase email/password, middleware refresh-session, `safeRedirectTarget()` anti open-redirect.
- **Rate limiting in-memory** : auth signin 5/10min, signup 3/10min, public booking 10/10min, slots API 30/min. Documentation : `lib/auth/rate-limit.ts` (multi-instance via Upstash KV : Phase 9b).
- **Honeypot** sur la booking page publique.
- **Headers** : CSP, X-Frame-Options DENY, nosniff, Referrer-Policy strict, Permissions-Policy off camera/mic/geo, HSTS 1 an.
- **Aucune donnée sensible affichée en clair** (SIN, Tax ID) — badges « Provided / Not Provided ».
- **Audit log** : 7 tables instrumentées via trigger SQL Phase 2 + `logAuditAction()` côté code.

## Différé V1.1

- **Phase 6b** : grille dense `barber_settings` (12 colonnes × 5 rows) + invitations User Settings via Supabase Auth `inviteUserByEmail`.
- **Phase 9b** : Playwright e2e (3 parcours), Lighthouse CI, Sentry actif (DSN), Upstash KV pour rate limit multi-instance, Cloudflare Turnstile sur booking, Resend email confirmations, SMS reminders.
- **Stripe Connect** : intégration paiement réelle (UI déjà câblée).
- **Realtime calendar** : Supabase Realtime sur `appointments` pour les barbiers multi-écrans.
- **Drag-and-drop calendrier** : reprogrammation des RDV (édition par modal en V1).
