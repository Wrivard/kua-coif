# Plan 026: SPIKE — CSV client import (kill the switching cost from the previous POS)

> **Executor instructions**: This is a DESIGN SPIKE, not a build plan. The
> deliverable is a written design (`plans/026-OUTPUT-csv-import-design.md`) +
> answered/open questions — code only as throwaway probes if needed. Follow
> the steps; honor STOP conditions; update the status row in
> `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat ef34cee..HEAD -- "app/api/export/[entity]/route.ts" lib/security/csv.ts supabase/migrations/20260609130000_clients_dedup_merge.sql "app/[locale]/(app)/clients"`

## Status

- **Priority**: P3 (product leverage: HIGH — sales blocker removal)
- **Effort**: M (the spike itself: S–M; the build it specifies: M)
- **Risk**: LOW (spike); the feature it designs touches PII in bulk → the
  design must front-load that
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `ef34cee`, 2026-06-10

## Why this matters

Every salon prospect arrives with a client file (Squire/Booksy/Fresha/Excel
export). Today migration = manual re-entry of hundreds of records — the
objection that kills the sale ("we can't lose our client list"). The repo has
the EXPORT half (CSV route, papaparse, `lib/security/csv.ts` sanitizer) and —
decisive — the entire anti-duplicate machinery the IMPORT half needs is
already deployed: the `phone_normalized` STORED column + per-shop unique
matching, the transactional `merge_clients()` function, dedup-on-create in
`createClient`, and the `marketing_opted_out` consent flag (CASL defaults for
imported contacts). Import is the missing asymmetric twin.

## Current state (the foundations the design builds on)

- `app/api/export/[entity]/route.ts` — export whitelist incl. clients;
  manager-gated for PII; CSV-injection sanitized; the column set there is the
  natural import template.
- `supabase/migrations/20260609130000_clients_dedup_merge.sql` —
  `phone_normalized` (last-10 NANP, generated) + indexes +
  `merge_clients(keep, merge, shop)`.
- `app/[locale]/(app)/clients/actions.ts` — `createClient` dedups on
  insert (same phone/email ⇒ CONFLICT); zod schema normalizes email/phone.
- `papaparse` is a dependency (used by export); `marketing_opted_out`
  defaults false — NOTE: for IMPORTED clients the CASL-safe default is the
  open design question #1 below.
- Loi 25 context: consent fields, `anonymized_at`, durable audit
  (`logDurableAudit`) — an import is a PII bulk-write and must audit.

## Steps (spike deliverables)

### Step 1: Source-format survey

Obtain/construct sample export headers from: Squire, Booksy, Fresha, a bare
Excel (name/phone/email columns). Document each one's columns and quirks
(phone formats, accents/encoding — Quebec data is Latin-accents-heavy: the
parser must handle UTF-8 AND Windows-1252; date-of-birth formats). Deliver a
column-mapping table → kua's `clients` columns (first_name, last_name, email,
phone, notes, date_of_birth).

### Step 2: Decide the 5 design questions (recommendation + rationale each)

1. **CASL default for imported clients**: `marketing_opted_out = true`
   (safe) vs false-with-attestation ("I confirm I have consent for these
   contacts" checkbox, logged to durable audit)? Recommend: attestation
   checkbox + audit; opt-out default kills the winback feature's value on
   day one for migrating shops. The lawyer-grade fallback is opt-out default.
2. **Mapping UX**: fixed template ("download our CSV template, fill it") vs
   column-mapping UI (detect headers, map visually)? Recommend: template-first
   (S effort) + auto-detection of the 3 big vendors' known headers (cheap
   win), mapping UI deferred.
3. **Duplicate policy at import**: skip / merge-into-existing
   (phone_normalized match → enrich missing fields, NEVER overwrite
   non-empty) / create-anyway? Recommend: enrich-on-match + report;
   `merge_clients` stays for post-import manual merges.
4. **Dry-run**: mandatory preview (parse server-side → return counts:
   N new, N matched, N invalid rows with reasons) before a confirm step?
   Recommend: yes, mandatory — a botched import pollutes the CRM.
5. **Limits/transport**: file size cap (e.g. 2MB / 5k rows), server action
   vs upload route, batch insert size, rate limit (PII bulk-write → mirror
   the export's 30/hr), manager+ gate, durable audit entry with row counts.

### Step 3: Probe the risky bits (throwaway code, NOT committed to app paths)

- Parse one accented Windows-1252 sample with papaparse — confirm encoding
  handling (or document the needed `TextDecoder` step).
- Verify a 1k-row insert strategy: chunked `.insert([...])` of 500 vs RPC;
  measure against the local DB if Docker available, else reason from
  PostgREST limits.
- Confirm `lib/security/csv.ts`'s sanitizer direction (it sanitizes OUTPUT;
  import needs INPUT validation — zod per row, reusing `createClient`'s
  normalizers).

### Step 4: Write the design doc

`plans/026-OUTPUT-csv-import-design.md`: scope (template + 3-vendor
detection, dry-run, enrich-on-match, attestation), the row pipeline
(parse → normalize → validate → match → preview → commit), the API surface
(one upload action + one commit action, schemas sketched), audit/consent
handling, the error-report CSV (rejected rows + reasons), test plan sketch
(unit: mapping + normalization; harness: dry-run/commit actions), and an
honest effort estimate per piece. End with the open questions for the
operator (the CASL default decision is theirs).

## Done criteria

- [ ] Design doc exists with the 5 decisions (recommendation + alternative each)
- [ ] Column-mapping table for ≥ 3 source formats
- [ ] Encoding + batch-insert probes documented with evidence
- [ ] No app-code changes (`git status`: only plans/)
- [ ] `plans/README.md` status row updated

## STOP conditions

- You cannot obtain/construct plausible vendor export samples — deliver the
  template-only design and say so (don't invent vendor headers).
- Anything pushes you to write production code — out of scope for a spike.

## Maintenance notes

- The build that follows should land BEHIND a manager-only settings entry,
  feature-complete in one wave (dry-run included) — a half-shipped importer
  is worse than none.
