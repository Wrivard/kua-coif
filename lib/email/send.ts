import type { ReactElement } from 'react';
import { render } from '@react-email/render';
import { getEmailConfig } from './client';
import { getShopSmtpConfig, sendViaShopSmtp } from './smtp';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { captureException } from '@/lib/observability';

/**
 * Email dispatcher — single public entry point for outgoing transactional
 * mail. Decides which transport to use **per call**:
 *
 *   1. If `shopId` + `kind` both supplied, check
 *      `notification_automations.enabled` for that combo. If the shop
 *      turned the automation off in `/settings/notifications`, no-op
 *      (returns `{ sent: false, reason: 'disabled' }`).
 *
 *   2. If `shopId` is supplied AND the shop has fully-configured SMTP
 *      credentials (host + port + user + password + from email), ship via
 *      nodemailer using their address. End-customer sees the email come
 *      from the salon's own domain.
 *
 *   3. Otherwise, fall back to Resend if `RESEND_API_KEY` + `RESEND_FROM`
 *      are set (i.e., the Phase 24 path). Email comes from
 *      `noreply@kua.quebec` but at least it goes out.
 *
 *   4. Otherwise, silent no-op (`reason: 'no-transport'`). Callers
 *      check the boolean — outbound mail is non-essential to the core
 *      booking flow, so a missing setup never crashes a request.
 *
 * Sentry captures real errors but never re-throws.
 */
export type AutomationKind =
  | 'booking_confirmation'
  | 'reminder_24h'
  | 'reminder_1h'
  | 'cancellation'
  | 'birthday';

export type SendEmailInput = {
  /** Shop the email belongs to. Required when you want the SMTP-per-shop
   *  path; omit only for system emails not tied to any single shop. */
  shopId?: string;
  /** Automation kind for the automations-toggle gate. Omit to bypass the
   *  gate (e.g., one-off admin emails outside the automation table). */
  kind?: AutomationKind;
  to: string | string[];
  subject: string;
  template: ReactElement;
  /** Optional plain-text fallback. If omitted, `@react-email/render` derives
   *  one from the HTML so corporate clients without HTML rendering still
   *  see something readable. */
  text?: string;
  /** Optional per-message reply-to override (e.g. send the salon's
   *  contact address rather than our generic noreply). */
  replyTo?: string;
  /** Free-form tags surfaced in Resend's dashboard for filtering / debugging. */
  tags?: Array<{ name: string; value: string }>;
};

export type SendEmailResult =
  | { sent: true; via: 'shop-smtp' | 'resend'; id: string }
  | { sent: false; reason: 'disabled' | 'no-transport' | 'error' };

/** Internal: render the React Email tree once, reused by both transports. */
async function renderTemplate(input: SendEmailInput): Promise<{ html: string; text: string }> {
  const html = await render(input.template);
  const text = input.text ?? (await render(input.template, { plainText: true }));
  return { html, text };
}

/**
 * Look up the (shop, kind, channel='email') row in
 * `notification_automations`. Returns `true` if the row says enabled, or if
 * no row exists for that combo (failsafe — when the migration's seed
 * missed something, we prefer to send than silently drop).
 */
async function isAutomationEnabled(shopId: string, kind: AutomationKind): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createSupabaseServiceRoleClient() as any;
  const { data } = await sb
    .from('notification_automations')
    .select('enabled')
    .eq('shop_id', shopId)
    .eq('kind', kind)
    .eq('channel', 'email')
    .limit(1);
  const row = ((data as Array<{ enabled: boolean }> | null) ?? [])[0];
  if (!row) return true; // missing seed row — opt-in by default
  return row.enabled;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  // ── Automation gate (per shop + kind) ───────────────────────────────
  if (input.shopId && input.kind) {
    try {
      const enabled = await isAutomationEnabled(input.shopId, input.kind);
      if (!enabled) return { sent: false, reason: 'disabled' };
    } catch (err) {
      // Gate lookup failed — log and continue to send. We'd rather send a
      // legitimate confirmation than swallow it because a SELECT errored.
      captureException(err, {
        tags: {
          layer: 'email-automation-gate',
          kind: input.kind,
          shopId: input.shopId,
        },
      });
    }
  }

  // ── Render once, reused by both transports ──────────────────────────
  let rendered: { html: string; text: string };
  try {
    rendered = await renderTemplate(input);
  } catch (err) {
    captureException(err, { tags: { layer: 'email-render', subject: input.subject } });
    return { sent: false, reason: 'error' };
  }

  // ── 1. Shop SMTP (preferred when configured) ────────────────────────
  if (input.shopId) {
    try {
      const cfg = await getShopSmtpConfig(input.shopId);
      if (cfg) {
        const result = await sendViaShopSmtp({
          cfg,
          to: input.to,
          subject: input.subject,
          html: rendered.html,
          text: rendered.text,
          replyTo: input.replyTo,
        });
        if (result.sent) return { sent: true, via: 'shop-smtp', id: result.messageId };
        // SMTP failed — surface to Sentry then try the Resend fallback. A
        // common failure is a stale Gmail app-password the owner forgot to
        // rotate; we keep the user-facing flow working via the Küa path.
        captureException(new Error(`Shop SMTP send failed: ${result.error}`), {
          tags: { layer: 'email-shop-smtp', shopId: input.shopId },
        });
      }
    } catch (err) {
      captureException(err, {
        tags: { layer: 'email-shop-smtp', shopId: input.shopId },
      });
    }
  }

  // ── 2. Resend fallback (Küa-branded) ────────────────────────────────
  const resend = getEmailConfig();
  if (resend) {
    try {
      const res = await resend.client.emails.send({
        from: resend.from,
        to: input.to,
        subject: input.subject,
        html: rendered.html,
        text: rendered.text,
        replyTo: input.replyTo ?? resend.replyTo,
        tags: input.tags,
      });
      if (res.error || !res.data?.id) {
        captureException(res.error ?? new Error('Resend returned no id'), {
          tags: { layer: 'email-resend', subject: input.subject },
        });
        return { sent: false, reason: 'error' };
      }
      return { sent: true, via: 'resend', id: res.data.id };
    } catch (err) {
      captureException(err, {
        tags: { layer: 'email-resend', subject: input.subject },
      });
      return { sent: false, reason: 'error' };
    }
  }

  // ── 3. Nothing configured ───────────────────────────────────────────
  return { sent: false, reason: 'no-transport' };
}
