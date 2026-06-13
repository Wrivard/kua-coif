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

export async function POST(req: NextRequest, props: { params: Promise<{ shopId: string }> }) {
  const params = await props.params;
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

  const admin = createSupabaseServiceRoleClient();

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

  // 4. Update notification_sends.status, scoped to THIS shop (INT-S3).
  // notification_sends has no shop_id column; a row's shop is reached via
  // appointment_id -> appointments.shop_id (the
  // table's own RLS uses that join). The path `shopId` was already
  // signature-validated above, so we resolve the row and require its
  // appointment to belong to that shop before touching status — otherwise a
  // shop could flip ANOTHER shop's row by signing its own webhook with a
  // foreign MessageSid. `channel='sms'` still guards against an unrelated
  // email row sharing the same provider_message_id.
  const lookup = await admin
    .from('notification_sends')
    .select('id, appointment_id')
    .eq('provider_message_id', messageSid)
    .eq('channel', 'sms')
    .maybeSingle();
  const row = lookup.data as { id: string; appointment_id: string } | null;

  let targetId: string | null = null;
  if (row) {
    const apptRes = await admin
      .from('appointments')
      .select('shop_id')
      .eq('id', row.appointment_id)
      .maybeSingle();
    if ((apptRes.data as { shop_id: string } | null)?.shop_id === params.shopId) {
      targetId = row.id;
    }
  }

  if (lookup.error) {
    captureException(
      new Error(`[twilio-webhook] lookup failed: ${lookup.error.message ?? 'unknown'}`),
      { tags: { layer: 'twilio-webhook' }, extra: { shopId: params.shopId, messageSid } },
    );
    // Return 204 anyway so Twilio doesn't retry — logging is enough.
  } else if (!targetId) {
    // No row for THIS shop's SID — a race (Twilio called back before
    // dispatch.ts INSERTed the row), a replay for a SID we never issued, OR a
    // SID belonging to another shop (cross-tenant attempt, now refused). Tag
    // distinctly so a spike vs background noise is obvious in Sentry.
    captureException(new Error(`[twilio-webhook] no notification_sends row for sid`), {
      tags: { layer: 'twilio-webhook', kind: 'orphan-status' },
      extra: { shopId: params.shopId, messageSid, messageStatus },
    });
  } else {
    const { error: updateError } = await admin
      .from('notification_sends')
      .update({ status: messageStatus.toLowerCase() })
      .eq('id', targetId);
    if (updateError) {
      captureException(
        new Error(`[twilio-webhook] update failed: ${updateError.message ?? 'unknown'}`),
        { tags: { layer: 'twilio-webhook' }, extra: { shopId: params.shopId, messageSid } },
      );
      // Return 204 anyway so Twilio doesn't retry — logging is enough.
    }
  }

  // Twilio expects a 2xx — anything else triggers their retry
  // logic (up to 5 attempts, then drops). 204 keeps the body
  // empty since Twilio doesn't read it.
  return new NextResponse(null, { status: 204 });
}
