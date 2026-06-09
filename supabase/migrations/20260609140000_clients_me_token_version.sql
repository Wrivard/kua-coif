-- ---------------------------------------------------------------------------
-- /me self-service token revocation (Clients audit W5c).
--
-- The /me token is a stateless HMAC bearer credential — once issued it's valid
-- until expiry with no way to revoke a specific client's link (e.g. if the
-- email was forwarded/leaked). This adds a per-client version counter that the
-- token embeds (`ver`) and the /me verify path checks against; bumping it
-- invalidates every outstanding token for that client.
-- ---------------------------------------------------------------------------

alter table public.clients
  add column if not exists me_token_version integer not null default 0;
