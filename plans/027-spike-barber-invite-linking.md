# Plan 027: SPIKE — Barber invite: link `barbers.user_id` and activate the dormant barber persona

> **Executor instructions**: DESIGN SPIKE — deliverable is
> `plans/027-OUTPUT-barber-invite-design.md` + answered/open questions; no
> production code. Honor STOP conditions; update the status row when done.
>
> **Drift check (run first)**: `git diff --stat ef34cee..HEAD -- "app/[locale]/(app)/settings/users/actions.ts" "app/[locale]/(auth)/setup-password" lib/auth/server.ts "app/[locale]/(app)/barbers"`

## Status

- **Priority**: P3 (product leverage: HIGH — table-stakes vs Squire; B8 in the barbers audit)
- **Effort**: spike S–M; the build it specifies: M
- **Risk**: LOW (spike). The feature: MED — it ACTIVATES real access for a
  new user class; the consuming gates are built and audited, the risk is a
  WRONG chair↔account link
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `ef34cee`, 2026-06-10

## Why this matters

The entire barber persona is built and DEAD: `getCurrentBarberId`
(`lib/auth/server.ts:~301`) matches on `barbers.user_id`, ~14 enforcement
sites consume `ctx.barberId` (own-calendar scoping, own-clients,
commission self-view via the `commission_tiers_select_self` RLS policy,
strict-barber gates across actions) — and **no code path ever writes
`barbers.user_id`** (verified: zero writers; seed says "no auth user yet,
user_id stays null"). Worse: inviting a barber TODAY produces a broken
account — they log in and every mutation on their own calendar returns
`FORBIDDEN no_barber_row` (the gates fail closed, correctly). "Your barbers
see their schedule and commissions" is a selling-point claim the app cannot
currently deliver. The missing piece is small: the link.

## Current state (read first; verified at `ef34cee`)

- Invite flow EXISTS — `app/[locale]/(app)/settings/users/actions.ts`
  (`inviteMember`): Path A (existing profile → `shop_members` status
  'confirmed' immediately), Path B (`sb.auth.admin.inviteUserByEmail` →
  `shop_members` status **'staff'** = pending → flipped to 'confirmed' by the
  `/setup-password` completion flow). Roles incl. 'barber' are accepted.
  NOTHING touches `barbers`.
- Roster rows EXIST independently — `app/[locale]/(app)/barbers/actions.ts`
  `createBarber` (display_name, email, phone, avatar; `user_id` never set).
- The consuming machinery (DO NOT redesign — it's the part that already
  works): `ctx.barberId` from withAction; strict-barber checks in
  calendar/clients/public-links actions; `is_own_barber` RLS helper;
  `commission_tiers_select_self`; the barbers page's `viewerBarberId`.
- The two 'staff' semantics collide here deliberately
  (shop_members.status='staff' = pending invite; barbers.status='staff' = a
  roster tab) — the design must not conflate them.

## Steps (spike deliverables)

### Step 1: Decide the linking model (THE decision)

Options to analyze (recommendation + failure modes for each):
- **A. Auto-match by email at accept-time**: when setup-password confirms a
  member whose role='barber', look up `barbers` in that shop with
  `lower(email) = lower(user.email)` and `user_id is null` → link. (The
  partial unique index `barbers_shop_email_unique` makes the match
  unambiguous per shop.) Failure mode: barber roster email ≠ invite email
  (common: personal vs work address) → silent non-link, broken account again.
- **B. Explicit chair picker at invite-time**: the invite form (role=barber)
  REQUIRES selecting a roster barber (dropdown of unlinked `barbers` rows);
  store the pending link (where? a column on shop_members, or a
  `barber_invites` table, or write `barbers.user_id` immediately at invite
  since the auth user id exists from `inviteUserByEmail`) → recommended
  starting hypothesis: write `barbers.user_id` at INVITE time (the auth user
  exists; the account simply can't log in until setup-password) — zero new
  tables, the accept flow needs no change.
- **C. Hybrid**: B as the flow, A as a suggestion-default in the picker.
  Likely the recommendation — analyze.

### Step 2: Specify the full lifecycle

- Invite (manager+; the picker; CONFLICT when the chair is already linked —
  the unique constraint design: one user_id per barber row; should one USER
  link to chairs in two shops? yes — user_id is not unique globally, the
  (shop, chair) is what's exclusive).
- Accept (setup-password — what changes, if anything, per the chosen model).
- Unlink/offboard: deleteBarber (soft) and member removal must null/keep the
  link? Spec it (today's deleteBarber tears down Google; add link-teardown).
- Backfill: the operator's existing invited-barber accounts (if any) — an
  admin "link existing member ↔ chair" affordance on the barbers page covers
  both backfill and mismatch repair. Probably the SAME picker UI as B.
- What a linked barber SEES day one: walk the gates and enumerate (own
  calendar RW, own clients, no finances, no settings, commissions self-view)
  — produce the table from the actual minRole/gates, not assumptions.

### Step 3: Probe the sharp edges

- `inviteUserByEmail` for an email that ALREADY has an auth user (barber who
  used the app at another shop): Path A runs — confirm the chair-link flow
  still works for that path.
- RLS: writing `barbers.user_id` — which policy allows it? (barbers
  INSERT/UPDATE = manager per `20260609180000` — the invite action is
  manager+, so the user client passes; confirm.)
- The audited barbers UPDATE trigger captures the link change — confirm the
  audit story is free.
- i18n surface inventory for the new UI strings (fr/en).

### Step 4: Write the design doc

`plans/027-OUTPUT-barber-invite-design.md`: chosen model + rationale, the
lifecycle spec, the day-one access table, schema delta (likely: none beyond
using the existing column — state it), UI deltas (invite form picker +
barbers-page link/unlink action), test plan sketch (the link/unlink actions
via the plan-015 harness; an e2e "barber sees only own column"), effort
estimate, open questions for the operator (the email-mismatch policy; whether
barbers may self-serve Google Calendar connect post-link — today that's
manager-gated by B3).

## Done criteria

- [ ] Design doc with the model decision (A/B/C analyzed), lifecycle,
      day-one access table built from the real gates
- [ ] Probes answered (existing-auth-user path, RLS write path, audit)
- [ ] No app-code changes (`git status`: only plans/)
- [ ] `plans/README.md` status row updated

## STOP conditions

- You find an EXISTING writer of `barbers.user_id` (the premise would be
  stale) — report it.
- The day-one access walk reveals a gate that would EXPOSE manager data to a
  linked barber — that's a finding, not a design detail; report it
  prominently.

## Maintenance notes

- This unblocks: per-barber Google self-connect policy, barber mobile/push
  ambitions, commission statements per barber. Keep the design minimal — the
  consuming layer is already built; resist redesigning it.
