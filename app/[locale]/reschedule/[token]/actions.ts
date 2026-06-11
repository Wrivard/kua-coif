'use server';

import { getClientIp } from '@/lib/security/client-ip';
import { z } from 'zod';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import { err, ok, type Result } from '@/lib/server-actions/result';
import { captureException } from '@/lib/observability';
import { logDurableAudit } from '@/lib/audit-log';
import { verifyToken } from '@/lib/security/signed-tokens';
import { combineShopDateTime, shopDayStart, shopDayEnd } from '@/lib/business/timezone';
import { checkAvailability, type ExistingAppointment } from '@/lib/business/availability';
import { resolveEffectiveBarberSettings } from '@/lib/business/barber-settings';
import { pushAppointment } from '@/lib/google/sync';
import { sendEmail } from '@/lib/email/send';
import { AppointmentConfirmation } from '@/lib/email/templates/appointment-confirmation';

/**
 * Phase 74 — Public reschedule via signed token.
 *
 * Mirrors the admin reschedule logic (drag-drop in the calendar) but
 * gated by a signed token (kind='reschedule', resourceId=appointment_id)
 * with a 7-day TTL. The customer can move their appointment within
 * the same shop / barber / services; date+time are the only changes.
 */

const schema = z.object({
  token: z.string().trim().min(10).max(4096),
  new_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  new_start_time: z.string().regex(/^\d{2}:\d{2}$/),
  /** Plan 037 — drives the confirmation email's language (mirrors the
   *  self-cancel action). Defaults FR so older clients keep working. */
  locale: z.enum(['fr', 'en']).default('fr'),
});

export type ReschedulePublicInput = z.infer<typeof schema>;

function toMinutes(t: string): number {
  const [hh, mm] = t.split(':').map(Number);
  return (hh ?? 0) * 60 + (mm ?? 0);
}

function formatMinutes(m: number): string {
  const h = Math.floor((m % 1440) / 60);
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export async function reschedulePublicAppointment(
  raw: ReschedulePublicInput,
): Promise<Result<{ id: string }>> {
  try {
    const ip = getClientIp();
    const rl = await checkRateLimit(`reschedule:${ip}`, {
      max: 15,
      windowMs: 10 * 60 * 1000,
    });
    if (!rl.allowed) return err('RATE_LIMITED');

    const parsed = schema.safeParse(raw);
    if (!parsed.success) return err('INVALID_INPUT');
    const input = parsed.data;

    const payload = verifyToken(input.token, 'reschedule');
    if (!payload) return err('INVALID_INPUT');

    const supabase = createSupabaseServiceRoleClient();

    // Resolve appointment + shop + total duration in one go.
    // Plan 037 — `client_id`/`total_amount` + shop `name`/`phone` widened in
    // so the confirmation email block below needs no extra appointment read.
    const apptRes = await supabase
      .from('appointments')
      .select(
        'id, shop_id, barber_id, client_id, start_at, end_at, status, total_amount, google_event_id, public_link_version, shop:shops(id, timezone, name, phone)',
      )
      .eq('id', payload.resourceId)
      .limit(1);
    const appt = (apptRes.data ?? [])[0];
    if (!appt || !appt.shop) return err('NOT_FOUND');
    // Revocation (plan 013): stale token version → same NOT_FOUND path as a
    // bad token (never a distinct error that would confirm the appt exists).
    if ((payload.ver ?? 0) !== (appt.public_link_version ?? 0)) return err('NOT_FOUND');

    // Block reschedules on terminal-status appointments.
    if (['cancelled', 'no_show', 'completed'].includes(appt.status)) {
      return err('INVALID_INPUT');
    }

    // Original duration is preserved — customers don't change services
    // via the public reschedule flow (that's an admin-only operation).
    const originalDurationMin = Math.round(
      (new Date(appt.end_at).getTime() - new Date(appt.start_at).getTime()) / 60000,
    );

    const newStartAt = combineShopDateTime(
      input.new_date,
      input.new_start_time,
      appt.shop.timezone,
    );
    const newEndAt = new Date(newStartAt.getTime() + originalDurationMin * 60_000);

    // Availability check against the new slot — same logic as
    // bookPublicAppointment but excluding the appointment we're moving.
    const dayStart = shopDayStart(newStartAt, appt.shop.timezone);
    const dayEnd = shopDayEnd(newStartAt, appt.shop.timezone);
    const [hoursRes, daysOffRes, apptsRes, blockedRes, settingsRes] = await Promise.all([
      supabase
        .from('shop_hours')
        .select('weekday, enabled, open_time, close_time')
        .eq('shop_id', appt.shop_id),
      supabase.from('shop_days_off').select('date').eq('shop_id', appt.shop_id),
      supabase
        .from('appointments')
        .select('id, barber_id, start_at, end_at, status')
        .eq('shop_id', appt.shop_id)
        .neq('id', appt.id) // exclude self
        .gte('start_at', dayStart.toISOString())
        .lt('start_at', dayEnd.toISOString()),
      supabase
        .from('blocked_time')
        .select('barber_id, start_at, end_at')
        .eq('shop_id', appt.shop_id)
        .gte('start_at', dayStart.toISOString())
        .lt('start_at', dayEnd.toISOString()),
      supabase
        .from('barber_settings')
        .select(
          'scope, barber_id, client_booking_interval_min, days_book_in_advance, mins_book_before_appt',
        )
        .eq('shop_id', appt.shop_id),
    ]);

    const hours = hoursRes.data ?? [];
    const daysOff = (daysOffRes.data ?? []).map((d) => d.date);
    const existing: ExistingAppointment[] = (apptsRes.data ?? []).map((a) => ({
      ...a,
      start_at: new Date(a.start_at),
      end_at: new Date(a.end_at),
    }));
    const blocked = (blockedRes.data ?? []).map((b) => ({
      barber_id: b.barber_id,
      start_at: new Date(b.start_at),
      end_at: new Date(b.end_at),
    }));
    const settingsRows = settingsRes.data ?? [];
    // B20 — shared resolver (override → shop → defaults). Never null now.
    const settings = resolveEffectiveBarberSettings(settingsRows, appt.barber_id);
    const shopWeekday = new Date(`${input.new_date}T00:00:00`).getDay();
    const verdict = checkAvailability({
      start_at: newStartAt,
      end_at: newEndAt,
      barber_id: appt.barber_id,
      shop_date: input.new_date,
      shop_weekday: shopWeekday,
      shop_start_time: input.new_start_time,
      shop_end_time: formatMinutes(toMinutes(input.new_start_time) + originalDurationMin),
      hours,
      daysOff: daysOff.map((d) => ({ date: d })),
      existing,
      blocked,
      settings: {
        client_booking_interval_min: settings.client_booking_interval_min,
        days_book_in_advance: settings.days_book_in_advance,
        mins_book_before_appt: settings.mins_book_before_appt,
      },
    });
    if (!verdict.ok) {
      return err(
        verdict.reason === 'CONFLICT_APPOINTMENT' || verdict.reason === 'CONFLICT_BLOCK'
          ? 'CONFLICT'
          : 'INVALID_INPUT',
      );
    }

    const { error } = await supabase
      .from('appointments')
      .update({
        start_at: newStartAt.toISOString(),
        end_at: newEndAt.toISOString(),
      })
      .eq('id', appt.id);
    if (error) {
      // Phase 70 audit P2.16 — unique_violation on
      // appointments_active_barber_slot_idx means another booking won
      // the race to the destination slot. Surface as CONFLICT (same
      // UX as the synchronous availability fail above).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = error as any;
      if (e?.code === '23505') return err('CONFLICT');
      return err('UNEXPECTED');
    }

    await logDurableAudit({
      shopId: appt.shop_id,
      actorId: '00000000-0000-0000-0000-000000000000',
      action: 'update',
      entity: 'appointments',
      entityId: appt.id,
      diff: {
        source: 'public-reschedule',
        old_start_at: appt.start_at,
        new_start_at: newStartAt.toISOString(),
      },
    });

    // ── Google Calendar push (admin parity) ──────────────────────────
    // The DB now holds the new time but the barber's mirrored Google
    // event still shows the OLD slot. Mirror the admin same-barber
    // reschedule branch: a single update on the existing event with the
    // NEW times. The public reschedule never changes barber, so the
    // delete+recreate cross-barber branch doesn't apply. `void`
    // best-effort with the NEW times — never the stale row values.
    if (appt.google_event_id) {
      void pushAppointment({
        appointmentId: appt.id,
        barberId: appt.barber_id,
        startAtIso: newStartAt.toISOString(),
        endAtIso: newEndAt.toISOString(),
        timezone: appt.shop.timezone,
        googleEventId: appt.google_event_id,
        summary: 'Appointment',
      });
    }

    // ── Plan 037 (CORRECTNESS-01) — confirmation email ────────────────
    // The success screen has promised "you'll receive an email" since
    // Phase 74, but nothing ever sent one. Mirror the self-cancel email
    // block (me/[token]/actions.ts): best-effort, swallow + Sentry — a
    // send failure must never fail the reschedule itself. The template is
    // populated with the NEW time, never the stale row values.
    try {
      if (appt.client_id) {
        const [clientRes, servicesRes, barberRes] = await Promise.all([
          supabase.from('clients').select('first_name, email').eq('id', appt.client_id).single(),
          supabase
            .from('appointment_services')
            .select('services(name, duration_min)')
            .eq('appointment_id', appt.id),
          supabase.from('barbers').select('display_name').eq('id', appt.barber_id).single(),
        ]);
        const customer = clientRes.data;
        const services = (servicesRes.data ?? [])
          .map((r) => r.services)
          .filter((s): s is { name: string; duration_min: number } => Boolean(s))
          .map((s) => ({ name: s.name, durationMin: s.duration_min }));
        const barber = barberRes.data;
        if (customer?.email) {
          const emailLocale = input.locale;
          await sendEmail({
            shopId: appt.shop_id,
            // Gate on the same automation toggle as the booking
            // confirmation — a shop that muted confirmations doesn't
            // want reschedule confirmations either.
            kind: 'booking_confirmation',
            to: customer.email,
            subject:
              emailLocale === 'fr'
                ? `Ton rendez-vous chez ${appt.shop.name} a été déplacé`
                : `Your appointment at ${appt.shop.name} has been moved`,
            template: AppointmentConfirmation({
              locale: emailLocale,
              shop: {
                name: appt.shop.name,
                phone: appt.shop.phone,
                timezone: appt.shop.timezone,
              },
              client: { firstName: customer.first_name },
              appointment: {
                startAt: newStartAt.toISOString(),
                services,
                totalAmount: Number(appt.total_amount ?? 0),
                professionalName: barber?.display_name ?? null,
              },
            }),
            tags: [
              { name: 'kind', value: 'booking_confirmation' },
              { name: 'source', value: 'self-reschedule' },
            ],
          });
        }
      }
    } catch (e) {
      // Swallow — the reschedule itself succeeded.
      captureException(e, { tags: { layer: 'public-reschedule', step: 'email' } });
    }

    return ok({ id: appt.id });
  } catch (e) {
    captureException(e, { tags: { layer: 'public-reschedule' } });
    return err('UNEXPECTED');
  }
}
