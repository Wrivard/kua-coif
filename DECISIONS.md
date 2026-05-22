# DECISIONS — kua-coiffure

> Journal d'arbitrages produit/technique pris au fil du projet quand la spec
> (CLAUDE.md) laissait une ambiguïté. Une ligne par décision, ordre chronologique.
> Si une décision est invalidée plus tard, on **barre** la ligne et on en ajoute
> une nouvelle dessous, on ne réécrit pas l'historique.

## Phase 0 — Bootstrap

- **Auth Supabase** : email/password en V1. Pas de magic link, pas d'OAuth (peut être ajouté en Phase 9 si demandé).
- **Branche par défaut git** : `main` (nouveau repo ; le repo client constructionstemarie utilise `master`, mais on part neuf).
- **Gestionnaire de paquets** : `npm` (cohérent avec le CLAUDE.md projet qui mentionne `npm run build`).
- **Repo git** : `git init` local dans `Desktop/kua-coiffure/`, repo isolé du `.git` parent à `C:\Users\Kolyxe\`. Remote : `https://github.com/Wrivard/kua-coif.git`.
- **`src/` dir** : non utilisé. Structure à la racine : `app/`, `components/`, `lib/`, `db/`, `messages/` (cohérent avec le §7 Phase 0 du CLAUDE.md).
- **Alias d'import** : `@/*` → racine projet.
- **Locale par défaut** : `fr`. Locales supportées : `fr`, `en`. Routing : `next-intl` avec préfixe locale (`/fr/...`, `/en/...`) ; redirection automatique `/` → `/fr/...`.
- **Section Tips** : placée dans **Shop details** uniquement (Image 15 de l'annexe), pas dupliquée dans Commission/Tip Splits (§H disait "peut vivre ici ou dans Shop details").
- **Booking public — statut initial des appointments créés en ligne** : `booked` (en attente de confirmation côté salon). `confirmed` est réservé à une action explicite admin.
- **Seed `default_language` du shop Axum** : reste `English` par fidélité à la maquette (Image 15) — n'affecte pas la locale par défaut de l'app, qui reste `fr`.
- **`globals.css`** : tokens couleur dans `:root` exactement comme §2, **aucune valeur d'accent en dur** dans le code (toujours `var(--accent)` ou via une classe utilitaire Tailwind qui résout vers `--accent`).
- **Tailwind config** : on étend `theme.extend.colors` pour mapper `bg-base`, `bg-surface`, `accent`, etc. → CSS vars, pour que Tailwind ne génère pas de palettes inutiles et que toutes les classes ramènent vers les tokens.

## Phase 1 — Design system

- **Route group `(app)`** : tous les écrans back-office vivent sous `app/[locale]/(app)/...`. Le route group n'apparaît pas dans l'URL (`/fr/clients` = `app/[locale]/(app)/clients/page.tsx`). Permet d'avoir un layout shell unique (sidebar + FAB + ToastProvider) sans polluer la racine.
- **`/_kitchen-sink` → `/kitchen-sink`** : le spec demandait `/_kitchen-sink` mais en App Router, les dossiers préfixés `_` sont des dossiers privés non routables. Renommé en `/kitchen-sink` (accessible à `/fr/kitchen-sink` et `/en/kitchen-sink`). Vit aussi sous le shell `(app)` pour tester la sidebar en contexte réel.
- **Composants UI dans `components/ui/`** : un fichier par composant, kebab-case, exports re-exposés via `components/ui/index.ts`. PagePlaceholder est un wrapper helper sous `components/features/shell/` (pas un primitive, donc pas dans `ui/`).
- **Sidebar** : icon-rail collapsible avec état React local (pas persisté en V1). Toggle via bouton chevron. Item actif marqué par une **barre verticale accent** à gauche + fond `--accent-subtle` + texte `--accent`. Notif badge (dot rouge) sur Finances par défaut, conformément à §4.
- **Settings index** : `/settings` redirige vers `/settings/shop` (premier item du dropdown Admin, conformément à Image 1 où Shop details est sélectionné par défaut).
- **Modal** : utilise l'élément HTML natif `<dialog>` avec `showModal()` (focus trap + ESC gratuit). Drawer fait à la main (translate-x). ConfirmDialog est un wrap de Modal.
- **DataTable V1** : table HTML + tri client-side simple. Migration vers `@tanstack/react-table` en Phase 4 quand les vraies grilles arrivent.
- **`lucide-react`** : la version `latest` est `1.16.0` — légitimement publiée par `lucide-icons/lucide` (Eric Fennis). C'est un récent major bump, pas un squatter, malgré la rupture avec le schéma `0.x` habituel.
