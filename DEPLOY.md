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
- [ ] **7. Premier vrai signup + signin testés sur l'URL live**.
- [ ] **8. Rattacher l'utilisateur au shop Axum (SQL one-liner)**.

## Resume après redémarrage Claude Code

> À copier-coller dans la nouvelle session pour reprendre exactement où on
> s'est arrêté. La todo + chapter du harness ne survivent pas au restart,
> mais le code + la config MCP si.

**Action 1 — Charger les outils MCP Supabase via ToolSearch :**

```
ToolSearch query: "select:mcp__supabase__execute_sql,mcp__supabase__apply_migration,mcp__supabase__list_tables,mcp__supabase__generate_typescript_types"
```

**Action 2 — Appliquer les 3 migrations + le seed Axum :**

Lire chaque fichier dans cet ordre et passer le contenu à `mcp__supabase__apply_migration` (pour les migrations) ou `mcp__supabase__execute_sql` (pour le seed) :

1. `supabase/migrations/20260523000001_init_schema.sql` → apply_migration name="init_schema"
2. `supabase/migrations/20260523000002_rls.sql` → apply_migration name="rls"
3. `supabase/migrations/20260523000003_indexes_triggers.sql` → apply_migration name="indexes_triggers"
4. `supabase/seed.sql` → execute_sql

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
- Tester signup + se rattacher au shop Axum

---

## Travail restant après le launch (V1.1 / Phase 10)

Capturé dans :
- **`WIDGET-SPEC.md`** : widget intégrable iframe + admin customizer + UX Squire-style (8-15 h).
- **`ARCHITECTURE.md` §4** : Playwright e2e, Lighthouse CI, Sentry actif, Upstash KV, Cloudflare Turnstile, Resend email confirmations, SMS reminders, Stripe Connect réel, Realtime calendrier, drag calendrier.
- **`AUDIT.md` §4` : optimisations P0/P1/P2 priorisées.

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
| `NEXT_PUBLIC_SITE_URL` | `https://<ton-domaine-vercel>` | URL Vercel du projet |
| `NEXT_PUBLIC_SENTRY_DSN` (optionnel) | `https://abc@o123.ingest.sentry.io/456` | Sentry → Settings → Client Keys (DSN). Active la capture d'erreurs côté navigateur. |
| `SENTRY_DSN` (optionnel) | idem | Variante server-only. Fallback sur `NEXT_PUBLIC_SENTRY_DSN` si absente. |
| `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT` (optionnel) | … | Activent l'upload source-maps au build → Sentry montre du JS lisible plutôt que minifié. |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (optionnel) | `https://…upstash.io` + token | Active le rate limit Upstash (shared sliding-window). Sans ça, fallback in-memory per-instance — fonctionnel mais réinitialisé à chaque cold start Vercel. Crée le DB sur https://console.upstash.com → Redis, région proche de Vercel. |
| `RESEND_API_KEY` (optionnel) | `re_…` | Active les emails Resend (booking confirmations). Sans ça, l'app no-op silencieusement à chaque send. Free tier 100 emails/jour. |
| `RESEND_FROM` (optionnel) | `"Küa <noreply@kua.quebec>"` | Expéditeur. Domaine doit être vérifié dans Resend (records DNS SPF + DKIM). Pour tester sans DNS : `onboarding@resend.dev`. |
| `RESEND_REPLY_TO` (optionnel) | `support@kua.quebec` | Reply-To. Fallback sur `RESEND_FROM` si absent. |
| `NOTIFICATION_ENCRYPTION_KEY` (V1.2+) | Generated avec `openssl rand -base64 32` | **Obligatoire si tu veux que les shops aient leur propre SMTP** (Phase 25). 32 bytes base64. Sans cette clé, l'UI `/settings/notifications` empêche la sauvegarde des mots de passe SMTP. |
| `CRON_SECRET` (optionnel) | Auto-injecté par Vercel quand `vercel.json` déclare un cron | Protège `/api/cron/notifications`. |

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

Sans ça, le signup confirme l'email vers `localhost:3000` au lieu de ton domaine Vercel.

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

Une fois 5+6 faits :

1. Visite `https://<ton-domaine-vercel>` → doit rediriger sur `/fr/login`
2. Clique « Créer un compte » → remplir → submit
3. Vérifier que tu reçois un email de confirmation (Supabase → Authentication → Templates pour customiser)
4. Confirme l'email, sign in
5. Tu arrives sur l'accueil (calendrier vide tant que tu n'es pas membre d'un shop)

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
- Backups Supabase activés (Pro plan)
- Sentry DSN + Resend pour les confirmations email (Phase 9b)
