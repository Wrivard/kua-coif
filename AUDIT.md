# AUDIT — fin de Phase 3

> Deep dive de l'état actuel du code (Phases 0–3 livrées) contre la spec
> `CLAUDE.md` et l'objectif "production-ready". Document compagnon de
> `ARCHITECTURE.md` (plan global) — celui-ci est **opérationnel** : il dit
> quoi faire, dans quel ordre, et avec quel effort estimé.
>
> Trois audits parallèles ont été menés : conformité spec, production-readiness,
> qualité de code. Synthèse ci-dessous.
>
> **Date** : fin de Phase 3 (auth Supabase + boundaries + headers livrés).

---

## Synthèse exécutive

| Axe | Note | Bloquants prod ? |
|---|---|---|
| Conformité `CLAUDE.md` (§3–§6 + annexe) | 🟢 **9/10** | Non — écarts mineurs, Phases 4–8 alignées |
| Modèle de données (26 tables + RLS + seed) | 🟢 **10/10** | Non — 100% conforme à la spec |
| Sécurité | 🟡 **7/10** | **Oui** — rate limit auth, CSP, mapping erreurs |
| Performance | 🟡 **7/10** | Partiel — indexes OK, perfectible Phase 5 |
| Observabilité | 🔴 **3/10** | **Oui** — Sentry, health check, audit log inaccessible |
| Tests | 🔴 **2/10** | **Oui** — Vitest absent, règles métier non testées |
| Déploiement (CI/CD) | 🔴 **3/10** | **Oui** — pas de GitHub Actions, pas de Vercel doc |
| Qualité code (i18n, types, a11y) | 🟢 **9/10** | Non — 5 micro-violations à polir |

**Verdict global** : Architecturalement solide. **4 bloquants production** identifiés (cf. P0 plus bas) qui pourraient ajouter ~10 h de travail bien placé pour ne pas accumuler de dette.

---

## 1. Conformité `CLAUDE.md` — 🟢 9/10

### Modèle de données (§3) — 100%
- **29 tables livrées** (vs 26 réclamées) : ajouts pertinents `profiles` (découplé de `auth.users`), `audit_log` (traçabilité), `waiting_list_config` (rename plus propre que des colonnes flat sur `shops`).
- Toutes les FKs, CHECK constraints et enums alignés.
- Helpers Postgres (`current_shop_ids`, `is_shop_member`, `has_role_in_shop`) bien factorisés.

### Navigation (§4) — 100%
- 9 items sidebar + dropdown Settings 11 sous-items + Logout (via Server Action form, intentionnel — pas dans `NAV_ITEMS`).

### Écrans (§5) — 17/18 (R diffé Phase 8)
- A–Q présents avec placeholders annotés de la phase d'implémentation.
- **R (Booking public)** absent — normal, Phase 8.

### Seed Axum (annexe Partie 2) — 100% exact
- Shop, hours, taxes (TPS 5%, TVQ 9.975%), 14 services aux prix exacts, 14 produits avec inventaires/taxes/marges, 4 barbers, 5 discounts, WELCOME20 promo, loyalty/tips/payment/notifications/waiting-list, 32 clients (avec doublon volontaire), 7 RDV du 22 mai 2026.
- Orthographe `junioir barber` conservée (cohérent avec annexe).

### Règles métier (§6) — Architecture en place
- Taxes multi (M:N) ✅ · Devise CAD `formatCurrencyCAD()` ✅ · Phone NANP `formatPhoneNANP()` ✅
- Dispo (tables + indexes GiST range) ✅ — logique Phase 5
- Annulation (`mins_cancel_before_appt` en `barber_settings`) ✅ — logique Phase 5
- Commissions (table avec 5 tiers + flag cumulative + scope) ✅ — calcul Phase 7
- i18n strict (next-intl, 53 usages `useTranslations`) ✅

### Top 5 écarts vs spec (tous mineurs)

| # | Écart | Sévérité | Action |
|---|---|---|---|
| 1 | `default_language = 'en'` (seed) alors que l'app défault FR | 🟢 Mineur | Acté dans DECISIONS.md ; fidélité maquette Image 15 |
| 2 | Logout absent de `NAV_ITEMS` | 🟢 Mineur | Intentionnel — c'est une Server Action form, pas un lien |
| 3 | Booking public (Écran R) absent | ⚪ Normal | Phase 8 |
| 4 | `confirmation_tip` UX en `/settings/barbers` à valider | 🟡 À surveiller | Phase 6 |
| 5 | `/kitchen-sink` non documenté en spec | 🟢 Bonus dev | Utile pour design system review |

---

## 2. Production-readiness — 🟡 6/10 (4 catégories sur 6 à durcir)

### 🟢 UX / Erreurs (8/10) — quasi prêt
- 4 boundaries : `global-error.tsx`, `[locale]/error.tsx`, `[locale]/not-found.tsx`, `[locale]/loading.tsx`, `(app)/error.tsx`.
- `EmptyState`, `Skeleton`, `Toast`, `Modal`, `ConfirmDialog` prêts.
- Skip-to-content link i18n.
- **Manque** : toast/confirm sur Server Actions (Phase 4), revalidation cache.

### 🟡 Sécurité (7/10)
**Bon** : headers complets (X-Frame DENY, nosniff, Referrer-Policy, Permissions-Policy, HSTS), RLS forcée sur 24 tables, test cross-shop, auth refresh @supabase/ssr, `safeRedirectTarget()` contre open redirects, CSRF natif Server Actions, secrets séparés `NEXT_PUBLIC_*` vs service-role.

**À faire** :
- ❌ **Rate limit** sur `signInAction` (brute-force possible)
- ⚠️ **CSP** différée (Phase 9 — quand on connaîtra toutes les origines : Supabase, Vercel, fonts)
- ⚠️ **Erreurs Supabase** retournées brut (`error.message`) — mapper à enum sécurisé
- ⚠️ **Email confirmation UX** si Supabase l'active : afficher "vérification en cours"

### 🟡 Performance (7/10)
**Bon** : indexes Postgres (GiST range pour overlap, trigram pour clients dedup, `(shop_id, start_at)`), RSC par défaut, bundle léger.

**À faire** :
- ⚠️ Lazy-load calendrier (Phase 5) : `dynamic(import('@/components/Calendar'), { ssr: false })`
- ⚠️ Cache HTTP / `revalidate` sur pages SSG
- ⚠️ Bundle analyzer en CI
- ⚠️ Image optimization Supabase + `next/image`

### 🔴 Observabilité (3/10) — **bloquant prod**
- ❌ **Sentry absent** — pas de capture d'erreurs serveur ni client. ARCHITECTURE l'a différé Phase 9 mais c'est trop tard ; l'auth en Phase 3 a déjà besoin de tracking.
- ❌ **Health check `/api/health`** absent.
- ❌ **Logs structurés** : juste `console.error` en dev.
- ❌ **Audit log inaccessible** : la table + triggers existent (7 tables wired), mais aucun wrapper `logAuditAction()` côté code, pas de page de consultation.

### 🔴 Tests (2/10) — **bloquant prod**
- ❌ Vitest + Playwright pas installés (planifiés Phase 9 — trop tard).
- ✅ `supabase/tests/rls_cross_shop.sql` existe (pgtap-free, robuste).
- ❌ Aucun test sur les utils (`formatCurrencyCAD`, `formatPhoneNANP`, futurs `lib/business/*`).

### 🔴 Déploiement (3/10) — **bloquant prod**
- ✅ `.env.example` clean.
- ✅ Scripts `db:*` (start, reset, push, types).
- ❌ `vercel.json` absent (peut être OK — Vercel détecte Next.js, mais on peut vouloir headers ou ISR).
- ❌ `.github/workflows/*` absent — pas de CI.
- ❌ README dépl manque le walkthrough Vercel (variables, custom domain).

### Top 10 actions production-readiness (triées impact/effort)

| # | Action | Catégorie | Effort | Bloquant prod ? |
|---|---|---|---|---|
| 1 | Sentry installé + DSN (front + server) | Observabilité | 1 h | **Oui (P0)** |
| 2 | `/api/health` (ping Supabase) | Observabilité | 30 min | **Oui (P0)** |
| 3 | Rate limit auth (Upstash KV ou Vercel KV) | Sécurité | 2 h | **Oui (P0)** |
| 4 | GitHub Actions CI (build/lint/typecheck/`db:test`) | Déploiement | 1.5 h | **Oui (P0)** |
| 5 | Vitest setup + tests `lib/utils.ts` | Tests | 2 h | P1 |
| 6 | `logAuditAction()` wrapper Server Action | Observabilité | 1 h | P1 |
| 7 | Doc Vercel deploy (README) | Déploiement | 45 min | P1 |
| 8 | CSP strict | Sécurité | 2 h | P2 (avant launch) |
| 9 | Lazy-load calendrier | Performance | 1 h | P2 (Phase 5) |
| 10 | Mapper erreurs Supabase à enum sécurisé | Sécurité | 1 h | P1 |

---

## 3. Qualité de code — 🟢 9/10 (5 micro-violations)

| Dimension | Verdict | Détail |
|---|---|---|
| Tokens couleur | ✅ | Aucun hex hardcoded hors `globals.css`. Tailwind config map propre. |
| i18n strict | ⚠️ | 99% OK, **3 strings hardcoded** : `global-error.tsx` (3 chaînes EN), `sidebar.tsx` (`'Collapse/Expand sidebar'`), `modal.tsx` + `drawer.tsx` (`aria-label="Close"`) |
| Server vs Client | ✅ | 20 fichiers `'use client'`, tous justifiés. Pas d'inversion. |
| Server Actions sécurité | ⚠️ | Validation Zod OK, open redirect protégé, **mais** `error.message` Supabase exposé brut (`lib/auth/actions.ts:72,118`) |
| Accessibilité | ⚠️ | Bonne foundation (`aria-current`, `role="alert"`, `<dialog>` natif), mais 4 `aria-label` en anglais à localiser |
| TypeScript strict | ✅ | `noUncheckedIndexedAccess`, zéro `any` explicite, 3 `!` tous justifiés après contrôle |
| Conventions commits / DECISIONS | ✅ | Conventional commits propres, DECISIONS à jour jusqu'à Phase 3 |

### Top 5 dette technique

| # | Violation | Fichier(s) | Effort fix |
|---|---|---|---|
| 1 | `global-error.tsx` 3 strings EN sans i18n | `app/global-error.tsx:21,22,32` | 15 min |
| 2 | `error.message` Supabase exposé brut au client | `lib/auth/actions.ts:72,118` | 30 min |
| 3 | `aria-label` EN hardcoded dans sidebar/modal/drawer | `components/ui/sidebar.tsx:141`, `modal.tsx:74`, `drawer.tsx:103` | 20 min |
| 4 | `issue.path[0]` sans assertion (strict TS warn) | `lib/auth/actions.ts:58,106` | 5 min |
| 5 | Manque `lib/business/` testé (taxes, dispo, commissions) | À créer Phase 4–7 | 5–8 h sur durée |

---

## 4. Plan d'optimisation priorisé

### P0 — Bloquants production (à faire AVANT Phase 4)

| Action | Effort | Pourquoi maintenant |
|---|---|---|
| **Sentry** (front + server) | 1 h | Tracker les erreurs d'auth dès la mise en ligne |
| **Rate limit auth** (Upstash KV, 5 tentatives/10 min/IP) | 2 h | Protéger `/signin` contre brute-force |
| **`/api/health`** ping Supabase | 30 min | Monitoring uptime + alertes externes (UptimeRobot, Vercel) |
| **GitHub Actions CI** (build/lint/typecheck + `db:test`) | 1.5 h | Empêcher la régression silencieuse |
| **Mapper erreurs Supabase** à enum sécurisé | 1 h | Pas leaker la stack interne au client |

**Total P0 : ~6 h**.

### P1 — Important (durant Phase 4–6)

| Action | Effort | Quand |
|---|---|---|
| Vitest + tests utils (`formatCurrencyCAD`, `formatPhoneNANP`) | 2 h | Début Phase 4 |
| `logAuditAction()` wrapper + page de consultation | 2 h | Phase 4 (premières Server Actions) |
| Fix les 5 micro-violations qualité code (i18n strings, etc.) | 1 h | Quick win — possible immédiatement |
| README enrichi (Vercel deploy walkthrough) | 45 min | Avant le premier deploy |
| `lib/business/availability.ts` testé Vitest | 4 h | Avant Phase 5 (moteur de dispo) |
| `lib/business/commissions.ts` testé Vitest | 3 h | Avant Phase 7 |
| Cache HTTP + revalidate sur pages stables | 1 h | Phase 4 |
| Bundle analyzer (`@next/bundle-analyzer`) en CI | 1 h | Phase 9 |

**Total P1 : ~14 h** étalé sur Phases 4–7.

### P2 — Avant launch (Phase 9)

| Action | Effort |
|---|---|
| CSP strict (CSP report-only puis enforce) | 2 h |
| Playwright e2e (3 parcours : login→home, booking, add product) | 4 h |
| axe-core audit kitchen-sink | 1 h |
| Lighthouse CI sur booking page | 1 h |
| Politique de confidentialité + bilinguisme intégral | 2 h |

**Total P2 : ~10 h**.

### Quick wins (< 30 min chacun, faisables maintenant)

1. Fix `error.message` Supabase exposé → mapping enum (30 min)
2. i18n des `aria-label` "Close" / "Collapse/Expand sidebar" (20 min)
3. `issue.path[0]` → `issue.path[0]!` (5 min)
4. `app/global-error.tsx` → fallback statique bilingue (15 min)
5. Email confirmation UX dans `/login?signedUp=1` (20 min)

**Total quick wins : ~1 h 30 — recommandé en intermède avant Phase 4.**

---

## 5. Roadmap finale vers production

### Avant de coder Phase 4

- [ ] **P0** : Sentry · health check · rate limit · CI · mapper erreurs (~6 h)
- [ ] **Quick wins qualité code** (~1 h 30)
- [ ] **Setup Vercel + Supabase cloud** + premier deploy (~1 h)
- [ ] Premier test e2e manuel : signup → login → logout sur URL Vercel

### Phase 4 (Core CRUD)

- Vitest installé dès le départ
- `react-hook-form` + Zod côté forms
- `@tanstack/react-query` pour grilles
- `@dnd-kit/core` pour reorder
- `logAuditAction()` câblé sur chaque Server Action mutate
- CSV export route handler

### Phase 5 (Calendrier)

- `lib/business/availability.ts` 100% testé Vitest
- Lazy-load du calendrier
- Realtime Supabase sur `appointments`
- Lock optimiste serveur

### Phase 6–7 (Settings + Finances)

- `lib/business/{taxes,commissions,tips,loyalty,cancellation}.ts` testés
- Validation Zod stricte côté serveur sur tous les forms
- Masquage strict SIN/Tax ID

### Phase 8 (Booking public)

- Rate limit Upstash sur `POST /book`
- Honeypot + Cloudflare Turnstile
- Slot lock SQL (`for update`)
- Schema.org `LocalBusiness` + `Hairdresser`

### Phase 9 (Pre-launch)

- CSP strict
- Playwright 3 parcours
- axe-core + Lighthouse CI > 90
- Politique confidentialité (Loi 25 Québec)
- Audit dépendances

### Checklist go-live (extraite de ARCHITECTURE.md §5)

Conserver et cocher avant publication publique :
- [ ] Sentry actif (P0)
- [ ] CI verte sur main (P0)
- [ ] Rate limit auth (P0)
- [ ] CSP strict (P2)
- [ ] Lighthouse > 90 booking (P2)
- [ ] Tests règles métier > 90% (P1)
- [ ] RLS testée multi-shop ✅ (déjà fait)
- [ ] Aucun `console.log` de SIN/phone/tax_id
- [ ] Politique de confidentialité

---

## Conclusion

**Phases 0–3 sont solides architecturalement** — conformité spec quasi parfaite, design system propre, sécurité de base en place. Mais entre "le code compile" et "production-ready", il manque ~6 heures d'observabilité + CI + rate limit qui sont des **bloquants réels** (et bon marché à régler).

**Recommandation immédiate** : caser une **mini-phase "3.5 — production hardening"** d'environ 6–8 heures (P0 + quick wins) avant d'attaquer Phase 4. Sinon, on accumulera de la dette qui sera plus chère à régler dans 3 phases.

Le reste (Phases 4–9) suit le plan ARCHITECTURE.md déjà en place, enrichi des P1/P2 ci-dessus.
