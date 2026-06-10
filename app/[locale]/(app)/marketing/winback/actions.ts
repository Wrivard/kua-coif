'use server';

import { revalidatePath } from 'next/cache';
import { appUrl } from '@/lib/env/app-url';
import { shopLocale } from '@/lib/i18n-locale';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { logAuditAction } from '@/lib/audit-log';
import { sendEmail, type AutomationKind } from '@/lib/email/send';
import { Winback } from '@/lib/email/templates/winback';
import { buildUnsubscribeUrl } from '@/lib/email/unsubscribe';
import { dispatchSms } from '@/lib/sms/dispatch';
import { winbackSms } from '@/lib/sms/templates';
import { twilioWebhookUrl } from '@/lib/sms/webhook';
import { sendWinbackSchema } from './schema';

const PATH = '/marketing/winback';

type SendResult = {
  attempted: number;
  sent: number;
  skipped: number;
  failed: number;
};

export const sendWinbackCampaign = withAction<typeof sendWinbackSchema, SendResult>({
  schema: sendWinbackSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseServiceRoleClient() as any;

    // 1. Load selected clients + shop info.
    const clientsRes = await admin
      .from('clients')
      .select('id, first_name, email, phone, anonymized_at, marketing_opted_out')
      .in('id', input.client_ids)
      .eq('shop_id', ctx.shopId);
    type ClientRow = {
      id: string;
      first_name: string;
      email: string | null;
      phone: string | null;
      anonymized_at: string | null;
      marketing_opted_out: boolean | null;
    };
    const clients = (clientsRes.data as ClientRow[] | null) ?? [];
    if (clients.length === 0) return err('NOT_FOUND');

    const shopRes = await admin
      .from('shops')
      .select('id, name, alias, default_language')
      .eq('id', ctx.shopId)
      .single();
    const shop = shopRes.data as {
      id: string;
      name: string;
      alias: string | null;
      default_language: string;
    } | null;
    if (!shop || !shop.alias) return err('UNEXPECTED');
    const locale = shopLocale(shop.default_language);

    // 2. Recurrence key — one winback per client per year per channel.
    //    Stops the operator from sending the same client multiple
    //    waves in the same calendar year. Tunable to YYYY-Qn (quarter)
    //    if a year ends up being too sparse a cap.
    const yearStr = String(new Date().getFullYear());

    // 3. Already-sent lookup for THIS year.
    const alreadyRes = await admin
      .from('client_marketing_sends')
      .select('client_id, channel')
      .eq('kind', 'winback')
      .eq('recurrence_key', yearStr)
      .in('client_id', input.client_ids);
    const alreadyEmail = new Set<string>();
    const alreadySms = new Set<string>();
    for (const row of (alreadyRes.data as Array<{ client_id: string; channel: string }> | null) ??
      []) {
      if (row.channel === 'email') alreadyEmail.add(row.client_id);
      if (row.channel === 'sms') alreadySms.add(row.client_id);
    }

    const base = appUrl();
    const bookingUrl = `${base}/${locale}/book/${encodeURIComponent(shop.alias)}`;

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const client of clients) {
      // CASL — skip anonymized clients and those who opted out of marketing.
      if (client.anonymized_at || client.marketing_opted_out) {
        skipped += 1;
        continue;
      }

      // ── Email branch ────────────────────────────────────────
      if (alreadyEmail.has(client.id) || !client.email) {
        skipped += 1;
      } else {
        const result = await sendEmail({
          shopId: shop.id,
          // Like the review-campaign: no AutomationKind for winback,
          // and we want the operator's click to be authoritative
          // (no matrix-gate). Omitting kind bypasses the gate.
          to: client.email,
          subject:
            locale === 'fr'
              ? `Tu nous manques, ${client.first_name} !`
              : `We miss you, ${client.first_name}!`,
          template: Winback({
            locale,
            shop: { name: shop.name },
            client: { firstName: client.first_name },
            bookingUrl,
            unsubscribeUrl: buildUnsubscribeUrl(client.id, locale),
          }),
          tags: [
            { name: 'kind', value: 'winback' },
            { name: 'shop', value: shop.id },
          ],
        });

        if (result.sent) {
          sent += 1;
          await admin
            .from('client_marketing_sends')
            .insert({
              shop_id: shop.id,
              client_id: client.id,
              kind: 'winback',
              channel: 'email',
              recurrence_key: yearStr,
              via: result.via,
            })
            .select('id');
        } else {
          failed += 1;
        }
      }

      // ── SMS branch ──────────────────────────────────────────
      if (alreadySms.has(client.id) || !client.phone) {
        skipped += 1;
      } else {
        const smsBody = winbackSms({
          locale,
          shopName: shop.name,
          firstName: client.first_name,
          bookingUrl,
        });
        const smsResult = await dispatchSms({
          shopId: shop.id,
          appointmentId: null, // marketing — own ledger
          // Placeholder kind; bypassAutomationGate=true short-circuits
          // the matrix lookup.
          kind: 'birthday' satisfies AutomationKind,
          bypassAutomationGate: true,
          to: client.phone,
          body: smsBody,
          statusCallbackUrl: twilioWebhookUrl(shop.id) ?? undefined,
        });

        if (smsResult.sent) {
          sent += 1;
          await admin
            .from('client_marketing_sends')
            .insert({
              shop_id: shop.id,
              client_id: client.id,
              kind: 'winback',
              channel: 'sms',
              recurrence_key: yearStr,
              via: 'twilio',
              provider_message_id: smsResult.sid,
            })
            .select('id');
        } else if (smsResult.reason === 'no-config' || smsResult.reason === 'no-encryption') {
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
        loi25_bulk_winback: true,
        attempted: clients.length,
        sent,
        skipped,
        failed,
      },
    });

    revalidatePath(PATH);
    return ok({ attempted: clients.length, sent, skipped, failed });
  },
});
