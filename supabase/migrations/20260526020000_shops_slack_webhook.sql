-- Loop 33 (Phase 90 from AUDIT_PHASE70) — owner notification: Slack
-- incoming-webhook URL. When set, the server fires a POST to this URL
-- on new booking events (and future event types). The URL itself is a
-- bearer credential (anyone with it can post to that Slack channel),
-- so:
--   - column-level GRANT stays SELECT for service-role only (the
--     dispatcher reads it; the UI writes via a settings action that
--     never reads it back)
--   - audit_log records UPDATES with `slack_webhook_url_set: true|false`,
--     never the value
--
-- Format is the same as Slack's standard incoming webhook:
--   https://hooks.slack.com/services/T0000/B0000/XXXX
-- We accept any URL though — Discord and other Slack-compatible
-- services use the same JSON payload shape and the column shouldn't
-- be tied to one vendor.

alter table public.shops
  add column if not exists slack_webhook_url text;

comment on column public.shops.slack_webhook_url is
  'Slack-compatible incoming webhook URL for owner notifications. '
  'Bearer credential — never expose to the client.';

-- Lock down reads. The dispatcher reads with service-role; the
-- settings UI writes via the action but never reads it back.
revoke select (slack_webhook_url) on public.shops from authenticated, anon;
