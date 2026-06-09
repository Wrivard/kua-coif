/**
 * Post-appointment review request — Loop 64.
 *
 * Called from `updateAppointment` on the not-completed → completed
 * transition, alongside the loyalty award + QuickBooks sync. When a
 * visit wraps up and the client has an email on file, we ask them for
 * a review with the same signed-token link the bulk
 * /marketing/review-campaign uses.
 *
 * Two hard rules:
 *
 *   - **Best-effort.** A send failure must NEVER fail the underlying
 *     status update. Everything runs inside one try/catch that routes
 *     errors to Sentry; the caller invokes us via `void`.
 *
 *   - **Idempotent.** One ask per appointment, ever. We reuse the
 *     existing `client_marketing_sends` ledger
 *     (kind='review_request', channel='email',
 *     recurrence_key=appointment_id) — the SAME key the bulk campaign
 *     writes — so a re-toggle (completed → booked → completed) or an
 *     appointment already covered by a bulk send never double-mails.
 *     The ledger's UNIQUE (client_id, kind, channel, recurrence_key)
 *     is the backstop against a concurrent double-fire.
 *
 * The automation gate is intentionally bypassed (`kind: undefined` to
 * `sendEmail`): there is no 'review_request' AutomationKind, and this
 * mirrors how `sendReviewCampaign` already dispatches the identical
 * template. A per-shop toggle can land later via a new automation kind.
 */

import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { captureException } from '@/lib/observability';
import { signToken } from '@/lib/security/signed-tokens';
import { sendEmail } from '@/lib/email/send';
import { ReviewRequest } from '@/lib/email/templates/review-request';
import { buildUnsubscribeUrl } from '@/lib/email/unsubscribe';

// 90 days — long enough that a client clicking a week later still sees
// the form, short enough that a leaked token can't be replayed years
// on. Matches the TTL used by `sendReviewCampaign`.
const REVIEW_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;

export async function sendReviewRequestOnCompletion({
  shopId,
  appointmentId,
  clientId,
}: {
  shopId: string;
  appointmentId: string;
  /** Nullable: walk-in appointments (Phase 72) have no client row. */
  clientId: string | null;
}): Promise<void> {
  // Walk-in with no client → nobody to email.
  if (!clientId) return;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseServiceRoleClient() as any;

    // Client must exist, not be anonymized, and have an email. Defense
    // in depth on `anonymized_at` mirrors `sendReviewCampaign` — a
    // forgotten client must never receive marketing.
    const clientRes = await admin
      .from('clients')
      .select('first_name, email, anonymized_at, marketing_opted_out')
      .eq('id', clientId)
      .maybeSingle();
    const client = clientRes.data as {
      first_name: string;
      email: string | null;
      anonymized_at: string | null;
      marketing_opted_out: boolean | null;
    } | null;
    // CASL — skip anonymized clients and those who opted out of marketing.
    if (!client || client.anonymized_at || client.marketing_opted_out || !client.email) return;

    // Idempotency pre-check — already asked about THIS appointment?
    // recurrence_key = appointment_id, the same key the bulk campaign
    // writes, so the two paths can't both mail the same visit.
    const alreadyRes = await admin
      .from('client_marketing_sends')
      .select('id')
      .eq('kind', 'review_request')
      .eq('channel', 'email')
      .eq('recurrence_key', appointmentId)
      .limit(1);
    if (((alreadyRes.data as Array<{ id: string }> | null) ?? []).length > 0) return;

    // Shop info for the template + locale.
    const shopRes = await admin
      .from('shops')
      .select('name, default_language')
      .eq('id', shopId)
      .maybeSingle();
    const shop = shopRes.data as { name: string; default_language: string | null } | null;
    if (!shop) return;
    const locale: 'fr' | 'en' = shop.default_language === 'en' ? 'en' : 'fr';

    // Signed-token link to the public /review/[token] page. Falls back
    // to a relative path if NEXT_PUBLIC_APP_URL is unset (broken link
    // beats no link), same as `sendReviewCampaign`.
    const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? '';
    const token = signToken({
      kind: 'review',
      resourceId: appointmentId,
      expiresInSeconds: REVIEW_TOKEN_TTL_SECONDS,
    });
    const reviewUrl = `${base}/${locale}/review/${encodeURIComponent(token)}`;

    const result = await sendEmail({
      shopId,
      // No 'review_request' AutomationKind — bypass the matrix gate,
      // matching `sendReviewCampaign`.
      to: client.email,
      subject:
        locale === 'fr'
          ? `Comment s'est passée ta visite chez ${shop.name} ?`
          : `How was your visit at ${shop.name}?`,
      template: ReviewRequest({
        locale,
        shop: { name: shop.name },
        client: { firstName: client.first_name },
        reviewUrl,
        unsubscribeUrl: buildUnsubscribeUrl(clientId, locale),
      }),
      tags: [
        { name: 'kind', value: 'review_request' },
        { name: 'shop', value: shopId },
      ],
    });

    // Only record the ledger row on a real send. The UNIQUE constraint
    // makes a concurrent double-fire's second insert a no-op (caught
    // below), keeping "one ask per appointment" intact.
    if (result.sent) {
      await admin.from('client_marketing_sends').insert({
        shop_id: shopId,
        client_id: clientId,
        kind: 'review_request',
        channel: 'email',
        recurrence_key: appointmentId,
        via: result.via,
      });
    }
  } catch (e) {
    captureException(e, {
      tags: { layer: 'review-request', stage: 'on-completion' },
      extra: { shopId, appointmentId, clientId },
    });
  }
}
