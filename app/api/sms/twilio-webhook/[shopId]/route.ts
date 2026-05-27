import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { decrypt, encryptionConfigured } from '@/lib/crypto/aes';
import { verifyTwilioSignature, twilioWebhookUrl } from '@/lib/sms/webhook';
import { captureException } from '@/lib/observability';

/**
 * Loop 55 (P100 slice 3) — Twilio delivery-status webhook.
 *
 * Twilio POSTs an `application/x-www-form-urlencoded` body each
 * time a message transitions between states. We care primarily
 * about the terminal ones (`delivered`, `failed`, `undelivered`)
 * but accept all of them — easier to reflect Twilio's lifecycle
 * faithfully than to partially filter.
 *
 * Per-shop URL: each shop's Twilio creds are different, so the
 * signature verification needs the shop's auth token. Putting
 * `shopId` in the path lets us look up the right token before
 * we trust anything in the body.
 *
 * Auth: signature verification via X-Twilio-Signature is the
 * only gate. No CRON_SECRET / bearer auth — Twilio doesn't sign
 * with anything other than the auth token, and the auth token IS
 * the shared secret.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { shopId: string } }) {
  // 1. Parse form body up-front (we need it for both signature
  //    verification AND the actual status update).
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return new NextResponse('Bad Request', { status: 400 });
  }
  const body: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    body[k] = String(v);
  }

  const messageSid = body.MessageSid;
  const messageStatus = body.MessageStatus;
  if (!messageSid || !messageStatus) {
    return new NextResponse('Bad Request', { status: 400 });
  }

  if (!encryptionConfigured()) {
    // Without the key we can't decrypt the auth token to verify
    // the signature. Reject rather than blindly trust.
    return new NextResponse('Service Unavailable', { status: 503 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createSupabaseServiceRoleClient() as any;

  // 2. Look up the shop's auth token. Service-role bypasses the
  //    REVOKE on twilio_auth_token_enc.
  const shopRes = await admin
    .from('shops')
    .select('twilio_auth_token_enc')
    .eq('id', params.shopId)
    .single();
  const enc = (shopRes.data as { twilio_auth_token_enc: string | null } | null)
    ?.twilio_auth_token_enc;
  if (!enc) {
    // Shop has no Twilio configured (or shopId doesn't exist) —
    // can't verify. 404 rather than 401 so a misconfigured cron
    // shows up clearly in logs vs a forged request.
    return new NextResponse('Not Found', { status: 404 });
  }

  // 3. Verify signature against the URL we originally registered
  //    with Twilio. Using `twilioWebhookUrl` (the same helper the
  //    cron uses to set StatusCallback) guarantees the inputs
  //    match — any drift between sender and receiver URL would
  //    silently break verification.
  const url = twilioWebhookUrl(params.shopId);
  if (!url) {
    // NEXT_PUBLIC_APP_URL missing — can't reconstruct the signed
    // URL. Same shape as 'no config' on the sender side.
    return new NextResponse('Service Unavailable', { status: 503 });
  }
  const signature = req.headers.get('x-twilio-signature') ?? '';

  let authToken: string;
  try {
    authToken = decrypt(enc);
  } catch (e) {
    captureException(e, {
      tags: { layer: 'twilio-webhook' },
      extra: { shopId: params.shopId },
    });
    return new NextResponse('Service Unavailable', { status: 503 });
  }

  if (!verifyTwilioSignature({ authToken, url, params: body, signature })) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  // 4. Update notification_sends.status. We scope by `channel='sms'`
  //    so an unrelated email row with the same provider_message_id
  //    can't be touched (shouldn't happen — emails use Resend ids
  //    — but cheap belt-and-braces).
  //
  //    Loop 55 SR — `.select('id')` so we can detect the "0 rows
  //    matched" case. There's a narrow race window where Twilio's
  //    callback can arrive before dispatch.ts has finished
  //    INSERTing the row (sendSms returns → Twilio fires before
  //    our INSERT roundtrip completes). In practice this is <50ms
  //    vs Twilio's typical 500ms+ to first callback, but if it
  //    EVER fires in prod we want to know — the status update is
  //    silently lost otherwise.
  const { data: updated, error } = await admin
    .from('notification_sends')
    .update({ status: messageStatus.toLowerCase() })
    .eq('provider_message_id', messageSid)
    .eq('channel', 'sms')
    .select('id');
  if (error) {
    captureException(new Error(`[twilio-webhook] update failed: ${error.message ?? 'unknown'}`), {
      tags: { layer: 'twilio-webhook' },
      extra: { shopId: params.shopId, messageSid },
    });
    // Return 204 anyway so Twilio doesn't retry — logging is
    // enough to investigate.
  } else if (!updated || (updated as Array<{ id: string }>).length === 0) {
    // Race: Twilio called us back before dispatch.ts wrote the
    // row, OR the row was hard-deleted, OR we're seeing a
    // replay for a SID we never issued. Tag distinctly so a
    // spike vs background noise is obvious in Sentry.
    captureException(new Error(`[twilio-webhook] no notification_sends row for sid`), {
      tags: { layer: 'twilio-webhook', kind: 'orphan-status' },
      extra: { shopId: params.shopId, messageSid, messageStatus },
    });
  }

  // Twilio expects a 2xx — anything else triggers their retry
  // logic (up to 5 attempts, then drops). 204 keeps the body
  // empty since Twilio doesn't read it.
  return new NextResponse(null, { status: 204 });
}
