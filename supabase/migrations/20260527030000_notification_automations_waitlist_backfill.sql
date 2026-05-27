-- Loop 56 self-review — fill in the waitlist_open hole in
-- notification_automations.
--
-- Two related issues surfaced when Loop 56's settings UI shipped:
--
--   1. The original CHECK on `kind` (Phase 25 migration) lists only
--      5 values. `waitlist_open` was added as an AutomationKind in
--      Loop 42 but the schema constraint was never widened — so any
--      attempt to INSERT a waitlist row fails the check.
--
--   2. The original seed (Phase 25 + the createShopAction TS seed)
--      only writes 5 kinds × 2 channels = 10 rows per shop. The
--      UI's AUTOMATION_ORDER expects 6 kinds (added `waitlist_open`
--      between cancellation and birthday in Loop 42), so the
--      waitlist row renders as "—" — no way for an owner to toggle
--      waitlist notifications via the matrix.
--
-- This migration widens the CHECK and backfills the two missing
-- rows (email + sms) for every existing shop. The TS seed in
-- app/admin/shops/new/actions.ts is updated in the same commit to
-- include them for future shop creations.
--
-- Both operations are idempotent.

alter table public.notification_automations
  drop constraint if exists notification_automations_kind_check;

alter table public.notification_automations
  add constraint notification_automations_kind_check
    check (kind in (
      'booking_confirmation',
      'reminder_24h',
      'reminder_1h',
      'cancellation',
      'waitlist_open',
      'birthday'
    ));

insert into public.notification_automations (shop_id, kind, channel, enabled)
select s.id, k.kind, k.channel, k.enabled
from public.shops s
cross join (values
  ('waitlist_open', 'email', false),
  ('waitlist_open', 'sms',   false)
) as k(kind, channel, enabled)
on conflict (shop_id, kind, channel) do nothing;
