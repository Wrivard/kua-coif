> ARCHIVED 2026-06-10 — historical phase/loop build ledger, relocated from README.md.
> A snapshot of what shipped when; not a description of current state. See docs/archive/README.md.

# Phase / loop build ledger — kua-coiffure

## Différé V1.1+ / V1.2

Suit l'ordre dans lequel les phases sont livrées (les ✅ sont en main, les ⏳ sont à venir).

- ✅ **Phase 21 — Upstash Redis rate limiting** : bascule auto multi-instance + fallback in-memory.
- ✅ **Phase 22 — Whitelist auth + super-admin Küa** : signup désactivé, owners créés via `/admin/shops/new`, staff invité via `/settings/users`.
- ✅ **Phase 23 — Multi-vertical** : 6 industries (hair_salon, barbershop, massage, physio, chiropractic, esthetics) avec catalogues éditables.
- ✅ **Phase 24 — Resend email + booking confirmation brandée**.
- ✅ **Phase 25 — SMTP-per-shop + reminders cron** (24h + 1h) + automation toggles + AES-256-GCM des SMTP passwords.
- ✅ **Phase 26 — Realtime calendar** : Supabase Realtime sur `appointments` + `blocked_time` pour la propagation multi-écrans.
- ⏳ **Phase 27 — Drag-to-reschedule** : déplacer/redimensionner un RDV directement sur la grille (`@dnd-kit/core` déjà installé). Dépend de Phase 26 pour propagation cross-viewer.
- ✅ **Phase 28 — Stripe Connect Express (onboarding)** : env-gated. UI dans `/settings/payments` qui crée un compte Express, redirige vers le KYC hosted Stripe, et reflète le statut via webhook `account.updated`. **Pas encore de charges** — les PaymentIntents sur booking arrivent en V1.5/Phase 32. Voir section Sécurité pour activation.
- ⏳ **Phase 29 — UI review / polish global** : passe de finition cross-écrans (voir détail ci-dessous).
- ✅ **Phase 30 — Cloudflare Turnstile** : protection bot sur booking publique (env-gated — voir section Sécurité).
- ✅ **Phase 31 — Per-shop CSP `frame-ancestors` whitelist** pour `/embed` (déjà livré avec Phase 20 — middleware lit `widget_config.allowed_origins` et bâtit la CSP par shop, UI dans `/settings/widget`).
- ✅ **Phase 33 — Calendar UI refinement** : softer grid (-50% opacité), alternating hour bands, "now" indicator, format heures clean ("8 AM" / "10 h"), +15% breathing room (PX_PER_MIN 1.4→1.6).
- ✅ **Phase 34 — Google Calendar two-way sync** (env-gated). Voir section dédiée plus haut.
- ✅ **Phase 35 — QuickBooks Online Payments** (env-gated, alternative à Stripe). Onboarding OAuth + scope Accounting + Payments. Charges sur invoice viendront en V1.5 (comme Stripe).
- ✅ **Phase 36 — Premium dark-theme overhaul** : palette refondue (near-black bg, alpha-based borders), système d'élévation (shadow + inset highlight), composants polishés (Card, Button, Modal, Drawer, Sidebar, Skeleton shimmer, etc.), display fontSizes + tracking-tight.
- ✅ **Phase 38 — Stripe PaymentIntents backend** : `chargeAppointment` + `refundAppointment` + webhook `payment_intent.*` / `charge.refunded`. UI Stripe Elements dans booking flow = V1.1.
- ✅ **Phase 39 — db/types.ts codegen** : 53KB de types live depuis Supabase. `as any` peuvent être nettoyés incrémentalement.
- ✅ **Phase 40 — Loi 25 export + anonymize** : Server Actions admin-only `exportClient` (JSON download) et `anonymizeClient` (préserve l'intégrité fiscale Revenu Québec). UI dans `/clients`.
- ✅ **Phase 41 — Promo codes activation** : validation server-side dans bookPublicAppointment (invalid/expired/used/first_only), discount appliqué au total, redemptions bumpé, UI dans booking wizard step 4 (gaté par `widget_config.show_promo_code`).
- ✅ **Phase 42 — Service deposit_amount admin field** : input dans `/services` form modal, persisté via `services.deposit_amount_cents`.
- ✅ **Phase 43 — Loyalty program activation** : `awardLoyaltyOnCompletion` hooké dans `updateAppointment` → bump `clients.loyalty_counter` + grant reward au goal. UI consommation = V1.1.
- ✅ **Phase 44 — Finances dashboard** : KPIs du mois courant (gross revenue, RDV complétés, panier moyen, loyalty outstanding) + table ventes par barbier. Manager+ only.
- ✅ **Phase 45 — Onboarding hint** : carte contextuelle sur le calendar quand le setup est < 100% (shop address, hours, services, barbers). Auto-cache une fois complet.
- ✅ **Phase 46 — Audit production-readiness post-loop 2** : doc `AUDIT_PHASE46.md` (état des P0/P1, verdict launch-ready avec caveats, roadmap V1.1).
- ✅ **Phase 47 — Premium UX polish** : auth shell (ambient gradient + brand mark), booking wizard (header, progress chips, service cards, barber cards, sticky subtotal), EmptyState (icon halo accent/danger), forms (Input/Select/Textarea/Toggle/Checkbox harmonisés ring-2 ring-accent/30 + shadow-sm).
- ✅ **Phase 48 — Calendar grid white-stroke root-cause fix** : découverte que `border-border/X` est un no-op silencieux depuis Phase 33 (Tailwind 3 ne strip pas l'alpha d'un `rgba()` token). Introduction de `--border-soft` (0.04) et `--border-faint` (0.025) bakés. Calendar overlays (blocked, Google busy, appointment blocks) au standard rounded-md + shadow-sm + hover-lift.
- ✅ **Phase 49 — Audit + roadmap loop 3** : doc `AUDIT_PHASE49.md` (état post-47/48, V1 remnants identifiés, roadmap loop 4).
- ✅ **Phase 50 — Loyalty auto-apply on booking** : `bookPublicAppointment` fetch `loyalty_balance_cents` au find-or-create, applique le crédit après promo (cap au running total, cents pour éviter le float drift), décrément best-effort post-insert. Audit log capture `loyaltyCreditCents`. UI surfacing dans wizard = V1.1.
- ✅ **Phase 51 — Finances date-range + per-category** : `/finances?start=YYYY-MM-DD&end=YYYY-MM-DD` (form GET, server-rendered). Per-category breakdown via appointment_services × services × service_categories.
- ✅ **Phase 52 — Commission report** : par barbier, sur leurs commission_tiers (scope services). Réutilise `lib/business/commissions.ts` (déjà testé 13 cas). Badge mode cumulatif vs single-tier.
- ✅ **Phase 53 — Waiting list (entries)** : migration `waiting_list_entries` (table + RLS + indexes + updated_at trigger). Server actions admin (`updateWaitlistEntryStatus`, `deleteWaitlistEntry`) + public `addToWaitlistPublic` (rate-limited, honeypot). Admin UI sur `/settings/waiting-list` liste les entrées en attente avec actions (mark notified, cancel, delete). Booking wizard CTA = V1.1.
- ⏳ **Phase 54 — Stripe Elements UI in booking** : deferred → livré en Phase 56.
- ✅ **Phase 55 — Audit + roadmap loop 4** : doc `AUDIT_PHASE55.md`.
- ✅ **Phase 56 — Stripe Elements UI dans booking** : `@stripe/stripe-js` + `@stripe/react-stripe-js` installés. `lib/stripe/client.ts` (singleton loadStripe + guard). Nouvelle server action `createBookingPaymentIntent` (resolve shop Connect status, sum `services.deposit_amount_cents`, crée PI via Phase 38 backend). `BookingPaymentSection` forwardRef component avec PaymentElement (dark Stripe theme accent #8b5cf6). `bookPublicAppointment` accepte `payment_intent_id` + `deposit_amount_cents`, persiste payment_status='pending' (webhook → 'paid'). Pas de ghost appointments — PI confirmé client-side AVANT création de l'appointment.
- ✅ **Phase 57 — Booking wizard waitlist CTA** : `SlotPicker` étendu avec `waitlistInfo` prop. Quand slots empty, message + bouton "Join the waitlist" → inline form (first_name + phone + notes). Submit via `addToWaitlistPublic` (Phase 53). Success pill remplace le form. Window = jour sélectionné (single-day).
- ⏳ **Phase 58 — Loyalty redemption surfacing wizard** : deferred (Loop 6 top prio — backend Phase 50 fonctionne déjà, juste le hint visuel manque).
- ⏳ **Phase 59 — db/types.ts regen** : deferred (codebase tolère via `any` casts).
- ✅ **Phase 58 audit doc** : `AUDIT_PHASE58.md` (état post-loop 5, P0 production blockers tous fermés, roadmap loop 6).
- ✅ **Phase 60 — Loyalty hint dans wizard summary** : nouvelle server action `lookupLoyaltyByPhone` (anonyme, rate-limited 60/10min, anti-enumeration). Debounce 500ms sur phone input → store dans state. Summary card affiche subtotal/credit/total quand crédit > 0 (single-line sinon). Client-side mirror exact de la math serveur. Translations subtotalLabel/loyaltyApplied/totalLabel ×2 locales.
- ⏳ **Phase 61 — db/types.ts regen** : task utilisateur (`pnpm exec supabase gen types typescript --project-id jzpfvefrjtwqfyynhczp > db/types.ts`). Le codebase fonctionne via `any` casts en attendant.
- ✅ **Phase 60 audit doc** : `AUDIT_PHASE60.md` (loop 6 wrap, P0 toujours tous fermés, roadmap loop 7).
- ✅ **Phase 64 — Marketing banner** : migration `shops.marketing_banner_text` + `marketing_banner_enabled`. Admin UI nouvelle section "Marketing" sur `/settings/shop` (Toggle + Textarea 280 char). Public render au-dessus du booking wizard quand toggle ON + texte non-vide. `revalidatePublicShopSurfaces` déjà câblé. Translations ×2 locales.
- ✅ **Phase 64 audit doc** : `AUDIT_PHASE64.md` (loop 7 wrap, P0 toujours tous fermés, roadmap loop 8).
- ✅ **Phase 65 — Multi-shop switcher MVP** : `SHOP_COOKIE` + `getCurrentShopId()` cookie-aware avec fallback à la première membership. Server action `selectShop` (verify membership avant cookie set, httpOnly + sameSite=lax + secure-in-prod, maxAge 1y). Page `/settings/active-shop` avec card picker (Current pill + Switch button). Sidebar dropdown = V1.1.
- ✅ **Phase 62 — Email per-shop branding (data layer)** : migration `shops.email_logo_url` + `email_accent_color` (CHECK hex). Schema + admin UI section "Email branding" sur `/settings/shop`. Intégration dans email templates = V1.1 (Phase 62b).
- ✅ **Phase 63 — Reviews schema** : migration `reviews` (rating 1-5, status pending/published/rejected, indexes + RLS shop_members + public SELECT sur published). Submission flow public via signed token + admin moderation UI = V1.1 (63b/63c).
- ⏳ **Phases 66, 67, 68, 69** : deferred (chacune mérite son loop — Storage bucket setup, MFA enrollment flow, phone-OTP infra, cron/matcher algo).
- ✅ **Phase 65 audit doc** : `AUDIT_PHASE65.md` (loop 8 wrap, MVPs + clear deferrals, roadmap loop 9).
- ✅ **Phase 62b — Email branding wiring** : template `appointment-confirmation.tsx` accepte `emailLogoUrl` + `emailAccentColor` ; logo image au lieu du Küa wordmark si fourni, palette accent overridable. Booking action lit les nouveaux colonnes + passe au template.
- ✅ **Phase 63c — Reviews moderation UI** : `/settings/reviews` admin page (3 sections pending/published/rejected) + actions `moderateReview` (publish/reject) + `deleteReview`. Star rating display, barber name lookup, audit log capture. RLS already enforced.
- ⏳ **Phase 65b — Sidebar dropdown** : reporté (sidebar 324 lignes — refactor sortant du budget loop, switcher reste accessible via `/settings/active-shop`).
- ⏳ **Phases 66, 69** : encore à venir (image upload, waitlist auto-notify).
- ✅ **Phase 63b — Public review submission via signed token** : `lib/security/signed-tokens.ts` (HMAC-SHA256, base64url, kind discriminator + exp). Page `/[locale]/review/[token]` valide le token, fetch appointment + barber pour context, render star rating form (1-5 + optional name + comment). Action `submitPublicReview` re-vérifie le token server-side, block duplicates. Statuts à 'pending' → admin moderates via Phase 63c UI.
- ✅ **Phase 68 — /me self-service page** : `/[locale]/me/[token]` montre loyalty balance + visit count + Loi 25 self-export button + shop contact. Action `exportMyData` retourne le même shape JSON que l'admin export (`/clients/[id]/export`), token-gated, rate-limited 10/h/IP.
- ✅ **Admin token generation buttons** : server action `generatePublicLinks({appointment_id})` (minRole barber) qui signe les deux tokens (review 90d, /me 365d) et retourne les URLs. Drawer appointment-detail gagne deux boutons "Review link" + "Self-service link" — copy to clipboard avec fallback toast si HTTPS bloque `navigator.clipboard`. Auto-send via Resend = V1.1.
- ✅ **Phase 67 — 2FA (TOTP) enrollment** : `/settings/two-factor` page + client utilisant `supabase.auth.mfa.enroll/challenge/verify/unenroll`. Trois états (none / enrolling avec QR + secret + code input / enrolled avec liste + remove + add another). Friendly name auto-tagged avec date. Recovery codes hors V1 (Supabase ne les ship pas natifs). Middleware sign-in challenge gate = V1.1.
- 🔍 **Phase 70 — Ultrathink Deep-Dive Audit** : `AUDIT_PHASE70.md` couvre 3 axes via 3 agents parallèles (intégrations, frontend vs Vercel design, real-world business gaps). Verdict : architecture solide, intégrations moins profondes que le README laisse croire (Stripe 80%, Google 90%, QuickBooks **30% — OAuth only, no invoices**, Sentry **20% — DSN pas set**, SMS **0%**). 5 P0 launch-blockers identifiés (no PDF receipt, walk-in flow broken `client_id NOT NULL`, tips reconciliation, no self-service reschedule, multi-currency hardcoded). 9 P1 day-one frictions (bulk cancel, loyalty expiry, refund UX combo, owner push notifs, public availability API, etc.). 16 P2 issues (race condition slot booking, audit log gaps, no SaaS billing, server-side validation gaps). Vercel design pivot : 10h minimum scope (80% alignment), 3-5 semaines pour 100%. Roadmap multi-phase **loops 13-22+ (phases 70-127)** détaillée avec effort estimates.
- ✅ **Phase 71 — Printable receipt** : `lib/security/signed-tokens.ts` étendu avec `kind='receipt'` (+ `'reschedule'`). Page `/[locale]/receipt/[token]` rend un reçu HTML avec `@media print` stylesheet (clean black-on-white A4, hides Print button when printing). Auto-print via `?print=1` query param. Logo + accent color du shop (Phase 62b) appliqués. Affiche subtotal / discount (promo+loyalty implicit) / tip / total + deposit balance. Pas de PDF lib lourde — Save-as-PDF du browser fait le job.
- ✅ **Phase 72 — Walk-in flow** : migration `appointments.client_id` nullable + nouvelle column `client_name_snapshot` (populée à l'insert, survit à l'anonymisation Loi 25 — comble le gap P2.30 du audit). Booking action populate snapshot automatiquement à partir de `first_name + last_name`. Calendar UI walk-in modal = V1.1.
- ✅ **Phase 73 — Tip reconciliation** : migration `appointments.tip_amount_cents` (integer DEFAULT 0, CHECK >= 0). Reçu (Phase 71) affiche déjà la ligne tip. Capture tip lors du paiement Stripe + breakdown dans finances per-barber = V1.1.
- ✅ **Phase 74 — Self-service reschedule** : page `/[locale]/reschedule/[token]` avec signed-token (kind='reschedule', 7-day TTL). Date strip 14 jours + slot grid (fetch via `/api/book/[shopSlug]/slots`). Action `reschedulePublicAppointment` re-vérifie token + rate-limit 15/10min + checkAvailability (exclut l'appointment lui-même). Block terminal-status (cancelled/completed/no_show). Preserve la durée originale (services ne changent pas via public flow).
- ✅ **Admin drawer enrichi** : 4 boutons publics maintenant (Receipt + Reschedule + Review + Self-service). `generatePublicLinks` retourne URLs pour les 4 kinds. Walk-ins skip /me link (no client_id). Receipt = 365d TTL, Reschedule = 7d TTL.

### Phase 29 — UI review / polish global (détail)

Passe de finition cross-écrans, à faire une fois que toutes les features fonctionnelles sont en main. Objectif : que l'app passe du « ça marche » au « ça se sent bon à utiliser », sans toucher au modèle de données ni casser le contrat des Server Actions.

**Axes** :
- **Animations & micro-interactions** : ouverture/fermeture Modal+Drawer en `transform+opacity` (pas de layout shift), toasts qui slide-in depuis bas-droite, chips de filtre avec transition `bg-color`, blocs de calendrier avec hover/active scale subtil, page transitions cohérentes. Évaluer `framer-motion` vs CSS pur (penche CSS pur — bundle).
- **Loading & empty states** : audit page-par-page que chaque async surface a un skeleton (déjà partiellement fait Phase 12) et chaque liste vide a un `EmptyState` avec icône + message + CTA (pas juste un `<p>No data</p>`).
- **Icônes** : audit cohérence `lucide-react` (mêmes tailles `h-4 w-4` ou `h-5 w-5`, pas de mélange), aria-label sur tout bouton icône-only, paire icône+label partout où l'icône seule est ambiguë.
- **Hiérarchie visuelle** : sur chaque écran, une seule action primaire (accent), le reste en `secondary` ou `ghost`. Pas de boutons accent qui se battent pour l'attention.
- **Spacing & density** : vérifier la rythmique verticale (gap-2/3/4/6) cohérente entre les pages — certaines pages denses (Products, Services) ont un rythme différent de Clients ou Settings.
- **Typography scale** : seulement les tailles du design system (`text-xs/sm/base/lg/xl/2xl`), pas de valeurs custom.
- **Hover/focus/active** : chaque élément interactif a un focus ring visible (clavier), un hover affordance (curseur + change subtil de bg), un état actif/pressed.
- **Mobile responsive** : audit chaque page à 360px / 768px / 1024px — sidebar drawer-able, tables → cartes, modals plein écran.
- **Accessibilité** : `axe-core` run sur le kitchen-sink + 5 pages clés, fix les critical issues, vérifier le tab order, ajouter `aria-current` sur la nav active.
- **Performance perçue** : `useTransition` / `useOptimistic` sur les Server Actions pour pas de bloc visuel pendant les mutations ; verify aucune liste ne re-render entièrement quand un item change (memo + key stable).
- **Branding cohérence** : logo Küa visible mais discret, palette accent partout via `--accent` (déjà fait V0), pas de couleur d'accent en dur.

**Critères de succès** : Lighthouse a11y > 95 sur 3 pages clés (Calendar, Clients, Booking public), axe-core 0 critique, ressenti subjectif sur un parcours « créer un RDV → encaisser » : aucune transition brutale, aucun flash de contenu, aucun bouton ambigu.

**Budget temps estimé** : 12-18 h (gros volume mais aucun risque, c'est du polish ciblé).
