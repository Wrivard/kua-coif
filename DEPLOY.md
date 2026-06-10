# DEPLOY — Vercel + Supabase

> Checklist concrète pour passer de "code en local" à "URL Chrome live".
> Mise à jour : MCP Supabase configuré, attente du redémarrage Claude Code
> pour appliquer les migrations.

## État global

- [x] **0. Code prêt** — toutes les phases livrées (42+ routes, 44 tests verts).
- [x] **1. Repo GitHub** — `Wrivard/kua-coif` à jour.
- [x] **2. Projet Supabase créé** — `jzpfvefrjtwqfyynhczp`.
- [x] **2.5 MCP Supabase configuré** — `.mcp.json` ajouté, OAuth authentifié par le user.
- [ ] **3. Migrations + seed appliqués à Supabase** ← **PROCHAINE ÉTAPE**
- [x] **4. Projet Vercel créé** — déployé une première fois.
- [ ] **5. Env vars renseignées dans Vercel** (URL ✓, anon ✓, **service_role ✗**, site_url ✗).
- [ ] **6. Supabase Auth Site URL + Redirect URLs**.
- [ ] **7. Premier compte créé (whitelist : Supabase Add user, pas de self-signup) + signin testés sur l'URL live**.
- [ ] **8. Rattacher l'utilisateur au shop Axum (SQL one-liner)**.

## Resume après redémarrage Claude Code

> À copier-coller dans la nouvelle session pour reprendre exactement où on
> s'est arrêté. La todo + chapter du harness ne survivent pas au restart,
> mais le code + la config MCP si.

**Action 1 — Charger les outils MCP Supabase via ToolSearch :**

```
ToolSearch query: "select:mcp__supabase__execute_sql,mcp__supabase__apply_migration,mcp__supabase__list_tables,mcp__supabase__generate_typescript_types"
```

**Action 2 — Appliquer TOUTES les migrations + le seed Axum :**

Le schéma n'est plus 3 fichiers : `supabase/migrations/` contient l'historique
complet (59+ migrations à ce jour et qui grossit). N'applique **pas** une liste
figée — applique-les **toutes**, dans l'ordre lexicographique des noms de
fichiers, puis le seed :

- **Voie CLI (recommandée)** : `pnpm db:push` (= `supabase db push`) applique
  toutes les migrations encore absentes de la DB distante, dans l'ordre. Le
  seed n'est **pas** inclus par `db push` — voir §3.4 pour le charger.
- **Voie MCP / Management API** : si tu passes par
  `mcp__supabase__apply_migration`, **itère sur tous** les fichiers de
  `supabase/migrations/` (lexicographique), pas sur une liste codée en dur,
  puis `mcp__supabase__execute_sql` sur `supabase/seed.sql`.

**Action 3 — Vérifier les données seed :**

```sql
select
  (select count(*) from public.shops)      as shops,           -- attendu: 1
  (select count(*) from public.services)   as services,        -- attendu: 14
  (select count(*) from public.barbers)    as barbers,         -- attendu: 4
  (select count(*) from public.clients)    as clients,         -- attendu: 32
  (select count(*) from public.products)   as products,        -- attendu: 14
  (select count(*) from public.appointments) as appointments;  -- attendu: 7
```

**Action 4 — Codegen `db/types.ts` :**

```
mcp__supabase__generate_typescript_types
```

Puis écrire le résultat dans `db/types.ts` (remplace le placeholder).

**Action 5 — Commit + push** :

```bash
git add db/types.ts
git commit -m "chore(db): regen db/types.ts from live Supabase schema"
git push
```

**Action 6 — Guider l'user pour :**
- Mettre `SUPABASE_SERVICE_ROLE_KEY` dans Vercel (sb_secret_…)
- Mettre `NEXT_PUBLIC_SITE_URL` dans Vercel (URL Vercel)
- Mettre Site URL + Redirect URLs dans Supabase Auth
- Redéployer Vercel
- Créer le 1er compte (Supabase → Add user ; pas de self-signup) + se rattacher au shop Axum

---

## Travail restant après le launch (V1.1 / Phase 10)

Capturé dans :
- **`WIDGET-SPEC.md`** : widget intégrable iframe + admin customizer + UX Squire-style (8-15 h).
- **`ARCHITECTURE.md` §4** : Playwright e2e, Lighthouse CI, Sentry actif, Upstash KV, Cloudflare Turnstile, Resend email confirmations, SMS reminders, Stripe Connect réel, Realtime calendrier, drag calendrier.
- **`docs/archive/AUDIT.md` §4** (snapshot historique archivé) : optimisations P0/P1/P2 priorisées.

---

## 3. Migrations Supabase — flow CLI (fallback si MCP indispo)

### 3.1 Access token

1. Va sur https://supabase.com/dashboard/account/tokens
2. **Generate new token**, nomme-le « kua-coif deploy »
3. Copie le token (commence par `sbp_`) — non récupérable après

### 3.2 Lien du projet

```bash
SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxx \
  npx --yes supabase link --project-ref jzpfvefrjtwqfyynhczp
```

La commande va demander le **DB password** (celui que tu as choisi à la création du projet Supabase). Si tu l'as oublié, tu peux le reset dans Project Settings → Database → Reset database password.

### 3.3 Push des migrations

```bash
SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxx \
  npx --yes supabase db push
```

Applique dans l'ordre :
- `20260523000001_init_schema.sql` (26 tables, enums, helper functions)
- `20260523000002_rls.sql` (RLS forcée sur toutes les tables)
- `20260523000003_indexes_triggers.sql` (indexes, updated_at, audit_log)

### 3.4 Seed (données Axum)

Le `db push` n'inclut pas le seed pour les DB distantes. Deux options :

**Option A — SQL Editor (le plus simple)** :
1. Va sur https://supabase.com/dashboard/project/jzpfvefrjtwqfyynhczp/sql/new
2. Ouvre `supabase/seed.sql` dans VS Code, copie tout le contenu
3. Colle dans le SQL Editor, clique **Run**
4. Tu dois voir « Seed completed for shop … » dans la sortie

**Option B — psql** (si tu l'as) :
```bash
psql "postgresql://postgres:[PASSWORD]@db.jzpfvefrjtwqfyynhczp.supabase.co:5432/postgres" \
  -f supabase/seed.sql
```

### 3.5 Codegen db/types.ts

```bash
SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxx \
  npx --yes supabase gen types typescript --linked > db/types.ts
```

Cela remplace le placeholder par les vrais types du schéma. Permet de retirer tous les `as any` dans les Server Components plus tard (refactor optionnel).

---

## 5. Env vars Vercel

Va sur https://vercel.com/[ton-team]/kua-coif/settings/environment-variables et ajoute pour **Production + Preview + Development** :

| Nom | Valeur | Source |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://jzpfvefrjtwqfyynhczp.supabase.co` | Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_…` | Project Settings → API → publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_…` | Project Settings → API → secret key |
| `NEXT_PUBLIC_SITE_URL` | `https://<ton-domaine-vercel>` | URL Vercel du projet (origine canonique : robots/sitemap/redirections auth) |
| `NEXT_PUBLIC_APP_URL` | `https://<ton-domaine-vercel>` | **Requis** — origine embarquée dans les liens clients signés (/me, /receipt, /review, /reschedule). Vide ⇒ liens relatifs cassés dans les emails. Mets la même valeur dans le secret GitHub Actions `APP_URL` (utilisé par les crons). |
| `NEXT_PUBLIC_SENTRY_DSN` (optionnel) | `https://abc@o123.ingest.sentry.io/456` | Sentry → Settings → Client Keys (DSN). Active la capture d'erreurs côté navigateur. |
| `SENTRY_DSN` (optionnel) | idem | Variante server-only. Fallback sur `NEXT_PUBLIC_SENTRY_DSN` si absente. |
| `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT` (optionnel) | … | Activent l'upload source-maps au build → Sentry montre du JS lisible plutôt que minifié. |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (optionnel) | `https://…upstash.io` + token | Active le rate limit Upstash (shared sliding-window). Sans ça, fallback in-memory per-instance — fonctionnel mais réinitialisé à chaque cold start Vercel. Crée le DB sur https://console.upstash.com → Redis, région proche de Vercel. |
| `RESEND_API_KEY` (optionnel) | `re_…` | Active les emails Resend (booking confirmations). Sans ça, l'app no-op silencieusement à chaque send. Free tier 100 emails/jour. |
| `RESEND_FROM` (optionnel) | `"Küa <noreply@kua.quebec>"` | Expéditeur. Domaine doit être vérifié dans Resend (records DNS SPF + DKIM). Pour tester sans DNS : `onboarding@resend.dev`. |
| `RESEND_REPLY_TO` (optionnel) | `support@kua.quebec` | Reply-To. Fallback sur `RESEND_FROM` si absent. |
| 🔴 `NOTIFICATION_ENCRYPTION_KEY` | `openssl rand -base64 32` | **Requis.** Chiffre toutes les credentials d'intégration stockées (SMTP/Google/QuickBooks/Twilio) ET signe tous les liens clients publics. **À sauvegarder ; jamais re-générer sur une prod vivante** — la perdre rend tout illisible et invalide tous les liens (cf. §5 backup DR). |
| `CRON_SECRET` | `openssl rand -hex 32` | Protège les endpoints `/api/cron/*`. **Fail-closed en prod** si absent. Déclenchés par GitHub Actions (`.github/workflows/cron-*.yml`) — mets la **même** valeur dans Vercel **et** dans le secret GitHub `CRON_SECRET`. |
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` + `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (optionnel) | Stripe Dashboard | Active dépôts / PaymentIntents / Elements. Absents ⇒ UI paiement off, réservation sans dépôt. `STRIPE_APP_FEE_BPS` (optionnel) = frais plateforme Küa en points de base (200 = 2 %). |
| `TURNSTILE_SECRET_KEY` + `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (optionnel) | Cloudflare Turnstile | Anti-bot sur la réservation publique. Absents ⇒ challenge ignoré. |
| `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` (optionnel) | Google Cloud Console | Sync Google Calendar des barbiers. Absents ⇒ sync off. |
| `QUICKBOOKS_CLIENT_ID` + `QUICKBOOKS_CLIENT_SECRET` + `QUICKBOOKS_ENVIRONMENT` (optionnel) | Intuit Developer | Sync QuickBooks. `ENVIRONMENT` = `sandbox`/`production`. Absents ⇒ sync off. |
| `KUA_GITHUB_TOKEN` (optionnel) | GitHub fine-grained PAT | Débloque le dashboard super-admin Sentry-autofix. Absent ⇒ page « not set ». |

> Liste exhaustive (toutes les vars, groupées, avec le fichier qui les lit) :
> **`.env.example`** à la racine. Les `NEXT_PUBLIC_*` sont exposées au navigateur ;
> le reste est server-only.

**Important** :
- Le `service_role` key est ultra-sensible (bypass RLS) — ne JAMAIS le préfixer `NEXT_PUBLIC_`.
- Quand tu changes une env var, tu dois redéployer (Vercel → Deployments → Redeploy).
- Sentry est **dormant tant que `NEXT_PUBLIC_SENTRY_DSN` n'est pas renseigné** — zéro overhead runtime. Détails dans le README §Sentry.

### Redéployer

```bash
# Si tu as Vercel CLI installé et linké
vercel deploy --prod

# OU dashboard → Deployments → ⋯ → Redeploy
```

---

## 6. Supabase Auth — Site URL + Redirect URLs

Sans ça, les courriels d'auth (invitation `/setup-password`, réinitialisation de
mot de passe) pointent vers `localhost:3000` au lieu de ton domaine Vercel.

1. https://supabase.com/dashboard/project/jzpfvefrjtwqfyynhczp/auth/url-configuration
2. **Site URL** : `https://<ton-domaine-vercel>` (sans slash final)
3. **Redirect URLs** — un par ligne :
   - `https://<ton-domaine-vercel>/**`
   - `https://<ton-domaine-vercel>/fr/reset-password`
   - `https://<ton-domaine-vercel>/en/reset-password`
   Les deux derniers sont nécessaires pour que les liens du courriel « mot de passe oublié » (Phase 16) ne soient pas rejetés par Supabase comme redirections non autorisées.
4. Save.

### Activer Leaked Password Protection

https://supabase.com/dashboard/project/jzpfvefrjtwqfyynhczp/auth/policies → toggle **Leaked password protection** (vérifie les mots de passe contre HaveIBeenPwned). Tue le dernier warning de l'advisor sécurité Supabase.

---

## 7. Test du parcours complet

Une fois 5+6 faits. **Il n'y a pas de self-signup** : la route `/signup`
n'existe plus (modèle whitelist, Phase 22 — cf. `middleware.ts`). Les comptes se
créent de deux façons :

- **Staff Küa** : `/<locale>/super-admin/shops/new` crée un shop + son compte
  owner (derrière l'auth super-admin).
- **Owner/manager d'un shop** : `/<locale>/settings/users` invite un membre ;
  l'invité définit son mot de passe via `/setup-password` (premier login).

Pour bootstrapper le **tout premier** compte sur une prod neuve (avant qu'un
super-admin n'existe), crée l'utilisateur à la main puis rattache-le :

1. Supabase → Authentication → Users → **Add user** (email + mot de passe).
2. Visite `https://<ton-domaine-vercel>` → redirige sur `/fr/login` → sign in.
3. Accueil (calendrier vide tant que tu n'es pas membre d'un shop).

### Devenir membre du shop Axum

Pour voir le back-office complet, lie ton compte au shop Axum :

```sql
-- Dans le SQL Editor de Supabase :
insert into public.shop_members (shop_id, user_id, role, status)
values (
  (select id from public.shops where alias = 'axum'),
  (select id from auth.users where email = 'TON_EMAIL_ICI'),
  'owner',
  'confirmed'
);
```

Recharge l'URL — tu vois maintenant la sidebar, le calendrier avec les 7 RDV du 22 mai 2026, les 32 clients, etc.

### Tester le booking public

`https://<ton-domaine>/fr/book/axum` — wizard 5 étapes, fonctionne sans login.

---

## Différé (à faire après le launch)

- Domaine custom (Vercel → Settings → Domains)
- Mise à jour `NEXT_PUBLIC_SITE_URL` avec le domaine custom
- Mise à jour Site URL + Redirect URLs Supabase avec le domaine custom
- Email templates Supabase (français + design)
- Sentry DSN + Resend pour les confirmations email (Phase 9b)

---

## Backup & Disaster Recovery (Loop 32, P2.106)

> Cette section est le **runbook** que tu suis quand quelque chose explose en
> prod. À tester au moins une fois sur le projet Supabase avant le launch :
> faire un restore réel sur une branche, vérifier qu'on récupère les RDV.

### 1. Ce que Supabase fait automatiquement

| Plan         | Backups quotidiens | PITR (point-in-time recovery)    | Rétention |
|--------------|--------------------|----------------------------------|-----------|
| Free         | ✗ (manuel via CLI) | ✗                                | —         |
| Pro          | ✓                  | ✓ (rolling 7 jours)              | 7 jours   |
| Team         | ✓                  | ✓ (rolling 14 jours)             | 14 jours  |

**Action minimale pour la prod Küa : plan Pro (25 $/mois)**. Le Free plan
n'a aucun filet — un `DROP TABLE` accidentel est définitif. Le PITR Pro
permet de revenir à n'importe quel instant dans les 7 derniers jours, à
la seconde près.

**Vérifier la config Supabase :**

1. Dashboard Supabase → Project → **Database** → **Backups**
2. Confirmer **Daily backups: Enabled** + **PITR: Enabled (7 days)**.
3. Si le projet est Free → upgrader avant le launch (jamais après — un
   incident sur un projet Free est non-récupérable).

### 2. Backup manuel (à faire avant chaque déploiement risqué)

Avant une migration destructive (`DROP COLUMN`, refactor de schéma,
backfill SQL massif) :

```bash
# Depuis ton local, supabase CLI installé.
supabase db dump --project-ref jzpfvefrjtwqfyynhczp --data-only > backup-$(date +%Y%m%d-%H%M).sql

# Pour un dump complet (schema + data) :
supabase db dump --project-ref jzpfvefrjtwqfyynhczp > full-backup-$(date +%Y%m%d-%H%M).sql
```

Stocker ces dumps **hors Supabase** (Google Drive, S3, disque local).
Un backup sur le même serveur que la prod n'est pas un backup.

### 3. Procédure de restore — PITR (recommandé)

**Cas d'usage : "ma migration a tout cassé il y a 2 heures, ramène-moi
avant"**.

1. Dashboard Supabase → Project → **Database** → **Backups** → **Restore**
2. Choisir **Point in time** + sélectionner l'instant cible (UTC).
3. Supabase clone le projet à cet instant dans une **branche** (pas un
   overwrite — le projet courant reste intact pendant le restore).
4. Une fois la branche prête, vérifier les données sur l'URL de branche.
5. Si OK → swap : Dashboard → **Settings** → **Connection pooling** →
   pointer l'URL Vercel vers la branche restaurée.

**Délai typique : 5-15 min** selon la taille de la DB. Pendant ce temps,
mettre l'app en mode maintenance (Vercel → Pause Deployments) pour éviter
les écritures sur le projet cassé.

### 4. Procédure de restore — dump manuel (fallback)

**Cas d'usage : "Supabase est down ou le PITR ne fonctionne pas"**.

```bash
# 1. Créer un nouveau projet Supabase vierge (ou utiliser le dev).
# 2. Appliquer les migrations de base :
supabase db push --project-ref NEW_PROJECT_REF

# 3. Restaurer le dump :
psql "postgresql://postgres:PASS@NEW_HOST:5432/postgres" -f full-backup-2026-05-26.sql

# 4. Mettre à jour les env vars Vercel pour pointer sur le nouveau projet :
#    NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
# 5. Redéployer.
```

**Délai typique : 30-60 min** + le temps de propagation DNS si le projet
était sur un domaine custom.

### 5. Backup des secrets (env vars)

Les env vars Vercel ne sont **pas** sauvegardées dans le repo. Si le
projet Vercel est supprimé, on perd toutes les clés.

**Garder une copie chiffrée hors-ligne** de ces valeurs (1Password vault
recommandé) :

- 🔴 **`NOTIFICATION_ENCRYPTION_KEY`** — **À SAUVEGARDER EN PRIORITÉ.** Chiffre
  toutes les credentials d'intégration stockées (SMTP/Google/QuickBooks/Twilio)
  ET signe (HMAC) tous les liens clients publics (/me, /receipt, /review,
  /reschedule, /unsubscribe). **La perdre ou la changer rend illisibles toutes
  les credentials de tous les shops ET invalide tous les liens clients en
  circulation — aucune récupération possible.** À stocker hors-ligne, jamais à
  re-générer sur une prod vivante.
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`
- `RESEND_API_KEY`
- `CRON_SECRET` (partagé avec les workflows GitHub Actions des crons)
- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (rate limiting durable)
- `SENTRY_AUTH_TOKEN` (source-maps upload)
- `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` (sync Google Calendar)
- `QUICKBOOKS_CLIENT_ID` + `QUICKBOOKS_CLIENT_SECRET` (sync QuickBooks)
- `TURNSTILE_SECRET_KEY` (Cloudflare)
- `CLAUDE_CODE_OAUTH_TOKEN` (secret **GitHub Actions** pour `sentry-autofix.yml`)

**Re-générer** plutôt que stocker en clair quand possible (Stripe, Resend,
Sentry, Upstash exposent tous une révocation + re-création depuis leur
dashboard). **Exception : `NOTIFICATION_ENCRYPTION_KEY` ne peut PAS être
re-générée** sans casser les données chiffrées existantes — elle se sauvegarde,
ne se régénère pas.

### 6. Test de restauration (à faire avant le launch)

Un backup non-testé n'est pas un backup. Avant le go-live :

1. Faire une migration destructive sur le projet **dev** (`DROP TABLE
   appointments` par exemple).
2. Suivre la procédure PITR ci-dessus pour restaurer.
3. Mesurer le temps total (target : < 20 min de bout en bout).
4. Vérifier l'intégrité : tous les RDV présents + RLS fonctionne + login
   continue.
5. Documenter dans ce fichier toute friction rencontrée (timeouts, perms,
   etc.).

### 7. Alertes proactives

- **Sentry** : déjà configuré (DSN dans Vercel env). Les exceptions
  serveur signalent les erreurs DB en temps réel.
- **Supabase Database Webhooks** : configurer une alerte si la table
  `audit_log` cesse d'enregistrer pendant > 1h (signal d'une panne
  silencieuse de l'app).
- **Vercel Monitoring** : `/api/health` répond 200 → uptime monitor
  externe (UptimeRobot, gratuit) ping toutes les 5 min.

### 8. Contacts d'urgence

- **Supabase support** : `support@supabase.com` + Dashboard → Support
  (24/48h sur Free, prio Pro)
- **Stripe support** : Dashboard → Help → Contact (immédiat pour les
  comptes Connect actifs)
- **Vercel support** : Dashboard → Help (24/48h sur Hobby, prio Pro)

---

**Cadence de vérification : tous les 3 mois**. Re-lire ce runbook,
re-faire un dry-run PITR sur le dev, vérifier que les contacts/dashboards
sont toujours accessibles.
