-- Phase 72 + 73 — Walk-in support, tip reconciliation, and name snapshot.
--
-- Three coupled changes on the appointments table, all flowing from
-- AUDIT_PHASE70.md P0 findings:
--
-- 1. `client_id` becomes nullable so walk-ins (which have no client
--    row in the clients table) can be booked. The barber's calendar
--    UI gets a "walk-in" mode that captures just a name.
--
-- 2. `client_name_snapshot` carries the displayed name at booking time.
--    For booked appointments it mirrors the linked client's name; for
--    walk-ins it's whatever the barber typed. Survives Loi 25
--    anonymization (which previously wiped the historical "who" from
--    receipts + finances), and acts as the calendar render fallback
--    when client_id is null.
--
-- 3. `tip_amount_cents` is the dedicated tip line. Until now total_amount
--    conflated services + tips, making shift-end tip reconciliation
--    impossible. Separating it lets finances + receipts break out the
--    line and gives the owner an auditable tip total.

alter table public.appointments alter column client_id drop not null;

alter table public.appointments add column client_name_snapshot text;

update public.appointments a
set client_name_snapshot = coalesce(
  c.first_name || case when c.last_name is not null then ' ' || c.last_name else '' end,
  '—'
)
from public.clients c
where a.client_id = c.id and a.client_name_snapshot is null;

alter table public.appointments
  add column tip_amount_cents integer not null default 0
  check (tip_amount_cents >= 0);

comment on column public.appointments.client_id is
  'Phase 72 — nullable for walk-in appointments. When null, client_name_snapshot carries the displayed name.';
comment on column public.appointments.client_name_snapshot is
  'Phase 72 — name captured at booking time. Survives Loi 25 anonymization of the client row so finances + receipts retain the historical "who".';
comment on column public.appointments.tip_amount_cents is
  'Phase 73 — tip amount paid by the client, in cents. Separate from total_amount so finances + receipts can break it out + the owner can audit shift-end tips.';
