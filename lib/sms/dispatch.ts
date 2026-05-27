/**
 * Loop 54 (P100 slice 2) — SMS dispatch helper.
 *
 * Wraps the Twilio REST client with the shop-side config lookup +
 * the `notification_sends` ledger write. The cron at
 * `/api/cron/notifications` calls this once per appointment that's
 * due for an SMS reminder; the action surface (cancel, booking
 * confirmation) could call it directly in V1.5 once those flows
 * grow SMS support.
 *
 * Return shape mirrors `sendEmail` from lib/email/send.ts so a
 * future unified dispatcher can swap channels behind one type.
 */

import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { decrypt, encryptionConfigured } from '@/lib/crypto/aes';
import { captureException } from '@/lib/observability';
import { sendSms, twilioConfiguredForShop } from './twilio';
import type { AutomationKind } from '@/lib/email/send';

export type DispatchSmsInput = {
  shopId: string;
  /**
   * Loop 62 — `null` means "I'll manage my own ledger" (used by the
   * birthday + future marketing-campaign crons, which write to
   * `client_marketing_sends` instead of `notification_sends`).
   * Non-null means "write the notification_sends row for me" — the
   * usual appointment-scoped reminder/confirmation flow.
   */
  appointmentId: string | null;
  kind: AutomationKind;
  to: string;
  body: string;
  /**
   * Optional callback URL. When set, Twilio POSTs delivery events
   * to it (delivered / failed / undelivered). The webhook handler
   * (Loop 55) reads it back to update `notification_sends.status`.
   */
  statusCallbackUrl?: string;
};

export type DispatchSmsResult =
  | { sent: true; sid: string }
  | { sent: false; reason: 'no-config' | 'no-encryption' | 'twilio-error' | 'disabled' };

export async function dispatchSms(input: DispatchSmsInput): Promise<DispatchSmsResult> {
  if (!encryptionConfigured()) return { sent: false, reason: 'no-encryption' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createSupabaseServiceRoleClient() as any;

  // Load the shop's Twilio creds. Service-role bypasses the
  // REVOKE on twilio_auth_token_enc.
  const shopRes = await admin
    .from('shops')
    .select('twilio_account_sid, twilio_auth_token_enc, twilio_from_number')
    .eq('id', input.shopId)
    .single();
  const cfg = shopRes.data as {
    twilio_account_sid: string | null;
    twilio_auth_token_enc: string | null;
    twilio_from_number: string | null;
  } | null;
  if (!cfg || !twilioConfiguredForShop(cfg)) {
    return { sent: false, reason: 'no-config' };
  }

  // Automation gate — same `notification_automations` table as
  // email but scoped to channel='sms'. Falls back to a `true`
  // default when no row exists (opt-in by default, owner can flip
  // off in /settings/notifications once the UI ships).
  const autoRes = await admin
    .from('notification_automations')
    .select('enabled')
    .eq('shop_id', input.shopId)
    .eq('kind', input.kind)
    .eq('channel', 'sms')
    .limit(1);
  const automation = ((autoRes.data as Array<{ enabled: boolean }> | null) ?? [])[0];
  if (automation && !automation.enabled) {
    return { sent: false, reason: 'disabled' };
  }

  // Twilio call — decrypt creds, fire, capture errors.
  try {
    const result = await sendSms(
      {
        accountSid: cfg.twilio_account_sid!,
        authToken: decrypt(cfg.twilio_auth_token_enc!),
        fromNumber: cfg.twilio_from_number!,
      },
      {
        to: input.to,
        body: input.body,
        statusCallback: input.statusCallbackUrl,
      },
    );
    if (!result.sent) {
      captureException(new Error(`[twilio] send failed: ${result.message ?? 'unknown'}`), {
        tags: { layer: 'sms-dispatch', status: String(result.status ?? '') },
        extra: { shopId: input.shopId, appointmentId: input.appointmentId },
      });

      // Loop 54 SR — a Twilio 4xx other than 401 is *permanent*:
      // a bad phone number (`To` malformed), a body length /
      // content rejection, a number-not-on-account error, etc.
      // Without a notification_sends row, the cron retries every
      // 15 min forever — flooding Sentry + Twilio's rate limiter.
      // We treat 401 as transient (operator can fix bad creds in
      // /settings/notifications) and 5xx as transient (Twilio
      // brownouts retry naturally on the next tick).
      //
      // Loop 62 — only write the failure row when appointmentId is
      // non-null. Marketing-campaign callers manage their own ledger
      // (client_marketing_sends).
      const httpStatus = result.status;
      const isPermanent =
        typeof httpStatus === 'number' &&
        httpStatus >= 400 &&
        httpStatus < 500 &&
        httpStatus !== 401;
      if (isPermanent && input.appointmentId !== null) {
        await admin
          .from('notification_sends')
          .insert({
            appointment_id: input.appointmentId,
            kind: input.kind,
            channel: 'sms',
            via: 'twilio',
            status: 'failed',
          })
          .select('id');
      }
      return { sent: false, reason: 'twilio-error' };
    }

    // Record the send in notification_sends. The unique constraint
    // on (appointment_id, kind, channel) guards against the rare
    // double-tick scenario. `provider_message_id` lets the Loop 55
    // status webhook find this row from the Twilio callback.
    //
    // Loop 62 — skip the ledger write when appointmentId is null
    // (marketing-campaign callers write to client_marketing_sends).
    if (input.appointmentId !== null) {
      await admin
        .from('notification_sends')
        .insert({
          appointment_id: input.appointmentId,
          kind: input.kind,
          channel: 'sms',
          via: 'twilio',
          provider_message_id: result.sid,
          status: result.status,
        })
        .select('id');
    }

    return { sent: true, sid: result.sid };
  } catch (e) {
    captureException(e, {
      tags: { layer: 'sms-dispatch' },
      extra: { shopId: input.shopId, appointmentId: input.appointmentId },
    });
    return { sent: false, reason: 'twilio-error' };
  }
}
