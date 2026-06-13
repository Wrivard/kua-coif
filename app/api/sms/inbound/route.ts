import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { decrypt, encryptionConfigured } from '@/lib/crypto/aes';
import { verifyTwilioSignature } from '@/lib/sms/webhook';
import { normalizePhoneKey } from '@/lib/utils';
import { logDurableAudit } from '@/lib/audit-log';
import { appUrl } from '@/lib/env/app-url';
import { captureException } from '@/lib/observability';

/**
 * MKT-03 / INT-S1 — Twilio INBOUND-message webhook (STOP opt-out).
 *
 * Distinct from the delivery-status callback (`twilio-webhook/[shopId]`):
 * Twilio POSTs here when a CLIENT replies to one of our SMS. We use it for
 * one thing in V1 — honoring an opt-out keyword by flipping the client's
 * `marketing_opted_out` flag. That makes a carrier-level STOP cross-channel:
 * Twilio already blocks further SMS, but it knows nothing about our EMAIL
 * sends; the app flag is the bridge that also cuts birthday/review/winback
 * email (all of which gate on it). We are a COMPLEMENT to Twilio's Advanced
 * Opt-Out, never a competing reply (we return empty TwiML).
 *
 * Single route (not per-shop path): the shop is resolved from `To` — the
 * shop's own Twilio number, unique per shop — so the STOP only ever opts the
 * client out of THE shop that received it, never a same-phone client at
 * another salon.
 *
 * Security: the Twilio signature (HMAC keyed by the shop's auth token) is the
 * gate, verified BEFORE any write. A forged `To` pointing at another shop
 * can't produce a valid signature, so once verified `To` is trustworthy.
 * Anything unverifiable (unknown number, bad/missing signature) is
 * black-holed with an empty 200 — never a 4xx, which would trigger Twilio's
 * retry/backoff on spoofed posts.
 *
 * Activation (operational, not code): point each shop's Twilio number's
 * "A MESSAGE COMES IN" webhook at `${NEXT_PUBLIC_APP_URL}/api/sms/inbound`.
 * Assumes standalone per-shop numbers (Twilio forwards inbound STOP to the
 * number's webhook); a Messaging Service with Advanced Opt-Out that suppresses
 * forwarding would need a MessagingServiceSid-based resolution (future work).
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Opt-out keywords. Twilio enforces the ENGLISH set at the carrier level; we
// ALSO honor the French equivalents (Twilio does not), so a Québécois client
// who replies "ARRÊT" is opted out of our marketing even though Twilio won't
// block it carrier-side. We list both accented and bare forms (phones often
// drop accents) and match after trim + uppercase + NFC compose.
const OPT_OUT_KEYWORDS = new Set([
  'STOP',
  'STOPALL',
  'UNSUBSCRIBE',
  'CANCEL',
  'END',
  'QUIT',
  'ARRET',
  'ARRÊT',
  'ARRETER',
  'ARRÊTER',
  'DESABONNER',
  'DÉSABONNER',
]);

// No user session — the client acted on themselves via the carrier. Matches
// the actor sentinel the public /unsubscribe action uses.
const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';

// Empty TwiML so Twilio sends no extra app reply; its own carrier-level
// opt-out confirmation goes out independently of this response.
function emptyTwiml(): NextResponse {
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200,
    headers: { 'content-type': 'text/xml; charset=utf-8' },
  });
}

function isOptOutKeyword(body: string): boolean {
  const normalized = body.trim().toUpperCase().normalize('NFC');
  return OPT_OUT_KEYWORDS.has(normalized);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Parse the form body (needed for both signature verification and routing).
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return emptyTwiml();
  }
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = String(v);

  const from = params.From;
  const to = params.To;
  const body = params.Body;
  if (!from || !to || !body) {
    return emptyTwiml();
  }

  if (!encryptionConfigured()) {
    // Can't decrypt the shop's auth token to verify the signature — ack empty.
    return emptyTwiml();
  }

  const admin = createSupabaseServiceRoleClient();

  // 2. Resolve the shop from the number that RECEIVED the SMS (`To` = the
  //    shop's own Twilio number, unique per shop). Read-only — no write yet.
  const shopRes = await admin
    .from('shops')
    .select('id, twilio_auth_token_enc')
    .eq('twilio_from_number', to)
    .limit(1);
  const shop = ((shopRes.data as Array<{
    id: string;
    twilio_auth_token_enc: string | null;
  }> | null) ?? [])[0];
  if (!shop || !shop.twilio_auth_token_enc) {
    // Unknown number / no Twilio config — can't verify, black-hole with 200.
    return emptyTwiml();
  }

  // 3. Verify the Twilio signature BEFORE any write. Keyed by THIS shop's auth
  //    token over the inbound URL + sorted params, so a forged `To` can't pass.
  let authToken: string;
  try {
    authToken = decrypt(shop.twilio_auth_token_enc);
  } catch (e) {
    captureException(e, { tags: { layer: 'twilio-inbound' }, extra: { shopId: shop.id } });
    return emptyTwiml();
  }
  const signature = req.headers.get('x-twilio-signature') ?? '';
  const url = `${appUrl()}/api/sms/inbound`;
  if (!verifyTwilioSignature({ authToken, url, params, signature })) {
    // Spoofed / unsigned — drop silently (200, no retry storm). NO write.
    return emptyTwiml();
  }

  // 4. STOP handling only. Any other inbound message is acknowledged + ignored
  //    in V1 (no general inbound processing).
  if (!isOptOutKeyword(body)) {
    return emptyTwiml();
  }

  // 5. Opt the client(s) OUT of marketing, scoped to THIS shop + the sender's
  //    phone via the indexed canonical key (`phone_normalized`, last 10 digits).
  //    The `marketing_opted_out = false` guard keeps it idempotent — a repeat
  //    STOP writes nothing and emits no audit noise.
  try {
    const phoneKey = normalizePhoneKey(from);
    if (!phoneKey) return emptyTwiml();
    const { data: updated } = await admin
      .from('clients')
      .update({ marketing_opted_out: true })
      .eq('shop_id', shop.id)
      .eq('phone_normalized', phoneKey)
      .eq('marketing_opted_out', false)
      .select('id');
    const rows = (updated as Array<{ id: string }> | null) ?? [];

    // Durable, PII-redacted consent trail (Loi 25 / CASL) — service-role write,
    // mirroring the /unsubscribe action (actor = all-zeros sentinel).
    for (const row of rows) {
      await logDurableAudit({
        shopId: shop.id,
        actorId: SYSTEM_ACTOR,
        action: 'custom',
        entity: 'clients',
        entityId: row.id,
        diff: { marketing_opted_out: true, source: 'inbound-sms-stop' },
      });
    }
  } catch (e) {
    // A write failure shouldn't trigger Twilio retries — log + ack 200.
    captureException(e, {
      tags: { layer: 'twilio-inbound', stage: 'opt-out' },
      extra: { shopId: shop.id },
    });
  }

  return emptyTwiml();
}
