import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { sendEmail, type AutomationKind } from '@/lib/email/send';
import { getShopSmtpConfig, type ShopSmtpConfig } from '@/lib/email/smtp';
import { AppointmentReminder } from '@/lib/email/templates/appointment-reminder';
import { dispatchSms } from '@/lib/sms/dispatch';
import { reminder1hSms, reminder24hSms } from '@/lib/sms/templates';
import { twilioWebhookUrl } from '@/lib/sms/webhook';
import { captureException, withCronMonitor } from '@/lib/observability';
import { isCronAuthorized } from '@/lib/security/cron-auth';
import {
  dueReminders,
  offsetMinutes,
  MAX_REMINDER_OFFSET_MIN,
  type ReminderOffsets,
} from '@/lib/business/reminders';
import {
  resolveEffectiveBarberSettings,
  BARBER_SETTINGS_DEFAULTS,
} from '@/lib/business/barber-settings';

/**
 * Reminder cron — Phase 25c.
 *
 * Scheduled every 15 minutes by GitHub Actions
 * (.github/workflows/cron-notifications.yml) — NOT vercel.json: Vercel Hobby
 * caps at 2 daily crons, so the 15-minute reminder cron lives in Actions.
 *
 * Two reminder slots per appointment, with CONFIGURABLE offsets (Barbers audit
 * B5): the timing comes from each barber's effective barber_settings
 * (reminder1/2_h/m, with the per-barber override falling back to the shop
 * default, then 24h/1h). Each tick loads candidate appointments across the
 * whole reminder horizon and `lib/business/reminders.dueReminders()` (pure,
 * unit-tested) picks which (appointment, slot) reminders fall in this tick's
 * ±15-min catch window. Slot 1 keys as `reminder_24h`, slot 2 as `reminder_1h`
 * (legacy stable keys for notification_sends + the automation toggle).
 *
 * Idempotency: we write to `notification_sends` (UNIQUE on appointment_id,
 * kind, channel) on success, so the overlapping catch windows across ticks
 * each fire a given reminder exactly once.
 *
 * Security: the GitHub Actions workflow passes `Authorization: Bearer
 * <CRON_SECRET>` via curl. We reject any other caller with 401. In
 * production a missing CRON_SECRET is fail-CLOSED (see lib/security/cron-auth);
 * outside production the route runs unprotected for local testing.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Hobby plan caps maxDuration at 10s. The route batches at most ~50 emails
// per tick on a busy shop, each ~50-150ms via SMTP or Resend, so it usually
// finishes within the budget. If the budget is tight in production, upgrade
// the Vercel plan and bump this back to 60 (Pro/Enterprise).
export const maxDuration = 10;

type ApptRow = {
  id: string;
  shop_id: string;
  start_at: string;
  status: string;
  barber_id: string;
  client_id: string;
  // Loop 54 (P100) — `phone` added so the SMS branch can route to
  // the customer. Null phone = SMS-skip even if the shop has Twilio
  // wired up.
  client: { first_name: string; email: string | null; phone: string | null } | null;
  shop: {
    name: string;
    timezone: string;
    street: string | null;
    municipality: string | null;
    province: string | null;
    phone: string | null;
    default_language: string;
  } | null;
  appointment_services: Array<{ services: { name: string } | null }> | null;
  barber: { display_name: string } | null;
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
  // Cron Monitor check-in lives INSIDE the auth gate so unauthorized probes
  // never emit a check-in. Slug + crontab mirror .github/workflows/cron-notifications.yml.
  return withCronMonitor('cron-notifications', { type: 'crontab', value: '*/15 * * * *' }, () =>
    runNotificationsCron(),
  );
}

async function runNotificationsCron(): Promise<NextResponse> {
  const startedAt = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createSupabaseServiceRoleClient() as any;

  const nowMs = Date.now();
  const HALF_WINDOW_MS = 15 * 60_000; // ±15 min catch window (matches the 15-min schedule)

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  // B5 — load every candidate appointment in the broad reminder horizon (now →
  // now + max configurable offset + the catch window) across all shops in ONE
  // query; dueReminders() then picks which are actually due this tick from each
  // barber's effective reminder1/2 offsets, replacing the old fixed 24h/1h
  // windows. (We fetch all statuses except cancelled/no_show so reschedules
  // still get a reminder.)
  const candidatesRes = await sb
    .from('appointments')
    .select(
      `id, shop_id, start_at, status, barber_id, client_id,
       client:clients(first_name, email, phone),
       shop:shops(name, timezone, street, municipality, province, phone, default_language),
       appointment_services(services(name)),
       barber:barbers(display_name)`,
    )
    .gte('start_at', new Date(nowMs).toISOString())
    .lte('start_at', new Date(nowMs + (MAX_REMINDER_OFFSET_MIN + 15) * 60_000).toISOString())
    .in('status', ['booked', 'confirmed', 'arrived'])
    // Nearest-due first, then bound to the PostgREST cap: ordering guarantees a
    // cap can only delay the FARTHEST reminders, never drop an imminent one.
    .order('start_at', { ascending: true })
    .limit(1000);
  const allCandidates = (candidatesRes.data as ApptRow[] | null) ?? [];
  if (allCandidates.length === 1000) {
    captureException(new Error('[cron/notifications] candidate load hit the 1000 cap'), {
      tags: { layer: 'cron', cron: 'notifications' },
      extra: { horizonMin: MAX_REMINDER_OFFSET_MIN + 15 },
    });
  }

  // B20 — the no-rows default offsets come from the shared resolver's DEFAULTS
  // (24h / 1h); the cron no longer hardcodes its own reminder fallback.
  const DEFAULT_OFFSETS: ReminderOffsets = {
    slot1Min: offsetMinutes(
      BARBER_SETTINGS_DEFAULTS.reminder1_h,
      BARBER_SETTINGS_DEFAULTS.reminder1_m,
    ),
    slot2Min: offsetMinutes(
      BARBER_SETTINGS_DEFAULTS.reminder2_h,
      BARBER_SETTINGS_DEFAULTS.reminder2_m,
    ),
  };
  const candidateById = new Map<string, ApptRow>();
  const dueBySlot: Record<1 | 2, Set<string>> = { 1: new Set<string>(), 2: new Set<string>() };
  if (allCandidates.length > 0) {
    for (const c of allCandidates) candidateById.set(c.id, c);
    // Effective reminder offsets per barber: override → shop default → fallback.
    const shopIds = [...new Set(allCandidates.map((c) => c.shop_id))];
    const settingsRes = await sb
      .from('barber_settings')
      .select('scope, barber_id, shop_id, reminder1_h, reminder1_m, reminder2_h, reminder2_m')
      .in('shop_id', shopIds);
    const settingsRows =
      (settingsRes.data as Array<{
        scope: 'shop' | 'barber';
        barber_id: string | null;
        shop_id: string;
        reminder1_h: number;
        reminder1_m: number;
        reminder2_h: number;
        reminder2_m: number;
      }> | null) ?? [];
    // Group rows per shop so the resolver's shop-row match is shop-scoped, then
    // resolve effective reminder offsets per barber (override → shop → defaults).
    const rowsByShop = new Map<string, typeof settingsRows>();
    for (const r of settingsRows) {
      const arr = rowsByShop.get(r.shop_id) ?? [];
      arr.push(r);
      rowsByShop.set(r.shop_id, arr);
    }
    const offsetsByBarber = new Map<string, ReminderOffsets>();
    for (const c of allCandidates) {
      if (!offsetsByBarber.has(c.barber_id)) {
        const eff = resolveEffectiveBarberSettings(rowsByShop.get(c.shop_id) ?? [], c.barber_id);
        offsetsByBarber.set(c.barber_id, {
          slot1Min: offsetMinutes(eff.reminder1_h, eff.reminder1_m),
          slot2Min: offsetMinutes(eff.reminder2_h, eff.reminder2_m),
        });
      }
    }
    const due = dueReminders(
      allCandidates.map((c) => ({
        id: c.id,
        startMs: new Date(c.start_at).getTime(),
        barberId: c.barber_id,
      })),
      offsetsByBarber,
      DEFAULT_OFFSETS,
      nowMs,
      HALF_WINDOW_MS,
    );
    for (const d of due) dueBySlot[d.slot].add(d.appointmentId);
  }

  // Plan 018 — preload the per-(shop,kind) email automation flags + per-shop
  // SMTP configs ONCE for the distinct shops with due reminders, then pass them
  // to sendEmail via `preloaded` so it skips its two internal DB reads on every
  // message this tick (was 2 reads × N reminders → 1 batch + 1 read/shop).
  const dueShopIds = [
    ...new Set(
      [...dueBySlot[1], ...dueBySlot[2]]
        .map((id) => candidateById.get(id)?.shop_id)
        .filter((s): s is string => Boolean(s)),
    ),
  ];
  const emailAutomationByShopKind = new Map<string, boolean>();
  const smtpByShop = new Map<string, ShopSmtpConfig | null>();
  if (dueShopIds.length > 0) {
    const autoRes = await sb
      .from('notification_automations')
      .select('shop_id, kind, enabled')
      .in('shop_id', dueShopIds)
      .eq('channel', 'email');
    for (const r of (autoRes.data as Array<{
      shop_id: string;
      kind: string;
      enabled: boolean;
    }> | null) ?? []) {
      emailAutomationByShopKind.set(`${r.shop_id}:${r.kind}`, r.enabled);
    }
    await Promise.all(
      dueShopIds.map(async (sid) => {
        smtpByShop.set(sid, await getShopSmtpConfig(sid));
      }),
    );
  }

  // Slot 1 → 'reminder_24h', slot 2 → 'reminder_1h': stable notification_sends +
  // AutomationKind keys (names are legacy; the timing is now configurable).
  for (const [kind, slot] of [
    ['reminder_24h', 1],
    ['reminder_1h', 2],
  ] as Array<['reminder_24h' | 'reminder_1h', 1 | 2]>) {
    const dueIds = [...dueBySlot[slot]];
    if (dueIds.length === 0) continue;
    try {
      const candidates = dueIds
        .map((id) => candidateById.get(id))
        .filter((c): c is ApptRow => Boolean(c));
      if (candidates.length === 0) continue;

      // Filter out appointments we've already notified for this kind. One
      // batched lookup against `notification_sends` rather than N queries.
      // Loop 53 — scope to `channel='email'` because the table is now
      // shared with the SMS pipeline; without this filter, an SMS row
      // would block an EMAIL send for the same appointment+kind.
      const candidateIds = candidates.map((c) => c.id);
      const alreadyRes = await sb
        .from('notification_sends')
        .select('appointment_id')
        .eq('kind', kind)
        .eq('channel', 'email')
        .in('appointment_id', candidateIds);
      const alreadySet = new Set(
        ((alreadyRes.data as Array<{ appointment_id: string }> | null) ?? []).map(
          (r) => r.appointment_id,
        ),
      );

      // Loop 54 — parallel lookup for SMS sends. Email and SMS each
      // get their own row in `notification_sends` (UNIQUE on
      // appointment_id, kind, channel), so we track them
      // independently — an appointment might get an email but not an
      // SMS (shop has no Twilio configured) or vice versa (client
      // has no email but a phone).
      const alreadySmsRes = await sb
        .from('notification_sends')
        .select('appointment_id')
        .eq('kind', kind)
        .eq('channel', 'sms')
        .in('appointment_id', candidateIds);
      const alreadySetSms = new Set(
        ((alreadySmsRes.data as Array<{ appointment_id: string }> | null) ?? []).map(
          (r) => r.appointment_id,
        ),
      );

      for (const appt of candidates) {
        if (!appt.client || !appt.shop) {
          // Missing the joined client/shop row — nothing we can
          // render for either channel. Count once and move on.
          skipped += 1;
          continue;
        }

        const locale: 'fr' | 'en' = appt.shop.default_language === 'en' ? 'en' : 'fr';

        // ── Email branch ────────────────────────────────────────
        if (alreadySet.has(appt.id) || !appt.client.email) {
          skipped += 1;
        } else {
          const addressLine = [appt.shop.street, appt.shop.municipality, appt.shop.province]
            .filter(Boolean)
            .join(', ');

          const services = (appt.appointment_services ?? [])
            .map((r) => r.services?.name)
            .filter((n): n is string => Boolean(n))
            .map((name) => ({ name }));

          const result = await sendEmail({
            shopId: appt.shop_id,
            kind: kind satisfies AutomationKind,
            // Plan 018 — preloaded config skips sendEmail's 2 internal reads.
            // Missing automation row → opt-in default true (matches
            // isAutomationEnabled's failsafe).
            preloaded: {
              automationEnabled: emailAutomationByShopKind.get(`${appt.shop_id}:${kind}`) ?? true,
              smtpCfg: smtpByShop.get(appt.shop_id) ?? null,
            },
            to: appt.client.email,
            // B5 — offset-agnostic subject (reminder timing is configurable);
            // the body carries the actual date + time.
            subject:
              locale === 'fr'
                ? `Rappel : ton rendez-vous chez ${appt.shop.name}`
                : `Reminder: your appointment at ${appt.shop.name}`,
            template: AppointmentReminder({
              locale,
              kind,
              shop: {
                name: appt.shop.name,
                addressLine: addressLine || null,
                phone: appt.shop.phone,
                timezone: appt.shop.timezone,
              },
              client: { firstName: appt.client.first_name },
              appointment: {
                startAt: appt.start_at,
                services,
                professionalName: appt.barber?.display_name ?? null,
              },
            }),
            tags: [
              { name: 'kind', value: kind },
              { name: 'shop', value: appt.shop_id },
            ],
          });

          if (result.sent) {
            sent += 1;
            // Record the send for idempotence on the next tick. The unique
            // constraint guards against the rare double-tick scenario.
            // Loop 53 — explicit `channel: 'email'` (column has the same
            // default but defensive against any future schema flip).
            await sb
              .from('notification_sends')
              .insert({
                appointment_id: appt.id,
                kind,
                channel: 'email',
                via: result.via,
              })
              .select('id');
          } else if (result.reason === 'disabled') {
            // Automation toggle is off — that's a soft skip, not a failure.
            // Don't write to notification_sends so flipping the toggle on
            // mid-cycle picks up the appointment on the next tick.
            skipped += 1;
          } else {
            failed += 1;
          }
        }

        // ── SMS branch (Loop 54) ────────────────────────────────
        // Mirrors the email branch but routes through `dispatchSms`,
        // which encapsulates the per-shop Twilio config lookup +
        // automation-toggle check + notification_sends write. If
        // the shop hasn't configured Twilio in /settings yet, the
        // dispatch returns reason='no-config' (silent skip).
        if (alreadySetSms.has(appt.id) || !appt.client.phone) {
          skipped += 1;
        } else {
          const smsBody =
            kind === 'reminder_24h'
              ? reminder24hSms({
                  locale,
                  shopName: appt.shop.name,
                  startAtIso: appt.start_at,
                  timezone: appt.shop.timezone,
                  shopPhone: appt.shop.phone,
                })
              : reminder1hSms({
                  locale,
                  shopName: appt.shop.name,
                  startAtIso: appt.start_at,
                  timezone: appt.shop.timezone,
                  shopPhone: appt.shop.phone,
                });

          // Loop 55 — register the per-shop status callback. Null
          // in dev / when NEXT_PUBLIC_APP_URL isn't an HTTPS host;
          // Twilio rejects http: callbacks anyway, so we just skip
          // the registration rather than fail the send.
          const statusCallbackUrl = twilioWebhookUrl(appt.shop_id) ?? undefined;
          const smsResult = await dispatchSms({
            shopId: appt.shop_id,
            appointmentId: appt.id,
            kind,
            to: appt.client.phone,
            body: smsBody,
            statusCallbackUrl,
          });

          if (smsResult.sent) {
            sent += 1;
          } else if (
            smsResult.reason === 'disabled' ||
            smsResult.reason === 'no-config' ||
            smsResult.reason === 'no-encryption'
          ) {
            // Soft skips — shop hasn't activated Twilio or the
            // platform encryption key isn't set in this env.
            skipped += 1;
          } else {
            failed += 1;
          }
        }
      }
    } catch (err) {
      captureException(err, { tags: { layer: 'cron-reminders', kind } });
      failed += 1;
    }
  }

  // Aggregate failure alert. Individual soft send-failures (result.sent ===
  // false for a non-'disabled' reason) only bump `failed` — they don't throw —
  // so a run where the whole email/SMS pipeline is down would otherwise return
  // a green 200 and go unnoticed. Surface the count so a broken automation is
  // visible in Sentry on the very next tick.
  if (failed > 0) {
    captureException(
      new Error(
        `[cron-reminders] ${failed} send(s) failed this run (sent=${sent}, skipped=${skipped})`,
      ),
      { tags: { layer: 'cron-reminders', stage: 'run-summary' } },
    );
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
