import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { sendEmail, type AutomationKind } from '@/lib/email/send';
import { BirthdayGreeting } from '@/lib/email/templates/birthday-greeting';
import { dispatchSms } from '@/lib/sms/dispatch';
import { birthdayGreetingSms } from '@/lib/sms/templates';
import { twilioWebhookUrl } from '@/lib/sms/webhook';
import { formatShopTime } from '@/lib/business/timezone';
import { captureException } from '@/lib/observability';
import { isCronAuthorized } from '@/lib/security/cron-auth';

/**
 * Loop 62 — Birthday greetings cron.
 *
 * Daily-scheduled (fires once per day from GitHub Actions, since Vercel
 * Hobby is at its 2-cron limit). Each tick:
 *
 *   1. Walks every shop, computes today's (month, day) in the shop's
 *      timezone (a 23:50 UTC tick is "tomorrow" for an Asia/Tokyo shop
 *      and we'd want to use Tokyo's date, not UTC's).
 *   2. Looks up clients whose `date_of_birth` matches today (month,
 *      day only — year is ignored).
 *   3. For each match, checks the shop's `notification_automations`
 *      for kind='birthday' per channel (email + sms).
 *   4. Sends the enabled channels, writes a `client_marketing_sends`
 *      row keyed on (client_id, 'birthday', channel, year). The
 *      UNIQUE constraint guarantees one send per year per channel
 *      even if the cron fires twice in a day.
 *
 * Per-channel idempotency on top of the per-day cron schedule means:
 *   - tick fires twice in 24h → second tick sees existing rows, skips.
 *   - shop disables birthday email AFTER an SMS sent → SMS row stays,
 *     no email row, that channel never fires this year. Correct.
 *   - operator manually deletes a client_marketing_sends row → next
 *     tick re-sends. Manual recovery available.
 *
 * Auth via Bearer ${CRON_SECRET} matches the notifications cron pattern.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

type ShopRow = {
  id: string;
  name: string;
  timezone: string;
  default_language: string;
};

type ClientRow = {
  id: string;
  shop_id: string;
  first_name: string;
  email: string | null;
  phone: string | null;
  date_of_birth: string; // YYYY-MM-DD (NOT NULL filtered upstream)
};

// Cron auth lives in one place (lib/security/cron-auth): fail-CLOSED in
// production when CRON_SECRET is unset, constant-time bearer compare.
function isAuthorized(req: NextRequest): boolean {
  return isCronAuthorized(req);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const startedAt = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createSupabaseServiceRoleClient() as any;

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  try {
    // 1. List every shop. Small shop counts (V1: <100) so a full scan
    //    is cheaper than a complex per-shop SQL join.
    const shopsRes = await sb.from('shops').select('id, name, timezone, default_language');
    const shops = (shopsRes.data as ShopRow[] | null) ?? [];

    for (const shop of shops) {
      try {
        // Shop's "today" in its timezone. Use formatShopTime to extract
        // month + day from now() projected into the shop's tz. The year
        // is used for the recurrence_key — a client with the same
        // shop + same birthday MD as last year still gets a fresh send.
        const now = new Date();
        const monthStr = formatShopTime(now, shop.timezone, 'MM');
        const dayStr = formatShopTime(now, shop.timezone, 'dd');
        const yearStr = formatShopTime(now, shop.timezone, 'yyyy');
        const todayMonth = Number(monthStr);
        const todayDay = Number(dayStr);

        // 2. Find clients with matching birthday in this shop. The
        //    `clients_birthday_md_idx` partial index (Loop 62
        //    migration) makes this O(matching-rows) per shop.
        const clientsRes = await sb
          .from('clients')
          .select('id, shop_id, first_name, email, phone, date_of_birth')
          .eq('shop_id', shop.id)
          .not('date_of_birth', 'is', null)
          .is('anonymized_at', null);
        const allWithDob = (clientsRes.data as ClientRow[] | null) ?? [];
        const matches = allWithDob.filter((c) => {
          if (!c.date_of_birth) return false;
          // ISO `YYYY-MM-DD` slice — index positions are stable.
          const m = Number(c.date_of_birth.slice(5, 7));
          const d = Number(c.date_of_birth.slice(8, 10));
          return m === todayMonth && d === todayDay;
        });
        if (matches.length === 0) continue;

        // 3. Already-sent lookup for THIS year. Same pattern as the
        //    reminder cron's alreadySet — one batched query rather
        //    than N lookups.
        const candidateIds = matches.map((m) => m.id);
        const alreadyEmailRes = await sb
          .from('client_marketing_sends')
          .select('client_id')
          .eq('kind', 'birthday')
          .eq('channel', 'email')
          .eq('recurrence_key', yearStr)
          .in('client_id', candidateIds);
        const alreadyEmail = new Set(
          ((alreadyEmailRes.data as Array<{ client_id: string }> | null) ?? []).map(
            (r) => r.client_id,
          ),
        );
        const alreadySmsRes = await sb
          .from('client_marketing_sends')
          .select('client_id')
          .eq('kind', 'birthday')
          .eq('channel', 'sms')
          .eq('recurrence_key', yearStr)
          .in('client_id', candidateIds);
        const alreadySms = new Set(
          ((alreadySmsRes.data as Array<{ client_id: string }> | null) ?? []).map(
            (r) => r.client_id,
          ),
        );

        const locale: 'fr' | 'en' = shop.default_language === 'en' ? 'en' : 'fr';

        for (const client of matches) {
          // ── Email branch ────────────────────────────────────────
          if (alreadyEmail.has(client.id) || !client.email) {
            skipped += 1;
          } else {
            const result = await sendEmail({
              shopId: shop.id,
              kind: 'birthday' satisfies AutomationKind,
              to: client.email,
              subject:
                locale === 'fr'
                  ? `Joyeux anniversaire ${client.first_name} ! 🎂`
                  : `Happy birthday ${client.first_name}! 🎂`,
              template: BirthdayGreeting({
                locale,
                shop: { name: shop.name },
                client: { firstName: client.first_name },
              }),
              tags: [
                { name: 'kind', value: 'birthday' },
                { name: 'shop', value: shop.id },
              ],
            });

            if (result.sent) {
              sent += 1;
              await sb
                .from('client_marketing_sends')
                .insert({
                  shop_id: shop.id,
                  client_id: client.id,
                  kind: 'birthday',
                  channel: 'email',
                  recurrence_key: yearStr,
                  via: result.via,
                })
                .select('id');
            } else if (result.reason === 'disabled') {
              skipped += 1;
            } else {
              failed += 1;
            }
          }

          // ── SMS branch ──────────────────────────────────────────
          if (alreadySms.has(client.id) || !client.phone) {
            skipped += 1;
          } else {
            const smsBody = birthdayGreetingSms({
              locale,
              shopName: shop.name,
              firstName: client.first_name,
            });
            const statusCallbackUrl = twilioWebhookUrl(shop.id) ?? undefined;
            // `appointmentId: null` signals to dispatchSms that we
            // manage our own ledger (client_marketing_sends) — it
            // skips the notification_sends INSERT that would
            // otherwise FK-violate against appointments.
            const smsResult = await dispatchSms({
              shopId: shop.id,
              appointmentId: null,
              kind: 'birthday',
              to: client.phone,
              body: smsBody,
              statusCallbackUrl,
            });

            if (smsResult.sent) {
              sent += 1;
              await sb
                .from('client_marketing_sends')
                .insert({
                  shop_id: shop.id,
                  client_id: client.id,
                  kind: 'birthday',
                  channel: 'sms',
                  recurrence_key: yearStr,
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
      } catch (err) {
        captureException(err, { tags: { layer: 'cron-birthday', shopId: shop.id } });
        failed += 1;
      }
    }
  } catch (err) {
    captureException(err, { tags: { layer: 'cron-birthday' } });
    failed += 1;
  }

  return NextResponse.json(
    {
      ok: true,
      sent,
      skipped,
      failed,
      durationMs: Date.now() - startedAt,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
