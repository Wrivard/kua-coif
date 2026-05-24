# DEPLOY — Vercel + Supabase

> Checklist concrète pour passer de "code en local" à "URL Chrome live".
> Le repo est déjà déployé sur Vercel (étape 4 ✅) ; ce doc traque où on en est.

## État

- [x] **0. Code prêt** — toutes les phases livrées (38+ routes, 44 tests verts).
- [x] **1. Repo GitHub** — `Wrivard/kua-coif` à jour.
- [x] **2. Projet Supabase créé** — `jzpfvefrjtwqfyynhczp`
- [ ] **3. Migrations + seed appliqués à Supabase**
- [x] **4. Projet Vercel créé** — déployé une première fois.
- [ ] **5. Env vars renseignées dans Vercel**
- [ ] **6. Supabase Auth Site URL + Redirect URLs**
- [ ] **7. Premier vrai signup + signin testés sur l'URL live**

---

## 3. Migrations Supabase — flow CLI

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
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbGc…` | Project Settings → API → `anon` `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGc…` | Project Settings → API → `service_role` `secret` key |
| `NEXT_PUBLIC_SITE_URL` | `https://<ton-domaine-vercel>` | URL Vercel du projet |

**Important** :
- Le `service_role` key est ultra-sensible (bypass RLS) — ne JAMAIS le prefixer `NEXT_PUBLIC_`.
- Quand tu changes une env var, tu dois redéployer (Vercel → Deployments → Redeploy).

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
3. **Redirect URLs** : ajoute `https://<ton-domaine-vercel>/**` (avec le double astérisque)
4. Save.

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
