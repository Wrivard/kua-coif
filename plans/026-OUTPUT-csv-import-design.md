# 026 — OUTPUT: CSV client import — design spike

> Deliverable of the design spike `plans/026-spike-csv-client-import.md`.
> **No production code** was written; the only executable artifact was a
> throwaway encoding probe (inline `node -e`, not committed). Authored at
> `HEAD = 84e8c07` (branch synced to main; plan 017 merged).
>
> **Status: design + recommendations + open questions for the operator.**
> The build it specifies is a single manager-only wave (~M effort, estimate
> at the end). The CASL-default decision (Q1) is the operator's to make.

---

## 0. TL;DR — the 5 decisions (one line each)

1. **CASL default**: import as `marketing_opted_out = false` **gated behind a
   mandatory consent-attestation checkbox** logged to durable audit.
   *Alternative (lawyer-grade): default `= true` (opt-out).* Operator decides.
2. **Mapping UX**: **template-first** (download kua's CSV template) **+
   synonym auto-detection** of common vendor headers. *Alternative: a visual
   column-mapping UI — deferred.*
3. **Duplicate policy**: **enrich-on-match** (phone/email match → fill only
   the kept row's EMPTY fields, never overwrite) + report. *Alternative:
   skip-on-match, or create-anyway.*
4. **Dry-run**: **mandatory** server-side preview (N new / N enriched /
   N invalid-with-reasons) before a separate confirm. *Alternative: direct
   commit — rejected.*
5. **Limits/transport**: **upload route** (not a server action), **2 MB /
   5 000-row** cap, **manager+** gate, **30/hr** rate limit (mirror export),
   one **transactional `import_clients` RPC**, **durable audit** with counts.
   *Alternative: chunked client-side `.insert()` batches — rejected (non-atomic).*

---

## 1. Why & what we're building on

Every prospect arrives with a client file (Squire / Booksy / Fresha / a bare
Excel). Today migration = manual re-entry → the objection that kills the sale.
Import is the asymmetric twin of the existing **export** half. The anti-dup
machinery the import needs is already deployed:

| Foundation (read for this spike) | What it gives the importer |
|---|---|
| `app/api/export/[entity]/route.ts` | The clients column set (`first_name, last_name, email, phone, created_at`) → the natural template; the PII manager-gate + 30/hr rate-limit + `logDurableAudit` pattern to mirror |
| `supabase/migrations/20260609130000_clients_dedup_merge.sql` | `phone_normalized` STORED = `right(regexp_replace(phone,'[^0-9]','','g'),10)`; indexes `clients(shop_id, phone_normalized)` + `clients(shop_id, lower(email))`; `merge_clients(keep, merge, shop)` — its **coalesce-only backfill** is exactly the "enrich, never overwrite" semantics we want |
| `app/[locale]/(app)/clients/actions.ts` → `createClient` | Dedup-on-create: `phoneNorm = phone.replace(/\D/g,'').slice(-10)` (matches when `>= 7` digits) and exact `email` match, both excluding `anonymized_at` rows → reuse verbatim per row |
| `app/[locale]/(app)/clients/schema.ts` → `clientSchema` | The per-row **INPUT** validator: trims, lowercases email, `phoneRegex`, `YYYY-MM-DD` DOB, max-lengths. Reuse as the import row schema |
| `20260609150000_clients_marketing_opt_out.sql` | `marketing_opted_out boolean not null default false` (implied consent for an existing business relationship); the winback cron filters `= false` |
| `lib/security/csv.ts` | **OUTPUT** sanitizer only (prefixes `= + - @ \t \r`). Import needs **INPUT** validation — different direction (see §5.3) |
| `lib/audit-log.ts` (`logDurableAudit`) | The PII-bulk-write trail. Per the repo brief `logAuditAction` is a runtime **no-op** — the import MUST use `logDurableAudit` |
| `db/rows.ts` → `ClientRow` | Target columns: `first_name, last_name, email, phone, date_of_birth, notes` (+ `shop_id`, `marketing_opted_out`) |

---

## 2. Step 1 — Source-format survey (column mapping)

> **Honesty note (STOP-condition honored):** I could **not obtain verified
> exact export headers** for Squire / Booksy / Fresha — their exports are
> behind a logged-in account and the published help docs (see Sources) only
> confirm that each offers an Excel/CSV export with the usual contact fields;
> none publishes the verbatim header row. The vendor columns below are
> therefore **PLAUSIBLE / UNVERIFIED** field sets, not invented exact strings.
> The design does **not depend on them being exact**: detection is
> **synonym-based** (normalize header → match against a dictionary), so it
> tolerates header drift. Confirm against one real export per vendor during
> the build (cheap: paste a header row into the dictionary).

**Canonical target (kua `clients`)** and the synonym dictionary the detector
matches each incoming header against (header normalized = lowercased, accents
stripped, non-alphanumerics collapsed):

| kua column | Required? | Header synonyms (match set) |
|---|---|---|
| `first_name` | **yes** | `first name`, `firstname`, `prénom`, `prenom`, `given name`, `client first name` |
| `last_name` | no | `last name`, `lastname`, `surname`, `nom`, `nom de famille`, `family name` |
| `email` | no | `email`, `e-mail`, `email address`, `courriel`, `adresse courriel` |
| `phone` | no¹ | `phone`, `mobile`, `mobile number`, `phone number`, `cell`, `téléphone`, `telephone`, `numéro` |
| `date_of_birth` | no | `date of birth`, `dob`, `birthday`, `birth date`, `date de naissance`, `anniversaire` |
| `notes` | no | `notes`, `note`, `comments`, `remarks`, `tags`, `remarques` |

¹ Not schema-required, but a row with **neither phone nor email** can never be
de-duplicated or contacted — see §5 validation (warn, allow with attestation).

**Per-format mapping (plausible field sets + quirks to handle):**

| Source | First | Last | Email | Phone | DOB | Notes | Known quirks |
|---|---|---|---|---|---|---|---|
| **kua template** (authoritative) | `first_name` | `last_name` | `email` | `phone` | `date_of_birth` | `notes` | UTF-8, `YYYY-MM-DD`, one name per column |
| **Squire** (plausible) | `First Name` | `Last Name` | `Email` | `Phone` / `Mobile` | `Birthday` | `Notes` | US `(514) 699-4290` phone format; sometimes a single `Name` column |
| **Booksy** (plausible) | `First name` | `Last name` | `Email` | `Cell phone` | `Birthday` | `Note` | export often via support; may include marketing-consent column |
| **Booksy / Fresha** (plausible) | `First name` | `Last name` | `Email` | `Mobile number` | `Date of birth` | `Notes` | **Excel `.xlsx`** option — we accept **CSV only** (ask them to "Save As CSV"); accents heavy |
| **Bare Excel** (the long tail) | any synonym | any synonym | any synonym | any synonym | any synonym | any synonym | a single `Name`/`Full Name` column is common → **split heuristic** (first token = first_name, remainder = last_name; flag low-confidence) |

**Quirks the pipeline must absorb (all observed in QC salon data):**
- **Encoding**: UTF-8 **and** Windows-1252 (Latin-accent-heavy) — see probe §6.1.
- **Phone formats**: `+1 514 699 4290`, `(514) 699-4290`, `514-699-4290`,
  `5146994290` → all normalize to `5146994290` via the existing last-10 rule.
- **DOB formats**: `YYYY-MM-DD`, `MM/DD/YYYY` (US), `DD/MM/YYYY` (EU) are
  **ambiguous** (`03/04/2024`). Accept `YYYY-MM-DD` strictly; for slash dates,
  parse only when unambiguous (day > 12), else reject the **cell** (keep the
  row, drop DOB) with a reason. Do not guess.
- **Single `Name` column**: split heuristic, flag as low-confidence in preview.
- **BOM** (`﻿`) on the first header — strip before header matching.

---

## 3. Step 2 — the 5 decisions (recommendation + alternative + rationale)

### Q1 — CASL default for imported contacts  ⟶ **operator's call**
- **Recommend:** insert `marketing_opted_out = false` **only behind a mandatory
  attestation checkbox** — *"I confirm I have consent (or an existing business
  relationship under CASL/Loi 25) to email/SMS these clients"* — and write that
  attestation (text + actor + count + timestamp) to `logDurableAudit`.
- **Alternative (lawyer-grade):** default every imported row to
  `marketing_opted_out = true` (opt-out); the shop re-permissions clients
  organically.
- **Rationale:** the winback/birthday crons filter `marketing_opted_out = false`,
  so an opt-out default makes the marketing features **worthless on day one**
  for exactly the migrating shops we're selling to — the feature's whole point.
  But the contacts are third-party PII and CASL liability is the **operator's**,
  not ours to assume. The attestation + durable audit gives a defensible
  middle path *and* a paper trail; the all-opt-out fallback is there if counsel
  insists. **This is the one open question that must be answered before build.**

### Q2 — Mapping UX  ⟶ **template-first + synonym auto-detect**
- **Recommend:** ship a **"Download kua CSV template"** button (headers =
  the export column set) + **auto-detect** the §2 synonym dictionary so a raw
  Squire/Booksy/Fresha export usually maps with zero user effort. Unmatched
  required columns block with a clear message ("couldn't find a First Name
  column").
- **Alternative:** a full visual column-mapping UI (drag header → field).
- **Rationale:** template-first is **S effort** and covers the bare-Excel long
  tail; synonym detection is a cheap dictionary lookup that handles the 3 big
  vendors. A mapping UI is **M+ effort** for the minority of weird exports —
  defer it until a real import fails to auto-map.

### Q3 — Duplicate policy  ⟶ **enrich-on-match, never overwrite**
- **Recommend:** for each row, match on `phone_normalized` (≥7 digits) then
  exact `lower(email)` within the shop, excluding `anonymized_at` rows (the
  exact `createClient` logic). **Match → enrich**: fill only the kept client's
  **NULL/empty** fields from the import row (the `merge_clients` coalesce
  semantics); **never** overwrite a non-empty value; append to `notes` with a
  separator rather than replace. **No match → insert.** Report both counts.
- **Alternative:** skip-on-match (lossy — drops the new email the file had), or
  create-anyway (re-introduces the duplicates dedup exists to prevent).
- **Rationale:** enrich-on-match is the only policy that's both **non-destructive**
  and **value-adding** (a re-export often carries an email the kua row lacks).
  `merge_clients` stays for post-import **manual** dedup of rows that still slip
  through (e.g. same person, different phone).

### Q4 — Dry-run  ⟶ **mandatory**
- **Recommend:** the upload step **always** parses + validates server-side and
  returns a preview — `{ newCount, enrichCount, invalidCount, sample rows,
  per-row reasons }` — and a short-lived token; **commit is a separate action**
  that re-validates and writes. Nothing is written on upload.
- **Alternative:** parse-and-commit in one shot.
- **Rationale:** a botched import **pollutes the CRM** (wrong-encoding mojibake
  names, mis-split single-name columns, bad phones) and is painful to unwind in
  bulk. A preview is the cheap insurance; it also surfaces the encoding/DOB
  ambiguities before they land.

### Q5 — Limits / transport  ⟶ **upload route, capped, gated, audited, RPC commit**
- **Recommend:**
  - **Transport:** a **route handler** (`POST` multipart) for the file, not a
    server action — Next.js server actions buffer the body and have tighter
    practical size limits; a route streams the upload and sets its own body cap.
  - **Caps:** **2 MB** and **5 000 rows** (a single shop's roster is well under
    this; bigger = split or support-assisted). Reject over-cap with a clear
    message — never silently truncate (the export route's lesson).
  - **Gate:** **manager+** (PII bulk-write) — mirror the export's
    `PII_ENTITIES` role gate.
  - **Rate limit:** **30/hr per user** (`checkRateLimit('import-csv:${userId}',
    { max: 30, windowMs: 3_600_000 })`) — mirror export.
  - **Commit:** one **`import_clients(rows jsonb, shop, opted_out bool)` RPC**
    (SECURITY DEFINER, one transaction, server-side match+enrich+insert) — see §5.4.
  - **Audit:** `logDurableAudit({ action:'custom', entity:'clients',
    diff:{ csv_import:true, new:N, enriched:N, invalid:N, attestation:true }})`.
- **Alternative:** client-side chunked `.insert([...500])` batches.
- **Rationale:** the RPC is **atomic** (all-or-nothing, no half-imported CRM),
  runs the dedup match against the existing indexes **server-side** (no N+1
  round-trips), and matches the repo's existing `save_barber_settings` /
  `merge_clients` SECURITY-DEFINER RPC pattern. Chunked client inserts are
  non-atomic and re-implement matching client-side.

---

## 4. The row pipeline

```
file (multipart upload, ≤2MB)
  │
  ├─ 1. DECODE        bytes → text. Try UTF-8; if the decode yields U+FFFD
  │                   (replacement) → re-decode as windows-1252. Strip BOM.   [§6.1]
  ├─ 2. PARSE         papaparse, { header:true, skipEmptyLines:true }.
  │                   Reject if > 5000 data rows.
  ├─ 3. MAP           normalize each header → synonym dictionary → kua column.
  │                   Require first_name; else hard error.                     [§2]
  ├─ 4. NORMALIZE     per row: reuse clientSchema transforms (trim, lower
  │                   email, phone regex, DOB YYYY-MM-DD). Phone → last-10
  │                   key. Single-Name split heuristic if needed.
  ├─ 5. VALIDATE      zod per row → {valid rows} + {invalid rows + reason}.
  │                   Reasons: NAME_REQUIRED, EMAIL_INVALID, PHONE_INVALID,
  │                   DOB_AMBIGUOUS, NO_CONTACT (no phone & no email → warn).
  ├─ 6. MATCH         for valid rows: phone_normalized then lower(email) vs
  │                   this shop (exclude anonymized) → tag new | enrich.
  │                   Also detect intra-file dups (two rows, same key).
  ├─ 7. PREVIEW       return counts + sample + per-row reasons + a commit
  │   (dry-run)       token. WRITE NOTHING.                                    [Q4]
  └─ 8. COMMIT        separate action: re-validate, call import_clients RPC
      (confirmed)     (atomic match+enrich+insert), logDurableAudit, return
                      an error-report CSV of the rejected rows.               [§5.4, §5.5]
```

---

## 5. API surface & key mechanics (sketches — not implemented)

### 5.1 Two actions

```ts
// (a) Upload + dry-run — a ROUTE handler (multipart), manager+, 30/hr.
// POST /api/import/clients   body: multipart file
// → { token, summary: { total, newCount, enrichCount, invalidCount },
//     sample: PreviewRow[], invalid: { row:number, reasons:string[] }[] }
// Parses + validates + matches server-side; writes NOTHING; stashes the
// validated, matched payload under `token` (short TTL — Upstash, 15 min).

// (b) Commit — a server action (withAction, minRole:'manager').
const commitImportSchema = z.object({
  token: z.string().uuid(),
  attestation: z.literal(true), // Q1 — must be checked to proceed
});
// → re-loads the payload by token, calls import_clients RPC, logDurableAudit,
//   returns { newCount, enrichCount, errorReportCsv }.
```

> Why a route for upload but an action for commit: the **file** wants a route
> (streamed multipart, own body cap); the **commit** is a tiny JSON call that
> fits `withAction`'s auth+role+zod envelope and keeps the gate logic in one
> place. The dry-run token decouples the two and guarantees the user saw a
> preview built from the *same bytes* they confirm.

### 5.2 Per-row validation schema (reuse, don't reinvent)

`clientSchema` from `app/[locale]/(app)/clients/schema.ts` is already the
correct INPUT validator (trim, lowercase email, phone regex, DOB regex,
max-lengths). The import row schema = `clientSchema` + a row index for error
reporting. **Do not** hand-roll new normalizers — drift from `createClient`
would let the importer accept rows the manual form rejects.

### 5.3 csv.ts is the wrong direction for import (confirmed)

`lib/security/csv.ts` **sanitizes OUTPUT** (prefixes a `'` to cells starting
with `= + - @ \t \r` so a downloaded CSV can't run a formula in Excel). Import
is the **opposite** problem — untrusted INPUT — so csv.ts does **not** apply on
the way in. Import safety = **zod validation per row** (§5.2) + parameterized
inserts (PostgREST/RPC, never string-built SQL). One small reuse: if the import
later **re-exports** an error-report CSV, that output path **should** run
`sanitizeCsvRows` (a malicious imported name like `=HYPERLINK(...)` must not
execute when the operator opens the error report).

### 5.4 `import_clients` RPC (server-side, atomic) — sketch

```sql
create or replace function public.import_clients(
  p_rows jsonb,        -- [{first_name,last_name,email,phone,date_of_birth,notes}, …] (pre-validated)
  p_shop uuid,
  p_opted_out boolean  -- Q1: false (attested) or true (opt-out fallback)
) returns jsonb        -- { inserted:int, enriched:int }
language plpgsql security definer set search_path = public as $$
…
-- For each element: compute phone_norm = right(regexp_replace(phone,'[^0-9]','','g'),10);
--   match = first client in p_shop where (phone_norm<>'' and phone_normalized=phone_norm)
--           or (email is not null and lower(email)=lower(elem.email)), anonymized_at is null.
--   match found → UPDATE keep set email=coalesce(email,elem.email), phone=coalesce(...),
--                 date_of_birth=coalesce(...), notes=<append>, (do NOT touch non-null) → enriched++
--   no match    → INSERT (…, shop_id=p_shop, marketing_opted_out=p_opted_out) → inserted++
-- Whole body = one implicit transaction (mirrors merge_clients / save_barber_settings).
$$;
```
Granted to `service_role` only; the commit action (manager-gated) passes the
validated `ctx.shopId`. **Tenant scoping is the RPC's responsibility** (service
role bypasses RLS) — every match/insert is `p_shop`-scoped.

### 5.5 Error-report CSV

The commit returns a downloadable **`import-errors-<date>.csv`** of the rejected
rows: original row number, the raw cell values, and the reason(s)
(`PHONE_INVALID`, `DOB_AMBIGUOUS`, `NO_CONTACT`, `DUPLICATE_IN_FILE`, …). The
operator fixes those rows and re-uploads just them. **Run `sanitizeCsvRows` on
this output** (§5.3).

### 5.6 Consent + audit handling

- Insert path sets `marketing_opted_out` per Q1 (attested → false, else true).
- Commit writes **one** `logDurableAudit` entry: `{ csv_import:true,
  new, enriched, invalid, attestation:<bool>, filename }` — PII-redacted
  (counts, not contact values), service-role, same policy as the export route.
- Anonymized rows are never matched/enriched (`anonymized_at is null` filter).

---

## 6. Step 3 — probes (with evidence)

### 6.1 Encoding — papaparse + Windows-1252 vs UTF-8  ✅ probed
Inline `node -e` (throwaway, **not committed**), québécois sample
`Michèle / Côté / François / Gagné / Élodie / Bélanger`:

```
raw byte for è  = 0xe8                         (single high byte = Windows-1252)
NAIVE utf8 :  {"first_name":"Mich�le","last_name":"C�t�", …}   ← mojibake (U+FFFD)
WIN-1252   :  {"first_name":"Michèle","last_name":"Côté", …}   ← correct
utf8 bytes → win-1252 decoder: {"first_name":"MichÃ¨le", …}    ← double-encoding mojibake
utf8 bytes → utf-8   decoder : {"first_name":"Michèle", …}     ← correct
```
**Conclusion:** neither decoder is universally safe; **encoding must be
detected**. papaparse works on already-decoded text (it does not sniff bytes).
**Strategy:** read the upload as a `Buffer`; `new TextDecoder('utf-8',
{fatal:false})` first; if the result contains `�` (or `{fatal:true}`
throws), re-decode with `new TextDecoder('windows-1252')`; strip a leading BOM;
then hand the string to papaparse. Both Node TextDecoders are available in the
Node runtime (the route already pins `runtime = 'nodejs'`, as export does).

### 6.2 Batch insert strategy — reasoned (Docker absent, no local DB) ⚠️
Could not measure against a live DB (no Docker in the authoring env). Reasoning
from PostgREST/supabase-js limits:
- A single `.insert([...])` is one POST; the real bound is **body size +
  statement time**, not row count. 5 000 small rows ≈ a few hundred KB — one
  request is fine, but it is **not transactional with the match step** and
  re-implements matching client-side (N selects).
- **Chosen:** the **`import_clients` RPC** (§5.4) — one `rpc()` call passing the
  validated set as `jsonb`, all match+enrich+insert in **one transaction**,
  matching reuses the existing `(shop_id, phone_normalized)` /
  `(shop_id, lower(email))` indexes server-side. At the 5 000-row cap the jsonb
  payload is small; if a future cap raises it, chunk the RPC calls (each its own
  transaction) rather than reverting to client inserts.
- **To validate during build:** run the RPC against `pnpm db:reset` + the seed
  on a Docker runner (the new plan-016 `db` CI job is the place to add an
  `import_clients` pgTAP test).

### 6.3 csv.ts direction — confirmed by reading (see §5.3)
OUTPUT sanitizer; import needs INPUT validation (zod). The only import use of
csv.ts is on the **error-report** export path.

---

## 7. Test plan sketch

- **Unit (vitest)** — pure, no DB:
  - header synonym detection (each vendor's plausible headers + accents/BOM → kua columns).
  - row normalization: phone formats → last-10; DOB ambiguity (reject `03/04/2024`, accept `2024-12-03`); single-Name split; email lowercasing.
  - encoding selection: UTF-8 vs Windows-1252 buffer → correct string (the §6.1 probe, productionized as a test fixture).
  - error-report CSV runs `sanitizeCsvRows` (a `=HYPERLINK` name is neutralized).
- **Harness (db CI job, plan 016)** — pgTAP / SQL:
  - `import_clients`: insert path; enrich-on-match fills only NULLs and never overwrites; intra-file dup collapses; tenant scoping (a row can't land in another shop); anonymized rows are skipped.
- **e2e (Playwright, gated like calendar)** — upload a 3-row fixture → preview counts → confirm with attestation → roster shows the rows.

## 8. Effort estimate (per piece)

| Piece | Effort |
|---|---|
| Template download + synonym detection + mapping | **S** |
| Decode/parse/normalize/validate pipeline + unit tests | **S–M** |
| `import_clients` RPC + migration + pgTAP | **S–M** |
| Upload route (dry-run) + token stash + commit action | **M** |
| Preview UI + attestation + error-report CSV (manager settings entry) | **M** |
| i18n (fr+en) for all of the above | **S** |
| **Total** | **~M, one wave** (ship dry-run + commit together; a half-shipped importer is worse than none) |

## 9. Open questions for the operator

1. **CASL default (Q1) — required before build.** Attestation-checkbox →
   opted-in (recommended), or opt-out-by-default (lawyer-grade)? This is a
   legal/risk call, not an engineering one.
2. **Which vendor(s) first?** One real export each from the shops you're
   actively selling confirms the §2 synonym dictionary (replaces the
   "plausible/unverified" tables with verified headers) — cheap, high-value.
3. **Row cap** — is 5 000 enough for your biggest prospect's roster, or should
   the first wave support support-assisted larger imports?
4. **DOB** — accept slash-date formats with an explicit "the dates are MM/DD"
   vs "DD/MM" toggle in the preview, or hard-require `YYYY-MM-DD` in the
   template (simplest, recommended for v1)?
5. **Re-import idempotency** — enrich-on-match already makes a re-run of the
   same file a near-no-op; confirm that's the desired "fix errors and
   re-upload" behavior (it is, by design).

---

### Sources (Step 1 — vendor export formats)
Exact headers were **not** publicly documented; these confirm only that each
vendor offers an Excel/CSV client export with the usual contact fields:
- [Fresha — import your existing client list](https://www.fresha.com/help-center/knowledge-base/clients/51-import-your-existing-client-list)
- [Fresha — export your client list](https://support.fresha.com/hc/en-us/articles/360020594380-How-do-I-export-my-client-list)
- [Booksy Biz — Data Export](https://support.booksy.com/hc/en-us/sections/20664663544594-Data-Export)
- [Exporting clients from Booksy (All Set guide)](https://guides.heyallset.com/Export_Clients/Exporting-Clients-from-Booksy)
