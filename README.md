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
  globals.css          # tokens couleur (CSS vars) — UNIQUE source de vérité du design
  [locale]/            # routes localisées (fr|en) — root layout vit ici
    layout.tsx
    page.tsx
components/
  ui/                  # primitives design system (Phase 1)
  features/            # composants métier (Phase 4+)
db/
  types.ts             # types Supabase générés (placeholder en Phase 0)
lib/
  supabase/
    client.ts          # client browser (RSC client / "use client")
    server.ts          # client server (Server Components / Server Actions)
messages/
  fr.json              # FR par défaut
  en.json
i18n.ts                # config next-intl
middleware.ts          # routing locale + (futur) refresh session Supabase
```

## Phases

Le projet est découpé en 10 phases (voir CLAUDE.md §7). À la fin de chaque phase :
- `npm run build` doit passer
- commit propre

Statut actuel : **Phase 0 — Bootstrap** terminé.
