/**
 * Google OAuth + Calendar API client — Phase 34.
 *
 * We deliberately do NOT pull in the full `googleapis` npm package
 * (~1MB+ tree of every Google service). Each operation we need
 * (OAuth code exchange, token refresh, events.insert/update/delete,
 * events.list/freebusy) is a single HTTP call against documented
 * endpoints, so `fetch()` is sufficient.
 *
 * Activation flow:
 *   1. Create a Google Cloud project at https://console.cloud.google.com.
 *   2. APIs & Services → Library → enable "Google Calendar API".
 *   3. APIs & Services → OAuth consent screen → set up External app
 *      (or Internal if you have Workspace), add scopes `calendar.events`
 *      and `userinfo.email`.
 *   4. APIs & Services → Credentials → Create OAuth 2.0 Client ID →
 *      Web application. Add `https://<your-domain>/api/google/oauth/callback`
 *      as an authorized redirect URI. Copy Client ID + Client Secret.
 *   5. Set in Vercel + .env.local:
 *      - `GOOGLE_OAUTH_CLIENT_ID`
 *      - `GOOGLE_OAUTH_CLIENT_SECRET`
 *      - `NEXT_PUBLIC_GOOGLE_OAUTH_CONFIGURED=1` (so the UI knows to render
 *        the "Connect Google Calendar" button — public boolean, not a key).
 *   6. Redeploy.
 *
 * Until env vars are set, every helper short-circuits with
 * `googleConfigured()` returning false, the OAuth start route 404s, and
 * the settings UI hides the connect button.
 */

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

// Scopes we ask for. `calendar.events` is read+write on events (we don't
// need access to ACLs / calendar list management). `userinfo.email` lets
// us show "Connected as foo@bar" in the settings UI.
export const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
].join(' ');

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}

/**
 * Build the consent URL we redirect the barber to. `state` is the
 * barber_id (signed by us upstream so the callback can verify integrity);
 * `redirectUri` must match exactly what we registered in Google Console.
 *
 * `access_type=offline` is required to get a refresh_token back. Without
 * it Google only gives short-lived access_tokens and we can't sync after
 * the first hour.
 *
 * `prompt=consent` forces the consent screen even on subsequent connects
 * so we ALWAYS get a refresh_token. Without it, Google may skip the
 * consent screen for already-authorized users and omit refresh_token,
 * which would silently break our reconnect flow.
 */
export function buildOAuthUrl({
  state,
  redirectUri,
}: {
  state: string;
  redirectUri: string;
}): string {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) throw new Error('[google] GOOGLE_OAUTH_CLIENT_ID is missing');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_OAUTH_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
    include_granted_scopes: 'true',
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: 'Bearer';
  id_token?: string;
};

/**
 * Exchange the one-time `code` from the OAuth redirect for an
 * access/refresh token pair. The refresh_token only comes back the first
 * time the user authorizes — or always if we set `prompt=consent` (we do).
 */
export async function exchangeCodeForToken({
  code,
  redirectUri,
}: {
  code: string;
  redirectUri: string;
}): Promise<TokenResponse> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('[google] OAuth client env vars are missing');
  }

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[google] code exchange failed: ${res.status} ${text}`);
  }
  return (await res.json()) as TokenResponse;
}

/**
 * Refresh an access token. Cheap (~50ms) — we call this once per push
 * burst rather than caching the access_token in the DB. Caching would
 * either expire silently or need a TTL column with extra sync logic;
 * not worth it for a 50ms call.
 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('[google] OAuth client env vars are missing');
  }

  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[google] refresh failed: ${res.status} ${text}`);
  }
  return (await res.json()) as TokenResponse;
}

/**
 * Look up the email of the connected Google account. Used by the OAuth
 * callback to populate `barber_google_calendar.google_email` so the
 * settings UI can show "Connected as foo@example.com".
 */
export async function fetchUserEmail(accessToken: string): Promise<string | null> {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { email?: string };
  return data.email ?? null;
}
