# SPEC — Plateforme de gestion pour salons de coiffure / barbershops

> Ce fichier est le cahier des charges destiné à **Claude Code**. Il décrit une application web back-office (admin) + booking public pour barbershops/salons, inspirée de l'interface Squire. Lis-le **entièrement** avant d'écrire du code (il se termine par une ANNEXE de fidélité visuelle + données de seed exactes — en cas de doute sur une valeur précise, l'annexe fait autorité). Suis le plan d'exécution par phases — **ne saute pas de phase**.

---

## 0. Contexte produit

Application SaaS multi-tenant vendue aux salons de coiffure/barbershops du Québec. Chaque salon (« shop ») a des barbiers, des clients, des services, des produits, un calendrier de rendez-vous, et une page de réservation publique. L'app remplace un POS/gestionnaire de salon. Interface bilingue FR/EN (FR par défaut au Québec).

**Personas :**
- **Owner/Manager** : accès total (réglages, finances, staff).
- **Barber/Staff** : accès limité (son calendrier, ses clients, ses commissions).
- **Client final** : réserve via la page publique (pas de login admin).

---

## 1. Stack technique (imposé)

- **Framework** : Next.js 14+ (App Router) + TypeScript strict.
- **Styling** : Tailwind CSS. Tous les tokens couleur passent par des variables CSS (voir §2).
- **UI primitives** : composants maison + `lucide-react` pour les icônes. Pas de lib lourde.
- **Backend/DB** : Supabase (Postgres, Auth, Row Level Security, Storage pour images).
- **State serveur** : React Server Components + Server Actions là où possible ; `@tanstack/react-query` pour le state client interactif (calendrier, tableaux).
- **Forms** : `react-hook-form` + `zod` pour validation.
- **Dates** : `date-fns` + `date-fns-tz` (gestion timezone shop, ex. America/Toronto).
- **Tables** : `@tanstack/react-table` pour les grilles denses (Products, Services, Clients).
- **Drag & drop** : `@dnd-kit/core` (réordonner services/barbiers).
- **i18n** : `next-intl`. Locales `fr` et `en`. FR par défaut.
- **Tests** : Vitest (unit) + Playwright (e2e sur 2-3 parcours critiques).

Pas de FastAPI, pas de backend séparé : tout vit dans Next.js + Supabase.

---

## 2. Design system

Thème **dark only** (V1). Branding **Küa**.

### Tokens couleur (CSS vars dans `globals.css`)

```css
:root {
  /* Surfaces */
  --bg-base:        #1b1b1b;   /* fond global */
  --bg-surface:     #222222;   /* cartes, rangées */
  --bg-surface-2:   #2a2a2a;   /* hover, inputs */
  --bg-elevated:    #2f2f2f;   /* dropdowns, modals */
  --border:         #383838;   /* séparateurs, contours */

  /* Texte */
  --text-primary:   #f5f5f5;
  --text-secondary: #a0a0a0;
  --text-muted:     #6b6b6b;

  /* Accent (Küa purple) — UN SEUL endroit à changer pour rebrand */
  --accent:         #8b5cf6;
  --accent-hover:   #7c4ddb;
  --accent-fg:      #ffffff;   /* texte sur accent */
  --accent-subtle:  rgba(139, 92, 246, 0.15);

  /* Statuts */
  --success:        #22c55e;
  --warning:        #f59e0b;
  --danger:         #ef4444;
  --info:           #3b82f6;

  /* Calendrier (blocs RDV) */
  --appt-green:     #1e3a32;
  --appt-purple:    #2e2348;
  --appt-blue:      #1e2a3a;

  /* Layout */
  --sidebar-w:      64px;
  --sidebar-w-open: 220px;
  --header-h:       72px;
  --radius:         8px;
  --radius-sm:      6px;
}
```

> **Règle de rebrand** : tout l'accent du produit doit pointer vers `--accent`. Pour vendre à un autre salon, on change uniquement ces 4 lignes. Aucune couleur d'accent en dur dans les composants.

### Typographie
- Sans-serif système / `Geist` (cohérent avec la charte Küa). Tailles : titres page `24px/600`, headers tableaux `12px/600 uppercase tracking-wide` couleur `--text-muted`, corps `14px/400`, données `14px/500`.

### Composants partagés à construire (`/components/ui`)
- `Sidebar` (icon-rail collapsible, largeur `--sidebar-w` → `--sidebar-w-open`, item actif = barre/point accent).
- `PageHeader` (titre gauche · `SearchBar` centre optionnel · slot actions droite · `SectionSwitcher` dropdown droite quand la page a des sous-vues).
- `Button` (variants : `primary` fond accent, `secondary` fond surface bordé, `ghost`, `danger`).
- `Toggle` (switch iOS-style, on = accent).
- `Checkbox` (carré, coché = accent).
- `RadioGroup`.
- `Input`, `Select`, `MoneyInput` (préfixe `$`), `PercentInput` (préfixe `%`), `PhoneInput` (drapeau pays + format NANP `+1 ### ### ####`), `TimeRangeSelect` (heures/minutes en deux dropdowns), `DateRangePicker`.
- `DataTable` (header sticky, tri, lignes zébrées subtiles, hover surface-2, état vide, pagination, drag-handle optionnel).
- `Card` / `Modal` / `Drawer` / `Tabs` / `Badge` (ex. badge "New", "VERIFIED").
- `FabButtons` (deux FAB bas-droite : support chat vert + accès POS/caisse accent — purement décoratifs/liens en V1).
- `EmptyState`, `Toast`, `ConfirmDialog`, `LoadingSkeleton`.

### Layout général
- Sidebar fixe gauche. Zone contenu avec `PageHeader` collant en haut. Fond `--bg-base`.
- Densité élevée façon desktop pro. Responsive : sidebar → drawer mobile, tableaux → cartes empilées sous `md`.

---

## 3. Modèle de données (Supabase / Postgres)

Multi-tenant via `shop_id` + RLS (un user ne voit que les données de ses shops). Schéma indicatif — adapte les types au besoin.

```
shops               id, name, alias, website, phone, email, instagram, yelp_id,
                    timezone, date_format(enum USA/EU), logo_url, description,
                    inventory_alert_email, inventory_alert_phone,
                    default_cash_drawer_balance, default_language,
                    supported_languages(text[]),
                    -- options
                    age_21_only(bool), allow_booking_any_barber(bool), gross_up_fees(bool),
                    use_prod_price_in_tips(bool), use_taxes_in_tips(bool),
                    client_reviews(bool), payout_discount_mode(enum split/shop/barber),
                    -- location
                    country, street, street2, municipality, province, postal_code,
                    created_at

shop_hours          id, shop_id, weekday(0-6), enabled, open_time, close_time
shop_days_off       id, shop_id, date, reason

users               id (= supabase auth uid), email, full_name, role(owner/manager/barber)
shop_members        id, shop_id, user_id, role, status(confirmed/staff/deleted), sort_order

barbers             id, shop_id, user_id(nullable), display_name, email, phone,
                    avatar_url, personnel_id, sort_order, status(confirmed/staff/deleted)

barber_settings     id, barber_id|shop_id(scope), allow_booking_wo_payment(bool),
                    booking_tip(bool), confirmation_tip(bool), allow_multiple_services(bool),
                    client_booking_interval_min, barber_booking_interval_min,
                    days_book_in_advance, mins_book_before_appt,
                    customer_cancellations(bool), mins_cancel_before_appt,
                    reminder1_h, reminder1_m, reminder2_h, reminder2_m
                    -- une ligne "Shop" sert de défaut, override par barbier

service_categories  id, shop_id, name, sort_order  (ex. "senior stylist", "junioir barber", "stylist")
services            id, shop_id, category_id, name, duration_min, price,
                    status(enabled/disabled), sort_order
service_taxes       service_id, tax_id            (M:N)

product_brands      id, shop_id, name             (AURA, OLIVE OIL, PUREPOUSSE, STMNT)
product_categories  id, shop_id, name             (AFRO, CAUCASIEN)
products            id, shop_id, brand_id, category_id, name, price, supply_price,
                    current_inventory, low_inventory_threshold, sku
product_taxes       product_id, tax_id            (M:N)

taxes               id, shop_id, name, percentage, add_to_price(bool),
                    external_orders_only(bool), enabled(bool)   (TPS 5, TVQ 9.975)

clients             id, shop_id, first_name, last_name, email, phone, notes, created_at

appointments        id, shop_id, barber_id, client_id, start_at, end_at,
                    status(booked/confirmed/arrived/completed/cancelled/no_show),
                    notes, source(admin/online), total_amount
appointment_services appointment_id, service_id, price_snapshot   (M:N)
blocked_time        id, shop_id, barber_id(nullable), start_at, end_at, reason

discounts           id, shop_id, name, type(percent/fixed), value,
                    assignment(services_only/products_only/both)
promo_codes         id, shop_id, code, type(percent/fixed), value,
                    first_appointment_only(bool), one_time(bool),
                    expiration_date(nullable), redemptions(int), total_redemption_value
loyalty_program     id, shop_id, enabled, type(transaction/value),
                    goal_count, min_transaction_amount, reward_amount,
                    include_product_sales(bool), include_tips(bool)

commission_tiers    id, shop_id, barber_id, scope(services/products),
                    cumulative(bool),
                    tier1_threshold, tier1_pct, ... tier5_threshold, tier5_pct

tips_config         id, shop_id, round_up(bool),
                    pct_tier1..4, pct_use_above_amount,
                    flat_tier1..4,
                    booking_tip(bool), confirmation_tip(bool)

payment_profiles    id, shop_id, legal_name, business_type, tax_id_provided(bool),
                    sin_provided(bool), dob, verified(bool),
                    destination_bank_name, destination_last4
notification_prefs  id, shop_id, event(confirm/reschedule/cancel/arrived),
                    email(bool), push(bool)
```

RLS : chaque table avec `shop_id` → policy `shop_id IN (select shop_id from shop_members where user_id = auth.uid())`.

---

## 4. Navigation

### Sidebar (icônes, ordre exact)
1. **Appointments** (calendrier) — `/`
2. **Clients** — `/clients`
3. **Services** (ciseaux) — `/services`
4. **Barbers** (liste/staff) — `/barbers`
5. **Products** (box) — `/products`
6. **Support** (bouée) — `/support`
7. **Settings** (engrenage) — `/settings/*`
8. **Marketing/extra** (triangle) — `/marketing` (placeholder)
9. **Finances** (dollar, pastille notif) — `/finances`
10. **Logout** (bas)

### Settings = sous-menu déroulant (depuis l'écran 1 « admin dropdown »)
`Shop details · User Settings(badge New) · Barber settings · Taxes · Payment Processing · Commission/Tip Splits · Change Password · Discounts · Loyalty Program · Waiting List · Promo Codes`
→ routes `/settings/shop`, `/settings/users`, `/settings/barbers`, `/settings/taxes`, `/settings/payments`, `/settings/commissions`, `/settings/password`, `/settings/discounts`, `/settings/loyalty`, `/settings/waiting-list`, `/settings/promo-codes`.

Pages multi-vues (Products, Clients) ont un **SectionSwitcher** en haut à droite (dropdown qui change la sous-vue : Products ⇄ Brands ⇄ Categories ; Clients ⇄ autres listes).

---

## 5. Écrans détaillés (les 17 + booking public)

### A. Appointments (`/`) — écran principal
- Toggle de vue : **Side by Side** (défaut) · **Week** · **List**.
- Filtre **Barbers** (dropdown multi-select). Boutons **Block time** et **Waiting List**.
- Navigation date : icône calendrier · **Today** · flèches préc/suiv · libellé « Fri May 22nd 2026 ».
- **Side by Side** : une colonne par barbier (header = pastille + nom). Axe vertical = heures (slots ~ selon `client_booking_interval`, ex. 6:15a → soir). Blocs RDV positionnés selon start/end, hauteur ∝ durée. Bloc affiche : nom client (gras), service(s), plage horaire à droite, petite icône statut. Couleur de bloc = `--appt-green/purple/blue` selon statut/service. Clic bloc → drawer détail RDV. Clic slot vide → modal création.
- **Week** : grille 7 jours pour le barbier/filtre sélectionné. **List** : tableau chronologique.
- **Add appointment** (header) : modal → choisir client (search/créer), barbier, service(s) (durée auto-calculée), date/heure, notes. Détecter conflits.
- Drag pour déplacer/redimensionner un RDV (V1.1 si trop lourd, sinon édition par modal).

### B. Clients (`/clients`)
- Barre A–Z cliquable (filtre par 1re lettre). Compteur total (« TOTAL A-Z (1896) »).
- Tableau : Client (avatar/icône + nom) · Email · Phone. Pagination (« TOTAL (227) · PAGE 1 OF 5 »).
- Actions : **Add client**, **Locate Duplicates** (détecte doublons par phone/email), **Download** (export CSV).
- Search global. Clic ligne → fiche client (historique RDV, total dépensé, notes, loyalty).

### C. Services (`/services`)
- Tableau : drag-handle (Sort) · Service name · Duration · Price · Tax (multi-lignes ex. « TVQ 9.975% / TPS 5% ») · Category · Status (Enabled/Disabled).
- Boutons : **Categories** (ouvre gestion des `service_categories`), **Reset service order**, **Export to csv**, **Add Service**.
- Add/Edit service : nom, catégorie, durée (min), prix, taxes applicables (multi), statut. Réordonnable par drag (`sort_order`).

### D. Barbers (`/barbers`)
- Onglets : **Confirmed** · **Staff** · **Deleted**.
- Tableau : drag-handle (Sort) · Barber (avatar + nom) · Email · Phone · Personnel ID.
- **Add barber** : invite par email, infos contact, avatar.

### E. Products (`/products`) + sous-vues Brands & Categories
- Header SectionSwitcher : **Products / Brands / Categories**.
- **Products** : barre d'outils → **Stock Taking**, **New Inventory**, **Low Inventory Report (n)**, indicateurs **Retail Value** + **Wholesale (Supply) Value**, **Export to csv**, **Create PO**, **Add product**.
  - Tableau : Name · Price · Supply Price · Current Inv. · Low Inv. · SKU · Tax (multi) · Category · Brand. Tri par colonne. Lignes sous le seuil → indicateur "low".
- **Brands** : liste nom + **Add brand**.
- **Categories** : liste nom + **Add category**.

### F. Taxes (`/settings/taxes`)
- Tableau : Tax name · (checkbox sélection) · Percentage · **Add to price** (checkbox) · **External orders only** (checkbox) · **Enabled** (checkbox). **Add tax**.
- Seed : TPS 5 (add_to_price, enabled), TVQ 9.975 (add_to_price, enabled).

### G. Payment Processing (`/settings/payments`)
- Carte profil : avatar initiales, nom, badge **VERIFIED**, SIN (Not Provided/Provided), DOB, phone, email, date création.
- Carte **Business details** : badge COMPANY, legal name, Business Number (Tax ID) Provided/✗, « See more details ».
- Encart **Rapid Transfer** (promo) + bouton **Activate Rapid Transfer** + liens légaux.
- **Destination accounts** : banque + `•••• last4`.
- V1 : lecture/affichage + édition infos business. Pas d'intégration paiement réelle (placeholder Stripe Connect plus tard).

### H. Commission/Tip Splits (`/settings/commissions`)
- Titre « Commission Tiers ». Toggle **Cumulative Commission**. Onglets **Services** / **Products**.
- Grille : une ligne par barbier × 5 tiers. Chaque tier = 2 champs : seuil **$** + commission **%**. Scroll horizontal. **Cancel** / **Save**.
- Section **Tips** (peut vivre ici ou dans Shop details — voir maquette 15) : Percentage tiers (15/18/20/25), « Use Percentage Tiers Above $ », Flat tiers (2/3/4/5), Round up tips, Booking tip / Confirmation tip toggles.

### I. Discounts (`/settings/discounts`)
- Tableau : Name · Value (% ou $) · Assignment (Services Only/Products Only/Both). **Add discount**.

### J. Loyalty Program (`/settings/loyalty`)
- Toggle **Enabled**. Type radio **Transaction based** / **Value based**.
- Champs : Number of transactions to the goal · Minimum transaction amount ($) · Reward amount ($).
- Toggles **Include product sales**, **Include tips**. **Save**.

### K. Waiting List (`/settings/waiting-list`)
- Toggle **Enabled** · **Waiting list threshold** (dropdown heures) · **Save**.

### L. Promo Codes (`/settings/promo-codes`)
- DateRange + **Submit** + **Export to CSV** + **Add Promo Code**.
- Tableau : Promo name · Value · First appointment only (checkbox) · One time promo (checkbox) · Expiration date · Redemptions · Total redemption value.

### M. Barber settings (`/settings/barbers`)
- Grille dense : une ligne **Shop** (défaut) puis une par barbier. Colonnes (toggles + dropdowns) :
  Allow booking w/o payment · Booking tip · Confirmation tip · Allow multiple services · Client booking interval (dropdown) · Barber booking interval (dropdown) · Days client can book in advance (input) · Mins a client can book before hand (h+m dropdowns) · Customer cancellations (toggle) · Mins clients can cancel before appt (h+m) · 1st client reminder (h+m) · 2nd client reminder (h+m).
- **Override barber settings** (applique défaut Shop à tous) + **Save**. Tooltips ⓘ sur certaines colonnes.

### N. Shop details (`/settings/shop`) — gros formulaire
Sections : **Media** (logo upload) · infos (Shop name*, Alias, Website, Phone, Email, Yelp ID, Instagram, Timezone, Date format, Inventory alert email/phone, Default cash drawer balance, Description) · **Preferred notification methods** (matrice Email/Push pour Confirm/Reschedule/Cancel/Arrived + reminders client 1er/2e avec délais) · **Schedule** (start/end date + 7 jours avec toggle + open/close) · **Days Off** (liste + add) · **Business Location** (Country, Street, Street2, Municipality, Province, Postal code) · **Language Settings** (supported + default) · **Options** (toggles : 21+ only, Allow booking with any barber, Gross Up Fees, Use Prod. Price in Calc. Tips, Use Taxes in Calculation of Tips, Client Reviews ; Payout discount mode dropdown) · **Tips** (voir §H). **Cancel** / **Save**.

### O. User Settings (`/settings/users`) — badge "New"
- Gestion des comptes/permissions des membres du shop (rôles owner/manager/barber, invitations).

### P. Change Password (`/settings/password`)
- Formulaire mot de passe actuel / nouveau / confirmation (via Supabase Auth).

### Q. Admin dropdown (écran 1)
- C'est le **SectionSwitcher des settings** : panneau déroulant listant toutes les sous-sections, item actif marqué d'un point accent, badge "New" sur User Settings.

### R. Booking public (`/book/[shopSlug]`) — NOUVEAU module
Parcours client sans login : choisir service(s) → choisir barbier (ou « any ») → choisir créneau (selon dispo réelle, intervalles, délais de barber_settings) → infos client (créer/retrouver) → tip optionnel (selon config) → promo code → confirmation. Crée un `appointment` avec `source=online`. Respecte timezone shop, jours off, horaires.

---

## 6. Règles métier transverses
- **Taxes** : multi-taxes par item (TPS+TVQ). `add_to_price` ⇒ taxe ajoutée au prix affiché. Calcul cohérent partout (panier, RDV, produits).
- **Devise** : CAD, format `$#,###.##`. **Téléphone** : NANP `+1 ### ### ####`.
- **Disponibilités** : un créneau est libre si pas de chevauchement appointment/blocked_time pour ce barbier, dans horaires shop, hors days_off, en respectant `client_booking_interval`, `days_book_in_advance`, `mins_book_before_appt`.
- **Annulation client** : autorisée seulement si `customer_cancellations` et délai > `mins_cancel_before_appt`.
- **Commissions** : par tier sur CA du barbier ; `cumulative` change le mode de calcul (paliers cumulés vs tier atteint). Scope services/products séparé.
- **i18n** : toutes les chaînes via `next-intl`. Aucune string en dur.

---

## 7. Plan d'exécution par phases (SUIVRE DANS L'ORDRE)

> Après **chaque** phase : `npm run build` doit passer, commit git avec message clair. Ne commence pas une phase tant que la précédente ne compile pas.

**Phase 0 — Bootstrap**
- Init Next.js 14 + TS + Tailwind. Configurer `globals.css` avec les tokens §2. Setup Supabase client (server + browser). Setup `next-intl` (fr/en). ESLint/Prettier. Structure dossiers : `app/`, `components/ui/`, `components/features/`, `lib/`, `db/`, `messages/`.

**Phase 1 — Design system**
- Construire TOUS les composants `/components/ui` du §2 avec une page `/_kitchen-sink` qui les affiche tous (pour vérif visuelle). Sidebar + PageHeader + layout shell fonctionnels avec navigation entre routes (pages vides).

**Phase 2 — Base de données**
- Écrire les migrations SQL Supabase pour tout le §3. Activer RLS + policies. Script de **seed** : 1 shop (« Axum barbershop », Montréal, America/Toronto), taxes TPS/TVQ, 3 catégories services, ~15 services, 4 brands, 2 catégories produits, ~15 produits, 4 barbiers, ~30 clients, quelques RDV sur la semaine courante. Générer types TS depuis Supabase.

**Phase 3 — Auth & shell**
- Login/logout Supabase. Garde de route. Récupération du shop courant + membres. Layout authentifié avec sidebar live.

**Phase 4 — Core CRUD (le plus de valeur)**
- Services (D), Barbers (E... = écran D), Products + Brands + Categories (E), Clients (B). DataTables complètes : tri, search, pagination, drag-order, add/edit modals, CSV export.

**Phase 5 — Calendrier**
- Appointments (A) : vue Side by Side d'abord (la plus dure), puis Week, puis List. Création/édition RDV, détection conflits, Block time. Moteur de disponibilité (§6).

**Phase 6 — Settings**
- Shop details (N), Taxes (F), Barber settings (M), Discounts (I), Loyalty (J), Waiting List (K), Promo Codes (L), Change Password (P), User Settings (O), Admin dropdown/SectionSwitcher (Q).

**Phase 7 — Finances**
- Commission/Tip Splits (H), Payment Processing (G, affichage + édition business, sans intégration paiement réelle).

**Phase 8 — Booking public**
- Module R : parcours complet client, branché sur le moteur de dispo.

**Phase 9 — Polish & tests**
- Responsive mobile, états vides, skeletons, toasts, FAB. Tests Vitest sur calcul taxes/commissions/dispo. Playwright sur : login→créer RDV, booking public, add product. README.

---

## 8. Contraintes pour Claude Code
- Travaille **phase par phase**, commit à chaque fin de phase.
- N'invente pas de couleurs : utilise les CSS vars. Accent toujours via `--accent`.
- Composants réutilisables d'abord, écrans ensuite.
- Mobile-friendly mais desktop-first (outil pro).
- Tout texte UI passe par i18n (fr défaut).
- Si une décision produit est ambiguë, choisis l'option la plus simple qui respecte les maquettes, documente-la dans `DECISIONS.md`, et continue (ne bloque pas).
- Données sensibles (SIN, tax id) : ne jamais logger, masquer à l'affichage.


---

# ANNEXE — Fidélité visuelle & données de seed exactes

> Relevé image par image des **valeurs exactes** et **comportements visuels fins** observés dans l'app de référence (Axum barbershop sur Squire). En cas de doute sur une valeur ou un comportement précis, **cette annexe fait autorité**. Le §SEED (Partie 2) doit être implémenté tel quel en Phase 2.

---

## Partie 1 — Détails visuels par écran

### Image 1 — Admin dropdown (SectionSwitcher settings)
- Panneau déroulant fond `--bg-elevated`, items séparés par fines lignes `--border`.
- Item **actif** = texte blanc gras + **point rond accent plein** à droite ; items **inactifs** = texte gris + point gris creux à droite.
- **User Settings** porte un badge pilule **« New »** (fond bleu, texte noir) à droite du label.
- Le header du dropdown répète le titre de la sous-section active avec un chevron ↑/↓ pour replier.
- Ordre exact des items : Shop details · User Settings · Barber settings · Taxes · Payment Processing · Commission/Tip Splits · Change Password · Discounts · Loyalty Program · Waiting List · Promo Codes.

### Images 2 & 3 — Brands / Categories
- SectionSwitcher haut-droite : libellé courant (« Brands » / « Categories ») + chevron ↓.
- Liste très épurée : header colonne unique **« NAME »** avec caret de tri ↑.
- Chaque entrée = rangée pleine largeur fond `--bg-surface`, texte blanc, espacée. Pas de colonnes secondaires.
- Bouton **« Add brand »** / **« Add category »** accent, haut-droite (un faux libellé centré « Add brand » apparaît aussi près du centre — c'est un artefact, garder un seul bouton réel à droite).
- **Brands** (4) : `AURA`, `OLIVE OIL`, `PUREPOUSSE`, `STMNT`.
- **Categories** (2) : `AFRO`, `CAUCASIEN`.

### Image 4 — Clients
- Barre alphabet **A–Z**, chaque lettre dans une case bordée accent ; lettre active = fond accent plein, texte blanc.
- Deux compteurs : **« TOTAL A-Z (1896) »** (grand total tous clients) et **« TOTAL (227) / PAGE 1 OF 5 »** (sous-ensemble lettre filtrée + pagination).
- Boutons : **Add client** (accent, dans le header), **Locate Duplicates** (secondaire), **Download** (accent) + icône **?** d'aide à côté.
- Colonnes : **CLIENT** (icône contact + nom) · **EMAIL** · **PHONE**.
- Téléphones au format `+1 ### ### ####`. Noter que des doublons existent (deux « Aaron O » avec le même téléphone `+1 873 376 1256` mais emails différents) → justifie la feature Locate Duplicates.
- Certains clients sans email (ex. « abdella ») : email peut être vide.

### Image 5 — Commission Splits (Commission Tiers)
- Toggle **« Cumulative Commission »** (OFF dans la capture).
- Onglets **Services** (actif, souligné accent) / **Products**.
- Grille : colonne nom barbier à gauche, puis **5 tiers**, chaque tier = **2 inputs côte à côte** : montant **`$`** (seuil) + **`%`** (commission). Scroll horizontal (chevrons ‹ ›).
- **Valeurs exactes par barbier (Services)** :
  - **Olivier** : T1 `$0.00 / 55%` · T2 `$1,000 / 60%` · T3 `$2,000 / 65%` · T4 `$2,500 / 70%` · T5 `$30,000 / 100%`
  - **Witzson Beaubrun** : T1 `$0.00 / 55%` · T2 `$1,000 / 60%` · T3 `$2,000 / 65%` · T4 `$2,500 / 70%` · T5 `$3,000 / 100%`
  - **Elmer Martinez** : T1 `$0.00 / 55%` · T2 `$1,000 / 60%` · T3 `$2,000 / 65%` · T4 `$2,500 / 70%` · T5 `$3,000 / 100%`
  - **Arsh** : tous tiers à `$0.00 / 0%` (non configuré).
- Boutons bas-droite : **Cancel** (secondaire) / **Save** (accent).
- Note : seuls les 4 barbiers « confirmed » apparaissent (pas la ligne Shop ici).

### Image 6 — Discounts
- Colonnes : **NAME** · **VALUE** · **ASSIGNMENT**.
- **Données exactes** :
  - `1 referral` — **15%** — Services Only
  - `2 referral` — **35%** — Services Only
  - `First appointment` — **20%** — Services Only
  - `STUDENT DISCOUNT` — **$5.00** (montant FIXE, pas %) — Services Only
  - `custom amount` — **98%** — Services Only
- → confirme que `value` peut être **percent** OU **fixed** ($) : le champ `type` est indispensable. Tous en « Services Only » ici mais garder l'option Products/Both.
- Bouton **Add discount** accent haut-droite.

### Image 7 — Barber settings
- Première ligne = **« Shop »** (réglages par défaut), puis une ligne par barbier : **Arsh, Elmer M, Witzson B, Olivier**.
- Colonnes (gauche→droite) : **Allow booking w/o payment** (toggle) · **Booking tip** (toggle, ⓘ) · **Confirmation tip** (toggle, ⓘ) · **Allow multiple services** (toggle) · **Client booking interval** (select) · **Barber booking interval** (select) · **Days client can book in advance** (input num) · **Mins a client can book appt before hand** (2 selects h + m) · **Customer cancellations** (toggle) · **Mins a clients can cancel before appt time** (2 selects h + m) · **1st client reminder** (2 selects h + m) · **2nd client reminder** (2 selects h + m).
- **Valeurs par défaut observées (toutes lignes identiques sauf Confirmation tip)** :
  - Allow booking w/o payment = **ON** · Booking tip = **ON** · Allow multiple services = **ON** · Customer cancellations = **ON**
  - **Confirmation tip** = **ON pour « Shop » uniquement**, **OFF** pour Arsh / Elmer / Witzson / Olivier.
  - Client booking interval = **30 mins** · Barber booking interval = **15 mins**
  - Days book in advance = **30** · Mins book before hand = **0h 5m** · Mins cancel before = **5h 0m**
  - 1st client reminder = **24h 0m** · 2nd client reminder = **1h 0m**
- Bas-droite : **Override barber settings** (secondaire, ⓘ) + **Save** (accent).

### Image 8 — Barbers
- Onglets : **Confirmed** (actif, souligné accent) · **Staff** · **Deleted**.
- Colonnes : **SORT** (poignée drag ⇅) · **BARBER** (avatar rond photo + nom) · **EMAIL** · **PHONE** · **PERSONNEL ID** (vide pour tous ici).
- **Données exactes (Confirmed, dans cet ordre)** :
  - `Arsh` — arshdeepsingh03000@gmail.com — +1 514 699 4290
  - `Elmer Martinez` — elmernetch@gmail.com — +1 438 458 6664
  - `Witzson Beaubrun` — witzson.beaubrun@gmail.com — +1 438 866 5206
  - `Olivier` — Oliviertcheuffa.b@gmail.com — +1 514 452 3057
- **Add barber** accent haut-droite + search.

### Image 9 — Loyalty Program
- Toggle **Enabled** = **OFF** dans la capture.
- **TYPE** : radios **Transaction based** (sélectionné) / **Value based**.
- Champs : **Number of transactions to the goal** = **4** · **Minimum transaction amount** = **$30.00** · **Reward amount** = **$0.00**.
- Toggles **Include product sales** = OFF · **Include tips** = OFF.
- **Save** accent (apparaît grisé/désactivé quand programme OFF).

### Image 10 — Payment Processing
- Carte profil gauche : avatar initiales **« YT »** (cercle bleu), nom **Yossa-olivier Tcheuffa**, badge **VERIFIED** (vert) + ⓘ.
  - Social insurance number : **✗ Not Provided** (croix rouge)
  - Date of birth : **Aug 2, 1994**
  - Phone : **+15144523057**
  - Email : **oliviertcheuffa.b@gmail.com**
  - Date of creation : **Dec 20, 2024**
- Carte **Business details** (badge bleu **COMPANY**, icône crayon édition) :
  - Legal name : **Salon Axum inc.**
  - Business Number (Tax ID) : **✓ Provided** (check vert)
  - lien **« See more details »** (accent).
- Encart droite **« Do you want to receive your money faster? »** : texte Rapid Transfer (dispo balance 3×/jour, **frais 2%**), bouton **Activate Rapid Transfer** (secondaire blanc), liens **Enterprise Terms of Service / SULA / Privacy Policy**. Illustration portefeuille à droite.
- **Destination accounts** : icône banque + **ROYAL BANK OF CANADA** + **•••• 7277** + chevron ↓.

### Image 11 — Products
- Barre d'outils gauche : **Stock Taking** · **New Inventory** · **Low Inventory Report (7)** (le nombre = produits sous seuil).
- Au centre : **Retail Value $2,828.28** · **Wholesale (Supply) Value $2,399.80** (libellés gris, montants en dessous).
- Droite : **Export to csv** · **Create PO** · **Add product** (tous accent).
- Colonnes : **NAME** (tri caret) · **PRICE** · **SUPPLY PRICE** · **CURRENT INV.** · **LOW INV.** · **SKU** (vide partout ici) · **TAX** (peut afficher 2 lignes ex. `TVQ 9.975%` + `TPS 5%`) · **CATEGORY** · **BRAND**.
- **Données exactes** :
  | Name | Price | Supply | Cur.Inv | Low | Tax | Category | Brand |
  |---|---|---|---|---|---|---|---|
  | AFRO Comb | $10.00 | $0.00 | 5 | 3 | — | AFRO | — |
  | AURA POWDER (big) | $28.70 | $10.00 | 10 | 5 | TVQ 9.975% / TPS 5% | CAUCASIEN | AURA |
  | AURA POWDER (small) | $21.74 | $10.00 | 8 | 5 | TPS 5% / TVQ 9.975% | CAUCASIEN | AURA |
  | Curl Sponge | $10.00 | $5.00 | 13 | 5 | — | AFRO | — |
  | OLIVE OIL (mousse) | $13.05 | $4.00 | 17 | 5 | TVQ 9.975% / TPS 5% | AFRO | OLIVE OIL |
  | Purepousse BAUME | $36.56 | $46.55 | 5 | 3 | — | AFRO | PUREPOUSSE |
  | Purepousse ELIXIR | $46.55 | $46.55 | 1 | 3 | — | AFRO | PUREPOUSSE |
  | Purepousse LAIT | $36.55 | $46.55 | 8 | 3 | — | AFRO | PUREPOUSSE |
  | Purepousse MASQUE | $39.26 | $46.55 | 6 | 3 | — | AFRO | PUREPOUSSE |
  | Purepousse SHAMPOING | $32.50 | $46.55 | 7 | 3 | — | AFRO | PUREPOUSSE |
  | Purepousse SPRAY | $29.05 | $46.55 | 9 | 3 | — | AFRO | PUREPOUSSE |
  | Stint CLASSIC POMADE | $33.05 | $19.25 | 3 | 5 | TPS 5% / TVQ 9.975% | CAUCASIEN | STMNT |
  | Stmnt BEARD OIL | $28.70 | $16.25 | 1 | 5 | TVQ 9.975% / TPS 5% | CAUCASIEN | STMNT |
  | Stmnt CONDITIONER | $28.70 | $16.25 | 2 | 0 | TPS 5% / TVQ 9.975% | CAUCASIEN | STMNT |
- **Comportement low-stock** : quand `current_inventory <= low_inventory_threshold`, signaler la ligne (ex. valeur en rouge/orange). Plusieurs produits sont sous seuil (ELIXIR 1<3, POMADE 3<5, BEARD OIL 1<5) → cohérent avec « Low Inventory Report (7) ».
- **Marge négative possible** : plusieurs Purepousse ont supply_price > price → afficher un **avertissement discret** (icône warning) sur ces lignes, ne pas bloquer.

### Image 12 — Promo Codes
- Haut : **DateRange** (« Start 05/16/2026 - End 05/22/2026 ») + **Submit** + **Export to CSV** (accent) ; à droite **Add Promo Code** (accent).
- Colonnes : **PROMO NAME** · **VALUE** · **FIRST APPOINTMENT ONLY** (checkbox) · **ONE TIME PROMO** (checkbox) · **EXPIRATION DATE** · **REDEMPTIONS** · **TOTAL REDEMPTION VALUE**.
- **Donnée exacte** : `WELCOME20` — **20%** — First appt only **☑** — One time **☑** — Expiration **-** (aucune) — Redemptions **1** — Total **$6.09**.

### Image 13 — Appointments (Side by Side)
- Barre : **Side by Side** (actif, fond clair/blanc) · **Week** · **List** | dropdown **Barbers** | **Block time** | **Waiting List** | (droite) date **« Fri May 22nd 2026 »** + icône calendrier + **Today** + flèches ‹ ›.
- **Add appointment** accent en haut-droite + search.
- Colonnes barbiers (header = pastille colorée + nom) : **Arsh · Elmer Martinez · Witzson Beaubrun · Olivier**.
- Axe heures vertical à gauche, slots ~ toutes les heures avec sous-graduations (ex. `6:15a`, `7:15a`, `8:15a`, `9:15a`, `10:15a`...).
- **Blocs RDV** : fond vert sombre `--appt-green` OU violet sombre `--appt-purple`, avec une **barre latérale gauche colorée** (verte = confirmé/payé, violette = autre statut) + petite **icône carte/paiement verte en bas-droite** du bloc (indique mode de paiement/booking). Contenu : **nom client (gras)** + **service** + **plage horaire** (coin sup-droit, ex. `8:15am - 8:45am`).
- **RDV exacts visibles (22 mai 2026)** :
  - Olivier : `Jules Lethor` Haircut + Beard **8:15am-8:45am** ; `Drew Paris` Haircut + Beard **9:10am-9:55am** ; `tjo tjo` Haircut **10:30am-11am** ; `Glenn Nz` Haircut + Beard **11am-...**
  - Witzson Beaubrun : `Mohamed Toure` haircut + Beard **10am-10:45am** ; `Lito Gordon` haircut **11am-11:35am**
  - Elmer Martinez : `Nelson Kabuya` beard trim + line up **10:30am-11am**
  - Arsh : aucun RDV ce jour.
- Clic bloc → drawer détail ; clic slot vide → modal création.

### Image 14 — Services
- Boutons : **Categories** (accent) · **Reset service order** (secondaire) | (droite) **Export to csv** · **Add Service** (accent).
- Colonnes : **SORT** (poignée ⇅) · **SERVICE NAME** · **DURATION** · **PRICE** · **TAX** (2 lignes `TVQ 9.975%` / `TPS 5%`) · **CATEGORY** · **STATUS** (Enabled).
- **Données exactes** (toutes Enabled, toutes taxées TVQ 9.975% + TPS 5%) :
  | Service | Durée | Prix | Catégorie |
  |---|---|---|---|
  | Kid's Haircut | 30 min | $30.44 | senior stylist |
  | Beard Trim + Line Up | 30 min | $30.44 | senior stylist |
  | Haircut | 30 min | $34.79 | senior stylist |
  | Haircut + Beard | 45 min | $43.49 | senior stylist |
  | Scissors Haircut | 45 min | $39.14 | senior stylist |
  | Scissors Haircut + Beard | 60 min | $47.84 | senior stylist |
  | haircut | 45 min | $30.44 | junioir barber |
  | haircut + beard | 60 min | $39.14 | junioir barber |
  | kid's haircut | 35 min | $26.09 | junioir barber |
  | beard trim + lineup | 30 min | $26.09 | junioir barber |
  | full scissors | 60 min | $34.79 | junioir barber |
  | full scissors haircut + Beard | 75 min | $43.49 | junioir barber |
  | haircut | 35 min | $30.44 | stylist |
  | haircut + Beard | 45 min | $39.14 | stylist |
- 3 catégories de services : **senior stylist**, **junioir barber** (orthographe d'origine conservée), **stylist**.

### Image 15 — Shop details (formulaire long, scroll vertical)
Sections dans l'ordre :
1. **Media** : upload logo (image ronde).
2. Champs : **Shop name*** = `Axum barbershop` · **Shop alias** (vide) · **Website** = `https://www.axumbarbershop.com` · **Phone** = `+1 5144523057` (drapeau 🇨🇦) · **Email** = `oliviertcheuffa.b+1@gmail.com` · **Yelp ID** (vide) · **Instagram** = `axumsalon` · **Timezone** = `America/Toronto` · **Date format** = `USA` (select) · **Inventory alert email** (vide) · **Inventory alert phone** (🇨🇦) · **Default cash drawer balance** = `$0.00` · **Shop description** (vide).
3. **Preferred notification methods** — matrice checkboxes :
   - **CONFIRM** : Email ☐ / Push ☑
   - **RESCHEDULE** : Email ☐ / Push ☑
   - **CANCEL** : Email ☐ / Push ☐
   - **ARRIVED** : Email ☐ / Push ☐
   - **REMINDER** : Email ☑ / Push ☑ ; **REMIND:** `0h 15m`
   - **CLIENT NOTIFICATIONS** :
     - **1ST CLIENT REMINDER** : Email ☑ / Push ☑ ; `24h 0m`
     - **2ND CLIENT REMINDER** : Email ☑ / Push ☑ ; `1h 0m`
4. **Schedule** : **Starting date** `12/03/2024`, **Ending date** (vide). Par jour (checkbox + open + close) :
   - Sunday ☐ 9:00am–6:00pm · Monday ☐ 9:00am–6:00pm · **Tuesday ☑ 10:00am–7:00pm** · **Wednesday ☑ 10:00am–7:00pm** · **Thursday ☑ 10:00am–8:00pm** · **Friday ☑ 10:00am–8:00pm** · **Saturday ☑ 10:00am–5:00pm**.
5. **Days Off** : « No days off. » + lien **Add new day off** (accent ⊕).
6. **Business Location** : **Country*** `Canada` · **Street*** `3857 Boulevard Décarie` · **Street 2** (vide) · **Municipality*** `Montréal` · **Province*** `QC` · **Postal code*** `H4A 3J6`.
7. **Language Settings** : **Supported languages** (multi-select, vide affiché) · **Shop default language** = `English`.
8. **Options** (toggles) : **21+ only** = OFF · **Allow booking with any barber** = ON · **Gross Up Fees** = ON · **Use Prod. Price in Calc. Tips** = ON · **Use Taxes in Calculation of Tips** = ON · **Client Reviews** = ON (ⓘ) · **Payout Discount Mode** (select) = `Split Shop/Barber`.
9. **Tips** :
   - **Percentage Tiers** : Tier1 `15` · Tier2 `18` · Tier3 `20` · Tier4 `25` (en %). **Round up tips** = ON (ⓘ).
   - **Use Percentage Tiers Above** (ⓘ) `$10.00` (en dessous de ce montant → flat tiers).
   - **Flat Tiers** : Tier1 `$2.00` · Tier2 `$3.00` · Tier3 `$4.00` · Tier4 `$5.00`.
   - **Booking Tip** (« Displays tipping during the booking flow ») = ON.
   - **Confirmation Tip** (« Displays tipping on the confirmation page ») = ON.
10. Bas : **Cancel** / **Save** (accent).

### Image 16 — Taxes
- Colonnes : **TAX NAME** · (checkbox de sélection à gauche du % — sert à inclure la taxe dans la sélection/calcul) · **PERCENTAGE** · **ADD TO PRICE** (checkbox) · **EXTERNAL ORDERS ONLY** (checkbox) · **ENABLED** (checkbox).
- **Données exactes** :
  - **TPS** — sélection ☑ — **5** — Add to price ☑ — External orders only ☐ — Enabled ☑
  - **TVQ** — sélection ☑ — **9.975** — Add to price ☑ — External orders only ☐ — Enabled ☑
- **Add tax** accent haut-droite.

### Image 17 — Waiting List
- Carte centrée : toggle **Enabled** = **ON** · label **WAITING LIST THRESHOLD** · select = **3** · unité **hours** · **Save** (accent).

---

## Partie 2 — SEED exact (Phase 2)

> Implémenter ces données telles quelles. Shop = « Axum barbershop ».

**Shop** : name `Axum barbershop`, website `https://www.axumbarbershop.com`, phone `+15144523057`, email `oliviertcheuffa.b+1@gmail.com`, instagram `axumsalon`, timezone `America/Toronto`, date_format `USA`, default_language `English`, default_cash_drawer_balance `0`, country `Canada`, street `3857 Boulevard Décarie`, municipality `Montréal`, province `QC`, postal_code `H4A 3J6`, created_at `2024-12-03`. Options : age_21_only `false`, allow_booking_any_barber `true`, gross_up_fees `true`, use_prod_price_in_tips `true`, use_taxes_in_tips `true`, client_reviews `true`, payout_discount_mode `split`.

**shop_hours** : Sun off, Mon off, Tue 10–19, Wed 10–19, Thu 10–20, Fri 10–20, Sat 10–17.

**Taxes** : `TPS` 5% (add_to_price, enabled) ; `TVQ` 9.975% (add_to_price, enabled).

**service_categories** : `senior stylist`, `junioir barber`, `stylist` (orthographe conservée).

**services** : les 14 lignes du tableau Image 14 (toutes enabled, toutes avec TPS+TVQ).

**product_brands** : `AURA`, `OLIVE OIL`, `PUREPOUSSE`, `STMNT`.
**product_categories** : `AFRO`, `CAUCASIEN`.
**products** : les 14 lignes du tableau Image 11 (avec inv/seuils/taxes/brand/category exacts ; AFRO Comb et Curl Sponge sans brand ni taxe).

**barbers** (status confirmed, dans l'ordre sort) :
1. `Arsh` / arshdeepsingh03000@gmail.com / +15146994290
2. `Elmer Martinez` / elmernetch@gmail.com / +14384586664
3. `Witzson Beaubrun` / witzson.beaubrun@gmail.com / +14388665206
4. `Olivier` / Oliviertcheuffa.b@gmail.com / +15144523057

**barber_settings** : ligne défaut « Shop » + une par barbier. Valeurs Image 7 :
allow_booking_wo_payment `true`, booking_tip `true`, allow_multiple_services `true`, customer_cancellations `true`, client_booking_interval 30, barber_booking_interval 15, days_book_in_advance 30, mins_book_before `0h5m`, mins_cancel_before `5h0m`, reminder1 `24h0m`, reminder2 `1h0m`. **confirmation_tip** : `true` pour Shop, `false` pour les 4 barbiers.

**commission_tiers** (scope services, cumulative=false) :
- Olivier : (0,55)(1000,60)(2000,65)(2500,70)(30000,100)
- Witzson : (0,55)(1000,60)(2000,65)(2500,70)(3000,100)
- Elmer : (0,55)(1000,60)(2000,65)(2500,70)(3000,100)
- Arsh : tous (0,0).

**discounts** :
- `1 referral` percent 15 services_only
- `2 referral` percent 35 services_only
- `First appointment` percent 20 services_only
- `STUDENT DISCOUNT` fixed 5.00 services_only
- `custom amount` percent 98 services_only

**promo_codes** : `WELCOME20` percent 20, first_appointment_only true, one_time true, expiration null, redemptions 1, total_redemption_value 6.09.

**loyalty_program** : enabled false, type transaction, goal_count 4, min_transaction_amount 30, reward_amount 0, include_product_sales false, include_tips false.

**tips_config** : round_up true, pct_tiers [15,18,20,25], pct_use_above_amount 10.00, flat_tiers [2,3,4,5], booking_tip true, confirmation_tip true.

**notification_prefs** : confirm(email false, push true), reschedule(email false, push true), cancel(email false, push false), arrived(email false, push false). reminder(email true, push true, 0h15m). 1st_client_reminder(email true, push true, 24h0m). 2nd_client_reminder(email true, push true, 1h0m).

**payment_profile** : legal_name `Salon Axum inc.`, business_type company, tax_id_provided true, sin_provided false, dob `1994-08-02`, verified true, destination_bank_name `ROYAL BANK OF CANADA`, destination_last4 `7277`, profile owner name `Yossa-olivier Tcheuffa`.

**waiting_list** : enabled true, threshold_hours 3.

**clients** : générer ~30 clients réalistes (noms FR/divers façon Montréal), quelques-uns sans email, **inclure volontairement un doublon** (2 entrées même téléphone, emails différents) pour tester « Locate Duplicates ». Total affiché simulé ~1896 (le compteur peut être un COUNT réel sur la table seedée — pas besoin de réellement 1896 lignes, mais prévoir pagination).

**appointments** (pour le 22 mai 2026, source admin, status confirmed) :
- Olivier : Jules Lethor (Haircut + Beard) 08:15–08:45 ; Drew Paris (Haircut + Beard) 09:10–09:55 ; tjo tjo (Haircut) 10:30–11:00 ; Glenn Nz (Haircut + Beard) 11:00–11:45.
- Witzson : Mohamed Toure (haircut + Beard) 10:00–10:45 ; Lito Gordon (haircut) 11:00–11:35.
- Elmer : Nelson Kabuya (beard trim + line up) 10:30–11:00.
- Arsh : aucun.
(Créer les clients correspondants s'ils n'existent pas. Lier aux services par nom.)

---

## Partie 3 — Comportements visuels transverses à ne pas oublier
- **Item de menu actif** : marqueur accent (barre latérale ou point), jamais juste un changement de couleur de texte.
- **Blocs RDV** : barre latérale gauche colorée selon statut + badge paiement coin bas-droit.
- **Low stock** : valeur d'inventaire en couleur d'alerte quand ≤ seuil ; compteur « Low Inventory Report (n) » = COUNT dynamique.
- **Marge négative produit** : icône warning discrète, non bloquante.
- **Taxes multi-lignes** dans les cellules (empilées) quand un item a TPS + TVQ.
- **Boutons désactivés** quand l'action n'a pas de sens (ex. Save loyalty si OFF) : opacité réduite.
- **Badges** : pilule « New » (settings), « VERIFIED » (vert), « COMPANY » (bleu).
- **Format date** : respecter `date_format` du shop (USA → MM/DD/YYYY).
- **Champs sensibles** (SIN, Tax ID) : afficher seulement « Provided / Not Provided », jamais la valeur.
