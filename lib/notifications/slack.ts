/**
 * Loop 33 (Phase 90) — Slack incoming-webhook dispatcher.
 *
 * Owner-facing channel for new-booking events (and future event types).
 * Slack's incoming webhooks accept a simple JSON `{text: string, blocks?: ...}`
 * payload — we send a compact `text` summary plus a `blocks` array for
 * richer formatting in clients that support it (Slack, Discord with
 * a Slack-compatible bridge, etc.).
 *
 * Fire-and-forget by design: a Slack outage MUST NOT block a customer
 * booking. The caller wraps each dispatch in a try/catch with Sentry
 * fallback.
 *
 * Security note: the webhook URL is a bearer credential — anyone with
 * it can post to the configured Slack channel. The URL never leaves
 * server-side code, never gets logged, and the audit_log records the
 * fact of a notification, never the URL.
 */

import { captureException } from '@/lib/observability';

export type SlackBookingPayload = {
  shopName: string;
  clientName: string;
  barberName: string;
  startAtIso: string;
  serviceNames: string[];
  totalAmount: number;
  source: 'admin' | 'online';
};

/**
 * POST a "new booking" notification to a Slack incoming webhook.
 *
 * Returns true on success, false on any failure (network, non-2xx
 * response, malformed URL). Failures are sent to Sentry but never
 * thrown — the caller assumes best-effort.
 *
 * The URL format Slack expects is
 *   https://hooks.slack.com/services/<TEAM>/<CHANNEL>/<SECRET>
 * but we don't validate the host — Discord (`/api/webhooks/...`) and
 * Mattermost expose Slack-compatible endpoints that accept the same
 * JSON shape, and locking the column to hooks.slack.com would prevent
 * shops from using those.
 */
export async function sendSlackBookingNotification(
  webhookUrl: string,
  payload: SlackBookingPayload,
): Promise<boolean> {
  if (!webhookUrl || !webhookUrl.startsWith('https://')) return false;

  const sourceEmoji = payload.source === 'online' ? '🌐' : '🪑';
  const formattedStart = new Date(payload.startAtIso).toLocaleString('fr-CA', {
    timeZone: 'America/Toronto',
    dateStyle: 'short',
    timeStyle: 'short',
  });
  const totalFormatted = new Intl.NumberFormat('fr-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(payload.totalAmount);
  const services = payload.serviceNames.join(', ');

  const text =
    `${sourceEmoji} *Nouvelle réservation* — ${payload.clientName} avec ${payload.barberName}\n` +
    `📅 ${formattedStart}\n` +
    `✂️ ${services}\n` +
    `💵 ${totalFormatted}`;

  const body = JSON.stringify({
    text,
    // `blocks` gives Slack a richer rendering; clients that don't
    // support blocks fall back to `text`. We keep the block list short
    // — a single section keeps mobile previews readable.
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text,
        },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `_${payload.shopName}_` }],
      },
    ],
  });

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      // Slack typically responds in <500ms; cap at 5s so a hung
      // webhook can't gum up the booking action that called us.
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      captureException(new Error(`Slack webhook returned ${res.status}`), {
        tags: { layer: 'notifications', kind: 'slack', status: String(res.status) },
      });
      return false;
    }
    return true;
  } catch (e) {
    captureException(e, {
      tags: { layer: 'notifications', kind: 'slack' },
    });
    return false;
  }
}
