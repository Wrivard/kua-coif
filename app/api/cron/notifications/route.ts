import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { sendEmail, type AutomationKind } from '@/lib/email/send';
import { AppointmentReminder } from '@/lib/email/templates/appointment-reminder';
import { captureException } from '@/lib/observability';

/**
 * Reminder cron — Phase 25c.
 *
 * Configured to fire every 15 minutes by `vercel.json`. Two windows we
 * care about each tick:
 *
 *   - `reminder_24h`: appointments starting in [now+23h45, now+24h15]
 *   - `reminder_1h`:  appointments starting in [now+0h45, now+1h15]
 *
 * The 30-minute window per kind matches the cron interval so the same
 * appointment isn't picked up twice, but we also write to
 * `notification_sends` on success and `INSERT … ON CONFLICT DO NOTHING`
 * to belt-and-braces against duplicate sends if a tick gets retried.
 *
 * Security: Vercel cron triggers attach `Authorization: Bearer
 * <CRON_SECRET>` automatically when a `CRON_SECRET` env var is set on the
 * project. We reject any other caller with 401. Manually testing? Either
 * call with the right header, or omit `CRON_SECRET` from env and the
 * route runs unprotected (dev only).
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
  client: { first_name: string; email: string | null } | null;
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

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // dev / no-secret deployment
  const header = req.headers.get('authorization');
  return header === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const startedAt = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createSupabaseServiceRoleClient() as any;

  const now = Date.now();
  // 30-minute windows — matches the cron interval (15 min) plus a safety
  // overlap so a slightly-late tick doesn't miss an appointment that
  // landed in the previous bucket.
  const window24h = {
    from: new Date(now + (24 * 60 - 15) * 60_000).toISOString(),
    to: new Date(now + (24 * 60 + 15) * 60_000).toISOString(),
  };
  const window1h = {
    from: new Date(now + (60 - 15) * 60_000).toISOString(),
    to: new Date(now + (60 + 15) * 60_000).toISOString(),
  };

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const [kind, window] of [
    ['reminder_24h', window24h],
    ['reminder_1h', window1h],
  ] as Array<['reminder_24h' | 'reminder_1h', { from: string; to: string }]>) {
    try {
      // Pull every candidate appointment + everything we need to render the
      // email in one shot. We fetch all statuses except 'cancelled' /
      // 'no_show' so reschedules in the window still get a reminder.
      const apptsRes = await sb
        .from('appointments')
        .select(
          `id, shop_id, start_at, status, barber_id, client_id,
           client:clients(first_name, email),
           shop:shops(name, timezone, street, municipality, province, phone, default_language),
           appointment_services(services(name)),
           barber:barbers(display_name)`,
        )
        .gte('start_at', window.from)
        .lte('start_at', window.to)
        .in('status', ['booked', 'confirmed', 'arrived']);

      const candidates = (apptsRes.data as ApptRow[] | null) ?? [];
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

      for (const appt of candidates) {
        if (alreadySet.has(appt.id)) {
          skipped += 1;
          continue;
        }
        if (!appt.client?.email || !appt.shop) {
          skipped += 1;
          continue;
        }

        const addressLine = [appt.shop.street, appt.shop.municipality, appt.shop.province]
          .filter(Boolean)
          .join(', ');

        const services = (appt.appointment_services ?? [])
          .map((r) => r.services?.name)
          .filter((n): n is string => Boolean(n))
          .map((name) => ({ name }));

        const locale: 'fr' | 'en' = appt.shop.default_language === 'en' ? 'en' : 'fr';

        const result = await sendEmail({
          shopId: appt.shop_id,
          kind: kind satisfies AutomationKind,
          to: appt.client.email,
          subject:
            kind === 'reminder_24h'
              ? locale === 'fr'
                ? `Rappel : ton rendez-vous demain chez ${appt.shop.name}`
                : `Reminder: your appointment tomorrow at ${appt.shop.name}`
              : locale === 'fr'
                ? `Rappel : ton rendez-vous dans 1 heure chez ${appt.shop.name}`
                : `Reminder: your appointment in 1 hour at ${appt.shop.name}`,
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
    } catch (err) {
      captureException(err, { tags: { layer: 'cron-reminders', kind } });
      failed += 1;
    }
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
