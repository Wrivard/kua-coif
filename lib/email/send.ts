import type { ReactElement } from 'react';
import { render } from '@react-email/render';
import { getEmailConfig } from './client';
import { getShopSmtpConfig, sendViaShopSmtp, type ShopSmtpConfig } from './smtp';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { captureException } from '@/lib/observability';

/**
 * Email dispatcher â€” single public entry point for outgoing transactional
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
 *      check the boolean â€” outbound mail is non-essential to the core
 *      booking flow, so a missing setup never crashes a request.
 *
 * Sentry captures real errors but never re-throws.
 */
export type AutomationKind =
  | 'booking_confirmation'
  | 'reminder_24h'
  | 'reminder_1h'
  | 'cancellation'
  | 'birthday'
  // Loop 42 (P122) â€” waitlist auto-notify on cancel. The automation
  // gate is intentionally permissive: when the shop's
  // notification_automations row for this kind is missing,
  // `isAutomationEnabled` returns true (opt-in by default). Shops
  // that don't want waitlist auto-emails can flip the toggle off in
  // /settings/notifications.
  | 'waitlist_open';

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
  /**
   * Plan 018 â€” optional pre-loaded config to skip this call's two internal
   * DB reads. A loop sending many emails for the same shops (reminder /
   * birthday / campaign crons) can batch-load both once per tick and pass
   * them down here. Each field is consulted independently:
   *   - `automationEnabled` present â†’ use it instead of the per-call
   *     `notification_automations` lookup (the gate).
   *   - `smtpCfg` KEY present (even when `null`) â†’ use it instead of the
   *     per-call `getShopSmtpConfig` lookup (`null` means "no shop SMTP â†’
   *     go straight to the Resend fallback").
   * Omit `preloaded` entirely (or omit a field) to keep the original
   * per-call lookup â€” the fallback path is identical.
   */
  preloaded?: { automationEnabled?: boolean; smtpCfg?: ShopSmtpConfig | null };
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
 * no row exists for that combo (failsafe â€” when the migration's seed
 * missed something, we prefer to send than silently drop).
 */
async function isAutomationEnabled(shopId: string, kind: AutomationKind): Promise<boolean> {
  const sb = createSupabaseServiceRoleClient();
  const { data } = await sb
    .from('notification_automations')
    .select('enabled')
    .eq('shop_id', shopId)
    .eq('kind', kind)
    .eq('channel', 'email')
    .limit(1);
  const row = ((data as Array<{ enabled: boolean }> | null) ?? [])[0];
  if (!row) return true; // missing seed row â€” opt-in by default
  return row.enabled;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  // â”€â”€ Automation gate (per shop + kind) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (input.shopId && input.kind) {
    try {
      // Plan 018 â€” use the preloaded flag when supplied (a batch caller already
      // read it); else fall back to the per-call lookup. `??` is safe here:
      // only undefined falls through, so a preloaded `false` correctly gates.
      const enabled =
        input.preloaded?.automationEnabled ?? (await isAutomationEnabled(input.shopId, input.kind));
      if (!enabled) return { sent: false, reason: 'disabled' };
    } catch (err) {
      // Gate lookup failed â€” log and continue to send. We'd rather send a
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

  // â”€â”€ Render once, reused by both transports â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let rendered: { html: string; text: string };
  try {
    rendered = await renderTemplate(input);
  } catch (err) {
    captureException(err, { tags: { layer: 'email-render', subject: input.subject } });
    return { sent: false, reason: 'error' };
  }

  // â”€â”€ 1. Shop SMTP (preferred when configured) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (input.shopId) {
    try {
      // Plan 018 â€” use the preloaded config when the caller supplied the
      // `smtpCfg` key (even `null` = "no shop SMTP, skip the lookup"); else
      // fall back to the per-call read.
      const cfg =
        input.preloaded && 'smtpCfg' in input.preloaded
          ? (input.preloaded.smtpCfg ?? null)
          : await getShopSmtpConfig(input.shopId);
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
        // SMTP failed â€” surface to Sentry then try the Resend fallback. A
        // common failure is a stale Gmail app-password the owner forgot to
        // rotate; we keep the user-facing flow working via the KÃ¼a path.
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

  // â”€â”€ 2. Resend fallback (KÃ¼a-branded) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ 3. Nothing configured â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return { sent: false, reason: 'no-transport' };
}
