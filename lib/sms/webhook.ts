/**
 * Loop 55 (P100 slice 3) — Twilio status callback verification.
 *
 * Twilio POSTs delivery events (`MessageStatus` = queued / sending /
 * sent / delivered / failed / undelivered) to the URL we pass as
 * `StatusCallback` on the original send. Without authentication
 * this endpoint would be a one-click vector for anyone on the
 * internet to forge a "delivered" status on any of our SMS sends.
 *
 * Twilio's signature scheme (HMAC-SHA1 over URL + sorted form
 * params, base64-encoded, keyed by the shop's auth token) is
 * cheap to verify and is the standard approach the provider
 * documents:
 *
 *   https://www.twilio.com/docs/usage/webhooks/webhooks-security
 *
 * We compute the expected signature with the SAME auth token the
 * shop used to send the original message, then constant-time
 * compare against `X-Twilio-Signature`.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { appUrl } from '@/lib/env/app-url';

/**
 * Reconstruct the StatusCallback URL we registered with Twilio so
 * the signature input matches what Twilio computed on its end.
 * Returns null in dev / when the public URL isn't an HTTPS host
 * (Twilio rejects http: callbacks anyway — keeps the cron from
 * passing a non-functional URL through).
 */
export function twilioWebhookUrl(shopId: string): string | null {
  // Plan 025b — appUrl() returns '' (not undefined) when unset; the existing
  // `!base` guard preserves twilioWebhookUrl's null contract (tested).
  const base = appUrl();
  if (!base || !base.startsWith('https://')) return null;
  return `${base}/api/sms/twilio-webhook/${shopId}`;
}

/**
 * Verify Twilio's signature on an inbound webhook POST.
 *
 *   data = url + (k1 + v1 + k2 + v2 + ... + kN + vN), keys sorted
 *   signature = base64(HMAC-SHA1(authToken, data))
 *
 * `params` should be the FORM body parameters Twilio posted — NOT
 * including any URL query-string params (those are already part
 * of `url`).
 */
export function verifyTwilioSignature(args: {
  authToken: string;
  url: string;
  params: Record<string, string>;
  signature: string;
}): boolean {
  const { authToken, url, params, signature } = args;
  if (!signature) return false;

  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const k of sortedKeys) {
    data += k + params[k];
  }

  const expected = createHmac('sha1', authToken).update(data).digest('base64');
  // Constant-time compare — short-circuit on length mismatch so
  // we never call timingSafeEqual on unequal-length buffers (which
  // would throw and create an observable side-channel).
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
