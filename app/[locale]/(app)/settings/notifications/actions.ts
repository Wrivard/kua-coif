'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { logAuditAction } from '@/lib/audit-log';
import { encrypt, encryptionConfigured } from '@/lib/crypto/aes';
import { verifyShopSmtp } from '@/lib/email/smtp';
import { checkRateLimit } from '@/lib/auth/rate-limit';
// Schemas live in `./schema` because Next.js `'use server'` files can only
// export async functions — Zod schemas are object values.
import {
  senderConfigSchema,
  slackWebhookSchema,
  testConnectionSchema,
  toggleAutomationSchema,
  twilioConfigSchema,
  twilioTestSchema,
} from './schema';
import { sendSms } from '@/lib/sms/twilio';

const PATH = '/settings/notifications';

/**
 * Save the shop's SMTP credentials. Encryption happens at the column-level
 * value here (`encrypt(smtp_password)`), and the `notification_smtp_password_enc`
 * column has `REVOKE SELECT` from authenticated/anon — only service-role
 * reads it back, which is the dispatcher.
 *
 * When `smtp_password` is the empty string, we **preserve** the existing
 * ciphertext (the form is write-only). When `null` is explicitly meant
 * — i.e., the user wants to clear the password — the UI exposes a separate
 * "Disconnect SMTP" button that calls `clearSenderConfig` instead.
 */
export const upsertSenderConfig = withAction({
  schema: senderConfigSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    if (input.smtp_password && !encryptionConfigured()) {
      // Server is missing NOTIFICATION_ENCRYPTION_KEY. Refuse rather than
      // store plaintext or trash. The UI surfaces a banner pointing the
      // user at the README's setup section.
      return err('UNEXPECTED');
    }

    const patch: Record<string, unknown> = {
      notification_from_email: input.from_email || null,
      notification_from_name: input.from_name || null,
      notification_smtp_host: input.smtp_host || null,
      notification_smtp_port: input.smtp_port ?? null,
      notification_smtp_user: input.smtp_user || null,
    };
    if (input.smtp_password) {
      patch.notification_smtp_password_enc = encrypt(input.smtp_password);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createSupabaseServerClient() as any;
    const { error } = await sb.from('shops').update(patch).eq('id', ctx.shopId);
    if (error) return err('UNEXPECTED');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'shops',
      entityId: ctx.shopId,
      // Never persist the plaintext password — `passwordRotated: true`
      // flags rotations without leaking the value.
      diff: {
        after: {
          notification_from_email: patch.notification_from_email,
          notification_from_name: patch.notification_from_name,
          notification_smtp_host: patch.notification_smtp_host,
          notification_smtp_port: patch.notification_smtp_port,
          notification_smtp_user: patch.notification_smtp_user,
          passwordRotated: Boolean(input.smtp_password),
        },
      },
    });
    revalidatePath(PATH);
    return ok({ ok: true });
  },
});

/**
 * Clears every notification_smtp_* column. Email then falls back to Resend
 * (or no-op if Resend isn't configured either).
 */
export const clearSenderConfig = withAction({
  minRole: 'manager',
  run: async (_input, ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createSupabaseServerClient() as any;
    const { error } = await sb
      .from('shops')
      .update({
        notification_from_email: null,
        notification_from_name: null,
        notification_smtp_host: null,
        notification_smtp_port: null,
        notification_smtp_user: null,
        notification_smtp_password_enc: null,
      })
      .eq('id', ctx.shopId);
    if (error) return err('UNEXPECTED');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'shops',
      entityId: ctx.shopId,
      diff: { smtpCleared: true },
    });
    revalidatePath(PATH);
    return ok({ ok: true });
  },
});

// ---------------------------------------------------------------------------
// Test connection (verify SMTP creds without saving them)
// ---------------------------------------------------------------------------

export type TestConnectionResult =
  | { ok: true }
  | {
      ok: false;
      errorCode:
        | 'UNAUTHENTICATED'
        | 'FORBIDDEN'
        | 'INVALID_INPUT'
        | 'CONNECTION_FAILED'
        | 'RATE_LIMITED';
      message?: string;
    };

/**
 * Verify SMTP credentials against the live server **without persisting**
 * them. Returns a structured result so the UI can show the actual error
 * message Resend / Gmail / Outlook returns (auth failed, host unreachable,
 * etc.) — that's exactly what the user needs to debug.
 *
 * Not wrapped in `withAction` because the result shape isn't a standard
 * `Result<T>` — the carried error text is useful diagnostic info that the
 * generic error-code mapping would erase.
 */
export async function testSmtpConnection(raw: unknown): Promise<TestConnectionResult> {
  const parsed = testConnectionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errorCode: 'INVALID_INPUT' };

  // Auth check inline (no `withAction` wrapper).
  const { getCurrentUser, requireRoleInCurrentShop, requireShopMember } =
    await import('@/lib/auth/server');
  try {
    await requireShopMember();
    await requireRoleInCurrentShop('manager');
  } catch (e) {
    const code = e instanceof Error && e.message === 'NO_SHOP' ? 'FORBIDDEN' : 'UNAUTHENTICATED';
    return { ok: false, errorCode: code };
  }

  // Security audit #10 — rate-limit this endpoint. Without a cap, an
  // authenticated manager could (a) hammer arbitrary SMTP creds to
  // DoS the third-party server, (b) leverage the verify path as an
  // internal port-scanner (the SSRF check in verifyShopSmtp blocks
  // private IPs but each attempt still costs a TCP open + auth
  // round-trip). 5/hour per user is generous for legitimate "test
  // before save" UX.
  const user = await getCurrentUser();
  const rateKey = `smtp-test:${user?.id ?? 'anon'}`;
  const rl = await checkRateLimit(rateKey, { max: 5, windowMs: 60 * 60 * 1000 });
  if (!rl.allowed) return { ok: false, errorCode: 'RATE_LIMITED' };

  const result = await verifyShopSmtp({
    fromEmail: parsed.data.from_email,
    fromName: parsed.data.from_name || null,
    host: parsed.data.smtp_host,
    port: parsed.data.smtp_port,
    user: parsed.data.smtp_user,
    password: parsed.data.smtp_password,
  });
  if (result.sent) return { ok: true };
  return { ok: false, errorCode: 'CONNECTION_FAILED', message: result.error };
}

// ---------------------------------------------------------------------------
// Loop 33 (Phase 90) — Slack webhook URL for owner notifications
// ---------------------------------------------------------------------------
//
// The URL is a bearer credential — column-level GRANT was REVOKEd
// from authenticated/anon in the migration, so RLS can't surface it
// even if the client tried to read directly. The audit log records
// the FACT of a change, never the URL value.

export const upsertSlackWebhook = withAction({
  schema: slackWebhookSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const next = input.slack_webhook_url.trim();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createSupabaseServerClient() as any;
    const { error } = await sb
      .from('shops')
      .update({ slack_webhook_url: next === '' ? null : next })
      .eq('id', ctx.shopId);
    if (error) return err('UNEXPECTED');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'shops',
      entityId: ctx.shopId,
      diff: { slack_webhook_url_set: next !== '' },
    });
    revalidatePath(PATH);
    return ok({ ok: true });
  },
});

// ---------------------------------------------------------------------------
// Loop 56 (P100 slice 4) — Twilio SMS credentials
// ---------------------------------------------------------------------------
//
// Mirrors the SMTP pattern: write-only auth_token (blank preserves
// existing ciphertext), encrypted via the same NOTIFICATION_ENCRYPTION_KEY,
// audit log records the FACT of rotation never the value. account_sid +
// from_number stay plaintext columns (not secrets — public on Twilio's
// console and required for the REST URL anyway).

export const upsertTwilioConfig = withAction({
  schema: twilioConfigSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    if (input.twilio_auth_token && !encryptionConfigured()) {
      return err('UNEXPECTED');
    }

    const patch: Record<string, unknown> = {
      twilio_account_sid: input.twilio_account_sid || null,
      twilio_from_number: input.twilio_from_number || null,
    };
    if (input.twilio_auth_token) {
      patch.twilio_auth_token_enc = encrypt(input.twilio_auth_token);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createSupabaseServerClient() as any;
    const { error } = await sb.from('shops').update(patch).eq('id', ctx.shopId);
    if (error) return err('UNEXPECTED');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'shops',
      entityId: ctx.shopId,
      diff: {
        after: {
          twilio_account_sid: patch.twilio_account_sid,
          twilio_from_number: patch.twilio_from_number,
          authTokenRotated: Boolean(input.twilio_auth_token),
        },
      },
    });
    revalidatePath(PATH);
    return ok({ ok: true });
  },
});

export const clearTwilioConfig = withAction({
  minRole: 'manager',
  run: async (_input, ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createSupabaseServerClient() as any;
    const { error } = await sb
      .from('shops')
      .update({
        twilio_account_sid: null,
        twilio_auth_token_enc: null,
        twilio_from_number: null,
      })
      .eq('id', ctx.shopId);
    if (error) return err('UNEXPECTED');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'shops',
      entityId: ctx.shopId,
      diff: { twilioCleared: true },
    });
    revalidatePath(PATH);
    return ok({ ok: true });
  },
});

export type TestTwilioResult =
  | { ok: true; sid: string }
  | {
      ok: false;
      errorCode: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'INVALID_INPUT' | 'SEND_FAILED' | 'RATE_LIMITED';
      message?: string;
    };

/**
 * Send a real SMS to the operator's own phone to validate Twilio creds
 * end-to-end. Doesn't persist anything — if validation passes the operator
 * still hits "Save" to write the creds. Not wrapped in `withAction` because
 * we want to surface Twilio's actual error message (bad SID, unverified
 * number, etc.) which `withAction`'s typed error codes can't carry.
 */
export async function testTwilioConfig(raw: unknown): Promise<TestTwilioResult> {
  const parsed = twilioTestSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errorCode: 'INVALID_INPUT' };

  const { getCurrentUser, requireRoleInCurrentShop, requireShopMember } =
    await import('@/lib/auth/server');
  try {
    await requireShopMember();
    await requireRoleInCurrentShop('manager');
  } catch (e) {
    const code = e instanceof Error && e.message === 'NO_SHOP' ? 'FORBIDDEN' : 'UNAUTHENTICATED';
    return { ok: false, errorCode: code };
  }

  // Security audit #10 — rate-limit. Twilio test sends a REAL SMS to
  // a manager-supplied number; without a cap a compromised session
  // could (a) spam an arbitrary phone (Twilio bills per send), (b)
  // probe Twilio creds. 5/hour per user covers legitimate setup.
  const user = await getCurrentUser();
  const rateKey = `twilio-test:${user?.id ?? 'anon'}`;
  const rl = await checkRateLimit(rateKey, { max: 5, windowMs: 60 * 60 * 1000 });
  if (!rl.allowed) return { ok: false, errorCode: 'RATE_LIMITED' };

  const result = await sendSms(
    {
      accountSid: parsed.data.twilio_account_sid,
      authToken: parsed.data.twilio_auth_token,
      fromNumber: parsed.data.twilio_from_number,
    },
    {
      to: parsed.data.test_to_number,
      // Fixed bilingual body — the test is for the OPERATOR, who set up
      // the shop and reads both languages on the settings page. Cheap to
      // ship in one segment for most carriers.
      body: 'Küa — test SMS / SMS de test. Twilio is configured correctly. ✓',
    },
  );
  if (result.sent) return { ok: true, sid: result.sid };
  return { ok: false, errorCode: 'SEND_FAILED', message: result.message };
}

// ---------------------------------------------------------------------------
// Automation toggles
// ---------------------------------------------------------------------------

export const toggleAutomation = withAction({
  schema: toggleAutomationSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createSupabaseServerClient() as any;
    const { error } = await sb
      .from('notification_automations')
      .update({ enabled: input.enabled })
      .eq('id', input.id)
      .eq('shop_id', ctx.shopId); // belt-and-braces; RLS already covers
    if (error) return err('UNEXPECTED');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'notification_automations',
      entityId: input.id,
      diff: { enabled: input.enabled },
    });
    revalidatePath(PATH);
    return ok({ ok: true });
  },
});

// ---------------------------------------------------------------------------
// Helper: fetch the shop's current sender config + automations for the page.
// Service-role read so we get the `has_password` flag (the encrypted column
// is REVOKE'd from authenticated). Never returns the ciphertext itself.
// ---------------------------------------------------------------------------

export type SenderConfigSnapshot = {
  fromEmail: string;
  fromName: string;
  smtpHost: string;
  smtpPort: number | null;
  smtpUser: string;
  hasPassword: boolean;
};

export type TwilioConfigSnapshot = {
  accountSid: string;
  fromNumber: string;
  // hasAuthToken stays a boolean — we never echo the encrypted value back
  // to the browser. Same write-only pattern as the SMTP password.
  hasAuthToken: boolean;
};

export type AutomationRow = {
  id: string;
  // Loop 42 — `waitlist_open` added so the kind matches AutomationKind
  // in lib/email/send.ts. UI exposes it in AUTOMATION_ORDER between
  // cancellation and birthday so the owner can toggle it off.
  kind:
    | 'booking_confirmation'
    | 'reminder_24h'
    | 'reminder_1h'
    | 'cancellation'
    | 'waitlist_open'
    | 'birthday';
  channel: 'email' | 'sms';
  enabled: boolean;
};

export async function loadNotificationsState(shopId: string): Promise<{
  config: SenderConfigSnapshot;
  twilio: TwilioConfigSnapshot;
  slackWebhookConfigured: boolean;
  automations: AutomationRow[];
  encryptionReady: boolean;
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createSupabaseServiceRoleClient() as any;
  const [shopRes, autoRes] = await Promise.all([
    admin
      .from('shops')
      // Loop 33 — `slack_webhook_url` selected so we can surface a
      // "Connected" badge without ever sending the URL to the client.
      // The page passes only a boolean down to the form.
      .select(
        // Loop 56 — `twilio_*` columns added so the page can render the
        // SMS-creds section without a second roundtrip. The auth token
        // ciphertext is fetched only to set the `hasAuthToken` boolean;
        // never sent down to the browser.
        'notification_from_email, notification_from_name, notification_smtp_host, notification_smtp_port, notification_smtp_user, notification_smtp_password_enc, slack_webhook_url, twilio_account_sid, twilio_auth_token_enc, twilio_from_number',
      )
      .eq('id', shopId)
      .single(),
    admin
      .from('notification_automations')
      .select('id, kind, channel, enabled')
      .eq('shop_id', shopId)
      .order('channel', { ascending: true })
      .order('kind', { ascending: true }),
  ]);

  const shop = (shopRes.data as {
    notification_from_email: string | null;
    notification_from_name: string | null;
    notification_smtp_host: string | null;
    notification_smtp_port: number | null;
    notification_smtp_user: string | null;
    notification_smtp_password_enc: string | null;
    slack_webhook_url: string | null;
    twilio_account_sid: string | null;
    twilio_auth_token_enc: string | null;
    twilio_from_number: string | null;
  } | null) ?? {
    notification_from_email: null,
    notification_from_name: null,
    notification_smtp_host: null,
    notification_smtp_port: null,
    notification_smtp_user: null,
    notification_smtp_password_enc: null,
    slack_webhook_url: null,
    twilio_account_sid: null,
    twilio_auth_token_enc: null,
    twilio_from_number: null,
  };

  return {
    config: {
      fromEmail: shop.notification_from_email ?? '',
      fromName: shop.notification_from_name ?? '',
      smtpHost: shop.notification_smtp_host ?? '',
      smtpPort: shop.notification_smtp_port,
      smtpUser: shop.notification_smtp_user ?? '',
      hasPassword: Boolean(shop.notification_smtp_password_enc),
    },
    twilio: {
      accountSid: shop.twilio_account_sid ?? '',
      fromNumber: shop.twilio_from_number ?? '',
      hasAuthToken: Boolean(shop.twilio_auth_token_enc),
    },
    slackWebhookConfigured: Boolean(shop.slack_webhook_url),
    automations: (autoRes.data as AutomationRow[] | null) ?? [],
    encryptionReady: encryptionConfigured(),
  };
}
