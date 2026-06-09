# Feature — Clients

> Référence technique du module **Clients** (répertoire client multi-tenant + conformité Loi 25 / LCAP).
> Destinée au mainteneur. La doc **utilisateur** (non technique) vit dans le centre d'aide in-app (`app/[locale]/(app)/documentation/content.ts`, entrée `clients`).
> Dernière mise à jour : audit 360° + corrections finales (origin/main `67a40c9`).

---

## 1. Vue d'ensemble

Le module Clients gère le répertoire des clients d'un salon : consultation A–Z, recherche, fiche détaillée, déduplication + fusion, et les droits Loi 25 (accès / oubli) + LCAP (consentement marketing + désinscription). Il s'intègre au booking public (find-or-create), à la fidélité, au marketing (relance / anniversaire / avis) et à l'audit durable.

**Personas / accès** :
- **Owner / Manager** — voit tout le répertoire du shop actif ; peut fusionner, anonymiser, exporter, révoquer les liens self-service.
- **Barbier** — voit uniquement les clients qu'il a **servis** (≥ 1 rendez-vous comme `barber_id`). Périmètre appliqué **côté application** (voir §5).
- **Client final** — pas de login admin ; accès self-service via lien signé `/me/[token]` + désinscription `/unsubscribe/[token]`.

---

## 2. Modèle de données

### Table `clients` (colonnes clés)

| Colonne | Rôle |
|---|---|
| `id`, `shop_id` | PK + tenant |
| `first_name`, `last_name`, `email`, `phone` | Coordonnées |
| `phone_normalized` | **Colonne générée STORED** = 10 derniers chiffres NANP (`migration 20260609130000`). Clé canonique de déduplication + match booking. Indexée. |
| `date_of_birth` | Anniversaire (cron Loop 62). **Rédigée dans l'audit** (`20260609120000`). |
| `notes` | Notes libres |
| `loyalty_balance_cents`, `loyalty_counter`, `loyalty_balance_expires_at` | Fidélité (compteur en mode transaction, cents en mode value) |
| `anonymized_at` | Tampon Loi 25 — non-null ⇒ fiche oubliée (PII effacée, ligne conservée pour la rétention fiscale) |
| `marketing_opted_out` | **bool, défaut false** (`20260609150000`). Consentement LCAP — true ⇒ exclu des 3 envois marketing |
| `me_token_version` | **int, défaut 0** (`20260609140000`). Versioning de révocation des liens `/me` |
| `quickbooks_customer_id` | Copie QBO (non effacée à l'anonymisation — cf. §11) |
| `created_at` | Inscription |

### Tables liées (référencent `client_id`)

| Table | FK | Comportement à la suppression |
|---|---|---|
| `appointments` | `client_id` | `ON DELETE RESTRICT` (un client avec RDV ne peut être hard-delete → utiliser anonymize) |
| `reviews` | `client_id` | `ON DELETE SET NULL` |
| `client_marketing_sends` | `client_id` | `ON DELETE CASCADE` |
| `waiting_list_entries` | (pas de FK) | matché par phone/email |

La fusion (`merge_clients`) re-pointe les 3 premières ; la waitlist est nettoyée par phone/email.

---

## 3. Surface UI & routes

| Route / fichier | Rôle |
|---|---|
| `app/[locale]/(app)/clients/page.tsx` | Liste — scoping shop actif + COUNT grand total + cap 1000 |
| `clients/clients-client.tsx` | Client island — barre A–Z, recherche, dédup/fusion, actions de rangée |
| `clients/[id]/page.tsx` | Fiche — coordonnées, 4 stats (dépensé / visites / no-shows / fidélité), historique RDV, notes |
| `clients/client-form-modal.tsx` | Add / Edit |
| `clients/actions.ts` | Server actions (voir §4) |
| `clients/schema.ts` | Schémas Zod |
| `app/api/export/[entity]/route.ts` | Export CSV (gate rôle + rate-limit + **audit durable**) |
| `app/[locale]/me/[token]/` | Self-service client (accès / loyalty / self-cancel) |
| `app/[locale]/unsubscribe/[token]/` | Désinscription marketing LCAP |
| `app/[locale]/review/[token]/` | Soumission d'avis public |

---

## 4. Server actions (`clients/actions.ts`)

Toutes passent par `withAction({ schema, minRole, run })` → `ctx = { userId, shopId (shop ACTIF, cookie-aware), role, barberId }`, résultat `Result` (`ok`/`err`).

| Action | minRole | Mécanique | Rate-limit |
|---|---|---|---|
| `createClient` | barber | **Dédup à l'insertion** : CONFLICT si même `phone_normalized` OU `email` (hors anonymisés) | — |
| `updateClient` | barber | Barbier limité aux clients servis (check appointments) | — |
| `deleteClient` | manager | Hard-delete (FK RESTRICT). `.select('id')` ⇒ `NOT_FOUND` si 0 ligne (id inexistant/cross-tenant) | — |
| `exportClient` | manager | JSON complet (Loi 25 accès) : client + RDV + loyalty + reviews + marketing_sends + waitlist. Audit durable | 20/h |
| `anonymizeClient` | manager | Efface PII + scrub `appointments.client_name_snapshot`, `reviews.client_name`, supprime waitlist. Flag `qb_customer_pending`. Audit durable | 10/h |
| `mergeClients` | manager | `rpc('merge_clients', {p_keep, p_merge, p_shop})` (transactionnel). Audit durable | 30/h |
| `revokeMeAccess` | manager | Incrémente `me_token_version` ⇒ tous les liens `/me` en cours échouent | — |
| `searchClientsList` | **manager** | Recherche ILIKE sur tout le shop actif, cap 50, shape `ClientRow` | 60/min |

> `searchClientsList` est **manager-only** délibérément : une recherche serveur côté barbier contournerait son périmètre « clients servis » (la même fuite que la route CSV). Les barbiers gardent la recherche client-side sur leur ensemble chargé (complet en pratique).

---

## 5. Sécurité

- **RLS** : `clients` = `is_shop_member(shop_id)` **plat** (USING + WITH CHECK) + force RLS. L'édition/suppression cross-shop est bloquée au niveau DB.
- ⚠️ **Le périmètre barbier (« clients servis ») est appliqué CÔTÉ APPLICATION**, pas en RLS. Chaque voie service-role (fiche, export, anonymize) contourne la RLS — un seul check applicatif manquant = fuite du répertoire. Voir §11.
- **Scoping shop actif** : `page.tsx` + `withAction` lisent le cookie `getCurrentShopId()` (pas `memberships[0]`) ⇒ un owner multi-shop ne voit jamais deux shops fusionnés.
- **Export CSV** (`api/export/[entity]`) : gate rôle (entités PII `clients`/`barbers` → manager+) + rate-limit 30/h + **audit durable** + colonnes whitelistées (jamais SIN/tax_id) + anti-injection CSV.
- **Tokens signés** (`lib/security/signed-tokens.ts`) : HMAC-SHA256, payload `{kind, resourceId, exp, ver?}`. Le `kind` est signé ⇒ un token `review` ne peut être rejoué en `me`/`unsub`. Couverts par tests (§10).
- **Révocation `/me`** : le token embarque `ver = me_token_version` au mint ; les 3 sites de vérif (`me/page`, `me/actions` ×2) rejettent si `ver` ≠ version courante. `revokeMeAccess` bump la version.

---

## 6. Déduplication & fusion

1. **Prévention** : `phone_normalized` (10 derniers chiffres) + dédup à la création (`createClient` → CONFLICT). Le booking public fait un find-or-create par `phone_normalized` **exact** (avant : `ilike '%digits%'` substring → source de doublons + fuite cross-client).
2. **Détection** (UI) : `clients-client.tsx` calcule `duplicateIds` (groupes partageant phone last-10 OU email) sur l'ensemble **chargé**. Bouton « Locate Duplicates » + badge « Doublon ».
3. **Fusion** (manager) : action de rangée → picker de partenaire → confirmation → `merge_clients(p_keep, p_merge, p_shop)`. La fonction Postgres (`20260609130000`, SECURITY DEFINER) re-pointe appointments/reviews/client_marketing_sends, combine la fidélité, comble les coordonnées manquantes, supprime la ligne fusionnée — le tout en une transaction, et re-vérifie que les deux clients appartiennent à `p_shop`.

⚠️ **Limite** : dédup + fusion n'opèrent que sur l'ensemble chargé (cap 1000). Des doublons à cheval sur le plafond dans un shop > 1000 clients ne sont pas détectés. Voir §11.

---

## 7. Recherche, A–Z & pagination

- **Barre A–Z** : `bucketLetter()` replie les accents (NFD, « Élodie » → E) ; noms hors A–Z + anonymisés sous « # ». Lettres vides grisées.
- **Recherche** : instantanée client-side sur l'ensemble chargé. **Pour les managers**, dès 2 caractères → `searchClientsList` interroge **tout le shop** (clients au-delà du cap restent trouvables) ; la barre A–Z bascule en bandeau « résultats dans tous les clients ».
- **Modèle 2-compteurs** (spec §B) : `totalCount` = vrai COUNT serveur (grand total, non plafonné — pour un barbier = nombre de clients servis distincts) ; le pied de table porte le compte filtré + page-of. Le sous-titre = grand total, + « {n} affichés » quand un filtre est actif.
- ⚠️ La **vraie pagination serveur A–Z > 1000** n'est pas faite (déféré) : le parcours est client-side sur l'ensemble plafonné à 1000. La recherche serveur couvre la « trouvabilité ».

---

## 8. Vie privée & conformité

### Loi 25 (Québec)
- **Droit d'accès** : `exportClient` (JSON complet) + l'export self-service depuis `/me`.
- **Droit à l'oubli** : `anonymizeClient` — efface PII de `clients` + scrub `appointments.client_name_snapshot` + `reviews.client_name` + supprime les entrées waitlist matchées. Irréversible. La ligne reste (rétention fiscale 6 ans).
- **PII-at-rest** : un trigger DB rédige `email/phone/notes/date_of_birth/...` dans `audit_log.diff` (`20260608130000` + `20260609120000`).

### LCAP (anti-pourriel)
- **Consentement** : `marketing_opted_out` (défaut false = consentement implicite de la relation d'affaires). Les **3 chemins d'envoi** (winback `marketing/winback/actions.ts`, anniversaire `api/cron/birthday-greetings`, avis `lib/business/review-request.ts`) sautent les clients opted-out.
- **Désinscription** : chaque email commercial (CEM) porte un lien `/unsubscribe/[token]` (token `unsub`, généré par `lib/email/unsubscribe.ts`, TTL 365 j) via le pied de `lib/email/templates/branded-layout.tsx`. La route publique : GET = page de confirmation (**aucune mutation** → safe vs prefetch des scanners), POST = `marketing_opted_out = true` (idempotent) + audit durable PII-redacté. Clients anonymisés → 404.

### Audit durable
- `logDurableAudit()` (`lib/audit-log.ts`) = écriture **service-role** (bypass RLS) + redaction PII récursive (`redactAuditPii`). Utilisé pour les ops Loi 25/LCAP (export, anonymize, merge, unsubscribe, revoke) + l'export CSV.
- ⚠️ `logAuditAction()` (client user) est **RLS-droppé** (`audit_log` n'a qu'une policy SELECT) — les triggers DB sont l'unique rédacteur du CRUD. Voir §11.

---

## 9. Migrations

| Fichier | Apport |
|---|---|
| `20260609120000_audit_redact_client_dob.sql` | Rédige `date_of_birth` dans le trigger d'audit |
| `20260609130000_*phone_normalized*.sql` | Colonne générée `phone_normalized` + index + fonction `merge_clients` |
| `20260609140000_*me_token_version*.sql` | `me_token_version int default 0` |
| `20260609150000_clients_marketing_opt_out.sql` | `marketing_opted_out bool default false` |

`db/types.ts` régénéré depuis le schéma live (inclut les 3 colonnes + le rpc `merge_clients`) ⇒ `clients/actions.ts` est **entièrement typé** (zéro `as any`).

---

## 10. Tests

| Fichier | Couverture |
|---|---|
| `lib/security/signed-tokens.test.ts` | 9 cas — round-trip, rejet wrong-kind (anti-rejeu), expiry, signature falsifiée, payload splicé, malformé, `ver` round-trip + legacy, liaison au secret. Garde `/review` · `/me` · `/unsubscribe`. |
| `lib/audit-log.test.ts` | 5 cas — `redactAuditPii` masque toutes les clés PII, récursion objets/tableaux, garde non-PII + null, primitives. Garde l'audit durable. |

> Pas encore de tests d'intégration DB (pas de harness mock-Supabase) — gap connu.

---

## 11. Limites connues & items déférés

| Item | Sévérité | État |
|---|---|---|
| Dédup/fusion aveugle au-delà du cap 1000 | 🟠 MOY | Déféré (lié à la pagination serveur) |
| Vraie pagination serveur A–Z > 1000 | 🟡 | Déféré — recherche serveur couvre la trouvabilité |
| Périmètre barbier app-only (zéro défense RLS) | 🟠 MOY | Décision design — un check applicatif manquant = fuite |
| `logAuditAction` RLS-droppé app-wide (contexte « custom » perdu) | 🟠 MOY | **Décision requise** : ajouter une policy INSERT (ré-introduit le double-log) OU migrer tous les appels vers `logDurableAudit` |
| Tokens `/me` + `/unsub` = bearer transférables | 🟡 BAS | Révocables (`/me`), mais pas de liaison par appareil |
| Erase QuickBooks à l'anonymisation | 🟡 | Déféré — seul `qb_customer_pending` est flaggé (pas d'appel QBO) |
| RPC transactionnel booking (vs rollback compensatoire actuel) | 🟡 | V2 documenté |
| Harness de tests d'intégration DB | 🟡 | Absent |

---

## 12. Historique d'audit

Audit 360° (2026-06-09, workflow 66 agents) + implémentation en 7 vagues (W1–W7) + audit final de vérification (2 vérificateurs adversariaux indépendants) + corrections. Ledger complet : note mémoire `kua-coiffure-clients-audit`. Toutes les failles hautes/légales sont résolues ; les items du §11 sont les résiduels assumés.
