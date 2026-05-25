/**
 * Per-shop SMTP transport — Phase 25.
 *
 * When a shop fills in its own SMTP credentials in `/settings/notifications`,
 * outgoing emails go via this module instead of our Resend fallback. The
 * salon's clients then see the email come from `noreply@theirsalon.com`
 * rather than `noreply@kua.quebec`.
 *
 * Storage shape (in `shops`):
 *   - `notification_from_email`           (e.g., `noreply@salon.com`)
 *   - `notification_from_name`            (e.g., `Salon Axum`)
 *   - `notification_smtp_host`            (e.g., `smtp.gmail.com`)
 *   - `notification_smtp_port`            (587 or 465)
 *   - `notification_smtp_user`            (often = from_email)
 *   - `notification_smtp_password_enc`    (AES-256-GCM blob, cf. lib/crypto/aes.ts)
 *
 * Anything missing → `getShopSmtpConfig` returns null and the dispatcher
 * falls back to Resend.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { decrypt, encryptionConfigured } from '@/lib/crypto/aes';
import { captureException } from '@/lib/observability';

export type ShopSmtpConfig = {
  fromEmail: string;
  fromName: string | null;
  host: string;
  port: number;
  user: string;
  password: string;
};

/**
 * Look up the shop's SMTP config via service-role (the encrypted-password
 * column is REVOKE'd from anon + authenticated). Decrypts the password and
 * returns a ready-to-use config, or `null` when any required field is
 * missing — host alone isn't enough, the dispatcher needs all five.
 */
export async function getShopSmtpConfig(shopId: string): Promise<ShopSmtpConfig | null> {
  if (!encryptionConfigured()) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createSupabaseServiceRoleClient() as any;
  const { data } = await sb
    .from('shops')
    .select(
      'notification_from_email, notification_from_name, notification_smtp_host, notification_smtp_port, notification_smtp_user, notification_smtp_password_enc',
    )
    .eq('id', shopId)
    .single();
  if (!data) return null;

  const {
    notification_from_email: fromEmail,
    notification_from_name: fromName,
    notification_smtp_host: host,
    notification_smtp_port: port,
    notification_smtp_user: user,
    notification_smtp_password_enc: passwordEnc,
  } = data as {
    notification_from_email: string | null;
    notification_from_name: string | null;
    notification_smtp_host: string | null;
    notification_smtp_port: number | null;
    notification_smtp_user: string | null;
    notification_smtp_password_enc: string | null;
  };

  if (!fromEmail || !host || !port || !user || !passwordEnc) return null;

  try {
    const password = decrypt(passwordEnc);
    return { fromEmail, fromName, host, port, user, password };
  } catch (err) {
    // Bad ciphertext / key rotated without re-encrypt → log + treat as
    // unconfigured so we fall back to Resend instead of throwing in a
    // booking flow.
    captureException(err, { tags: { layer: 'smtp-config', shopId } });
    return null;
  }
}

/**
 * Build a nodemailer transport from a resolved SMTP config. Connection
 * pooling on so a burst of reminders (Phase 25c cron) reuses the same TCP
 * session instead of opening one per send.
 */
function buildTransport(cfg: ShopSmtpConfig): Transporter {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    // 465 is the historical SMTPS port (TLS from the start); 587 uses
    // STARTTLS (cleartext upgrade). nodemailer infers correctly from the
    // port number when `secure` is left at its default for 465, but we set
    // it explicitly so a misconfigured port doesn't accidentally send
    // creds in cleartext.
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.password },
    pool: true,
    maxConnections: 3,
    maxMessages: 50,
  });
}

export type SmtpSendInput = {
  cfg: ShopSmtpConfig;
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
};

export type SmtpSendResult = { sent: true; messageId: string } | { sent: false; error: string };

/**
 * Low-level sender. `dispatch.ts` is the only intended caller; surface it
 * here for the "Test connection" Server Action too.
 */
export async function sendViaShopSmtp(input: SmtpSendInput): Promise<SmtpSendResult> {
  const transport = buildTransport(input.cfg);
  try {
    const fromAddr = input.cfg.fromName
      ? `"${input.cfg.fromName}" <${input.cfg.fromEmail}>`
      : input.cfg.fromEmail;
    const info = await transport.sendMail({
      from: fromAddr,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      replyTo: input.replyTo,
    });
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown SMTP error';
    return { sent: false, error: message };
  } finally {
    // Best-effort cleanup of the pooled connections — nodemailer's docs
    // recommend `close()` when the transport is one-shot. For long-running
    // processes you'd reuse the transport; serverless invocations always
    // shut down anyway, so close-or-leak is a wash.
    transport.close();
  }
}

/**
 * One-shot "ping" — opens a connection, authenticates, closes. Surfaced in
 * the /settings/notifications UI's "Test connection" button so the user
 * gets a green check before they save credentials they think work.
 */
export async function verifyShopSmtp(cfg: ShopSmtpConfig): Promise<SmtpSendResult> {
  const transport = buildTransport(cfg);
  try {
    await transport.verify();
    return { sent: true, messageId: 'verify-only' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown SMTP error';
    return { sent: false, error: message };
  } finally {
    transport.close();
  }
}
