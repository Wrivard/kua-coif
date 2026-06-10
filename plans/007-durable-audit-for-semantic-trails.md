# Plan 007: Durable audit writes for the semantic trails (refunds, consent, orphan PI, public self-service)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ef34cee..HEAD -- lib/audit-log.ts "app/[locale]/(app)/actions.ts" "app/[locale]/(app)/actions-public-links.ts" "app/[locale]/book/[shopSlug]/actions.ts" "app/[locale]/me/[token]/actions.ts" "app/[locale]/reschedule/[token]/actions.ts" "app/[locale]/review/[token]/actions.ts"`
> On mismatch with the Current-state excerpts, STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (swapping a silently-no-op call for a working one; both swallow their own failures)
- **Depends on**: none. Conflicts with plans 004/009 (same files) — run sequentially.
- **Category**: security / compliance
- **Planned at**: commit `ef34cee`, 2026-06-10

## Why this matters

`audit_log` has **no INSERT policy** — only the SECURITY DEFINER table
triggers and the service-role client can write it
(`supabase/migrations/20260523000002_rls.sql:293-299`). `logAuditAction`
inserts through the **user-session client**, so every one of its writes is
silently dropped by RLS. For ordinary CRUD that's harmless (the trigger
captures the row change). But a set of call sites carry **semantics the
trigger cannot capture**, and those trails currently do not exist at all:
the `force_refund` out-of-policy acknowledgment (the code's own comment says
"the owner can later trace out-of-policy refunds" — false today), the
"severity: critical" orphan-PaymentIntent recovery row (the PI id survives
only in Sentry), the public booking's **Loi 25 consent proof**, and every
public-flow trail (self-cancel, public reschedule, review submit, waitlist
join — all run with an anon session). The durable, PII-redacting writer
already exists (`logDurableAudit`, built for the Loi 25 export/anonymize/merge
ops) — this plan routes the remaining semantic sites through it.

## Current state

- `lib/audit-log.ts` (read in full at `ef34cee`):
  - `logAuditAction(args)` :25-48 — user-session client; insert silently
    dropped (no INSERT policy); failures swallowed with Sentry breadcrumb.
  - `logDurableAudit(args)` :89-107 — service-role client; same `LogArgs`
    signature; redacts the diff with `redactAuditPii` (key-mask list :53-65).
    **Same call shape — the swap is import + function name only.**
- The triggers (audit_log_* per table) capture row changes for RLS-client
  mutations; service-role mutations (public booking, crons) get NO trigger
  actor — which is why public-flow semantic rows matter.
- Sites to SWAP (verified by grep at `ef34cee` — `logAuditAction({` with line
  numbers):

| File | Line | What the diff carries (why the trigger can't) |
|---|---|---|
| `app/[locale]/(app)/actions.ts` | 859 | cancel-and-refund: `refunded`, `source`, **`force_refund`** flag |
| `app/[locale]/(app)/actions.ts` | 1123 | bulk-cancel forensic ID list |
| `app/[locale]/(app)/actions.ts` | 1395 | charge-at-counter success context |
| `app/[locale]/(app)/actions.ts` | 1422 | **orphan-PI recovery, severity critical** |
| `app/[locale]/(app)/actions.ts` | 1496 | standalone refund context |
| `app/[locale]/(app)/actions-public-links.ts` | 110 | public-link (receipt/review) mint trail |
| `app/[locale]/book/[shopSlug]/actions.ts` | 794 | **Loi 25 consent proof** (actor = all-zeros anon sentinel) |
| `app/[locale]/book/[shopSlug]/actions.ts` | 1046 | public waitlist join (service-role insert → no trigger actor) |
| `app/[locale]/me/[token]/actions.ts` | 145 | self-service op (read the surrounding fn for its exact semantics) |
| `app/[locale]/me/[token]/actions.ts` | 370 | customer self-cancel (anon sentinel) |
| `app/[locale]/reschedule/[token]/actions.ts` | 225 | public reschedule (anon sentinel) |
| `app/[locale]/review/[token]/actions.ts` | 95 | public review submit trail |

- Sites to KEEP on `logAuditAction` (row-change context the trigger already
  captures; the call is a deliberate no-op — see step 3): all remaining ones —
  `(app)/actions.ts` :288, :363, :534, :684, :890, :1251;
  `clients/actions.ts` :65, :103, :136; `barbers/actions.ts` :37, :73, :121,
  :147, :261; all of `services/actions.ts` and `products/actions.ts`.
- Exemplar of correct `logDurableAudit` usage: the Loi 25 ops in
  `app/[locale]/(app)/clients/actions.ts` (export/anonymize/merge) — match
  their import + call style.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all pass (audit-log redaction tests exist: `lib/audit-log.test.ts`) |
| Lint/format | `pnpm lint` && `pnpm format:check` | exit 0 |

## Scope

**In scope**:
- The 6 files in the swap table (call-site edits + import lines)
- `lib/audit-log.ts` (docstring update only — step 3)

**Out of scope**:
- Adding an INSERT policy on `audit_log` (deliberately rejected: it would
  reintroduce the double-log ambiguity the team already analyzed).
- The KEEP list above. The DB triggers. `redactAuditPii`'s key list.

## Git workflow

- Conventional commit: `fix(audit): route semantic trails through the durable service-role writer`.
- Do NOT push unless instructed.

## Steps

### Step 1: Swap the 12 sites

In each file of the swap table: import `logDurableAudit` from
`@/lib/audit-log` (keep the `logAuditAction` import only if KEEP sites remain
in that file) and rename the call at the listed lines. Argument objects are
unchanged (`LogArgs` is shared). For `me/[token]/actions.ts:145`, read the
enclosing function first and record in your report what op it is.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Verify the classification

`grep -n "logAuditAction({" app -r` → every remaining hit must be in the KEEP
list (paste the output in your report). `grep -rn "logDurableAudit" app | measure` →
12 new call sites + the pre-existing clients-actions ones.

### Step 3: Update the docstring honestly

In `lib/audit-log.ts`, rewrite `logAuditAction`'s docstring to state plainly:
"NO-OP at runtime by design: the user-session insert is dropped by audit_log
RLS (no INSERT policy). Kept only as inline documentation of intent next to
row mutations the SQL triggers already capture. Anything whose diff carries
semantics the trigger can't reconstruct MUST use `logDurableAudit`." Keep the
function (removing ~30 call sites is churn for zero behavior change — out of
scope).

**Verify**: `pnpm test` → all pass (the redaction unit tests must be green —
the swapped sites now flow through `redactAuditPii`).

### Step 4: Full gates

**Verify**: `pnpm lint` && `pnpm format:check` → exit 0; `pnpm build` → exit 0.

## Test plan

- Existing `lib/audit-log.test.ts` covers `redactAuditPii` — it now guards the
  swapped diffs (e.g. consent payloads). No new unit tests required; the
  function behavior is unchanged.
- Post-deploy operator check: perform one force-refund cancel and one public
  booking with consent → both rows appear in `/settings/audit-log` (manager
  view), with PII masked.

## Done criteria

- [ ] `pnpm typecheck` exits 0; `pnpm test` exits 0
- [ ] All 12 table sites call `logDurableAudit` (grep verified, output in report)
- [ ] No KEEP site was swapped (grep output in report)
- [ ] `logAuditAction` docstring states the no-op reality
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- A swap-table line number doesn't land on a `logAuditAction({` call (drift) —
  re-locate by the diff content shown in the table; if ambiguous, report.
- You find a swap site whose diff contains a RAW secret/token value — do NOT
  just swap; report it (redaction masks known PII keys, not arbitrary secrets).
- Plans 004 or 009 already modified the same lines (check `git log --oneline
  -5 -- "app/[locale]/(app)/actions.ts"`) — rebase the line numbers by content,
  not position.

## Maintenance notes

- Rule going forward: `logDurableAudit` for anything semantic (money,
  consent, compliance, public flows); `logAuditAction` is documentation-only.
  A reviewer seeing a NEW `logAuditAction` call on a money path should reject.
- If audit volume grows, the durable writer is service-role and bypasses RLS —
  the monthly `purge_old_audit_log(24)` pg_cron job already bounds retention.
