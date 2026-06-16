# Audit round-2 — daily-driver flow UX (lecture-seule)

> Task `ecead317-b2e4-4720-b07c-d76ae2da7e51` — campagne `/improve`.
> Passage CHIRURGICAL et VÉRIFIÉ : chaque finding ouvert et confirmé dans le code
> avant d'être listé. Zéro spéculation. Aucun fichier source/app modifié — ce
> document est le seul livrable.

## Périmètre couvert (lu intégralement)

- **Calendrier / RDV** : `app/[locale]/(app)/page.tsx`, `appointments-calendar.tsx`
  (1366 l.), `appointments-grid.tsx`, `appointments-week-view.tsx`,
  `appointments-list-view.tsx`, `appointment-detail-drawer.tsx`,
  `appointment-form-modal.tsx`, `block-time-form-modal.tsx`.
- **Booking public** : `app/[locale]/book/[shopSlug]/booking-wizard.tsx` (2269 l.),
  `booking-payment-section.tsx`.
- **Dashboard** : la home `(app)/page.tsx` **est** le calendrier (aucune route
  `dashboard` séparée n'existe) → couverte ci-dessus.

## Candidats écartés (vérifiés comme faux / hors périmètre)

- **Chevauchement de RDV même barbier masqué dans la grille** — IMPOSSIBLE : la
  base a une contrainte `EXCLUDE` anti-overlap (`actions.ts:254`, code `23P01 →
  CONFLICT`). Deux RDV d'un même barbier ne peuvent pas se chevaucher.
- **Chemin paiement / money** — durci (BUG-03/09, readiness gating, stale-PI
  guard) ; exclu par le contrat.

## Findings priorisés

| # | zone | sév | titre | file:line | effort | fix 1-ligne |
|---|------|-----|-------|-----------|--------|-------------|
| 1 | calendrier | **HIGH** | Sur mobile, TOUTE la nav de jour du calendrier disparaît (prev/today/next/saut-de-date + indicateurs live/stale sont dans le slot `center`, masqué `hidden sm:flex`) — impossible de changer de jour sur téléphone | page-header.tsx:53 + appointments-calendar.tsx:1021 | M | sortir le cluster prev/today/next/date du `center` du PageHeader vers la barre d'outils du corps (visible < sm) |
| 2 | calendrier | MED | Vue Liste n'a aucun indicateur de paiement alors que la grille jour ET la vue semaine affichent le glyphe « payé » (CreditCard) → en liste on ne distingue pas payé/impayé | appointments-list-view.tsx:50 | S | ajouter une colonne/badge « payé » gardé sur `payment_status==='paid'` |
| 3 | calendrier | MED | Modale création RDV affiche la durée totale (`NN min`) mais jamais le PRIX total pendant la sélection des services (le montant n'apparaît qu'après création, dans le drawer) | appointment-form-modal.tsx:335 | S | afficher Σ `price` à côté du libellé Services |
| 4 | calendrier | MED | Le filtre barbiers peut être vidé à zéro ; « Ajouter un RDV » de l'en-tête ouvre alors le form avec `barber_id=''` → le zodResolver bloque le submit et aucun `errors.barber_id` n'est rendu → clic « Réserver » sans effet visible (ni toast ni erreur) | appointments-calendar.tsx:1104 | S | fallback `barbers[0]` quand `visibleBarbers` vide + FieldHint sur `barber_id` |
| 5 | booking | MED | Étape 4 : « Confirmer » est désactivé sans aucune raison affichée quand le consentement Loi 25 / Turnstile / prénom manquent (seuls tel + courriel ont un hint inline) → bouton mort sur l'étape de conversion | booking-wizard.tsx:1366 (+ canAdvance 660) | M | indiquer la condition non remplie (texte près du consentement/Turnstile, ou valider-au-clic) |
| 6 | calendrier | LOW | Vue Semaine : les en-têtes de jour (`Mon 18`) sont des `<div>` non cliquables → impossible de cliquer un jour pour basculer en vue jour (aggrave #1 sur mobile) | appointments-week-view.tsx:82 | S | rendre l'en-tête un bouton qui `jumpToDate(iso)` + passe en side-by-side |
| 7 | calendrier | LOW | Chips de filtre barbiers : aucun affordance « Tous / Aucun » → isoler 1 barbier sur un shop à 10 barbiers = 9 clics | appointments-calendar.tsx:1149 | S | ajouter un chip « Tous » (sélectionne/efface tout) |
| 8 | calendrier | LOW | Drawer : « Annuler » (annulation seule) utilise `disabled={isPending}` sans spinner, alors que « Annuler & rembourser » voisin utilise `loading` → annulation lente = aucun feedback | appointment-detail-drawer.tsx:388 | S | passer le bouton en `loading={isPending}` |
| 9 | calendrier | LOW | Onglets de vue : « Côte-à-côte » n'a pas de badge de compte alors que Semaine et Liste en ont un | appointments-calendar.tsx:1127 | S | ajouter `count` au tab side-by-side (ou retirer des deux) |
| 10 | booking | LOW | DateStrip affiche jour-de-semaine + numéro mais aucun MOIS → une bande de 14 j à cheval sur 2 mois (…30, 1, 2) est ambiguë au moment du choix | booking-wizard.tsx:1992 | S | afficher le mois (en-tête de bande ou sur le 1er jour de chaque mois) |
| 11 | calendrier | LOW | Le champ date de re-planification (drawer) n'a pas de `min`, autorisant une date passée — incohérent avec la modale Block-time dont `until_date` fixe `min={date}` | appointment-detail-drawer.tsx:469 | S | ajouter `min={today}` (ou `min` cohérent) au champ date de reschedule |

## Notes de cadrage

Items triés par impact. **#1 est de loin le plus sérieux** : régression mobile
réelle sur l'écran le plus utilisé du produit. #2/#3/#10 sont des incohérences
inter-vues vérifiées (pas du repolish). #4 et #5 sont des pièges « bouton mort »
silencieux sur des actions clés (création RDV admin ; confirmation booking).
Exclus : chemin money/paiement (durci) et items W1-W5 déjà livrés.
