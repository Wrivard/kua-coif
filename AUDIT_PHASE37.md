# AUDIT — Phase 37 (production readiness)

> Comprehensive snapshot of the app's state at the end of Phase 36. Every
> phase 21-36 has been delivered. This document inventories what's still
> needed to consider the app **fully production-ready** for a real shop
> processing real money for real clients.

---

## Synthèse exécutive

| Axe | Note | Production-blocker ? |
|---|---|---|
| Auth + RLS | 🟢 **10/10** | Non |
| Modèle de données (29 tables + RLS) | 🟢 **9/10** | Non — db/types codegen stale |
| Calendar + booking | 🟢 **9/10** | Non |
| Email (SMTP-per-shop + cron) | 🟢 **9/10** | Non |
| Sécurité (rate-limit, CSP, encryption) | 🟢 **9/10** | Non |
| Observabilité (Sentry DSN-gated, audit log) | 🟢 **8/10** | Non |
| **Charges réelles (paiements)** | 🔴 **3/10** | **OUI** — onboarding seulement, pas de charge |
| **db/types.ts strict typing** | 🔴 **2/10** | Partiel — `as any` partout, runtime safe mais devs ne voient pas les erreurs |
| **Conformité Loi 25 (export + suppression user data)** | 🔴 **4/10** | **OUI** — politique écrite mais flow user-facing manquant |
| Loyalty / promo / waiting list | 🟡 **5/10** | Non — tables existent, logique manquante |
| Onboarding nouveau shop | 🟡 **4/10** | Partiel — `/admin/shops/new` existe mais pas de welcome flow |
| Reports (sales, commissions) | 🔴 **2/10** | Non — UI manquante |
| UI premium (palette, élévation, animations) | 🟢 **9/10** | Non — Phase 36 livrée |
| Mobile responsive | 🟢 **9/10** | Non — Phase 29 r3 livrée |
| Tests (Vitest + Playwright) | 🟡 **6/10** | Non — couverture basique OK |
| Documentation | 🟢 **8/10** | Non — README + DEPLOY + ARCHITECTURE complets |

**Verdict** : 3 production-blockers identifiés (P0 ci-dessous) + 4 "important V1" (P1) + plusieurs "polish V1.x" (P2).

---

## P0 — Production-blockers (à faire AVANT de prendre des paiements réels)

### P0.1 — Charges réelles via Stripe/QuickBooks (Phase 38)
**État actuel** : Onboarding Connect existe (Phase 28 Stripe, Phase 35 QuickBooks). Aucun PaymentIntent / Sales Receipt n'est créé sur booking. Donc le shop a un compte connecté mais ne peut pas faire payer un client.

**Manque** :
- Toggle "deposit required" par service ou par shop (settings)
- Booking flow étape "Paiement" : Stripe Elements (card.number, card.expiry, card.cvc) OU bouton "Payer avec QuickBooks"
- Server Action `createPaymentIntent(amount, shopId, appointmentId)`
- Confirm + persist `payment_intent_id` sur `appointments`
- Webhook `payment_intent.succeeded` → marker `payment_status='paid'`
- Refund flow dans `cancelAppointment` quand `payment_status='paid'`
- UI dans `/appointments` montrant le statut paiement

**Budget** : 6-10h (Stripe seul). QuickBooks Payments en parallèle = +4-6h.

### P0.2 — Loi 25 data export + deletion user-facing (Phase 40)
**État actuel** : Politique de confidentialité écrite (`/privacy`). Aucun bouton "exporter mes données" ni "supprimer mon compte" pour les clients OU les shop members.

**Manque** :
- Server Action `exportClientData(clientId)` → renvoie un JSON avec tous les RDV, services, etc.
- Server Action `deleteClient(clientId)` → soft-delete ou anonymize
- UI dans `/clients/[id]` (admin) : boutons "Export" + "Delete"
- Self-service : page `/me` ou similaire pour le client lui-même (V1.5)
- Pour shop members : action "delete my account" qui clean up

**Budget** : 3-4h.

### P0.3 — db/types.ts strict typing (Phase 39)
**État actuel** : `db/types.ts` est un placeholder. Tout le code utilise `as any` ou des structural casts pour appeler Supabase. Bug-prone : ajouter une colonne change rien en TS.

**Manque** :
- Codegen via `supabase gen types typescript --linked > db/types.ts`
- Refactor des callsites pour utiliser les types stricts
- Remove tous les `// eslint-disable-next-line @typescript-eslint/no-explicit-any` autour des Supabase clients

**Budget** : 2-3h.

---

## P1 — Important V1 (à faire AVANT le launch public)

### P1.1 — Loyalty + promo codes + waiting list activation (Phase 41)
**État actuel** : Tables `loyalty_program`, `promo_codes`, `waiting_list_entries` existent + UI de config dans `/settings/*`. Aucune logique côté booking flow.

**Manque** :
- Promo codes : champ dans booking wizard, validation server-side, persist redemption
- Loyalty : track per-client purchases, award rewards
- Waiting list : auto-fill if a slot opens (UI for adding to waiting list when no slot available)

**Budget** : 8-12h.

### P1.2 — Reports / Analytics (Phase 42)
**État actuel** : `/finances` page existe mais affiche placeholder. Aucun rapport.

**Manque** :
- Monthly sales report (per barber, per service category)
- Commission report (calc'd from `commission_tiers` + actual sales)
- Tip report
- Export CSV

**Budget** : 6-8h.

### P1.3 — Onboarding wizard nouveau shop (Phase 43)
**État actuel** : `/admin/shops/new` (Küa) permet de créer un shop avec settings minimaux. Pas de welcome flow pour le owner après création.

**Manque** :
- Wizard 5-step : Shop details → Hours → Services seed → Invite barbers → Done
- Inline tour de la calendar
- "Hello {name}" greeting

**Budget** : 4-6h.

### P1.4 — Custom domain + Vercel production setup (V1.0 launch)
**État actuel** : `<projet>.vercel.app`. Pas de domaine custom.

**Manque** :
- DNS pour `app.kua.quebec` (ou domaine choisi)
- Vercel domain config
- Update `NEXT_PUBLIC_SITE_URL`
- Update Supabase Auth redirect URLs

**Budget** : 1h (utilisateur).

---

## P2 — Nice-to-have V1.x

| # | Quoi | Budget |
|---|---|---|
| P2.1 | Page de marketing/landing publique | 3-5h |
| P2.2 | Pricing page + tier system | 4-6h |
| P2.3 | Image upload (avatars barbiers + logo shop) via Supabase Storage | 3-4h |
| P2.4 | 2FA pour les owners | 4-6h |
| P2.5 | Reviews/ratings client après RDV | 4-6h |
| P2.6 | More e2e tests (Playwright) | 4h |
| P2.7 | Lighthouse CI + perf budget | 2-3h |
| P2.8 | Cookie consent banner | 2h |
| P2.9 | Email templates: personnalisation par shop (logo, couleurs) | 3-4h |
| P2.10 | Multi-shop switcher pour users avec accès à plusieurs shops | 3-4h |

---

## Roadmap finale jusqu'à V1.0 production

Phases à exécuter dans cette session :

- **Phase 38** — Stripe PaymentIntents sur booking (P0.1, partial — Stripe seul; QuickBooks side V1.5)
- **Phase 39** — db/types.ts codegen + refactor des `as any` (P0.3)
- **Phase 40** — Loi 25 data export + delete (P0.2)
- **Phase 41** — Promo codes activation dans booking (P1.1 partial — promo seul)

Après ces 4 phases, l'app est P0-complete et P1.1-partial. Loyalty/waiting list/reports/onboarding wizard restent V1.1.

---

## Métriques

- **Lignes de code** : ~30k (TS/TSX/SQL) selon `wc -l`
- **Migrations Supabase** : 14
- **Routes Next.js** : 40+
- **Composants UI** : 27
- **Tests Vitest** : 64
- **Tests Playwright** : 3 scenarios
- **i18n strings** : ~250 par locale (FR + EN)

---

*Document généré fin de Phase 36 (commit `a6708f5`). À actualiser à chaque phase livrée.*
