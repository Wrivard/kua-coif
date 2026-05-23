# kua-coiffure

Plateforme SaaS de gestion pour salons de coiffure / barbershops (back-office + page de réservation publique). Inspirée de Squire, marque Küa.

> **Spec** : voir [`CLAUDE.md`](./CLAUDE.md) (cahier des charges complet — design system, schéma de données, 17 écrans + booking, valeurs de seed exactes en annexe).
> **Décisions** : voir [`DECISIONS.md`](./DECISIONS.md) (journal des arbitrages produit/technique).

## Stack

- **Next.js 14** App Router + TypeScript strict
- **Tailwind CSS** avec tokens couleur en CSS vars (rebrand = 4 lignes)
- **Supabase** (Postgres + Auth + RLS + Storage)
- **next-intl** (FR par défaut, EN supporté)
- **React Query** + Server Actions pour l'état serveur (Phase ultérieure)
- **react-hook-form** + **zod** pour la validation (Phase ultérieure)

## Démarrer

```bash
# 1. Variables d'environnement (Supabase)
cp .env.example .env.local
# … puis remplir NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY

# 2. Dépendances
npm install

# 3. Dev
npm run dev      # http://localhost:3000 → redirige vers /fr

# 4. Build / typecheck
npm run build
npm run typecheck
```

## Structure

```
app/
  globals.css                # tokens couleur (CSS vars) — UNIQUE source de vérité du design
  [locale]/                  # routes localisées (fr|en) — root layout vit ici
    layout.tsx
    (app)/                   # route group : shell back-office (sidebar + page header)
      page.tsx               # /  → Appointments
      clients|services|barbers|products|support|marketing|finances/page.tsx
      settings/[…]/page.tsx
      kitchen-sink/page.tsx
components/
  ui/                        # 27 primitives design system (Phase 1)
  features/shell/            # composants spécifiques au shell (PagePlaceholder, …)
db/
  types.ts                   # types Supabase générés via codegen (placeholder en l'absence de DB)
  enums.ts                   # miroir manuel des enums Postgres (source du runtime + types TS)
lib/
  supabase/
    client.ts                # client browser
    server.ts                # client server (Server Components / Server Actions)
  nav-items.ts               # config sidebar (icônes + match path)
  utils.ts                   # cn(), formatCurrencyCAD(), formatPhoneNANP()
messages/
  fr.json                    # FR par défaut
  en.json
supabase/
  config.toml                # config Supabase CLI
  migrations/
    20260523000001_init_schema.sql       # 26 tables, enums, fonctions helper
    20260523000002_rls.sql               # RLS policies (tenant isolation)
    20260523000003_indexes_triggers.sql  # indexes, updated_at, audit_log
  seed.sql                   # données Axum complètes (Annexe CLAUDE.md)
  tests/
    rls_cross_shop.sql       # régression isolation multi-shop
i18n.ts                      # config next-intl
middleware.ts                # routing locale + (futur) refresh session Supabase
```

## Base de données — appliquer les migrations

Deux flows possibles selon ton setup.

### A. Local (recommandé pour le dev), avec Docker

```bash
# une fois Docker Desktop installé et démarré :
npm run db:start         # lance Postgres + Studio + Auth en local (Supabase CLI)
npm run db:reset         # applique migrations + seed.sql
npm run db:types:local   # regénère db/types.ts depuis le schéma local
npm run db:test          # joue supabase/tests/*.sql (incl. rls_cross_shop)
```

L'URL locale s'affiche dans le terminal (par défaut `http://127.0.0.1:54321`). Renseigne-la dans `.env.local` :

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<copie depuis la sortie supabase start>
```

### B. Cloud (Supabase Studio), sans Docker

```bash
# 1. lier le repo à ton projet Supabase distant
SUPABASE_PROJECT_REF=xxxxxxx npm run db:link

# 2. pousser les migrations sur la DB distante
npm run db:push

# 3. exécuter le seed manuellement
#    soit via le SQL Editor Studio en copiant supabase/seed.sql
#    soit via psql contre le SUPABASE_DB_URL

# 4. regénérer les types
npm run db:types:remote
```

Le seed est **idempotent par run mais pas par état** : pour le rejouer, supprime
d'abord le shop : `delete from public.shops where alias = 'axum';` (cascade).

## Phases

Le projet est découpé en 10 phases (voir CLAUDE.md §7). À la fin de chaque phase :
- `npm run build` doit passer
- commit propre

Statut actuel : **Phase 0 — Bootstrap** terminé.
