# ARCHITECTURE & production-readiness

> Audit complet de la couverture `CLAUDE.md` + plan pour passer en production.
> Ce document complète `CLAUDE.md` (spec produit) et `DECISIONS.md` (journal).
> Mis à jour à chaque fin de phase.

**Dernière mise à jour** : fin de Phase 5 (Calendrier Side by Side + moteur de dispo testé).
**Statut global** : Phases 0–5 ✅ · Vues Week + List et Realtime différés V1.1 · Phases 6–9 à faire.

> Sentry est **différé en Phase 9** (pas Phase 3 comme prévu initialement) — son installation demande un compte Sentry + un DSN, et installer le wrapper sans DSN ajoute du noise pour rien. La façade `lib/observability.ts` est en place : migration en 4 lignes quand un compte existera.

> Phase 4 a été splittée en 4a (fondations + Services) et 4b (Barbers, Clients, Products+Brands+Categories, CSV export). Drag-reorder et migration `@tanstack/react-table` reportés en Phase 5 (quand le calendrier impose la virtualisation).

---

## 1. Couverture du `CLAUDE.md` — Statut actuel

### 1.1 Stack imposée (§1) — où on en est

| Dépendance | Statut | Phase d'introduction | Note |
|---|---|---|---|
| Next.js 14 App Router + TS strict | ✅ | 0 | `noUncheckedIndexedAccess` + `noImplicitOverride` activés |
| Tailwind + tokens CSS vars | ✅ | 0/1 | Tous les composants passent par `var(--accent)` |
| `@supabase/supabase-js` + `@supabase/ssr` | ✅ setup, ❌ usage | 0 / 2 | Clients prêts, schéma à créer |
| RSC + Server Actions | ⚠️ partiel | 4+ | Pas encore d'action serveur écrite |
| `@tanstack/react-query` | ❌ | 4 | À installer pour les grilles |
| `react-hook-form` + `zod` | ❌ | 4 / 6 | À installer pour les forms |
| `date-fns` + `date-fns-tz` | ❌ | 5 | Pour le calendrier (timezone shop) |
| `@tanstack/react-table` | ❌ | 4 | Migration depuis le `DataTable` V1 |
| `@dnd-kit/core` | ❌ | 4 | Reorder services/barbers |
| `next-intl` | ✅ | 0 | FR/EN, `requestLocale` API |
| `lucide-react` | ✅ | 1 | 25+ icônes utilisées |
| Vitest + Playwright | ❌ | 9 | À installer + setup CI |

### 1.2 Design system (§2) — vérification par token

| Token | Implémenté | Référencé depuis |
|---|---|---|
| Surfaces (5) | ✅ | `app/globals.css` `:root` |
| Texte (3) | ✅ | idem |
| Accent (4) | ✅ | **UNIQUE point de rebrand** |
| Statuts (4) | ✅ | idem |
| Calendrier (3) | ✅ | Pas encore consommés |
| Layout (5) | ✅ | sidebar/header sizes |

Les 27 composants de §2 sont **tous présents** dans `components/ui/`. À vérifier en Phase 9 : contrast WCAG AA sur le purple `#8b5cf6` vs `#1b1b1b` (a priori OK ~7:1 mais à confirmer).

### 1.3 Modèle de données (§3) — 0 / 26 tables créées

Tables à créer en Phase 2, listées dans `CLAUDE.md` :
`shops`, `shop_hours`, `shop_days_off`, `users`, `shop_members`, `barbers`, `barber_settings`, `service_categories`, `services`, `service_taxes`, `product_brands`, `product_categories`, `products`, `product_taxes`, `taxes`, `clients`, `appointments`, `appointment_services`, `blocked_time`, `discounts`, `promo_codes`, `loyalty_program`, `commission_tiers`, `tips_config`, `payment_profiles`, `notification_prefs`.

→ **RLS sur toutes les tables avec `shop_id`** via la policy générique du §3 (un user ne voit que les shops dont il est membre).

### 1.4 Navigation (§4) — ✅ Phase 1

- 9 items sidebar + Logout ✅
- Settings dropdown : à câbler en Phase 6 (le `SectionSwitcher` existe déjà comme primitive)
- `SectionSwitcher` Products/Brands/Categories : composant prêt, branchement en Phase 4

### 1.5 Écrans (§5, A–R) — 0 / 18 écrans réels

Tous les fichiers `page.tsx` existent et naviguent (placeholders). À remplir :

| Écran | Phase | Difficulté | Risque |
|---|---|---|---|
| A — Appointments (calendrier) | **5** | 🔴 Haute | Moteur dispo, drag, conflits |
| B — Clients | 4 | 🟡 Moyenne | A–Z bar, dedup, pagination |
| C — Services | 4 | 🟢 Basse | DataTable + drag reorder |
| D — Barbers | 4 | 🟢 Basse | Onglets confirmed/staff/deleted |
| E — Products + Brands + Categories | 4 | 🟡 Moyenne | SectionSwitcher + low-stock |
| F — Taxes | 6 | 🟢 Basse | Form simple |
| G — Payment Processing | 7 | 🟡 Moyenne | UI seulement, Stripe Connect plus tard |
| H — Commission / Tips | 7 | 🟡 Moyenne | Grille dense barbier × tier |
| I — Discounts | 6 | 🟢 Basse | Table + form |
| J — Loyalty Program | 6 | 🟢 Basse | Form |
| K — Waiting List | 6 | 🟢 Basse | Form |
| L — Promo Codes | 6 | 🟡 Moyenne | DateRange + table |
| M — Barber settings | 6 | 🟡 Moyenne | Grille très dense (overrides) |
| N — Shop details | 6 | 🔴 Haute | Formulaire géant, ~9 sections |
| O — User Settings | 6 | 🟡 Moyenne | Invitations + RLS roles |
| P — Change Password | 6 | 🟢 Basse | Supabase Auth API |
| Q — Admin dropdown | 6 | 🟢 Basse | `SectionSwitcher` réutilisé |
| R — Booking public | **8** | 🔴 Haute | Parcours complet, dispo réelle |

### 1.6 Règles métier (§6) — entièrement à coder

Toutes les règles vivront dans `lib/business/*.ts`, pures et testables :
- `taxes.ts` — calculs TPS/TVQ, `add_to_price`
- `availability.ts` — moteur de slots dispos
- `commissions.ts` — paliers cumulatifs/non-cumulatifs
- `tips.ts` — pct vs flat tiers selon montant
- `loyalty.ts` — décompte transactions / valeur
- `cancellation.ts` — règles d'annulation client

→ Bénéfice : Vitest peut tout couvrir indépendamment de Supabase.

---

## 2. Gaps production-ready (au-delà de la spec)

`CLAUDE.md` est focus produit/écrans. Pour livrer en prod, il faut aussi :

### 2.1 Bloquants production (à ne PAS oublier)

| Domaine | Manquant | Quand l'ajouter |
|---|---|---|
| Erreurs | `app/error.tsx`, `app/not-found.tsx`, `app/loading.tsx`, error boundaries par route | Phase 3 (auth) |
| Sécurité | Security headers (CSP, X-Frame-Options, Referrer-Policy) dans `next.config.mjs` | Phase 3 |
| Sécurité | Rate limiting sur la booking page publique (Upstash ou Vercel KV) | Phase 8 |
| Sécurité | Auth refresh dans middleware (pattern `@supabase/ssr`) | Phase 3 |
| Sécurité | Vérif RLS exhaustive — script de test qui essaie de cross-shop access | Phase 2 |
| Données | Backup Supabase activé (gratuit avec PITR sur plan Pro) | Phase 2 |
| Données | Migrations versionnées (`supabase/migrations/*.sql`) | Phase 2 |
| Données | Codegen `db/types.ts` automatique (`npm run db:types`) | Phase 2 |
| Conformité | Loi 25 (Québec) : politique de confidentialité + bannière cookies si analytics | Phase 9 |
| Conformité | Bilinguisme strict FR/EN partout (déjà cadré) | continu |
| Légal | Conservation des données fiscales 6 ans | Phase 6 (rétention) |
| Légal | Conformité PCI : pas de stockage de carte (Stripe Connect tokens uniquement) | Phase 7 |

### 2.2 Important pour la qualité

| Domaine | Manquant | Quand |
|---|---|---|
| Observabilité | Sentry pour errors (front + server) | Phase 3 |
| Observabilité | Logs structurés (pino ou Vercel logs) | Phase 3 |
| Observabilité | Audit log table (`audit_log`) pour les actions sensibles (delete client, refund, change commission) | Phase 4 |
| Tests | Vitest setup + tests règles métier | Phase 4–6 progressif |
| Tests | Playwright e2e : login → créer RDV, booking public, add product | Phase 9 |
| CI/CD | GitHub Actions : build + lint + typecheck + tests sur chaque push | Phase 9 |
| CI/CD | Preview deployments Vercel sur PR | Phase 9 |
| A11y | Audit axe-core dans le kitchen-sink | Phase 9 |
| A11y | Skip-to-content link | Phase 3 |
| A11y | Focus management dans Modal/Drawer (focus trap) — `<dialog>` le fait, vérifier `Drawer` | Phase 9 |
| Perf | Cache HTTP / `revalidate` sur les pages SSG | Phase 3 |
| Perf | Lazy-load du calendrier (composant lourd) | Phase 5 |
| Perf | Indexes Postgres sur `(shop_id, start_at)` pour `appointments`, `(shop_id, phone)` pour `clients` (dedup) | Phase 2 |
| Perf | Realtime Supabase pour le calendrier (autres barbiers voient les RDV créés) | Phase 5 |
| UX | Optimistic updates pour add/edit/delete | Phase 4 |
| UX | Empty states sur **chaque** liste (déjà la primitive `EmptyState`) | continu |
| UX | Toasts sur **chaque** action mutate | continu |
| UX | Confirmation modale sur **chaque** delete | continu |

### 2.3 Nice-to-have / polish

| Domaine | Manquant | Quand |
|---|---|---|
| PWA | manifest.json + service worker (mode offline pour le calendrier consultable) | post-V1 |
| SEO | Booking page : metadata Open Graph + sitemap.xml + robots.txt | Phase 8 |
| SEO | Schema.org `LocalBusiness` + `Hairdresser` sur la booking page | Phase 8 |
| SEO | Multi-domaine custom (axum.kua.app) — déjà supporté par `shops.alias` | post-V1 |
| DX | Hooks pre-commit (lint-staged) — **demander avant d'ajouter** (karpathy) | post-V1 |
| DX | Renovate/Dependabot pour les bumps de deps | Phase 9 |
| DX | VSCode workspace settings recommandées (`.vscode/settings.json`) | optionnel |
| Notifications | Web Push API pour les reminders client (au lieu de SMS payant) | Phase 6 |
| Notifications | Resend/Postmark pour les emails transactionnels | Phase 6 |
| Notifications | Twilio pour SMS reminders (futur) | post-V1 |
| Marketing | Page Marketing réelle (campagnes email/SMS) | Phase 8 |

---

## 3. Décisions architecturales structurantes (à acter)

Ces choix valent pour **toute la suite** et méritent d'être tranchés tôt :

### 3.1 Data layer : Server Actions vs Route Handlers vs tRPC

**Recommandation** : **Server Actions** par défaut + un `Result<T, AppError>` typage uniforme.
- Avantage : co-localisation form ↔ mutation, pas d'API à maintenir, gratuit avec App Router.
- Pour les writes complexes (booking transactionnel) : on garde la possibilité d'ajouter une `/api/booking` Route Handler.

### 3.2 React Query vs simple `fetch` côté client

**Recommandation** : **React Query uniquement pour les écrans interactifs lourds** (calendrier, grilles).
- Server Components RSC pour la **liste initiale** (rendu serveur, pas de waterfall client).
- React Query pour les **mises à jour locales** + **realtime** + invalidation.

### 3.3 Types : Supabase codegen vs Zod manuel

**Recommandation** : **les deux, complémentaires.**
- `db/types.ts` ← codegen Supabase pour les colonnes brutes.
- `lib/schemas/*.ts` ← schémas Zod pour les forms et la validation entrée (avec messages localisés via `next-intl`).
- Server Actions : parsent l'input Zod **avant** d'écrire en DB.

### 3.4 RLS strategy

**Recommandation** :
- Une policy unique par table : `shop_id IN (select shop_id from shop_members where user_id = auth.uid())`.
- Pour les rôles (owner/manager/barber) : ne **pas** essayer de tout faire en RLS. RLS = isolation tenant ; rôles fins = vérification dans le code Server Action via une fonction `requireRole(role)`.
- Une fonction Postgres `current_shop_id()` (security definer) pour simplifier les policies.

### 3.5 Auth : sessions + middleware

**Recommandation** : suivre le pattern officiel `@supabase/ssr` :
- `lib/supabase/server.ts` (Server Components / Server Actions)
- `lib/supabase/client.ts` (Client Components)
- `lib/supabase/middleware.ts` (refresh session) → branché dans le `middleware.ts` existant.

### 3.6 Timezone & dates

**Recommandation** :
- **Tous** les `timestamptz` en DB (UTC stocké).
- Affichage via `date-fns-tz` + `shop.timezone` (`America/Toronto` par défaut).
- Format selon `shop.date_format` (USA `MM/DD/YYYY` ou EU `DD/MM/YYYY`).

### 3.7 Calendrier : architecture rendering

Le calendrier de l'écran A est le plus gros risque technique. Options :
- **A (recommandé)** : Server Component pour les RDV du jour (RSC fetch), Client Component pour les interactions (drag, modals, drawer détail).
- **B** : 100% Client avec React Query + Supabase Realtime — fluide mais SEO/cold-start moins bons.

Mix A pour l'initial, Realtime ajouté en V1.1.

### 3.8 Drag & drop

Le spec dit "V1.1 si trop lourd". Recommandation :
- Phase 4 : drag pour réordonner services / barbiers (statique, `sort_order`).
- Phase 5 : **pas** de drag sur le calendrier au début. Édition uniquement par modal. Drag = V1.1.

### 3.9 Booking public — protection

- Pas de login → cible idéale pour bots / scraping.
- **Mesures** :
  - Rate limit IP (Upstash 10 req/min sur `POST`).
  - Honeypot field dans le form.
  - Captcha invisible (Cloudflare Turnstile) si abus.
  - Validation slot serveur (jamais faire confiance au client pour la dispo).

### 3.10 Multi-shop — onboarding

Le seed crée 1 shop (Axum). Pour vendre à d'autres salons :
- Page `/onboarding` (post-Phase 9) qui crée un shop + invite owner.
- `shop.alias` permet de servir un sous-domaine (`axum.kua.app`) plus tard.

---

## 4. Plan révisé Phases 2 → 9

### Phase 2 — Base de données (enrichie)

**Spec** : migrations + RLS + seed Axum.

**Ajouts production-ready** :
- [ ] Initialiser Supabase local avec CLI (`supabase init`, `supabase start`).
- [ ] Migrations versionnées dans `supabase/migrations/000X_*.sql`.
- [ ] RLS policy générique + helper SQL `current_shop_id()`.
- [ ] Indexes : `(shop_id, start_at)` sur `appointments`, `(shop_id, lower(phone))` sur `clients`, `(shop_id, sort_order)` partout où il y a sort.
- [ ] Trigger `updated_at` automatique sur toutes les tables.
- [ ] `audit_log` table + trigger pour `clients`, `appointments`, `discounts`, `commission_tiers`.
- [ ] `npm run db:types` génère `db/types.ts` depuis le schéma local.
- [ ] `npm run db:reset` recharge migrations + seed Axum.
- [ ] Test SQL anti-cross-shop : impossible de lire des données d'un autre shop_id depuis un user d'un shop différent (à automatiser dans `supabase/tests/`).

### Phase 3 — Auth & shell (enrichie)

**Spec** : login/logout + garde de route + shop courant.

**Ajouts production-ready** :
- [ ] `middleware.ts` : combine `next-intl` + Supabase session refresh.
- [ ] Page `/[locale]/login` + `/[locale]/signup` (V1 : email/password).
- [ ] `app/error.tsx` + `app/not-found.tsx` + `app/loading.tsx`.
- [ ] Error boundary par route group `(app)` qui renvoie un toast + fallback.
- [ ] Security headers dans `next.config.mjs` (CSP, X-Frame-Options, Referrer-Policy, X-Content-Type-Options).
- [ ] Sentry setup (`@sentry/nextjs`) + DSN en env.
- [ ] `requireUser()` / `requireShopMember()` helpers serveur.
- [ ] Skip-to-content link dans le layout pour a11y.

### Phase 4 — Core CRUD (enrichie)

**Spec** : Services, Barbers, Products+Brands+Categories, Clients. DataTables + drag + CSV.

**Ajouts production-ready** :
- [ ] Migration `DataTable` → `@tanstack/react-table` (filtres, virtualisation pour clients ~1900).
- [ ] `react-hook-form` + `zod` sur tous les forms.
- [ ] `@dnd-kit/core` pour drag-reorder services/barbiers.
- [ ] Server Actions typées avec parse Zod → `Result<T, AppError>`.
- [ ] Optimistic updates (React Query mutations).
- [ ] CSV export côté serveur (route handler `/api/export/[entity]`).
- [ ] Recherche full-text Postgres (`pg_trgm`) sur clients (nom + phone + email).
- [ ] Dedup clients : query par `lower(phone)` ou `lower(email)`.
- [ ] Low-stock warning + report dynamique.
- [ ] Marge négative warning sur produits.

### Phase 5 — Calendrier (enrichie)

**Spec** : Side by Side + Week + List, création/édition, conflits, dispo.

**Ajouts production-ready** :
- [ ] `lib/business/availability.ts` testé en Vitest avec ~20 cas.
- [ ] Lock optimiste sur la création RDV (vérifier conflit en transaction).
- [ ] `lib/business/timezone.ts` helpers (toShopTime, fromShopTime, formatShopDate).
- [ ] Supabase Realtime sur `appointments` (autres barbiers voient les RDV en live).
- [ ] Block time + Waiting list intégrés au moteur dispo.
- [ ] Drag différé en V1.1 (commenté dans le code).
- [ ] Composant calendrier lazy-loadé (`dynamic(() => …, { ssr: false })`).

### Phase 6 — Settings (enrichie)

**Spec** : Shop details + Taxes + Barber settings + Discounts + Loyalty + Waiting + Promo + Password + Users + Admin dropdown.

**Ajouts production-ready** :
- [ ] Form sectionné (Shop details) avec `<form>` HTML5 + `react-hook-form` + sauvegarde par section ou globale.
- [ ] Notifications matrice → `notification_prefs` upsert.
- [ ] `barber_settings` : override Shop default avec un visual diff cue (◆ icône si overridé).
- [ ] Validation côté serveur (Zod) **même si** le client valide.
- [ ] User invitations : email via Resend (template branded) → magic link de confirmation.
- [ ] Change password via Supabase Auth API + re-auth si session ancienne.

### Phase 7 — Finances (enrichie)

**Spec** : Commission/Tip Splits + Payment Processing.

**Ajouts production-ready** :
- [ ] `lib/business/commissions.ts` testé : cumulative on/off, services vs products scope.
- [ ] Payment Processing : UI complète mais **stub** Stripe Connect (intégration réelle = post-V1).
- [ ] Masquage strict des données sensibles (`Provided` / `Not Provided` + jamais log).
- [ ] Calcul des payouts (par barbier, par période) avec export CSV.

### Phase 8 — Booking public (enrichie)

**Spec** : Parcours client complet sans login.

**Ajouts production-ready** :
- [ ] Rate limit (Upstash) sur `POST /book/[shopSlug]/create`.
- [ ] Honeypot + Cloudflare Turnstile.
- [ ] Slot lock serveur (`SELECT … FOR UPDATE`).
- [ ] Email confirmation client (Resend).
- [ ] Metadata SEO : `<title>{shop.name} — Réserver en ligne</title>`, Open Graph.
- [ ] Schema.org `Hairdresser` + `LocalBusiness`.
- [ ] Format dates selon `shop.date_format`.
- [ ] Mobile-first design (la majorité bookera depuis mobile).

### Phase 9 — Polish & tests (enrichie)

**Spec** : Responsive, états vides, skeletons, toasts, FAB. Tests Vitest + Playwright. README.

**Ajouts production-ready** :
- [ ] Vitest config + `@testing-library/react` + tests des composants critiques (Modal, Drawer, Toast, DataTable).
- [ ] Tests règles métier : taxes, commissions, dispo, cancellation.
- [ ] Playwright : 3 parcours (login→créer RDV, booking public, add product) + un test multi-shop (RLS).
- [ ] GitHub Actions : build + typecheck + lint + vitest + playwright (sur PR).
- [ ] axe-core audit du kitchen-sink.
- [ ] Lighthouse CI sur la booking page (perf + a11y > 90).
- [ ] README enrichi : architecture, déploiement, runbook.
- [ ] Politique de confidentialité (Loi 25 + RGPD).
- [ ] Bilinguisme strict vérifié (tous les `useTranslations`).

---

## 5. Checklist finale "production-ready"

À cocher avant le go-live :

**Sécurité**
- [ ] HTTPS partout (Vercel ✓)
- [ ] Security headers (CSP strict, X-Frame-Options DENY, etc.)
- [ ] RLS testée multi-shop
- [ ] Rate limiting sur booking + login
- [ ] Honeypot + captcha sur formulaires publics
- [ ] Aucun secret dans le client bundle
- [ ] Aucun log de SIN / Tax ID / phone non masqué
- [ ] Dependencies à jour (audit npm) et CVE résolues

**Données**
- [ ] Backups Supabase activés (PITR si plan Pro)
- [ ] Migrations versionnées et reproductibles
- [ ] Codegen `db/types.ts` automatisé
- [ ] Indexes sur les colonnes critiques (`shop_id`, `start_at`, `phone`, `sort_order`)
- [ ] `updated_at` triggers
- [ ] Audit log sur les actions sensibles

**Observabilité**
- [ ] Sentry front + server
- [ ] Logs structurés
- [ ] Health check `/api/health`
- [ ] Monitoring uptime (UptimeRobot ou similaire)
- [ ] Alertes (deploy fail, error rate > X)

**Performance**
- [ ] Lighthouse > 90 sur booking page (mobile + desktop)
- [ ] Web Vitals tracking
- [ ] Cache HTTP propre
- [ ] Image optimization Next.js
- [ ] Bundle analyzer vérifié (pas de lib accidentelle lourde)

**Accessibilité**
- [ ] Lighthouse a11y > 90
- [ ] axe-core 0 erreur critique
- [ ] Navigation clavier complète
- [ ] Screen reader test au moins une fois
- [ ] Contrastes WCAG AA validés

**Tests**
- [ ] Vitest couvre les règles métier (taxes, commissions, dispo) > 90%
- [ ] Playwright couvre 3 parcours critiques
- [ ] CI verte sur main

**Conformité**
- [ ] Politique de confidentialité (Loi 25 Québec)
- [ ] Bilinguisme FR/EN intégral
- [ ] Conservation des données fiscales documentée
- [ ] Mention légale CASL (emails marketing)
- [ ] Possibilité d'export RGPD/Loi 25 par client

**Business / produit**
- [ ] Onboarding nouveau shop testé
- [ ] Booking public testé sur mobile réel
- [ ] Calendrier testé avec 50+ RDV simultanés
- [ ] Multi-barbier testé sur la même slot
- [ ] Taxes TPS+TVQ vérifiées contre exemples du seed
- [ ] Commissions cumulative on/off vérifiées

---

## 6. Risques techniques principaux

| Risque | Impact | Mitigation |
|---|---|---|
| Moteur de dispo bogué | RDV doubles / clients fâchés | Vitest exhaustif + lock SQL + Realtime |
| RLS mal configurée | Fuite cross-shop (catastrophe) | Script test automatisé Phase 2 |
| Calendrier lent (50+ RDV) | UX dégradée | Virtualisation + lazy load + indexes |
| Booking abusé par bots | Spam DB + alertes inutiles | Rate limit + captcha + slot lock |
| Mauvais calcul taxes / commissions | Perte d'argent / litiges | Tests règles métier + revues de calcul |
| Timezone mal gérée | RDV à la mauvaise heure | `timestamptz` UTC + `date-fns-tz` partout |
| Dépendance lourde silencieuse | Bundle bloated | `next bundle-analyzer` en CI |
| Stripe Connect non intégré | Pas de payouts | UI complète + intégration post-V1 |
