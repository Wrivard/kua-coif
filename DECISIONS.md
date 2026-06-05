# DECISIONS — kua-coiffure

> Journal d'arbitrages produit/technique pris au fil du projet quand la spec
> (CLAUDE.md) laissait une ambiguïté. Une ligne par décision, ordre chronologique.
> Si une décision est invalidée plus tard, on **barre** la ligne et on en ajoute
> une nouvelle dessous, on ne réécrit pas l'historique.

## Phase 0 — Bootstrap

- **Auth Supabase** : email/password en V1. Pas de magic link, pas d'OAuth (peut être ajouté en Phase 9 si demandé).
- **Branche par défaut git** : `main` (nouveau repo ; le repo client constructionstemarie utilise `master`, mais on part neuf).
- **Gestionnaire de paquets** : ~~`npm` (cohérent avec le CLAUDE.md projet qui mentionne `npm run build`).~~ **Loop 41 (mai 2026)** : pivot sur `pnpm`. Le double-lockfile (npm + pnpm) qui en a résulté pendant ~5 commits a finalement cassé la CI quand seul `pnpm-lock.yaml` était mis à jour. `package-lock.json` supprimé du repo, CI passe à `pnpm install --frozen-lockfile`. Single source of truth = `pnpm-lock.yaml`.
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
- **Codegen `db/types.ts` post-application** : le fichier reste placeholder tant qu'aucune DB n'a été appliquée. `pnpm db:types:local` / `db:types:remote` le régénère depuis le schéma vivant.
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

## Phase 3.5 — Production hardening

- **`/api/health`** : route handler `nodejs` dynamic. Ping `supabase.auth.getSession()` (cheap, pas de DB hit). Skippe si pas d'env vars. Retourne 200 ou 503. Pas de PII.
- **Rate limit in-memory** (`lib/auth/rate-limit.ts`) : signin 5/10min/IP, signup 3/10min/IP. Map fixed-window avec cleanup lazy. **Limitation documentée** : pas multi-instance-safe en serverless cold start. Drop-in vers Upstash/Vercel KV en Phase 9.
- **`lib/observability.ts`** : façade `captureException`/`captureMessage`/`setUser`. No-op en prod, `console` en dev. Migration vers `@sentry/nextjs` en 4 lignes (4 étapes documentées dans le fichier).
- **`lib/auth/errors.ts` + `mapSupabaseAuthError()`** : enum stable `AuthErrorCode` ∈ {INVALID_CREDENTIALS, EMAIL_NOT_CONFIRMED, EMAIL_ALREADY_EXISTS, WEAK_PASSWORD, RATE_LIMITED, TOO_MANY_REQUESTS, INVALID_INPUT, UNEXPECTED}. Server Actions retournent désormais `{ errorCode }`, plus jamais `error.message` brut. UI traduit via `auth.errors.{code}` dans next-intl.
- **GitHub Actions** (`.github/workflows/ci.yml`) : run `typecheck` + `lint` + `format:check` + `next build` sur push/PR vers main. Concurrency cancel-in-progress. Placeholder Supabase env vars pour ne pas casser le build sans secrets.
- **a11y aria-labels** : passés en i18n (`a11y.close`, `nav.expandSidebar`, `nav.collapseSidebar`). Plus de chaînes EN en dur dans les composants.
- **`global-error.tsx`** : fallback bilingue auto-détecté via `navigator.language` (fr par défaut). Pas de dépendance à next-intl puisque c'est l'ultime boundary.

## Phase 4a — CRUD foundations + Services

- **Server Action pattern** unique via `withAction()` (`lib/server-actions/with-action.ts`) :
  1. Auth gate (`getCurrentUser` → `UNAUTHENTICATED`)
  2. Shop gate (`getShopMemberships` → `NO_SHOP`)
  3. Role gate (vs `minRole` → `FORBIDDEN`)
  4. Zod parse input (→ `INVALID_INPUT` + `fieldErrors`)
  5. Try/catch sur la fonction `run`, `captureException` → `UNEXPECTED`
- **`Result<T, ActionErrorCode>`** : type uniforme `{ ok: true, data } | { ok: false, errorCode, fieldErrors? }`. Codes traduits côté UI via `actionErrors.{code}`.
- **`react-hook-form` + `zod`** : pattern `useForm<T>({ resolver: zodResolver(schema), defaultValues })`. Pour les inputs numériques, on déclare le schema avec `z.number()` (pas `z.coerce.number()` qui casse les generics RHF) et on `register('field', { valueAsNumber: true })`.
- **React Query Provider** dans `(app)/layout.tsx` avec defaults : `staleTime 60s`, `refetchOnWindowFocus: false`, `retry: 1` (queries) / `0` (mutations). Cohérent avec un back-office (pas de polling agressif).
- **`db/rows.ts`** : types row manuels pour les tables qu'on utilise. **Source de vérité = migrations SQL** ; ce fichier sera remplacé par les types codegen quand `pnpm db:types:remote` aura tourné contre une DB live.
- **`lib/business/taxes.ts`** : module pur (aucune dépendance Supabase/React), testé Vitest (8 tests). Inclut la logique inclusive vs exclusive et l'arrondi cents. Patron pour `lib/business/{commissions,tips,availability,cancellation,loyalty}.ts` à venir.
- **Vitest** : config minimaliste (jsdom, alias `@/`, scan `*.test.{ts,tsx}`). `npm test` court (1.4s sur le module taxes seul).
- **Services screen** :
  - `page.tsx` Server Component : fetch 4 tables en parallèle (services, service_categories, taxes, service_taxes) → passe en prop à `ServicesClient`.
  - `services-client.tsx` Client Component : `DataTable` réutilisé (PAS encore `@tanstack/react-table` — Phase 4b), actions edit/toggle/delete par ligne, `ConfirmDialog` sur delete.
  - `service-form-modal.tsx` Client Component : `react-hook-form` + Zod + `Modal`. Taxes en multi-checkbox. `useTransition` pour pending state.
  - `actions.ts` Server Actions : `createService`, `updateService`, `deleteService`, `toggleServiceStatus`. Tous wrappés `withAction` + `logAuditAction()` + `revalidatePath('/services')`.
- **Audit log** : `logAuditAction()` failure-safe (catch + observability hook). Toutes les Server Actions mutate appellent ce helper avec `entityId` + `diff`.
- **Drag-reorder et CSV export** : différés en Phase 4b (pas critique pour l'écran fonctionnel, et chaque feature mérite son commit dédié).

## Phase 4b — Barbers, Clients, Products + CSV

- **Réutilisation stricte du pattern Services** : chaque écran (Barbers / Clients / Products) a la même structure : `page.tsx` (RSC) + `*-client.tsx` (Client orchestrant DataTable + modals) + `*-form-modal.tsx` (`react-hook-form` + Zod + `Modal`) + `actions.ts` (`withAction` + `logAuditAction` + `revalidatePath`) + `schema.ts` (Zod).
- **Soft-delete pour `barbers`** : `deleteBarber` flip `status` à `deleted` au lieu de DELETE row, pour garder les FK appointments intactes. Onglet "Supprimés" + bouton "Restaurer" via `setBarberStatus`.
- **Clients dedup côté client** : la liste reçue côté Server Component est passée au Client qui calcule les doublons via Map `(phone normalisé / email lower-case)`. Affichage : badge `warning` "Doublon" + bouton toggle "Localiser les doublons" qui filtre la liste. Phase 5 pourra basculer vers un index full-text Postgres (`pg_trgm` déjà installé).
- **Clients A–Z bar** : 26 boutons + bouton "Tous". Pas de pagination par lettre via DB (filter côté client suffit pour <2000 lignes). DataTable garde sa pagination simple (25 rows/page).
- **Suppression Clients = hard delete** mais protégée par `ON DELETE RESTRICT` côté FK appointments → erreur `CONFLICT` retournée si le client a des RDV.
- **Products avec SectionSwitcher** : 3 vues (Products / Brands / Categories) dans une seule page, via `useState<View>`. Le bouton "Ajouter" change de label selon la vue active. Toolbar Products montre Retail Value / Wholesale Value / low-stock count (annexe Image 11).
- **Warnings produits** : badge `warning` avec icône AlertTriangle sur les lignes à inventaire ≤ seuil **ou** marge négative (supply_price > price). Pas bloquant, juste signalé visuellement.
- **CSV export générique** : route handler `/api/export/[entity]/route.ts` avec whitelist d'entités + colonnes safes (jamais SIN/Tax ID). Auth + shop gate strict. `papaparse` pour la sérialisation. `Content-Disposition: attachment` + nom de fichier daté. Optionnel `?status=` pour filtrer les barbers par onglet.
- **Pas encore migré sur `@tanstack/react-table`** : DataTable maison suffit pour <2000 lignes en mémoire. Migration prévue Phase 5+ quand la virtualisation devient nécessaire (calendrier surtout).
- **Drag reorder différé Phase 5** : `@dnd-kit` installé mais pas encore branché. La spec Services + Barbers Image (poignée ⇅) reste un placeholder visuel via `reorderable: true` sur DataTable, sans vraie action sortable.
- **Build après Phase 4b** : 37 routes (16 admin × 2 + auth + kitchen-sink + 2 API), middleware 101 kB. Tests Vitest : 8 passing (taxes module). Lint / typecheck / format / build / test : tous verts.

## Phase 5 — Calendrier (Side by Side)

- **Timezone partout via `date-fns-tz`** : DB stocke en UTC, on convertit en wall-clock pour positionner les blocs, on reconvertit en UTC pour l'insert. Helpers centralisés dans `lib/business/timezone.ts` (`toShopWallClock`, `shopWallClockToUtc`, `formatShopTime`, `combineShopDateTime`, `shopDayStart/End`, `minutesFromShopMidnight`, `formatHeaderDate`, `shopIsoDate`, `parseShopIsoDate`).
- **Moteur de dispo `lib/business/availability.ts`** pur (zéro Supabase / zéro React). 8 raisons de refus (`SHOP_CLOSED`, `DAY_OFF`, `OUTSIDE_HOURS`, `CONFLICT_APPOINTMENT`, `CONFLICT_BLOCK`, `TOO_LATE`, `TOO_FAR_IN_ADVANCE`, `NEGATIVE_DURATION`). **16 tests Vitest** couvrant chaque branche. La même fonction sert sur le serveur (Server Action) et le client (futur booking public Phase 8).
- **`canClientCancel()`** : règle de cancellation isolée, testée séparément.
- **Server Actions calendrier** : `createAppointment` (fait son propre `checkAvailability` avant insert, lie les services M:N, calcule `total_amount` depuis le prix snapshot des services), `updateAppointment` (V1 : status + notes only — time-shift en V1.1), `cancelAppointment` (flip status à `cancelled`), `blockTime`. Tous wrappés `withAction` + `logAuditAction`.
- **Vue Side by Side** uniquement en Phase 5 (Week + List différés Phase 5b). Colonnes par barbier × time-axis vertical. **1.4 px/min** pour que 30 min restent confortables au clic.
- **Plage de jour adaptative** : utilise `shop_hours` du jour (e.g. 10:00-19:00 mar/mer). Fallback 8h-20h quand le shop est fermé pour qu'on voit quand même la grille. Banner `warning` quand fermé.
- **Filtre barbers** : chips toggle au-dessus du calendrier. Tous sélectionnés par défaut. État local React (pas dans l'URL).
- **Navigation date via URL** : `?date=YYYY-MM-DD`. Today/prev/next mettent à jour le query param et `router.push` re-render le Server Component. Pas de cache trouble.
- **Blocs RDV** : couleur selon statut (`bg-appt-green` pour confirmed/arrived/completed, `bg-appt-blue` pour booked, gris+opacity pour cancelled). Barre latérale gauche colorée (`border-l-4`). Icône carte de paiement coin bas-droit (cosmétique, conforme annexe Image 13).
- **Block time** rendu en overlay rouge avec icône XOctagon dans la colonne du barbier (ou toutes si `barber_id` null).
- **Modal création** : `react-hook-form` + Zod. Search client texte simple (filtre dans la liste pré-fetched, top 50). Multi-checkbox services groupés par catégorie. Durée totale auto-calculée. Toast succès/erreur.
- **Drawer détail** : ouvre au clic d'un bloc. Affiche client, plage horaire (formatée TZ shop), statut, services + durées, notes, source admin/online, total amount. Bouton "Annuler" si pas déjà cancelled. Édition du time-shift = V1.1.
- **Drag pour déplacer/redimensionner** : différé V1.1 (spec §5.A "V1.1 si trop lourd, sinon édition par modal"). Édition par modal en V1.
- **Realtime Supabase** : différé V1.1 — le calendrier se rafraîchit après une mutation via `revalidatePath('/')`. Realtime ferait juste mieux pour le multi-barber simultané.
- **Cast `as any` du Supabase builder** dans `page.tsx` : volontaire — la chaîne `select().order().gte().lt()` est trop compliquée à typer sans codegen. Le bon typage viendra avec `db:types:remote`.
- **24 tests passing** (8 taxes + 16 availability), build verts (38 routes incl. /api/health + /api/export).

## Phase 6 — Settings (7 écrans livrés)

- **Pattern singleton vs CRUD** : Taxes, Discounts, Promo Codes suivent le pattern CRUD (table + form modal). Loyalty, Waiting List, Shop details suivent le pattern singleton (row unique par shop, upsert via `onConflict: 'shop_id'`).
- **Change Password** : double-check côté serveur via `signInWithPassword` puis `updateUser` — Supabase n'expose pas de "verify current password" direct, donc on re-loggue l'utilisateur avec son current password comme preuve. Erreur Supabase mappée via `mapSupabaseAuthError()` → `INVALID_INPUT` si le password est faux.
- **Shop Details = 3 cards + 1 schedule** : Identity, Location, Options dans un seul form ; Schedule (7 weekdays) dans un form séparé (upsert avec `onConflict: 'shop_id,weekday'`). Permet de sauvegarder les horaires sans toucher au reste. Sections différées Phase 6b : notification matrix, Days Off list, Tips config, Language settings, Media upload.
- **Discount value range** : la CHECK constraint Postgres limite percent ≤ 100, donc on a retiré le `.refine()` Zod (incompatible avec `.extend()`) — fallback sur la DB est OK car les Server Actions catchent les erreurs.
- **Settings/Barbers (M) + Settings/Users (O) différés Phase 6b** : la grille dense barber settings (12 colonnes × 5 lignes avec overrides) demande son propre composant table éditable. Les invitations utilisateurs demandent un flow Supabase Auth `inviteUserByEmail` + acceptation. Les placeholders restent en place.
- **Cast `as any` du Supabase builder partout** : on assume cette dette en attendant le codegen `db:types:remote`. Refactor automatique quand la DB live sera branchée.
- **Patch i18n via script Node temporaire** (`.tmp-patch-i18n.mjs` créé + supprimé dans le même commit) : ajouter ~200 clés via Edit ciblé aurait pris trop de tours. Pattern à réutiliser pour les futures grosses pages.
- **Build après Phase 6** : 38 routes (les sub-routes settings/* existaient déjà en placeholder, on les a remplacées par les vraies pages). Middleware 104 kB. Tests Vitest : 24 passing. Lint / typecheck / format / build / test : tous verts.

## Phase 7 — Finances

- **`lib/business/commissions.ts`** : moteur pur, 11 tests Vitest. Deux modes :
  - Non cumulatif : pct du plus haut tier `threshold ≤ revenue`, appliqué au revenue entier.
  - Cumulatif : chaque tier s'applique sur la portion entre son seuil et le tier suivant.
  - `normalizeTiers()` filtre les rows tout-à-zéro (= "pas de commission" comme Arsh dans le seed).
- **`lib/business/tips.ts`** : suggestion 4 options. Flat tiers en dessous de `pct_use_above_amount`, percent tiers au-dessus. `round_up` arrondit au dollar entier (sinon arrondi au centime). 4 tests Vitest.
- **Toggle "Cumulative" global par scope** : la spec montre un seul toggle au-dessus de la grille (pas par barbier) → on prend la valeur majoritaire actuelle comme init, et au save on l'applique à toutes les rows du scope.
- **Save batch** : `saveCommissions` upsert toutes les rows en une fois via `onConflict: 'shop_id,barber_id,scope'`. Pas de N requêtes séparées.
- **Commissions = owner-only** : `minRole: 'owner'` côté `withAction` + RLS policy déjà restrictive en Phase 2. Les barbiers peuvent voir leurs propres tiers via la policy `commission_tiers_select_self`.
- **Payment Processing UI-only** : V1 affiche profil utilisateur + business details + destination account + Rapid Transfer promo (button désactivé). `updatePaymentProfile` permet d'éditer `legal_name`, `business_type`, `dob`. **Aucune donnée sensible affichée en clair** : SIN/Tax ID montrés comme badge "Provided / Not Provided" (annexe Image 10 + §8).
- **Audit log sans payload** pour `payment_profiles` : on enregistre l'action mais pas le diff, car le diff pourrait contenir des données sensibles. Le trigger SQL Phase 2 capture le vrai diff côté DB pour les managers.
- **Stripe Connect différé post-MVP** : la page actuelle prépare l'UI ; l'intégration réelle nécessite un compte Stripe Connect, des webhooks, et le flux KYC. Phase 9+ ou post-launch.
- **Tips config UI = Phase 6b** : la spec dit "vit dans Shop details" (Image 15). On a déjà acté ça dans DECISIONS Phase 0. Implémentation différée Phase 6b (avec barber settings et user settings) — les valeurs sont dans la table `tips_config`, le moteur `lib/business/tips.ts` est prêt à les consommer.
- **Build après Phase 7** : 38 routes. Middleware 105 kB. Tests Vitest : **44 passing** (8 taxes + 16 availability + 11 commissions + 4 tips, ×5 vs Phase 5).

## Phase 8 — Booking public

- **Pas d'auth pour les visiteurs** : un visiteur anonyme doit pouvoir lire shop / services / barbers / hours. RLS bloque l'anon par défaut. Deux choix : (a) policies SELECT publiques côté DB, (b) `service_role` côté serveur uniquement. **On a pris (b)** : `lib/supabase/service-role.ts` crée un client server-only avec `SUPABASE_SERVICE_ROLE_KEY`. Bypass RLS, utilisé seulement par `/book/[slug]` (Server Component) + `/api/book/[slug]/slots` + le Server Action. Documenté en tête de fichier avec « never expose ».
- **Route group `book` hors auth** : `app/[locale]/book/[shopSlug]/` — pas dans `(app)/`. Le middleware whitelistait déjà `/book` depuis Phase 3.
- **Wizard 5 steps en state local** (pas de routes par step) : services → barber → date+slot → contact → confirmation. Moins de bookmarks malheureux + meilleure protection contre les replays.
- **Slots API `/api/book/[slug]/slots`** : Route Handler qui calcule les créneaux dispos via `checkAvailability` pour (date, barber, duration). Rate limit 30/min/IP. Le wizard l'appelle à chaque changement de date/barber/services.
- **Honeypot field** : `name="hp"` `hidden` `aria-hidden`. Si rempli, Server Action renvoie `ok` mais ne crée rien (pour ne pas dire au bot qu'il a été détecté).
- **Rate limit booking** : 10/10min/IP (looser que auth — un client réel peut hésiter). Réutilise `lib/auth/rate-limit.ts`.
- **Find-or-create client par phone** normalisé (digits-only via `ilike '%digits%'`). Pas de dédup email pour V1.
- **`appointment.source = 'online'` + status `'booked'`** (acté Phase 0 DECISIONS) — l'admin peut passer à `confirmed` depuis le calendrier.
- **Booking-flow constraints** appliquées : `barber_settings` (override par barber, fallback shop) → `mins_book_before_appt`, `days_book_in_advance` passés à `checkAvailability`.
- **SEO** : `generateMetadata` retourne `<title>{shop.name} — Réserver en ligne</title>` + Open Graph. Schema.org `LocalBusiness`/`Hairdresser` différé Phase 9.
- **Mobile-first** : layout `max-w-2xl mx-auto`, grid responsive pour slots, date-strip horizontal scrollable.
- **Différé V1.1** : tip pendant le booking, promo code application, Cloudflare Turnstile (V1 OK avec rate limit + honeypot), Resend confirmation email, SMS reminders.
- **Build après Phase 8** : 38 + 2 routes (`/book/[shopSlug]` × 2 locales + `/api/book/[shopSlug]/slots`). Middleware 105 kB. Tests Vitest : 44 passing inchangés.

## Phase 9 — Polish & launch readiness

- **CSP strict-ish dans `next.config.mjs`** : `default-src 'self'`, `script-src 'self' 'unsafe-inline' 'unsafe-eval'` (Next 14 streaming + RSC payloads). `connect-src 'self' https://${supabaseHost} wss://…`. `frame-ancestors 'none'`. Switch vers nonces quand Next 15+ stabilisera l'API.
- **`upgrade-insecure-requests` en prod uniquement** : ne casse pas le dev local en HTTP.
- **`app/robots.ts` + `app/sitemap.ts`** : MetadataRoute Next.js. Robots autorise `/`, `/fr`, `/en`, `/fr/book/`, `/en/book/` et bloque tout `/{locale}/(app)/*` + `/api/`. Sitemap inclut les locales roots, /privacy, /terms, et un entry par `shops.alias` non null (fetché via service-role). `NEXT_PUBLIC_SITE_URL` env var.
- **Schema.org `HairSalon` sur `/book/[slug]`** : injecté via `<script type="application/ld+json">`. Contient nom, description, `PostalAddress`, `OpeningHoursSpecification`. Permet à Google d'afficher l'horaire dans les rich results.
- **`/privacy` + `/terms`** : pages statiques (force-static) bilingues, scaffold conforme Loi 25 Québec + principes RGPD. Sections : intro, données collectées, finalités, rétention (6 ans fiscal Québec, 7 ans clients inactifs), droits (accès/correction/suppression/portabilité), contact `wrivard@kua.quebec`.
- **CGU mentionnent juridiction Québec/Montréal** + responsabilité limitée (Küa = plateforme, salons = prestataires).
- **Middleware whitelist updated** : `/privacy` + `/terms` ajoutés à `PUBLIC_PATH_PREFIXES`.
- **README enrichi** : statut par phase, stack à jour, deploy walkthrough Vercel + Supabase (env vars, redirect URLs Supabase, custom domain), section "Différé V1.1".
- **Différé Phase 9b** (besoin d'une URL live pour tester) : Playwright e2e (login → home, booking, add product), Lighthouse CI (perf + a11y > 90 sur booking), axe-core dev, Sentry actif (DSN), Upstash KV pour rate limit multi-instance, Cloudflare Turnstile sur booking, Resend email confirmations, SMS reminders, Stripe Connect réel, Realtime calendrier, drag calendrier.
- **Build après Phase 9** : 42+ routes (+`/robots.txt`, `/sitemap.xml`, `/privacy` × 2, `/terms` × 2). Middleware 107 kB (CSP). Tests Vitest : 44 passing.

## Phase 6b — Barber Settings dense grid + User Settings invitations

- **Barber Settings (M)** : grille dense `1 + N` lignes (Shop default + une par barbier confirmé) × 12 colonnes (toggles + selects + h+m). Sticky-left column pour le nom. Bouton « Appliquer aux barbiers » qui copie les défauts Shop vers chaque barbier (in-memory, sans save auto). Save batch via `saveBarberSettings` qui split entre row 'shop' et rows 'barber', et fait update-then-insert manuellement (les UNIQUE partial indexes Phase 2 ne permettent pas un onConflict unique).
- **User Settings (O)** : DataTable des `shop_members` avec join client-side sur `profiles` (email + full_name). Edit role + status via modal. Soft-delete (`status='deleted'`) plutôt que DELETE pour préserver l'audit.
- **Invitation V1** : `inviteUser` cherche un profile existant par email. Si trouvé → insert `shop_members` immédiat avec `status='confirmed'`. Si pas trouvé → renvoie `NOT_FOUND` et le client affiche un toast `warning` invitant la personne à créer un compte d'abord. **V1.1** ajoutera une table `pending_invitations` + intégration `auth.admin.inviteUserByEmail` + email via Resend.
- **Service-role pour invitation** : `inviteUser` lit `profiles` (cross-tenant lookup) → besoin de bypass RLS → on utilise `createSupabaseServiceRoleClient()`. Justifié et documenté.
- **Conflict si déjà membre** : `inviteUser` retourne `CONFLICT` si l'email correspond à un user déjà dans `shop_members`.
- **Spec CLAUDE.md fermée à 100%** : tous les 18 écrans + booking public sont livrés. Phase 10 (widget embeddable, voir `WIDGET-SPEC.md`) est le seul travail produit pré-launch restant.
- **Build après Phase 6b** : 42+ routes, middleware 109 kB. Tests Vitest : 44 passing.

## Phase 10 — Widget intégrable (planifiée, cf. `WIDGET-SPEC.md`)

- `/embed/[shopSlug]` route dédiée sans layout, optimisée iframe.
- Snippet JS `public/widget.js` qui injecte un iframe + postMessage resize.
- Page admin `/settings/widget` avec preview live.
- Colonne JSONB `widget_config` sur `shops` (mode dark/light, accent_color, allowed_origins, etc.).
- CSP `frame-ancestors` adaptée par shop via middleware.
- Améliorations UX wizard (Squire-style) : "Choose a professional first" optionnel, multi-service step "Anything to add", récap "Your order" dark, date strip + slots avec icônes sun/moon.
- Stripe paiement online (post-MVP).
- Estimation : 8–15h.

## UI Refresh Wave — accent discipline (2026-06-05)

> Throughline validé avec l'owner (« precision instrument, warm signature ») : réserver `--accent` + `shadow-accent-glow` aux **actions primaires et au statut live uniquement**, pour que l'accent devienne signifiant *parce qu'il est rare*.

- **Les états actif/sélectionné de nav/onglets perdent l'accent** : l'item actif de la Sidebar principale (SidebarLink + KuaAdminLink), la sous-nav Settings (settings-sidebar), la nav super-admin, les onglets (tabs.tsx), et l'option sélectionnée du ShopSwitcher n'utilisent plus `bg-accent-subtle`/`text-accent`/`shadow-accent-glow`. Ils passent à un **marqueur structurel NEUTRE** — remplissage `bg-bg-surface-2` + `text-text-primary`, ou un soulignement `border-text-primary` pour les nav en onglets. Ça respecte le SPEC (« marqueur actif, jamais juste un changement de couleur de texte » : la barre/le soulignement EST le marqueur) tout en honorant la discipline d'accent. L'ancien état actif Phase 36 empilait un glow accent sur une barre laissée rendue (double accent) — les deux retirés, la barre est désormais neutre.
- **Les contrôles de formulaire GARDENT l'accent** (Toggle on, Checkbox coché) : le SPEC est explicite (« on = accent », « coché = accent ») et l'accent est l'affordance on/sélectionné la plus claire pour un input interactif. Le « toggles » du throughline est lu comme les contrôles de *nav/segmented* en forme de toggle, pas les switches de formulaire. On GARDE l'accent sur `toggle.tsx` (checked) + `checkbox.tsx` (checked). Ambiguïté tranchée selon la règle SPEC « choisir l'option la plus simple qui respecte les maquettes, documenter, continuer ».
- **Accent CONSERVÉ ailleurs** : Button primary, FAB, tuile logo Küa, variante `accent` du Badge, pastille d'initiales avatar (branding / action primaire / identité).

## Wave 1 — gaps fonctionnels « construit-mais-inatteignable » (2026-06-05)

> Trois surfaces dont la donnée/l'action existait déjà mais sans UI atteignable. Implémentées en read/display strict (aucun changement de schéma/webhook). Implémentées en parallèle via des sous-agents Workflow en worktrees isolés, chacune revue de façon adverse avant intégration (cherry-pick).

- **Vue litiges Stripe** (`/finances/disputes`, manager-gated, read-only) : suit la grammaire `/finances/today` (`<table>` brut dans Card, PAS DataTable ; `createSupabaseServerClient() as any` + `DisputeRow` typé à la main, pas de regen `db/types.ts`). La **réponse aux litiges / soumission de preuves est HORS périmètre** : le modèle destination-charge exige le composant Stripe `dispute_management` (non intégré) → on **deep-link vers le dashboard Stripe** plutôt qu'une UI de réponse. La cellule « Appointment » est un indicateur `Linked/—` (pas un lien vers le drawer : le drawer du calendrier s'ouvre par état client-side, aucun contrat `?appointment=`, un lien serait mort).
- **Vue List du calendrier** : scopée au **jour courant** (même dataset day-scopé que Side-by-Side → zéro refetch). État de vue en `useState` semé depuis `?view=`, sans réécrire l'URL au toggle. Toggle = primitive `Tabs` (onglet **Week désactivé** = tâche sœur). Réutilise `DataTable` + le **drawer déjà monté** (pas de second drawer). Nit connu : un RDV drag-déplacé garde sa position jusqu'au refetch (colonne triable en secours).
- **Avis publics sur la page booking** : lit la vue `reviews_public` (lignes publiées uniquement) via le **service-role client** déjà audité (DECISIONS Phase 8). Affiche moyenne + total + 3 snippets récents, **plafonné à 20 lignes récentes** (moyenne/total sous-estiment au-delà — approximation assumée et commentée), et **se cache** s'il n'y a aucun avis publié.
