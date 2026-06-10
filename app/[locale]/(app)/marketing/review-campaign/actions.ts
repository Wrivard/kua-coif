'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { logAuditAction } from '@/lib/audit-log';
import { signToken } from '@/lib/security/signed-tokens';
import { sendEmail, type AutomationKind } from '@/lib/email/send';
import { ReviewRequest } from '@/lib/email/templates/review-request';
import { dispatchSms } from '@/lib/sms/dispatch';
import { reviewRequestSms } from '@/lib/sms/templates';
import { twilioWebhookUrl } from '@/lib/sms/webhook';
import { sendReviewCampaignSchema } from './schema';

const PATH = '/marketing/review-campaign';

// 90 days — long enough that a client who clicks a week after the
// email arrives still sees the review form, short enough that a leaked
// token from years ago can't be replayed. Mirrors the per-appointment
// review token TTL used by the post-appointment email in Phase 25c.
const REVIEW_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;

type SendResult = {
  /** Total appointments processed (capped by schema at 200). */
  attempted: number;
  /** Email + SMS sends that succeeded (counted independently per channel). */
  sent: number;
  /** Channels skipped (no email/phone, already-asked, automation disabled). */
  skipped: number;
  /** Channels that errored (Resend/Twilio failure, decryption failure). */
  failed: number;
};

export const sendReviewCampaign = withAction<typeof sendReviewCampaignSchema, SendResult>({
  schema: sendReviewCampaignSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseServiceRoleClient() as any;

    // 1. Load the selected appointments + their clients + shop info.
    //    Re-verifies shop_id ownership defensively (the `withAction`
    //    wrapper already validates membership but not per-row scope).
    const apptsRes = await admin
      .from('appointments')
      .select(
        'id, shop_id, start_at, status, public_link_version, client:clients(id, first_name, email, phone, anonymized_at)',
      )
      .in('id', input.appointment_ids)
      .eq('shop_id', ctx.shopId);
    type ApptRow = {
      id: string;
      shop_id: string;
      start_at: string;
      status: string;
      public_link_version: number | null;
      client: {
        id: string;
        first_name: string;
        email: string | null;
        phone: string | null;
        anonymized_at: string | null;
      } | null;
    };
    const appts = (apptsRes.data as ApptRow[] | null) ?? [];
    if (appts.length === 0) return err('NOT_FOUND');

    // 2. Shop info for the email/SMS templates.
    const shopRes = await admin
      .from('shops')
      .select('id, name, default_language')
      .eq('id', ctx.shopId)
      .single();
    const shop = shopRes.data as { id: string; name: string; default_language: string } | null;
    if (!shop) return err('UNEXPECTED');
    const locale: 'fr' | 'en' = shop.default_language === 'en' ? 'en' : 'fr';

    // 3. Already-sent lookup — exclude appointments we've already
    //    asked about (recurrence_key = appointment_id). Same pattern
    //    as the birthday cron's batched alreadyEmail/alreadySms sets.
    const alreadyRes = await admin
      .from('client_marketing_sends')
      .select('recurrence_key, channel')
      .eq('kind', 'review_request')
      .in('recurrence_key', input.appointment_ids);
    const alreadyEmail = new Set<string>();
    const alreadySms = new Set<string>();
    for (const row of (alreadyRes.data as Array<{
      recurrence_key: string;
      channel: string;
    }> | null) ?? []) {
      if (row.channel === 'email') alreadyEmail.add(row.recurrence_key);
      if (row.channel === 'sms') alreadySms.add(row.recurrence_key);
    }

    // 4. Public app URL for the /review/[token] links. Falls back to
    //    relative path if NEXT_PUBLIC_APP_URL isn't set; the email
    //    client will render that as a broken link, which is preferable
    //    to silently sending no URL at all.
    const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? '';

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const appt of appts) {
      // Defense in depth — anonymized clients should never receive
      // marketing. The /marketing/review-campaign page filters them
      // out, but the action verifies again.
      if (!appt.client || appt.client.anonymized_at) {
        skipped += 1;
        continue;
      }

      const token = signToken({
        kind: 'review',
        resourceId: appt.id,
        expiresInSeconds: REVIEW_TOKEN_TTL_SECONDS,
        ver: appt.public_link_version ?? 0,
      });
      const reviewUrl = `${base}/${locale}/review/${encodeURIComponent(token)}`;

      // ── Email branch ─────────────────────────────────────────
      if (alreadyEmail.has(appt.id) || !appt.client.email) {
        skipped += 1;
      } else {
        const result = await sendEmail({
          shopId: shop.id,
          // Reuse the existing 'birthday' (or rather any) automation
          // gate — there's no 'review_request' AutomationKind. We
          // intentionally bypass the per-automation toggle here:
          // bulk review campaigns are operator-initiated, not
          // automated, so the matrix toggle doesn't apply.
          kind: undefined,
          to: appt.client.email,
          subject:
            locale === 'fr'
              ? `Comment s'est passée ta visite chez ${shop.name} ?`
              : `How was your visit at ${shop.name}?`,
          template: ReviewRequest({
            locale,
            shop: { name: shop.name },
            client: { firstName: appt.client.first_name },
            reviewUrl,
          }),
          tags: [
            { name: 'kind', value: 'review_request' },
            { name: 'shop', value: shop.id },
          ],
        });

        if (result.sent) {
          sent += 1;
          await admin
            .from('client_marketing_sends')
            .insert({
              shop_id: shop.id,
              client_id: appt.client.id,
              kind: 'review_request',
              channel: 'email',
              recurrence_key: appt.id,
              via: result.via,
            })
            .select('id');
        } else {
          failed += 1;
        }
      }

      // ── SMS branch ───────────────────────────────────────────
      if (alreadySms.has(appt.id) || !appt.client.phone) {
        skipped += 1;
      } else {
        const smsBody = reviewRequestSms({
          locale,
          shopName: shop.name,
          firstName: appt.client.first_name,
          reviewUrl,
        });
        const smsResult = await dispatchSms({
          shopId: shop.id,
          appointmentId: null, // we manage our own ledger
          // `kind` is required by the type but unused when
          // bypassAutomationGate=true. 'birthday' is a benign
          // placeholder — dispatchSms only reads `kind` for the
          // matrix-toggle lookup which we're now skipping.
          kind: 'birthday' satisfies AutomationKind,
          // Loop 63 SR — operator-initiated bulk send. Skip the
          // notification_automations gate so the campaign fires
          // regardless of which kinds the shop has toggled off.
          bypassAutomationGate: true,
          to: appt.client.phone,
          body: smsBody,
          statusCallbackUrl: twilioWebhookUrl(shop.id) ?? undefined,
        });

        if (smsResult.sent) {
          sent += 1;
          await admin
            .from('client_marketing_sends')
            .insert({
              shop_id: shop.id,
              client_id: appt.client.id,
              kind: 'review_request',
              channel: 'sms',
              recurrence_key: appt.id,
              via: 'twilio',
              provider_message_id: smsResult.sid,
            })
            .select('id');
        } else if (
          smsResult.reason === 'disabled' ||
          smsResult.reason === 'no-config' ||
          smsResult.reason === 'no-encryption'
        ) {
          skipped += 1;
        } else {
          failed += 1;
        }
      }
    }

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'custom',
      entity: 'client_marketing_sends',
      diff: {
        loi25_bulk_review_request: true,
        attempted: appts.length,
        sent,
        skipped,
        failed,
      },
    });

    revalidatePath(PATH);
    return ok({ attempted: appts.length, sent, skipped, failed });
  },
});
