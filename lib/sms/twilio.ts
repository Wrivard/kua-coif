/**
 * Loop 53 (P100 slice 1 from AUDIT_PHASE70) — Twilio REST client.
 *
 * Plain `fetch` against Twilio's Messages endpoint. We don't use
 * the `twilio` npm SDK because:
 *   - It's ~1.5MB on disk, vs. ~50 lines here
 *   - It requires a runtime config of Account SID + Auth Token at
 *     module load, which doesn't fit per-shop credentials (we need
 *     to swap creds per call)
 *   - The 2-3 endpoints we'll ever call (messages.create, the
 *     status webhook callback, optional message status fetch) are
 *     all trivially expressible as HTTP requests
 *
 * Docs:
 *   https://www.twilio.com/docs/messaging/api/message-resource
 *
 * Activation path (per shop, configured in /settings/notifications
 * — UI deferred to a follow-up loop):
 *   1. Owner creates a Twilio account at twilio.com
 *   2. Buys a Canadian phone number (or verifies an existing one)
 *   3. Pastes Account SID + Auth Token + From number into the shop
 *      settings — we encrypt the auth token via the existing
 *      NOTIFICATION_ENCRYPTION_KEY
 *   4. Toggles `sms` automations on in the notification matrix
 *
 * Until step 3 is complete for a given shop, `twilioConfiguredForShop`
 * returns false and the SMS dispatcher silently no-ops for that
 * shop.
 */

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';

export type TwilioShopCreds = {
  accountSid: string;
  /** Plaintext auth token. The caller decrypts before passing. */
  authToken: string;
  /** E.164 sender number, e.g. `+15145551212`. */
  fromNumber: string;
};

export type SendSmsInput = {
  /** E.164 destination, e.g. `+15145551212`. */
  to: string;
  /** SMS body — Twilio splits at 160 GSM-7 chars / 70 UCS-2 chars. */
  body: string;
  /** Optional Twilio status callback URL — Twilio POSTs delivery
   *  events here (delivered / failed / undelivered). */
  statusCallback?: string;
};

export type SendSmsResult =
  | { sent: true; sid: string; status: string }
  | { sent: false; reason: 'twilio-error'; status?: number; message?: string };

function basicAuthHeader(accountSid: string, authToken: string): string {
  return 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');
}

/**
 * Twilio reports cred-shape problems with a 401 + JSON body
 * { code, message, more_info, status }. We return a typed failure
 * so the caller can decide whether to flag the shop's config as
 * broken (the future "test SMS" button in settings) vs treat as
 * transient.
 */
export async function sendSms(creds: TwilioShopCreds, input: SendSmsInput): Promise<SendSmsResult> {
  const body = new URLSearchParams({
    From: creds.fromNumber,
    To: input.to,
    Body: input.body,
  });
  if (input.statusCallback) body.set('StatusCallback', input.statusCallback);

  const res = await fetch(
    `${TWILIO_API_BASE}/Accounts/${encodeURIComponent(creds.accountSid)}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(creds.accountSid, creds.authToken),
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
      cache: 'no-store',
    },
  );

  if (!res.ok) {
    let message: string | undefined;
    try {
      const errJson = (await res.json()) as { message?: string };
      message = errJson.message;
    } catch {
      message = await res.text().catch(() => undefined);
    }
    return { sent: false, reason: 'twilio-error', status: res.status, message };
  }

  type TwilioMessageResponse = {
    sid: string;
    status: string;
  };
  const data = (await res.json()) as TwilioMessageResponse;
  return { sent: true, sid: data.sid, status: data.status };
}

/**
 * `true` when the shop has all three Twilio columns populated.
 * Caller is responsible for decrypting `twilio_auth_token_enc`
 * before passing to `sendSms` — see `lib/crypto/aes.ts`.
 */
export function twilioConfiguredForShop(args: {
  twilio_account_sid: string | null;
  twilio_auth_token_enc: string | null;
  twilio_from_number: string | null;
}): boolean {
  return Boolean(args.twilio_account_sid && args.twilio_auth_token_enc && args.twilio_from_number);
}
