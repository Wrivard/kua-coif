'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { logAuditAction } from '@/lib/audit-log';
import { encrypt, encryptionConfigured } from '@/lib/crypto/aes';
import { verifyShopSmtp } from '@/lib/email/smtp';
// Schemas live in `./schema` because Next.js `'use server'` files can only
// export async functions — Zod schemas are object values.
import { senderConfigSchema, testConnectionSchema, toggleAutomationSchema } from './schema';

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
      errorCode: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'INVALID_INPUT' | 'CONNECTION_FAILED';
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
  const { requireRoleInCurrentShop, requireShopMember } = await import('@/lib/auth/server');
  try {
    await requireShopMember();
    await requireRoleInCurrentShop('manager');
  } catch (e) {
    const code = e instanceof Error && e.message === 'NO_SHOP' ? 'FORBIDDEN' : 'UNAUTHENTICATED';
    return { ok: false, errorCode: code };
  }

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

export type AutomationRow = {
  id: string;
  kind: 'booking_confirmation' | 'reminder_24h' | 'reminder_1h' | 'cancellation' | 'birthday';
  channel: 'email' | 'sms';
  enabled: boolean;
};

export async function loadNotificationsState(shopId: string): Promise<{
  config: SenderConfigSnapshot;
  automations: AutomationRow[];
  encryptionReady: boolean;
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createSupabaseServiceRoleClient() as any;
  const [shopRes, autoRes] = await Promise.all([
    admin
      .from('shops')
      .select(
        'notification_from_email, notification_from_name, notification_smtp_host, notification_smtp_port, notification_smtp_user, notification_smtp_password_enc',
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
  } | null) ?? {
    notification_from_email: null,
    notification_from_name: null,
    notification_smtp_host: null,
    notification_smtp_port: null,
    notification_smtp_user: null,
    notification_smtp_password_enc: null,
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
    automations: (autoRes.data as AutomationRow[] | null) ?? [],
    encryptionReady: encryptionConfigured(),
  };
}
