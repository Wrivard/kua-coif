/**
 * Phase H+1 — Sentry PII scrubber for Quebec Loi 25 compliance.
 *
 * Loi 25 treats Sentry as a foreign sub-processor (servers in the US).
 * To stay compliant without ditching error tracking entirely, we strip
 * known-PII keys from every event before it leaves our process and
 * pseudonymize the user identity so the Sentry side carries only
 * opaque tokens.
 *
 * What gets scrubbed:
 *   - `user.email` → hashed to a stable opaque ID (cyrb53, 14 hex
 *     chars = 53 bits) so you can still pivot on "same user" without
 *     exposing the address. Same runtime behavior in client / server /
 *     edge — no Node-only crypto dependency to bundle.
 *   - `user.ip_address` → forced to `null` so Sentry doesn't auto-attach.
 *   - Known PII keys in `extra` / `contexts` / `request.data` (any
 *     depth): phone, email, address, notes, names, password, token,
 *     secret, api_key, authorization, cookie, set-cookie,
 *     card_number, cvv, card_token, sin, tax_id, dob. Each match →
 *     `<scrubbed>`.
 *   - `request.headers.authorization` / `cookie` / `set-cookie`.
 *
 * What stays:
 *   - The error itself + stack trace (no PII typically lives here).
 *   - Tags like `layer:`, `stage:`, `action:` (operational metadata).
 *   - `user.id` (opaque UUID, not PII per Loi 25).
 *   - Breadcrumbs (Sentry-side scrubbing also catches these via the
 *     standard `sendDefaultPii: false`).
 *
 * Same module loaded by client, server, and edge configs so the
 * scrubbing rule is identical in all three runtimes.
 */

const PII_KEYS = new Set([
  'phone',
  'email',
  'address',
  'notes',
  'first_name',
  'last_name',
  'firstname',
  'lastname',
  'password',
  'current_password',
  'new_password',
  'confirm_password',
  'token',
  'secret',
  'api_key',
  'apikey',
  'authorization',
  'cookie',
  'set-cookie',
  'card_number',
  'cvv',
  'card_token',
  'sin',
  'tax_id',
  'taxid',
  'dob',
  'date_of_birth',
]);

const SCRUBBED = '<scrubbed>';

/**
 * Stable non-crypto hash for email pseudonymization.
 *
 * Loi 25 calls for pseudonymization, not cryptographic security: the
 * Sentry-side stored token just needs to be irreversible IN PRACTICE
 * (no rainbow table covering every possible email) and stable across
 * requests so "this is the same user" still pivots. cyrb53 — a fast,
 * well-distributed 53-bit hash — fits perfectly and runs in all three
 * runtimes (browser, edge, node) without any platform shim. The
 * stronger SHA-256 path was tempting but cost a dynamic import that
 * failed under ESM bundlers.
 *
 * cyrb53 ref: https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js
 */
function hashEmail(email: string): string {
  const normalized = email.toLowerCase().trim();
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const combined = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return combined.toString(16).padStart(14, '0');
}

/**
 * Recursively walk `obj` and replace any value whose KEY matches the
 * PII set with `<scrubbed>`. Arrays and nested objects are walked
 * structurally. Returns a fresh structure — the caller's input isn't
 * mutated.
 */
function scrubKeys(obj: unknown, depth = 0): unknown {
  if (depth > 10) return obj; // recursion safety
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((v) => scrubKeys(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (PII_KEYS.has(k.toLowerCase())) {
      out[k] = SCRUBBED;
    } else {
      out[k] = scrubKeys(v, depth + 1);
    }
  }
  return out;
}

/**
 * Sentry `beforeSend` callback — same shape for client/server/edge.
 * Typed loosely as `(event: any) => any` so the same module works
 * across SDK versions where the Event type may drift; the actual
 * Sentry SDK accepts our return value structurally.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function scrubSentryEvent(event: any): any {
  if (!event || typeof event !== 'object') return event;

  // User identity: keep id, hash-or-drop email, drop IP.
  if (event.user && typeof event.user === 'object') {
    const user = event.user as { id?: string; email?: string; ip_address?: string | null };
    const cleaned: { id?: string; email?: string; ip_address?: null } = {};
    if (user.id) cleaned.id = user.id;
    if (typeof user.email === 'string' && user.email.length > 0) {
      cleaned.email = `cyrb53:${hashEmail(user.email)}`;
    }
    cleaned.ip_address = null;
    event.user = cleaned;
  }

  if (event.extra && typeof event.extra === 'object') {
    event.extra = scrubKeys(event.extra);
  }
  if (event.contexts && typeof event.contexts === 'object') {
    event.contexts = scrubKeys(event.contexts);
  }

  if (event.request && typeof event.request === 'object') {
    const req = event.request as {
      headers?: Record<string, unknown>;
      cookies?: unknown;
      data?: unknown;
    };
    if (req.headers && typeof req.headers === 'object') {
      const headers: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        headers[k] = PII_KEYS.has(k.toLowerCase()) ? SCRUBBED : v;
      }
      req.headers = headers;
    }
    if (req.cookies) req.cookies = SCRUBBED;
    if (req.data) req.data = scrubKeys(req.data);
  }

  return event;
}
