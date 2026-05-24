# WIDGET-SPEC — Booking widget intégrable (Phase 10)

> Spec capturée à partir des screenshots Squire fournis par l'utilisateur.
> **Phase 10** — à implémenter après Phase 6b. Demande explicite :
>
> 1. Widget bookable intégrable dans un site web tiers (iframe ou snippet JS).
> 2. Page admin dans l'app pour personnaliser le design/layout du widget.
> 3. Connecté au même backend que `/book/[shopSlug]` (employés, calendrier,
>    services, tips, paiement online).
> 4. Améliorations UX du wizard (cf. screenshots Squire) — voir §3 ci-dessous.

---

## 1. Architecture

### 1.1 Page widget rendue
- Route dédiée : `app/[locale]/embed/[shopSlug]/page.tsx`
- Différences avec `/book/[shopSlug]` :
  - **Pas de layout app** (pas de header, pas de footer, pas de skip-link)
  - Header X-Frame-Options : remplacé par `Content-Security-Policy: frame-ancestors *` (ou whitelist via shop config)
  - Optimisée mobile + petits écrans embed (300–500 px de large)
  - Auto-resize : émet `postMessage({ height })` au parent pour ajuster l'iframe

### 1.2 Snippet JS embarquable
- Fichier statique servi à `https://<domain>/widget.js`
- Usage côté site tiers :
  ```html
  <div data-kua-widget="axum"></div>
  <script src="https://kua-coif.vercel.app/widget.js" async></script>
  ```
- Le snippet :
  - Trouve `[data-kua-widget]`
  - Insère un `<iframe>` pointant vers `https://kua-coif.vercel.app/fr/embed/axum`
  - Écoute le `postMessage({ height })` et redimensionne l'iframe
  - Optionnel : `data-theme="dark|light"`, `data-locale="fr|en"`

### 1.3 CSP / X-Frame
- `embed/*` doit autoriser l'embed cross-origin
- Variante CSP : `frame-ancestors 'self' https://*.domain-tiers.com` (whitelist via `shops.widget_allowed_origins` JSONB array)
- Sinon : `frame-ancestors *` en V1 (warning : permissif)

---

## 2. Page admin de personnalisation

### 2.1 Localisation
- Soit dans `/marketing` (placeholder existant)
- Soit `/settings/widget` (nouveau, plus logique)

### 2.2 Champs configurables (par shop)
Une nouvelle table `widget_settings` ou colonne JSONB `widget_config` sur `shops` :

```ts
type WidgetConfig = {
  // Identity
  display_name?: string;        // override du nom du shop dans le header widget
  show_address: boolean;
  show_phone: boolean;

  // Theme
  mode: 'dark' | 'light' | 'auto';
  accent_color?: string;        // hex — surcharge --accent
  font_family?: 'system' | 'geist' | 'inter';
  border_radius: 'sharp' | 'rounded' | 'pill';

  // Steps
  show_professional_first: boolean;  // sinon : service first (default)
  allow_multi_service: boolean;
  show_tip_step: boolean;
  show_promo_code: boolean;

  // Behavior
  default_locale: 'fr' | 'en';
  allowed_origins: string[];    // pour CSP frame-ancestors
};
```

### 2.3 Preview live
- Split view : config à gauche, iframe `embed/[shopSlug]?preview=1` à droite
- Mise à jour en temps réel via `postMessage({ config })` au lieu de reload

### 2.4 Snippet à copier-coller
- Bouton « Copier le code d'intégration »
- Génère un snippet personnalisé avec les bons `data-*` attributes

---

## 3. Améliorations UX du wizard (vues Squire)

Les screenshots montrent un flow différent de notre implémentation actuelle.
À aligner :

### 3.1 Step 1 — « Choose a professional » avant les services
- Carte « Shuffle / Any » en premier (matche `allow_booking_any_barber`)
- Une carte par barbier avec **avatar circulaire** + nom + disponibilité du jour
  (« Available Today », « Available Tuesday May 26 »)
- ⚠️ Notre wizard actuel met services d'abord ; option `show_professional_first` rendra ça configurable

### 3.2 Step 2 — Service primary + « Anything you wish to add ? »
- Une fois un service choisi, **bandeau bleu en haut** avec ce service (avec X pour retirer)
- En dessous : « Anything you wish to add? » + cartes secondaires
- Multi-service grouping plus naturel qu'une multi-checkbox

### 3.3 Step 3 — « Your order » récap dark
- Carte profil pro (avatar + nom) + service + prix à droite
- Section « Add guest to order » (multi-personne, V1.2)
- Subtotal + bouton « Choose a time » plein largeur

### 3.4 Step 4 — Date strip + slots avec icônes contextuelles
- Date strip horizontale avec dimanche grisé/passé
- Slots affichés par tranches avec icônes :
  - ☀️ matin (jusqu'à 11h)
  - ☼ après-midi (11h–17h)
  - 🌙 soir (17h+)
- Format am/pm (selon `shop.date_format`)

### 3.5 Step 5 — Tip optionnel
- 4 options pré-calculées via `lib/business/tips.ts` (déjà testé)
- Activable par `widget_config.show_tip_step`

### 3.6 Step 6 — Paiement online (Stripe)
- Sortie du scope MVP (Stripe Connect = post-V1)
- Hook prêt dans la page Payments existante

---

## 4. Sécurité

- **CORS** sur les routes `/api/book/*` : autoriser les origines listées dans
  `shops.widget_allowed_origins`.
- **Rate limit déjà en place** (10/10min/IP sur booking, 30/min/IP sur slots).
- **CSP `frame-ancestors`** lit la whitelist par shop avant de servir la page
  embed → empêche l'iframing par n'importe qui.
- Honeypot + Turnstile : pareil que `/book/[shopSlug]`.

---

## 5. Implémentation suggérée (Phase 10)

Ordre proposé :

1. **Migration SQL** : ajouter `widget_config jsonb` à `shops` + default `{}`.
2. **Service de config** : `lib/business/widget-config.ts` pour parser /
   merger les defaults.
3. **Page admin** `/settings/widget` : form + live preview iframe.
4. **Page widget** `app/[locale]/embed/[shopSlug]/page.tsx` : sans layout,
   thème dynamique injecté via CSS vars depuis `widget_config`.
5. **Snippet JS statique** `public/widget.js` : injection iframe + postMessage
   resize.
6. **CSP frame-ancestors dynamique** : middleware lit le slug et adapte le
   header.
7. **Améliorations UX** wizard (§3) en parallèle — peuvent landé
   indépendamment dans `/book/[shopSlug]` avant d'être copiées vers
   `/embed/`.
8. **Tests Playwright** sur le widget embedded dans une page demo.

Estimation : 8–15h selon l'ampleur des améliorations UX.

---

## 6. Notes business

- Vendre le widget = différenciateur fort vs concurrents (Squire, Boulevard).
- Sticky : une fois embarqué sur le site du salon, ils changent rarement.
- Pricing potentiel : "Booking sur ton site" = upsell vs plan de base.

---

## 7. Hors scope explicite

- Multi-tenant widget (un seul widget pour plusieurs shops) — pas demandé.
- App native iOS/Android — pas demandé, l'app reste web-only.
- Paiement off-Stripe — pas demandé.
