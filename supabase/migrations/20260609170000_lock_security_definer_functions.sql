-- ---------------------------------------------------------------------------
-- Lock down destructive SECURITY DEFINER functions (cross-cutting security fix,
-- surfaced during the Barbers audit while hardening save_barber_settings).
--
-- PostgreSQL grants EXECUTE to PUBLIC on CREATE FUNCTION, and Supabase's
-- default privileges additionally grant EXECUTE to anon/authenticated. So two
-- destructive SECURITY DEFINER functions shipped callable by ANY web client
-- (even anonymous), bypassing RLS:
--
--   - merge_clients(p_keep, p_merge, p_shop) — re-points appointments/reviews/
--     marketing-sends + combines loyalty + deletes a client row. anon could
--     destructively merge clients in ANY shop given two client UUIDs + a shop
--     UUID.
--   - purge_old_audit_log(retain_months) — DELETEs audit_log rows. anon could
--     call purge_old_audit_log(0) and wipe the entire audit trail.
--
-- Both are only ever invoked server-side: merge_clients via the manager-gated
-- mergeClients action (service-role client), purge_old_audit_log via the
-- pg_cron retention job (runs as its owner). So restricting them to
-- service_role breaks no legitimate caller.
--
-- NOT touched: is_shop_member / has_role_in_shop / is_own_barber /
-- current_shop_ids — these are RLS helper predicates that MUST remain
-- executable by authenticated (RLS policies call them), and they read
-- auth.uid() internally so an anon caller gets an empty/false result with no
-- data exposure.
-- ---------------------------------------------------------------------------

revoke execute on function public.merge_clients(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.merge_clients(uuid, uuid, uuid) to service_role;

revoke execute on function public.purge_old_audit_log(integer) from public, anon, authenticated;
grant execute on function public.purge_old_audit_log(integer) to service_role;
