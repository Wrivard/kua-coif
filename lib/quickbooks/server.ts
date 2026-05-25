/**
 * QuickBooks Online OAuth + API client — Phase 35.
 *
 * Alternative payment processor to Stripe Connect (Phase 28). Shops can
 * pick one (or neither) — the /settings/payments UI shows both cards
 * but disables the inactive one once a choice is made.
 *
 * Why QuickBooks rather than Stripe: shops that already use QuickBooks
 * Online for accounting want their payments to land directly in their
 * books (every charge becomes a sales receipt that ties to TPS/TVQ tax
 * lines automatically). For a Quebec shop that already does its
 * bookkeeping through QBO, this saves them ~30 min/week of manual entry.
 *
 * Activation:
 *   1. Sign up for an Intuit Developer account at
 *      https://developer.intuit.com (free).
 *   2. Create a new app → choose "QuickBooks Online and Payments" scopes.
 *   3. Add `https://<your-domain>/api/quickbooks/oauth/callback` to the
 *      app's redirect URIs (under "Keys & OAuth").
 *   4. Copy Client ID + Client Secret.
 *   5. Set in Vercel + .env.local:
 *      - `QUICKBOOKS_CLIENT_ID`
 *      - `QUICKBOOKS_CLIENT_SECRET`
 *      - `QUICKBOOKS_ENVIRONMENT=sandbox` (or `production`)
 *      - `NEXT_PUBLIC_QUICKBOOKS_OAUTH_CONFIGURED=1` (public flag for UI gate)
 *
 * Until set, every helper short-circuits and the Connect button hides.
 *
 * Same fetch-only philosophy as Google: the `intuit-oauth` and
 * `node-quickbooks` SDKs are 500KB+ together and we only need ~6
 * endpoints. Plain `fetch()` is sufficient.
 */

const OAUTH_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const OAUTH_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const OAUTH_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';

// Scopes:
//   com.intuit.quickbooks.accounting — read/write company data (customers, items, invoices)
//   com.intuit.quickbooks.payment — read/write payments
//   openid + email — for user identity in callback handler
export const QB_OAUTH_SCOPES = [
  'com.intuit.quickbooks.accounting',
  'com.intuit.quickbooks.payment',
  'openid',
  'email',
].join(' ');

export function qbApiBase(): string {
  const env = process.env.QUICKBOOKS_ENVIRONMENT ?? 'sandbox';
  // Intuit publishes two API hosts: sandbox for test data, production for live.
  return env === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

export function quickbooksConfigured(): boolean {
  return Boolean(process.env.QUICKBOOKS_CLIENT_ID && process.env.QUICKBOOKS_CLIENT_SECRET);
}

export function buildQbOAuthUrl({
  state,
  redirectUri,
}: {
  state: string;
  redirectUri: string;
}): string {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  if (!clientId) throw new Error('[qb] QUICKBOOKS_CLIENT_ID is missing');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: QB_OAUTH_SCOPES,
    state,
  });
  return `${OAUTH_AUTH_URL}?${params.toString()}`;
}

export type QbTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
  token_type: 'bearer';
};

/**
 * Build the HTTP Basic auth header Intuit's token endpoint expects.
 * Their docs show `Authorization: Basic base64(clientId:clientSecret)`.
 */
function basicAuthHeader(): string {
  const id = process.env.QUICKBOOKS_CLIENT_ID;
  const secret = process.env.QUICKBOOKS_CLIENT_SECRET;
  if (!id || !secret) throw new Error('[qb] OAuth env vars missing');
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
}

export async function exchangeQbCode({
  code,
  redirectUri,
}: {
  code: string;
  redirectUri: string;
}): Promise<QbTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`[qb] code exchange failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as QbTokenResponse;
}

export async function refreshQbToken(refreshToken: string): Promise<QbTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`[qb] refresh failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as QbTokenResponse;
}

/**
 * Revoke a refresh token (used when the user disconnects). Intuit
 * accepts EITHER an access or refresh token for revocation; the refresh
 * is the canonical "kill the connection" path.
 */
export async function revokeQbToken(refreshToken: string): Promise<void> {
  const res = await fetch(OAUTH_REVOKE_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token: refreshToken }),
    cache: 'no-store',
  });
  // Intuit's revoke endpoint can return 200 or 204. Anything else means
  // the token was already invalid — not our problem at this point.
  if (!res.ok && res.status !== 401 && res.status !== 410) {
    throw new Error(`[qb] revoke failed: ${res.status} ${await res.text()}`);
  }
}
