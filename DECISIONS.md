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

## Phase 2 — Base de données

- **Migrations versionnées** dans `supabase/migrations/` avec timestamps Supabase CLI (`YYYYMMDDHHMMSS_*.sql`). Trois fichiers pour rester lisibles : schéma · RLS · indexes/triggers. Tout le reste vivra dans des migrations subséquentes.
- **`public.profiles` séparée de `auth.users`** : profile applicatif (email, full_name, avatar_url) découplé de l'auth Supabase. Trigger `on_auth_user_created` provisionne automatiquement la profile au signup.
- **`barber_settings` avec colonne `scope`** : une ligne "shop" (défaut) + une ligne par barbier (override). CHECK constraint + index unique partial pour interdire les doublons. Plus propre que deux tables séparées.
- **Helper functions `current_shop_ids()`, `is_shop_member(uuid)`, `has_role_in_shop(uuid, role)`** : `security definer` + `stable` → policies RLS concises et performantes. Cache implicite par Postgres pour la même transaction.
- **`commission_tiers` aplatis (5 tiers en colonnes)** : pas de table normalisée — la spec fixe à 5 paliers max, le bloc colonnes est plus rapide à querier qu'un JOIN avec 5 rows.
- **RLS = défense en profondeur, pas la seule barrière** : `force row level security` partout pour bloquer même le owner du schéma. Mais les rôles (owner/manager/barber) sont vérifiés *en plus* en Server Actions via `requireRole()` (à venir Phase 3). Pour les tables hyper-sensibles (`payment_profiles`, `commission_tiers` writes), la RLS exige aussi le rôle minimum.
- **Indexes critiques posés tôt** : `(shop_id, start_at)` sur appointments, GiST range sur `(barber_id, tstzrange)` pour les overlap checks de dispo, trigram sur `clients` pour la recherche par nom, `(shop_id, lower(phone))` pour dedup.
- **`audit_log` write-only** : trigger `tg_audit_log` sur 7 tables sensibles (clients, appointments, discounts, promo_codes, commission_tiers, payment_profiles, shop_members). RLS lecture pour managers du shop. Aucun INSERT/UPDATE/DELETE policy → seul le service_role peut écrire (via le trigger).
- **Pas de hard delete** : la plupart des entités utilisent un `status` enum avec valeur `deleted`. Le `ON DELETE CASCADE` est réservé à la suppression de shop entière (cas extrême).
- **Codegen `db/types.ts` post-application** : le fichier reste placeholder tant qu'aucune DB n'a été appliquée. `npm run db:types:local` / `db:types:remote` le régénère depuis le schéma vivant.
- **`db/enums.ts` source manuelle** : les enums Postgres sont mirrored à la main en TS pour avoir le runtime ET les types sans dépendre du codegen. Source de vérité = la migration SQL ; mismatch détecté en Phase 9.
- **Test RLS cross-shop dans `supabase/tests/`** : pgtap-free, pure SQL, exécutable via `supabase test db` ou `psql`. Crée 2 shops/2 users en transaction, assert que A ne voit pas B, puis rollback.
- **Locale shop seed à `'en'`** (au lieu de `English` du spec, qui n'est pas une valeur d'enum) : on stocke le code ISO. L'affichage continue d'utiliser le libellé localisé.
- **Default `confirmation_tip` = false** dans le schéma : matche le comportement attendu par défaut. La ligne "Shop" du seed le passe explicitement à `true` (cohérent avec Image 7 de l'annexe).

## Phase 3 — Auth, shell, boundaries

- **Auth = email/password Supabase, pas de magic link en V1** (déjà acté Phase 0, confirmé : Server Actions `signInAction`/`signUpAction`/`signOutAction` avec validation Zod).
- **Route group `(auth)`** : `/[locale]/(auth)/login` et `/[locale]/(auth)/signup` vivent **hors** du shell `(app)`. Le layout `(auth)` est centré, sans sidebar, avec son propre `ToastProvider`.
- **Middleware combiné next-intl + Supabase** : next-intl tourne **avant** ; si elle redirige, on rafraîchit quand même la session sur la response et on laisse passer. Sinon on lit `auth.getUser()` (qui rotate le refresh token) et on applique les redirects auth-gating.
- **Skip Supabase si env vars absentes** : permet de tourner le design system / kitchen-sink en local sans projet Supabase configuré. Quand `NEXT_PUBLIC_SUPABASE_URL` est défini, l'auth s'active.
- **Chemins publics** : `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/book/*`, `/kitchen-sink`. Tout le reste exige une session. Si pas authentifié → redirect `/login?redirect=<original>`.
- **Auth user déjà loggué visitant `/login`** → renvoyé sur `/` (évite la confusion).
- **Helpers `lib/auth/server.ts`** : `getCurrentUser`, `getShopMemberships`, `requireUser`, `requireShopMember`, `getCurrentShopId`, `requireRoleInCurrentShop`. Tous cachés via `react.cache()` pour dédupliquer dans la même requête.
- **Role hierarchy code-side** : `owner > manager > barber` (numérique 3/2/1). `requireRoleInCurrentShop('manager')` accepte manager OU owner. Doublé par la RLS pour les tables sensibles.
- **`useFormState` (pattern Next 14 / React 18)** : actions retournent `{ ok: true } | { ok: false, error, fieldErrors? }`. `useFormStatus` pour le bouton submit. Migration vers `useActionState` (React 19) sera triviale.
- **`safeRedirectTarget()`** : valide qu'un `redirect=` venant de l'URL est bien une path relative — sinon retour à `/{locale}/` pour éviter un open redirect.
- **Security headers** : `X-Frame-Options DENY`, `X-Content-Type-Options nosniff`, `Referrer-Policy strict-origin-when-cross-origin`, `Permissions-Policy` (camera/mic/geo/cohort off), `Strict-Transport-Security`, `X-DNS-Prefetch-Control on`. **CSP différée en Phase 9** (besoin de connaître toutes les origines : Supabase, Vercel preview, fonts, images).
- **`poweredByHeader: false`** : pas de `X-Powered-By: Next.js` exposé.
- **Quatre boundaries** : `app/global-error.tsx` (ultime, sans i18n), `app/[locale]/error.tsx` (page globale), `app/[locale]/not-found.tsx` (404 i18n), `app/[locale]/loading.tsx` (skeleton suspense), `app/[locale]/(app)/error.tsx` (local au shell — garde sidebar + page header).
- **Skip-to-content** dans le layout localisé : visible seulement au focus clavier, ancre `#main` dans `(app)` et `(auth)` layouts.
- **Sidebar live** : reçoit le `user` du Server Component shell. Affiche profile chip (avatar initiales OU image) + nom + email. Bouton logout = `<form action={signOutAction}>` (Server Action). Pas de JS client pour le logout.
- **Sentry différé** : installation et configuration en Phase 9 (post-MVP). L'`useEffect` dans `error.tsx` log `console.error` en dev pour l'instant, et hostera `Sentry.captureException(error)` plus tard.
