# AUDIT round-2 — Settings · Finances · Marketing (UX, lecture-seule)

Tâche `77d1ab3f` · auditeur LECTURE-SEULE · **aucun fichier source modifié**.
Périmètre : `app/[locale]/(app)/settings/*`, `app/[locale]/(app)/finances/*`,
`app/[locale]/(app)/marketing/*`.
Lentille : friction UX config/reporting, feedback de sauvegarde, états vide/erreur/chargement,
lisibilité nombres/devises, libellés trompeurs, ruptures mobile.
Exclus (déjà livrés) : sécurité/money-integrity, schémas `multipleOf`, db typés,
error/loading boundaries, primitives UI, fixes par-verticale mergés.

Chaque finding ci-dessous a été **ouvert et confirmé au code** (file:line + preuve). 8 items HIGH/MED,
zéro LOW marginal, zéro padding.

---

## Tableau priorisé

| # | zone | sév | titre | file:line | effort | fix 1-ligne |
|---|------|-----|-------|-----------|--------|-------------|
| 1 | settings/reviews | **HIGH** | Page entière en anglais codé en dur — usagers FR (défaut) voient de l'anglais | `settings/reviews/reviews-client.tsx:69` (+53,55,62,63,71,112,133,197,237,240) | M | Passer chaque chaîne par `t()` (hook déjà câblé L34) + clés `pages.settings.reviews.*` fr/en |
| 2 | finances | **HIGH** | Aucune affordance d'export (CSV) sur le hub de reporting | `finances/page.tsx:324` (header `actions` = 2 liens nav) | M | Bouton « Exporter CSV » pour commissions / par-barbier / catégorie |
| 3 | marketing | MED | Le résultat d'envoi masque le compte « skipped » — l'opérateur croit avoir tout rejoint | `marketing/review-campaign/review-campaign-client.tsx:133` + `marketing/winback/winback-client.tsx:123` | S | Lire `skipped` (déjà retourné, `review-campaign/actions.ts:228`) et l'afficher avec sa raison |
| 4 | finances | MED | Filtre de dates sans préréglages ni comparaison de période | `finances/date-range-filter.tsx:37-93` | M | Puces (Aujourd'hui/7j/Mois/Mois dernier/YTD) + delta « vs période précédente » |
| 5 | finances | MED | Tableaux larges débordent sur mobile (pas de conteneur scroll) | `finances/page.tsx:483` + `finances/today/page.tsx:305` | S | Envelopper chaque `<table>` dans `<div className="overflow-x-auto">` (comme `disputes/page.tsx:105`) |
| 6 | marketing | MED | URL tapée non-https tombe dans l'état vide trompeur « Pas encore d'URL » (zéro validation inline) | `marketing/reviews-qr/reviews-qr-client.tsx:65` | S | Distinguer « vide » de « invalide » : indice « doit commencer par https:// » dans l'aperçu |
| 7 | finances | MED | Close-out caisse sans champ « compté réel » ni écart over/short (owner calcule de tête) | `finances/today/page.tsx:269-291` | M | Champ client-only « encaisse comptée » qui calcule le delta vs attendu en direct (sans schéma) |
| 8 | settings/loyalty | MED | Objectif en $ (`type==='value'`) rendu en `Input` nu sans préfixe $, à côté de deux `MoneyInput` | `settings/loyalty/loyalty-client.tsx:107` | S | Rendre `goal_count` en `MoneyInput` (ou ajouter le `$`) quand `type === 'value'` |

---

## Preuves (confirmées ligne-à-ligne)

- **#1** `reviews-client.tsx` importe `useTranslations('pages.settings.reviews')` (L34) mais ne l'utilise que pour `confirmDelete` (L157-158). Codés en dur : `<PageHeader title="Reviews" />` (L69), `title="Pending moderation"` (L71), `"Published"` (L112), `"Rejected"` (L133), toasts `'Published'/'Rejected'` (L53), `'Moderation failed'` (L55), `'Deleted'` (L62), `'Delete failed'` (L63), empty `Nothing here yet.` (L197), `No comment.` (L237), `toLocaleDateString()` sans locale (L240). `tests/i18n-parity.test.ts` ne compare que les jeux de clés fr/en → littéraux en dur non détectés.
- **#2** `finances/page.tsx:324-352` : `actions` ne contient que 2 `<a>` (today, disputes). `grep -i 'csv|export|download'` sur tout `finances/` → 0 (hors mots-clés `export default`). Le tableau commissions (face-paie) est lecture-seule à l'écran, aucune extraction.
- **#3** `review-campaign/actions.ts:228` `return ok({ attempted, sent, skipped, failed })` ; le client ne lit que `const { sent, failed } = result.data;` (`review-campaign-client.tsx:133`, idem `winback-client.tsx:123`). `skipped` jamais déstructuré → 17 sautés sur 20 = invisibles. Le `sent` compte par-canal (`actions.ts` commentaire).
- **#4** `date-range-filter.tsx` : 2 `<input type="date">` (L53, L68) + Apply (L80) + « ce mois » (L89). Aucun préréglage, aucune comparaison. « Mois dernier » = saisie manuelle des deux bornes.
- **#5** `finances/page.tsx:483` `<table className="w-full text-sm">` (5 colonnes) dans `CardBody` sans wrapper ; `today/page.tsx:305` idem. `disputes/page.tsx:105` enveloppe correctement (`<div className="overflow-x-auto">`) → incohérence confirmée.
- **#6** `reviews-qr-client.tsx:65-66` : `if (!previewUrl || !/^https:\/\/.+/i.test(previewUrl)) { setQrDataUrl(null); return; }` → une URL `google.com/review` (non-https) collapse dans la même branche `qrDataUrl===null` qui rend `emptyTitle` = « Pas encore d'URL ». Seul indice https = `formHint` statique, pas de feedback live.
- **#7** `today/page.tsx:269-291` : carte tiroir affiche uniquement valeurs attendues + `drawer.helper`. Commentaire L269-273 : « The owner manually counts the drawer and writes the delta in their own ledger. We don't persist an 'actual' value here (no schema change). » Un calculateur d'écart client-only ne requiert aucun schéma.
- **#8** `loyalty-client.tsx:104-114` : `goal_count` = `<Input type="number">` nu ; label = `goalValueAmount` (« …($) ») quand `type==='value'`. Voisins `min_transaction_amount` (L118) et `reward_amount` (L126) = `<MoneyInput>` (préfixe `$`). Même rangée, deux traitements visuels pour des montants.

---

## Écartés après vérification (anti-faux-positif)

- **settings/shop** — les deux boutons « Save » (détails + horaires) partagent un seul `isPending` (`shop-details-client.tsx:60,396,452`) → spinner sur les deux à chaque save. Réel mais mineur.
- **settings/active-shop** — rôle rendu en enum brut `{r.role}` (`active-shop-client.tsx:74`) vs traduit ailleurs (`users-client.tsx:70`). Cosmétique, redondant thématiquement avec #1.
- **finances « Gross revenue »** — la variable `grossRevenue = netRevenue(...)` (`page.tsx:131`, `today/page.tsx:126`) est rendue sous le label « Gross revenue ». Défendable comptablement (les remboursements réduisent même le brut) → risque de faux positif, exclu.
- **reviews-qr bouton Save** — ne se re-désactive pas après save (`initialUrl` prop figée, `reviews-qr-client.tsx:169,88`). Cas limite mineur.
- **campagnes colonne contact** — icônes-seules sur mobile (`hidden sm:inline`) mais possède un `title`. Mineur.

## Vérifié sain (pas de finding)
Le reste des sous-pages settings (taxes, discounts, promo-codes, commissions, notifications,
payments, widget, two-factor, password, audit-log, waiting-list) a : toasts de succès/échec,
états disabled/loading, états vides, dirty-guards là où pertinent, et formatage
`formatCurrencyCAD` / dates `Intl.DateTimeFormat(fr-CA/en-CA)` corrects. Finances :
formatage money correct partout (`fmtCAD`, cents `/100` avant affichage, aucun cents brut),
empty states sur chaque tableau, `ResponsiveContainer` sur le graphe. Marketing :
`ConfirmDialog` avant envoi de masse, compteur d'audience (`{selected} sur {total}`),
empty states et toasts de save présents.

---

_Aucun fichier source modifié. Ce fichier d'audit est le seul livrable commité._
