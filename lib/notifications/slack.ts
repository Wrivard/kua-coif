import { isAllowedSlackWebhookHost } from '@/lib/security/ssrf';

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
  // Security audit #4 — host allow-list for webhook URLs. Pre-fix any
  // https:// URL was accepted; a malicious owner could point us at
  // internal IPs (instance metadata, Redis, etc.). The whitelist covers
  // the known Slack-compatible services; custom Mattermost endpoints
  // are explicitly opted-in via the *.mattermost.com suffix.
  if (!webhookUrl || !isAllowedSlackWebhookHost(webhookUrl)) return false;

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

/**
 * Phase B — chargeback / dispute notifier. Posted to the shop's Slack
 * webhook when Stripe fires `charge.dispute.created`.
 *
 * Disputes are time-sensitive — the shop has ~7 days to submit
 * evidence before auto-loss. Without this notification, the first
 * chargeback surprises the owner when they next check the Stripe
 * dashboard, often after the response window has closed.
 *
 * Fire-and-forget like the booking notifier; failures captured to
 * Sentry but never thrown. The dispute row in the `disputes` table is
 * the authoritative record; Slack is just the alert.
 *
 * Phase B SR (audit fix) — `reason` is now mapped to human-readable
 * text instead of the raw Stripe enum, and the whole notification
 * branches on `locale` so shops with `default_language='en'` get
 * English copy (matches the per-shop locale resolution used by the
 * reminder + birthday crons).
 */

/**
 * Map Stripe's dispute `reason` enum to human-readable text per locale.
 * Stripe's set is documented at
 * https://stripe.com/docs/api/disputes/object#dispute_object-reason.
 * Anything unrecognized falls back to the raw enum value (safer than
 * a blank message — gives the operator something to search for).
 */
function disputeReasonText(reason: string, locale: 'fr' | 'en'): string {
  const fr: Record<string, string> = {
    duplicate: 'Transaction en double',
    fraudulent: 'Fraude alléguée',
    subscription_canceled: 'Abonnement annulé',
    product_unacceptable: 'Produit inacceptable',
    product_not_received: 'Produit non reçu',
    unrecognized: 'Transaction non reconnue',
    credit_not_processed: 'Crédit non traité',
    general: 'Motif général',
    incorrect_account_details: 'Détails du compte incorrects',
    insufficient_funds: 'Fonds insuffisants',
    bank_cannot_process: 'Banque ne peut traiter',
    debit_not_authorized: 'Débit non autorisé',
    customer_initiated: 'Initié par le client',
  };
  const en: Record<string, string> = {
    duplicate: 'Duplicate transaction',
    fraudulent: 'Alleged fraud',
    subscription_canceled: 'Subscription canceled',
    product_unacceptable: 'Product unacceptable',
    product_not_received: 'Product not received',
    unrecognized: 'Unrecognized transaction',
    credit_not_processed: 'Credit not processed',
    general: 'General',
    incorrect_account_details: 'Incorrect account details',
    insufficient_funds: 'Insufficient funds',
    bank_cannot_process: 'Bank cannot process',
    debit_not_authorized: 'Debit not authorized',
    customer_initiated: 'Customer initiated',
  };
  const table = locale === 'en' ? en : fr;
  return table[reason] ?? reason;
}

export type SlackDisputePayload = {
  shopName: string;
  /** Per-shop locale resolution (see `shop.default_language`). */
  locale: 'fr' | 'en';
  amount: number; // dollars (not cents)
  reason: string; // Stripe enum value, e.g. 'fraudulent', 'product_not_received'
  evidenceDueByIso: string | null;
  stripeDashboardUrl: string;
};

export async function sendSlackDisputeNotification(
  webhookUrl: string,
  payload: SlackDisputePayload,
): Promise<boolean> {
  // Security audit #4 — see sendSlackBookingNotification for rationale.
  if (!webhookUrl || !isAllowedSlackWebhookHost(webhookUrl)) return false;

  const intlLocale = payload.locale === 'en' ? 'en-CA' : 'fr-CA';
  const amountFormatted = new Intl.NumberFormat(intlLocale, {
    style: 'currency',
    currency: 'CAD',
  }).format(payload.amount);
  const dueFormatted = payload.evidenceDueByIso
    ? new Date(payload.evidenceDueByIso).toLocaleString(intlLocale, {
        timeZone: 'America/Toronto',
        dateStyle: 'short',
        timeStyle: 'short',
      })
    : null;

  const reasonText = disputeReasonText(payload.reason, payload.locale);

  let dueLine: string;
  let headline: string;
  let reasonLabel: string;
  if (payload.locale === 'en') {
    headline = `🚨 *Chargeback received* — ${amountFormatted}`;
    reasonLabel = 'Reason';
    dueLine = dueFormatted
      ? `⏰ *Response required by* ${dueFormatted}`
      : '⏰ Response deadline: see Stripe dashboard';
  } else {
    headline = `🚨 *Contestation reçue (chargeback)* — ${amountFormatted}`;
    reasonLabel = 'Motif';
    dueLine = dueFormatted
      ? `⏰ *Réponse requise avant* ${dueFormatted}`
      : '⏰ Délai de réponse : voir le tableau de bord Stripe';
  }

  const text =
    `${headline}\n` +
    `📋 ${reasonLabel} : ${reasonText}\n` +
    `${dueLine}\n` +
    `🔗 ${payload.stripeDashboardUrl}`;

  const body = JSON.stringify({
    text,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text },
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
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      captureException(new Error(`Slack dispute webhook returned ${res.status}`), {
        tags: { layer: 'notifications', kind: 'slack-dispute', status: String(res.status) },
      });
      return false;
    }
    return true;
  } catch (e) {
    captureException(e, {
      tags: { layer: 'notifications', kind: 'slack-dispute' },
    });
    return false;
  }
}
