# Plan 027 — OUTPUT: Barber invite → link `barbers.user_id` (design)

> Design spike deliverable for plan 027. No production code. All claims below
> are read from the repo at the current branch head; file:line cited inline.

## TL;DR

- **Recommended model: C (hybrid)** — an **explicit chair picker at invite-time
  that writes `barbers.user_id` immediately**, with **email auto-match (model A)
  as the picker's pre-selected default**, plus the **same picker reused as a
  backfill/repair link-action on the `/barbers` page**.
- **Schema delta: none.** `barbers.user_id` already exists (nullable); the whole
  consuming layer is built. One *optional* integrity index is proposed.
- **STOP-condition exposure walk: clean.** No gate exposes manager-only data to
  a linked barber. One pre-existing, not-introduced-here observation noted (§6).
- **Premise confirmed:** zero writers of `barbers.user_id` exist today
  (`grep` across `app/ lib/` → none). The persona is dead until the link lands.

## 1. The decision (A / B / C)

The auth user id is available **at invite-time** in BOTH invite paths
(`settings/users/actions.ts`):

- Path A (existing profile): `profile.id` (:54).
- Path B (new invite): `inviteRes.data.user.id` (:103).

So nothing forces us to defer the link to accept-time.

### A. Auto-match by email at accept-time
Hook `setup-password` (`(auth)/setup-password/actions.ts:87`) after the
`staff→confirmed` flip: for each confirmed `barber`-role membership, find a
`barbers` row in that shop with `lower(email)=lower(user.email)` and
`user_id is null`, link it.
- **Pro:** zero new UI; the partial unique index `barbers_shop_email_unique`
  makes the per-shop match unambiguous.
- **Failure mode (disqualifying as the *only* mechanism):** roster email ≠
  invite email (work vs personal address is the common case) → **silent
  non-link**, and the barber logs into a broken account (`no_barber_row`
  FORBIDDEN on every own-calendar mutation, `actions.ts:147`). A table-stakes
  feature cannot fail silently.
- Also: Path A sends **no email** and never visits `setup-password`, so an
  accept-time-only hook never fires for existing-profile invites.

### B. Explicit chair picker at invite-time, write `user_id` now
Invite form, when `role='barber'`, **requires** picking an unlinked roster
chair. The action writes `barbers.user_id = <authUserId>` immediately (the
account simply can't log in until `setup-password`).
- **Pro:** deterministic — no silent non-link; **zero new tables**; the accept
  flow (`setup-password`) needs **no change**; works identically for Path A and
  Path B (the id exists in both).
- **Failure mode:** a manager can mis-pick the wrong chair → wrong person sees
  the wrong calendar. Mitigated by (a) the email-match default from A, (b) the
  audit trail (§3), (c) a one-click unlink/repair affordance.

### C. Hybrid (recommended)
**B as the mechanism, A as a non-binding default** inside the picker: pre-select
the unlinked chair whose email matches the invite email; the manager confirms or
overrides. The **same picker** becomes a `/barbers` row action for backfill (the
operator's already-invited-but-broken accounts) and mismatch repair.
- **Why C over B:** keeps B's determinism while recovering A's one-click
  ergonomics for the common matching-email case, with the manager always in
  explicit control. The email default is a *suggestion*, never a silent action.

## 2. Lifecycle spec

**Activation requires THREE conditions** (do not conflate them — the two
`'staff'` meanings collide deliberately, plan note §current-state):
1. `barbers.user_id = <authUserId>` (the new link),
2. `barbers.status = 'confirmed'` (roster tab; `getCurrentBarberId` filters on
   it, `lib/auth/server.ts:317`),
3. `shop_members.status = 'confirmed'` (invite accepted; flipped at
   `setup-password:87`).

| Stage | Behavior |
|---|---|
| **Invite** (manager+, `inviteUser`) | `role='barber'` → picker required. After the existing member insert, write `barbers.user_id` (service-role, scoped to `ctx.shopId` + chosen chair). **CONFLICT** if that chair already has a `user_id`. A given USER may hold chairs in **different shops** — `user_id` is *not* globally unique; exclusivity is per **(shop, chair)**. |
| **Accept** (`setup-password`) | **No change** under model C — the link already exists; the existing `staff→confirmed` flip is what activates the persona. |
| **Unlink / offboard** | Add link-teardown to **two** existing actions: `deleteBarber` (soft-delete, `barbers/actions.ts:96`) must also `user_id = null`; `removeMember` (`settings/users/actions.ts:203`) must null `user_id` on any chair in that shop linked to the removed user. Rationale: a freed person must be re-linkable; a `status='deleted'` chair must not stay matched. |
| **Backfill / repair** | Same picker as a `/barbers` row action: **Link member ↔ chair** + **Unlink** (manager+, user-session client → `barbers_update` manager RLS passes, audit trigger captures — §3). Covers both the existing broken accounts and any A-mismatch. |

## 3. Probes answered

- **Existing-auth-user path (Path A):** `inviteUser` links `shop_members`
  `confirmed` immediately and sends no email (:72-89). Under model C the chair
  `user_id` write happens **in that same action** using `profile.id` — no
  `setup-password` round-trip needed. Works.
- **RLS write path:** `barbers_update` policy = `has_role_in_shop(shop_id,
  'manager')` (`20260609180000_barbers_rls_and_audit.sql:33`). The invite action
  already uses the **service-role** client (RLS bypass) so the invite-time write
  is unconditionally allowed; the `/barbers` link/unlink action uses the
  **user-session** client and passes because it's `minRole: 'manager'`. Both OK.
- **Audit:** `audit_log_barbers` AFTER insert/update/delete →
  `tg_audit_log()` (same migration :64-67). A user-session link/unlink write
  captures the actor via `auth.uid()` — **free audit**. ⚠ The *invite-time*
  write goes through service-role (no `auth.uid()`), so the trigger records a
  null actor; pair it with an explicit `logDurableAudit({ … barber_user_link })`
  in the invite action so the link has a named actor. (Cheap, recommended.)
- **i18n inventory (fr + en):** picker label, "unlinked chair" / "chaise non
  liée", "linked to <email>" / "liée à", "Link to member" / "Lier à un membre",
  "Unlink" / "Délier", chair-already-linked CONFLICT toast, link/unlink success
  toasts, "create a new chair" option. ≈ 9 keys × 2 locales. Parity test
  (`tests/i18n-parity.test.ts`) enforces both.

## 4. Day-one access table (built from the real gates)

What a **linked + confirmed** `barber` (role=`barber`, `ctx.barberId` set) gets:

| Surface | Access | Real gate |
|---|---|---|
| Own calendar column | View own only | `page.tsx:61` `isStrictBarber` → barbers `.eq('id', viewerBarberId)` (:121), appts `.eq('barber_id', viewerBarberId)` (:132), own blocked (:291) |
| Create/edit/cancel/charge/refund/reschedule appt | Own appts only | `actions.ts` `ctx.role==='barber' && barber_id!==ctx.barberId → FORBIDDEN` (:148,:350,:449,:621,:768); `no_barber_row` if unlinked (:147) |
| Clients list + detail | Only clients they served | `clients/page.tsx:56`, `clients/[id]/page.tsx:96` `.eq('barber_id', viewerBarberId)`; `clients/actions.ts:89` FORBIDDEN if no barber row |
| Public links (receipt/review/…) mint | Own appt only | `actions-public-links.ts:55` |
| Commission tiers | **Self-view only** | RLS `commission_tiers_select_self` = `barbers.user_id = auth.uid()` (`20260524144355:91`) |
| Appointments/blocked RLS | Manager OR own | `is_own_barber(shop,barber)` = `barbers.user_id = auth.uid()` (`20260607130000:29`) |
| Finances dashboard | **Blocked** | `finances/page.tsx:43` `requireRoleInCurrentShop('manager')` |
| Settings / barber mgmt / user mgmt | **Blocked (mutate)** | `minRole: 'manager'` on those actions |

The link is the **lynchpin**: `is_own_barber` and `commission_tiers_select_self`
both return false while `user_id is null`, which is exactly why an unlinked
invited barber today has a fail-closed broken account.

## 5. STOP-condition exposure walk — result: CLEAN (one observation)

No gate exposes manager-only data (revenue, other barbers' books/clients,
settings) to a linked barber: calendar/clients are `viewerBarberId`-scoped,
commissions are self-scoped by RLS, finances and settings are manager-gated, and
every appointment mutation re-checks ownership server-side.

**Observation (pre-existing, NOT introduced by this feature, low severity):**
`barbers_select` is shop-wide (`is_shop_member(shop_id)`), so any confirmed
member — including a linked barber who navigates to `/barbers` — can read the
roster's names/emails/phones. This is unchanged by linking and is a separate
roster-visibility decision; flagging for the operator, not blocking this design.

## 6. Schema delta

**None required** — `barbers.user_id uuid null` already exists and is consumed.

**Optional integrity guard (recommend):** a partial unique index
`create unique index barbers_user_shop_unique on public.barbers (user_id,
shop_id) where user_id is not null and status <> 'deleted';` — enforces
one live chair per user per shop at the DB level (the picker's CONFLICT check is
app-level only). Cheap insurance against a double-link race.

## 7. UI deltas

- **Invite form** (`settings/users`): when `role=barber`, render a required
  chair picker — dropdown of unlinked `status='confirmed'` barbers in the shop,
  pre-selected to the email match (model A default), plus a "create a new chair"
  escape hatch.
- **`/barbers` page**: per-row link status ("linked to <email>" / "unlinked")
  + a manager-only **Link member ↔ chair** / **Unlink** action reusing the
  picker. Doubles as backfill + repair.

## 8. Test plan sketch (plan-015 harness)

- `link` action: writes `user_id`; **CONFLICT** when chair already linked;
  cross-shop link of the same user **allowed**; **manager-only**.
- `unlink` / offboard: `deleteBarber` nulls `user_id`; `removeMember` nulls the
  removed user's chair in that shop.
- Path A (email already in `auth.users` from another shop): chair link still
  applies in the invite action.
- e2e: invite barber → `setup-password` → barber signs in → sees **only** their
  own calendar column, own clients, own commissions; `/finances` → blocked.

## 9. Effort estimate

**Build: M.** Invite-form picker + schema-less link write in `inviteUser`
(~0.5d) · `/barbers` link/unlink action + UI + email-default (~0.5d) ·
teardown in `deleteBarber`/`removeMember` (~0.25d) · optional index + audit line
(~0.25d) · i18n + tests/e2e (~0.5d). ≈ 2 days. No consuming-layer changes.

## 10. Open questions for the operator

1. **Email-mismatch policy:** when no roster email matches the invite email, the
   manager picks manually (default behavior). Acceptable, or warn explicitly?
2. **Barber self-serve Google connect post-link:** today Google connect is
   manager-gated (Barbers audit B3, `disconnectGoogleCalendar` is manager-only).
   Should a *linked* barber self-connect their own calendar? Product decision —
   linking unblocks it technically but doesn't grant it.
3. **`removeMember` auto-unlink vs keep:** recommend **auto-unlink** (clean
   re-invite story); confirm.
4. **Optional `(user_id, shop_id)` unique index** (§6): adopt now or defer?

## Done-criteria self-check

- [x] Model decision (A/B/C analyzed) + lifecycle + day-one table from real gates.
- [x] Probes answered (existing-auth-user path, RLS write path, audit, i18n).
- [x] No app-code changes (deliverable is this doc under `plans/`).
- [ ] `plans/README.md` status row — owned by the orchestrator (not touched here).
