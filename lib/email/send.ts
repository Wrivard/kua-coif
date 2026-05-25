import type { ReactElement } from 'react';
import { render } from '@react-email/render';
import { getEmailConfig } from './client';
import { captureException } from '@/lib/observability';

/**
 * High-level email send. Renders a React Email template to HTML + plaintext
 * and hands it to Resend.
 *
 * **No-op when Resend isn't configured** (the dormant DSN-gated pattern).
 * Returns `{ sent: false, reason: 'no-config' }` so the caller can branch on
 * activation status without crashing the surrounding flow (e.g., a booking
 * mustn't fail just because Resend env vars aren't set).
 *
 * Logs all real errors through Sentry rather than throwing, again to keep
 * email failures from bubbling up to the user-facing request.
 */
export type SendEmailInput = {
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
  | { sent: true; id: string }
  | { sent: false; reason: 'no-config' | 'error' };

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const cfg = getEmailConfig();
  if (!cfg) return { sent: false, reason: 'no-config' };

  try {
    // `render()` returns a Promise<string> in newer @react-email/render
    // versions; awaiting handles both shapes.
    const html = await render(input.template);
    const text = input.text ?? (await render(input.template, { plainText: true }));

    const res = await cfg.client.emails.send({
      from: cfg.from,
      to: input.to,
      subject: input.subject,
      html,
      text,
      replyTo: input.replyTo ?? cfg.replyTo,
      tags: input.tags,
    });

    if (res.error || !res.data?.id) {
      captureException(res.error ?? new Error('Resend returned no id'), {
        tags: { layer: 'email-send', subject: input.subject },
      });
      return { sent: false, reason: 'error' };
    }
    return { sent: true, id: res.data.id };
  } catch (err) {
    captureException(err, {
      tags: { layer: 'email-send', subject: input.subject },
    });
    return { sent: false, reason: 'error' };
  }
}
