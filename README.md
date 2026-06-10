# kua-coiffure

Plateforme SaaS de gestion pour salons de coiffure / barbershops (back-office + page de réservation publique + widget intégrable). Inspirée de Squire, marque Küa.

> **Brief agent** : [`CLAUDE.md`](./CLAUDE.md) — état courant + conventions (chargé dans chaque session IA). La spec d'origine + l'annexe seed exacte sont dans [`docs/archive/SPEC-original.md`](./docs/archive/SPEC-original.md).
> **Architecture** : [`ARCHITECTURE.md`](./ARCHITECTURE.md) — snapshot du plan d'origine (partiellement dépassé).
> **Archives** : [`docs/archive/`](./docs/archive/README.md) — audits et plans historiques figés (ne reflètent plus l'état courant).
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

Couverture de tests : voir le job `Test (Vitest)` dans `.github/workflows/ci.yml` (la suite tourne aussi sous `TZ=UTC`) ; e2e Playwright dans `.github/workflows/db-e2e.yml` (non bloquant). Back-office + booking public + widget embed + routes API.

## Stack

- **Next.js 14.2** App Router + TypeScript strict
- **Tailwind CSS** avec tokens couleur en CSS vars (rebrand = 4 lignes)
- **Supabase** (Postgres + Auth + RLS + Storage)
- **next-intl** (FR par défaut, EN supporté)
- **react-hook-form** + **zod** (le state serveur passe par React Server Components + Server Actions ; pas de lib de data-fetching client ni de lib de table)
- **@dnd-kit** (drag — V1.2 sur calendrier) · **papaparse** (CSV) · **date-fns-tz** (timezone shop)
- **@sentry/nextjs** (dormant tant que pas de DSN, voir [Sentry](#sentry-observability))
- **Vitest** (unit + business) + **@playwright/test** (e2e)

## Démarrer en local

```bash
# 1. Variables d'environnement
cp .env.example .env.local
# … puis remplir NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY, SUPABASE_PROJECT_REF.

# 2. Dépendances (le projet utilise pnpm — la CI échoue sur npm ci)
pnpm install

# 3. Dev
pnpm dev          # http://localhost:3000 → redirige vers /fr

# 4. Vérifs
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test                # tests Vitest
pnpm test:e2e            # Playwright (headless) — boote `pnpm dev` auto
pnpm test:e2e:ui         # Playwright (mode interactif)
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
| `SUPABASE_PROJECT_REF` | CLI local | ⛔ prod | Utilisé par `pnpm db:*` uniquement |
| `NEXT_PUBLIC_SENTRY_DSN` | client + server | ⛔ | Active Sentry browser quand renseigné |
| `SENTRY_DSN` | server-only | ⛔ | Active Sentry server/edge (fallback sur `NEXT_PUBLIC_SENTRY_DSN`) |
| `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT` | build-time | ⛔ | Activent l'upload source-maps (sinon Sentry montre du minifié) |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | server-only | ⛔ | Active le rate limit Upstash (shared sliding-window au lieu de l'in-memory per-instance). Free tier 10k cmd/jour. |
| `RESEND_API_KEY` + `RESEND_FROM` | server-only | ⛔ | Active les emails brandés via Resend (booking confirmation). Sans ces vars, le code no-op silencieusement. Voir [Resend](#resend-emails-transactionnels). |
| `RESEND_REPLY_TO` | server-only | ⛔ | Adresse Reply-To pour les emails (ex. `support@kua.quebec`). Fallback sur `RESEND_FROM`. |
| `NOTIFICATION_ENCRYPTION_KEY` | server-only | 🔴 requis | Chiffre **toutes** les credentials d'intégration stockées (SMTP/Google/QuickBooks/Twilio) **et** signe tous les liens clients publics. 32 bytes base64 (`openssl rand -base64 32`). **À sauvegarder ; jamais re-générer sur une prod vivante** (perte = données illisibles + liens invalidés). |
| `CRON_SECRET` | server-only | ⛔ | Protège les endpoints `/api/cron/*` (**fail-closed en prod** si absent). Mets la même valeur dans Vercel **et** dans le secret GitHub `CRON_SECRET` (les crons fréquents tournent via GitHub Actions). |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` | client + server | ⛔ | Active Cloudflare Turnstile sur la booking publique (Phase 30). Setup gratuit sur [dash.cloudflare.com/?to=/:account/turnstile](https://dash.cloudflare.com/?to=/:account/turnstile). Sans ces vars, le widget ne render pas et la vérification serveur no-op (honeypot + rate-limit gardent leur rôle de défense). |
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` | server-only | ⛔ | Active Stripe Connect Express (Phase 28) — onboarding KYC pour que les shops reçoivent les paiements. Sans ces vars, la carte "Stripe Connect" dans `/settings/payments` ne s'affiche pas. Setup : `sk_test_...` du dashboard Stripe + `whsec_...` après avoir créé un webhook endpoint pointant sur `/api/webhooks/stripe`. |
| `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` | server-only | ⛔ | Active Google Calendar sync per-barbier (Phase 34). Sans ces vars, la colonne "Google Calendar" dans `/barbers` ne s'affiche pas. Setup : crée un projet sur [console.cloud.google.com](https://console.cloud.google.com) → enable "Google Calendar API" → OAuth consent screen (External app) → Credentials → Web application → redirect URI `https://<ton-domaine>/api/google/oauth/callback`. Requiert aussi `NOTIFICATION_ENCRYPTION_KEY` (réutilisé pour chiffrer les refresh tokens). |
| `QUICKBOOKS_CLIENT_ID` + `QUICKBOOKS_CLIENT_SECRET` + `QUICKBOOKS_ENVIRONMENT` | server-only | ⛔ | Active QuickBooks Online comme alternative à Stripe (Phase 35). `QUICKBOOKS_ENVIRONMENT=sandbox` ou `production`. Sans ces vars, la carte QuickBooks dans `/settings/payments` ne s'affiche pas. Setup : compte sur [developer.intuit.com](https://developer.intuit.com), nouvelle app avec scopes Accounting + Payments, redirect URI `https://<ton-domaine>/api/quickbooks/oauth/callback`. Requiert aussi `NOTIFICATION_ENCRYPTION_KEY`. |

Toutes les vars `NEXT_PUBLIC_*` sont **bakées au build time** — un redeploy est nécessaire après changement Vercel.

## Base de données — appliquer les migrations

Deux flows possibles.

### A. Local avec Docker (recommandé pour le dev)

```bash
# Docker Desktop installé et démarré
pnpm db:start         # lance Postgres + Studio + Auth en local
pnpm db:reset         # applique migrations + seed.sql
pnpm db:types:local   # codegen db/types.ts
pnpm db:test          # joue supabase/tests/*.sql (incl. rls_cross_shop)
```

L'URL locale s'affiche dans le terminal (par défaut `http://127.0.0.1:54321`). Renseigne-la dans `.env.local`.

#### Premier login local (modèle whitelist — pas de self-signup)

La route `/signup` n'existe pas (auth whitelist, Phase 22). Pour entrer dans le
back-office en local après le seed : crée un utilisateur auth puis rattache-le au
shop Axum.

1. Studio local → **Authentication → Add user** (email + mot de passe), ou via SQL.
2. Lie-le au shop seedé (SQL Editor local) :

```sql
insert into public.shop_members (shop_id, user_id, role, status)
values (
  (select id from public.shops where alias = 'axum'),
  (select id from auth.users where email = 'TON_EMAIL'),
  'owner', 'confirmed'
);
```

3. `pnpm dev` → `/fr/login` → sign in → tu vois le calendrier seedé.

### B. Cloud (Supabase Studio) via MCP ou CLI

Voir [`DEPLOY.md`](./DEPLOY.md) pour le flow MCP (recommandé — c'est ce qui a déployé la prod actuelle), ou le flow CLI traditionnel :

```bash
cross-env SUPABASE_PROJECT_REF=xxxxxxx pnpm db:link
pnpm db:push                  # applique toutes les migrations de /supabase/migrations
# Puis copie-colle supabase/seed.sql dans le SQL Editor Supabase
pnpm db:types:remote          # regénère db/types.ts depuis le schéma live
```

Le seed est idempotent par run mais pas par état : pour le rejouer, supprime d'abord le shop : `delete from public.shops where alias = 'axum';` (cascade).

## Déployer sur Vercel

Voir [`DEPLOY.md`](./DEPLOY.md) — checklist concrète post-Phase 11.

## Resend (emails transactionnels)

Wirage Phase 24, **dormant tant que `RESEND_API_KEY` + `RESEND_FROM` ne sont pas renseignés**. Aucun coût runtime quand off. Pour activer :

1. Crée un compte gratuit Resend (100 emails/jour, 3k/mois) sur https://resend.com.
2. Vérifie le domaine `kua.quebec` (records DNS SPF + DKIM + DMARC) — ou utilise `onboarding@resend.dev` pour tester sans DNS.
3. Crée une API key → `RESEND_API_KEY` dans Vercel.
4. Set `RESEND_FROM` (ex. `"Küa <noreply@kua.quebec>"`). Optionnel : `RESEND_REPLY_TO=support@kua.quebec`.
5. Redeploy. La prochaine réservation publique envoie un email branded au client.

Templates actuels (`lib/email/templates/`) :
- `appointment-confirmation.tsx` — envoyé après une réservation réussie sur `/book/[shop]`.
- `appointment-reminder.tsx` — variants 24h + 1h envoyés par le cron Vercel.
- `appointment-cancellation.tsx` — envoyé quand un admin annule un RDV.

### SMTP par shop (Phase 25)

Chaque shop peut configurer son propre SMTP dans `/settings/notifications` (Gmail / Outlook / hébergeur). Quand configuré, les emails du shop partent de **leur domaine** (`noreply@salonaxum.com`) plutôt que de `noreply@kua.quebec`. Le mot de passe est **chiffré AES-256-GCM** au repos via `lib/crypto/aes.ts`.

**Pré-requis pour activer la feature** : génère une clé d'encryption et set-la dans Vercel :

```bash
openssl rand -base64 32
# colle le résultat dans NOTIFICATION_ENCRYPTION_KEY (Production + Preview)
```

Sans cette clé, l'UI bloque la sauvegarde du mot de passe SMTP avec un warning explicite. Les shops sans SMTP configuré tombent sur le fallback Resend Küa-branded.

### Google Calendar sync (Phase 34)

Chaque barbier peut connecter SON compte Google Calendar perso. Le flow est two-way :

- **Küa → Google (push)** : à chaque `createAppointment` / `rescheduleAppointment` / `cancelAppointment`, on push le changement vers le calendrier personnel du barbier. Stocké via `appointments.google_event_id` pour les updates/deletes idempotents.
- **Google → Küa (pull)** : à chaque render du calendrier `/`, on query l'API `freeBusy` de chaque barbier connecté pour le jour affiché. Les events perso (vacances, RDV médicaux, etc.) apparaissent comme des overlays gris striés. Cached 60s via `unstable_cache`.

**Activation** :
1. Créer un projet Google Cloud → enable Calendar API
2. OAuth consent screen → External app, scopes `calendar.events` + `userinfo.email`
3. Credentials → Web application avec redirect URI `https://<ton-domaine>/api/google/oauth/callback`
4. Set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `NOTIFICATION_ENCRYPTION_KEY` dans Vercel
5. Redeploy
6. Page `/barbers` → colonne Google Calendar → "Connecter Google" par barbier

**Sécurité** : le refresh_token est chiffré AES-256-GCM via `NOTIFICATION_ENCRYPTION_KEY` (même clé que SMTP). La colonne `refresh_token_enc` a un REVOKE SELECT pour anon/authenticated — seul le service-role la lit. Les access tokens (1h) ne sont JAMAIS persistés — on refresh sur chaque batch (~50ms).

### Cron reminders

La route `/api/cron/notifications` scan deux fenêtres à chaque appel :
- RDV à venir dans 24h ±15 min → envoie `reminder_24h`
- RDV à venir dans 1h ±15 min → envoie `reminder_1h`

Idempotence via la table `notification_sends` (unique sur `(appointment_id, kind)`).

**Trigger** : les crons sont déclenchés de deux façons selon leur fréquence (tous
appellent l'endpoint avec `Authorization: Bearer $CRON_SECRET`) :

- **GitHub Actions** (`.github/workflows/cron-*.yml`) pour les crons fréquents :
  `cron-notifications.yml` (`*/15`), `cron-birthday-greetings.yml` (quotidien),
  `cron-stripe-reconcile.yml` (horaire). Chaque workflow ping
  `${APP_URL}/api/cron/...` — requiert les secrets repo **`APP_URL`** + **`CRON_SECRET`**.
- **`vercel.json` crons** (Vercel natif) pour les tâches de maintenance
  quotidiennes : `/api/cron/quickbooks-refresh` + `/api/cron/google-channel-renew`.

En production, `CRON_SECRET` absent = **fail-closed** (les routes refusent).

**Pour les emails d'auth** (invitation Phase 22, reset password Phase 16) : Supabase les envoie via son SMTP par défaut. Pour les router via Resend, configure le SMTP custom dans Supabase Auth → SMTP Settings avec les credentials Resend SMTP. Aucun changement code.

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
  ui/                          # primitives design system
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
  migrations/                  # historique complet (voir le dossier — 59+ fichiers)
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
- **Cloudflare Turnstile** (optionnel, Phase 30) : CAPTCHA privacy-friendly sur la booking page. Active en posant `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` dans Vercel. Sans ces vars, le widget ne render pas et la vérification serveur no-op — l'app garde honeypot + rate-limit comme défense. Setup : crée un site sur [dash.cloudflare.com/?to=/:account/turnstile](https://dash.cloudflare.com/?to=/:account/turnstile), copie les deux clés.
- **Stripe Connect Express** (optionnel, Phase 28) : onboarding hosted Stripe pour que les shops reçoivent leurs paiements. Env-gated via `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`. Sans ces vars, la carte « Stripe Connect » dans `/settings/payments` ne s'affiche pas. Activation : (1) compte sur [dashboard.stripe.com/register](https://dashboard.stripe.com/register), (2) copie le test Secret Key dans Vercel Preview, (3) crée un webhook endpoint pointant vers `https://<ton-domaine>/api/webhooks/stripe` avec l'event `account.updated`, (4) copie le signing secret. Voir `lib/stripe/connect.ts` pour le détail du flow.
- **Headers** : CSP avec `frame-ancestors *` réservé aux routes `/embed/*`, strict ailleurs · X-Frame-Options DENY · nosniff · Referrer-Policy strict · Permissions-Policy off camera/mic/geo · HSTS 1 an.
- **Aucune donnée sensible affichée en clair** (SIN, Tax ID) — badges « Provided / Not Provided ».
- **Audit log** : 7 tables instrumentées via trigger SQL Phase 2 + `logAuditAction()` côté code, surface admin sur `/settings/audit-log`.


## Historique des phases

Le journal détaillé phase-par-phase (livraisons V1.1+/V1.2, loops d'audit) a été
déplacé vers [`docs/archive/PHASES.md`](./docs/archive/PHASES.md) — c'est un
snapshot historique, pas l'état courant. Le suivi vivant du travail en cours est
dans [`plans/README.md`](./plans/README.md).
