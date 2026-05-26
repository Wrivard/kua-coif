'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { logAuditAction } from '@/lib/audit-log';
import { checkAvailability, type ExistingAppointment } from '@/lib/business/availability';
import {
  combineShopDateTime,
  formatShopTime,
  shopDayEnd,
  shopDayStart,
  shopIsoDate,
} from '@/lib/business/timezone';
import {
  appointmentSchema,
  blockTimeSchema,
  cancelAppointmentSchema,
  chargeAppointmentSchema,
  refundAppointmentSchema,
  rescheduleAppointmentSchema,
  updateAppointmentSchema,
} from './schema';
import { sendEmail } from '@/lib/email/send';
import { AppointmentCancellation } from '@/lib/email/templates/appointment-cancellation';
import { deleteAppointmentMirror, pushAppointment } from '@/lib/google/sync';
import { stripeConfigured } from '@/lib/stripe/server';
import { createDepositPaymentIntent, refundPaymentIntent } from '@/lib/stripe/payments';
import { awardLoyaltyOnCompletion } from '@/lib/business/loyalty';
import { captureException } from '@/lib/observability';

const APPOINTMENTS_PATH = '/';

type ServiceRowLite = { id: string; name: string; duration_min: number; price: number };
type HoursRow = {
  weekday: number;
  enabled: boolean;
  open_time: string | null;
  close_time: string | null;
};

function rawDb() {
  // Narrow stub until codegen ships. The structural shape exposes what we need.
  return createSupabaseServerClient() as unknown as Record<string, unknown>;
}

async function fetchScheduleData(shopId: string, dayStartUtc: Date, dayEndUtc: Date) {
  const sb = rawDb() as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (
          k: string,
          v: string,
        ) => Promise<{ data: unknown; error: unknown }> & {
          gte: (
            k: string,
            v: string,
          ) => {
            lt: (k: string, v: string) => Promise<{ data: unknown; error: unknown }>;
          };
        };
      };
    };
  };

  const [shopRes, hoursRes, daysOffRes, apptsRes, blockedRes] = await Promise.all([
    sb.from('shops').select('id, timezone').eq('id', shopId),
    sb.from('shop_hours').select('weekday, enabled, open_time, close_time').eq('shop_id', shopId),
    sb.from('shop_days_off').select('date').eq('shop_id', shopId),
    sb
      .from('appointments')
      .select('id, barber_id, start_at, end_at, status')
      .eq('shop_id', shopId)
      .gte('start_at', dayStartUtc.toISOString())
      .lt('start_at', dayEndUtc.toISOString()),
    sb
      .from('blocked_time')
      .select('id, barber_id, start_at, end_at')
      .eq('shop_id', shopId)
      .gte('start_at', dayStartUtc.toISOString())
      .lt('start_at', dayEndUtc.toISOString()),
  ]);

  return {
    timezone:
      (shopRes.data as Array<{ id: string; timezone: string }> | null)?.[0]?.timezone ??
      'America/Toronto',
    hours: (hoursRes.data as HoursRow[] | null) ?? [],
    daysOff: (daysOffRes.data as Array<{ date: string }> | null) ?? [],
    appts: (
      (apptsRes.data as Array<{
        id: string;
        barber_id: string;
        start_at: string;
        end_at: string;
        status: ExistingAppointment['status'];
      }> | null) ?? []
    ).map(
      (a): ExistingAppointment => ({
        ...a,
        start_at: new Date(a.start_at),
        end_at: new Date(a.end_at),
      }),
    ),
    blocked: (
      (blockedRes.data as Array<{
        barber_id: string | null;
        start_at: string;
        end_at: string;
      }> | null) ?? []
    ).map((b) => ({
      barber_id: b.barber_id,
      start_at: new Date(b.start_at),
      end_at: new Date(b.end_at),
    })),
  };
}

async function fetchServices(serviceIds: ReadonlyArray<string>, shopId: string) {
  const sb = rawDb() as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (
          k: string,
          v: string,
        ) => {
          in: (k: string, vs: string[]) => Promise<{ data: unknown; error: unknown }>;
        };
      };
    };
  };
  const { data, error } = await sb
    .from('services')
    // `name` added Phase 34 so the Google Calendar event summary can list
    // the booked services. ~no cost (same row).
    .select('id, name, duration_min, price')
    .eq('shop_id', shopId)
    .in('id', [...serviceIds]);
  if (error) return null;
  return (data as ServiceRowLite[] | null) ?? [];
}

// ---------------------------------------------------------------------------
// createAppointment
// ---------------------------------------------------------------------------
export const createAppointment = withAction({
  schema: appointmentSchema,
  minRole: 'barber',
  run: async (input, ctx) => {
    const services = await fetchServices(input.service_ids, ctx.shopId);
    if (!services || services.length !== input.service_ids.length) {
      return err('NOT_FOUND');
    }

    const totalMinutes = services.reduce((s, x) => s + x.duration_min, 0);
    const totalAmount = services.reduce((s, x) => s + x.price, 0);

    // Pull shop tz to compose start_at/end_at.
    const sb = rawDb() as unknown as {
      from: (t: string) => {
        select: (cols: string) => {
          eq: (k: string, v: string) => Promise<{ data: unknown; error: unknown }>;
        };
      };
    };
    const shopRes = await sb.from('shops').select('timezone').eq('id', ctx.shopId);
    const timezone =
      (shopRes.data as Array<{ timezone: string }> | null)?.[0]?.timezone ?? 'America/Toronto';

    const startAt = combineShopDateTime(input.date, input.start_time, timezone);
    const endAt = new Date(startAt.getTime() + totalMinutes * 60_000);

    // Verify availability before insert.
    const dayStart = shopDayStart(startAt, timezone);
    const dayEnd = shopDayEnd(startAt, timezone);
    const schedule = await fetchScheduleData(ctx.shopId, dayStart, dayEnd);

    const wallStart = new Date(startAt);
    const verdict = checkAvailability({
      start_at: startAt,
      end_at: endAt,
      barber_id: input.barber_id,
      shop_date: input.date,
      shop_weekday: (wallStart.getUTCDay() + 7) % 7, // approximation — engine treats hours in shop-local already
      shop_start_time: input.start_time,
      shop_end_time: `${String(Math.floor(((wallStart.getUTCHours() * 60 + wallStart.getUTCMinutes() + totalMinutes) % 1440) / 60)).padStart(2, '0')}:${String((wallStart.getUTCMinutes() + totalMinutes) % 60).padStart(2, '0')}`,
      hours: schedule.hours,
      daysOff: schedule.daysOff,
      existing: schedule.appts,
      blocked: schedule.blocked,
      settings: null, // admin booking — booking-flow bounds skipped
    });

    if (!verdict.ok) {
      // Conflict is the most common case → CONFLICT errorCode.
      return err(
        verdict.reason === 'CONFLICT_APPOINTMENT' || verdict.reason === 'CONFLICT_BLOCK'
          ? 'CONFLICT'
          : 'INVALID_INPUT',
      );
    }

    // Insert appointment row.
    const insertRes = await (
      rawDb() as unknown as {
        from: (t: string) => {
          insert: (row: Record<string, unknown>) => {
            select: (cols: string) => {
              single: () => Promise<{
                data: { id: string } | null;
                error: { message: string } | null;
              }>;
            };
          };
        };
      }
    )
      .from('appointments')
      .insert({
        shop_id: ctx.shopId,
        barber_id: input.barber_id,
        client_id: input.client_id,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        status: input.status,
        source: 'admin',
        notes: input.notes,
        total_amount: totalAmount,
      })
      .select('id')
      .single();
    if (insertRes.error || !insertRes.data) {
      // Phase 70 audit P2.16 — partial UNIQUE index on (barber_id,
      // start_at) WHERE status NOT IN ('cancelled','no_show') fires
      // 23505 when a concurrent insert wins the race. Surface as
      // CONFLICT (same code path as a synchronous availability fail).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = insertRes.error as any;
      if (e?.code === '23505') return err('CONFLICT');
      return err('UNEXPECTED');
    }

    // Link services.
    const linkRes = await (
      rawDb() as unknown as {
        from: (t: string) => {
          insert: (
            rows: Array<{
              appointment_id: string;
              service_id: string;
              price_snapshot: number;
            }>,
          ) => Promise<{ error: unknown }>;
        };
      }
    )
      .from('appointment_services')
      .insert(
        services.map((s) => ({
          appointment_id: insertRes.data!.id,
          service_id: s.id,
          price_snapshot: s.price,
        })),
      );
    void linkRes;

    void shopIsoDate; // marked used (helper exposed for callers)

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'insert',
      entity: 'appointments',
      entityId: insertRes.data.id,
      diff: { after: { ...input, totalMinutes, totalAmount } },
    });

    // Best-effort push to Google Calendar (Phase 34) — fires and forgets;
    // any failure is logged on the barber's connection row but never
    // breaks the appointment creation flow.
    void pushAppointment({
      appointmentId: insertRes.data.id,
      barberId: input.barber_id,
      startAtIso: startAt.toISOString(),
      endAtIso: endAt.toISOString(),
      timezone,
      googleEventId: null,
      summary: services.map((s) => s.name ?? 'Service').join(' + ') || 'Appointment',
      description: input.notes ?? undefined,
    });

    revalidatePath(APPOINTMENTS_PATH);
    return ok({ id: insertRes.data.id });
  },
});

// ---------------------------------------------------------------------------
// updateAppointment — V1: only allows status/notes change. Time-shift comes V1.1.
// ---------------------------------------------------------------------------
export const updateAppointment = withAction({
  schema: updateAppointmentSchema,
  minRole: 'barber',
  run: async (input, ctx) => {
    const { id, status, notes } = input;

    // Read the prior state so we can detect the unpaid→completed
    // transition (Phase 43 loyalty award only fires once per visit).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = rawDb() as any;
    const priorRes = await sb
      .from('appointments')
      .select('status, client_id, total_amount')
      .eq('id', id)
      .single();
    const prior = priorRes.data as {
      status: string;
      client_id: string;
      total_amount: number;
    } | null;

    const { error } = await sb.from('appointments').update({ status, notes }).eq('id', id);
    if (error) return err('UNEXPECTED');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'appointments',
      entityId: id,
      diff: { status, notes },
    });

    // Phase 43 — loyalty award on the not-completed → completed
    // transition. Best-effort; failure doesn't roll back the status.
    if (status === 'completed' && prior && prior.status !== 'completed') {
      void awardLoyaltyOnCompletion({
        shopId: ctx.shopId,
        appointmentId: id,
        clientId: prior.client_id,
        totalAmount: prior.total_amount,
      });
    }

    revalidatePath(APPOINTMENTS_PATH);
    return ok({ id });
  },
});

// ---------------------------------------------------------------------------
// rescheduleAppointment — Phase 27 drag-to-reschedule.
//
// The client passes (id, barber_id, start_at). We re-derive `end_at` from
// the row's existing duration so a drag never silently changes the length
// of the appointment. The availability check excludes the appointment
// being moved (otherwise it would conflict with itself).
//
// Why not let the client send end_at too: the calendar UI works in
// minute-granularity, but duration is canonical on the row. Trusting the
// client's end_at would let a buggy drag handler corrupt the row's length.
// Reading the old row is one extra round-trip and keeps the invariant.
// ---------------------------------------------------------------------------
export const rescheduleAppointment = withAction({
  schema: rescheduleAppointmentSchema,
  minRole: 'barber',
  run: async (input, ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = rawDb() as any;

    // 1. Load the appointment to compute duration + verify ownership.
    const apptRes = await sb
      .from('appointments')
      .select('id, shop_id, barber_id, start_at, end_at, status')
      .eq('id', input.id)
      .single();
    const appt = apptRes.data as {
      id: string;
      shop_id: string;
      barber_id: string;
      start_at: string;
      end_at: string;
      status: ExistingAppointment['status'];
    } | null;
    if (!appt) return err('NOT_FOUND');
    if (appt.shop_id !== ctx.shopId) return err('NOT_FOUND'); // RLS would have hidden it, but belt-and-braces.
    // Don't allow moving a cancelled/no-show appointment — they're
    // historical. The drag UI should disable dragging those, but the
    // server rejects them defensively too.
    if (appt.status === 'cancelled' || appt.status === 'no_show') {
      return err('INVALID_INPUT');
    }

    // 2. Preserve duration.
    const oldStart = new Date(appt.start_at);
    const oldEnd = new Date(appt.end_at);
    const durationMs = oldEnd.getTime() - oldStart.getTime();
    const newStart = new Date(input.start_at);
    if (Number.isNaN(newStart.getTime())) return err('INVALID_INPUT');
    const newEnd = new Date(newStart.getTime() + durationMs);

    // 3. Pull shop timezone, then fetch the day's schedule (we hit the same
    //    function as createAppointment for parity — same conflict rules).
    const shopRes = await sb.from('shops').select('timezone').eq('id', ctx.shopId);
    const timezone =
      (shopRes.data as Array<{ timezone: string }> | null)?.[0]?.timezone ?? 'America/Toronto';

    const dayStart = shopDayStart(newStart, timezone);
    const dayEnd = shopDayEnd(newStart, timezone);
    const schedule = await fetchScheduleData(ctx.shopId, dayStart, dayEnd);

    // 4. Exclude the moving appointment from the conflict set; otherwise
    //    a no-op drag (or any drag inside the original time window) would
    //    self-collide.
    const filteredExisting = schedule.appts.filter((a) => a.id !== input.id);

    // 5. Build the wall-clock inputs the engine needs.
    const shopDate = shopIsoDate(newStart, timezone);
    const startTime = formatShopTime(newStart, timezone, 'HH:mm');
    const endTime = formatShopTime(newEnd, timezone, 'HH:mm');
    // Shop-local weekday (Sun=0..Sat=6). Re-derive from the formatter so
    // it matches the calendar's `weekday` calculation.
    const isoWeekday = Number(formatShopTime(newStart, timezone, 'i'));
    const shopWeekday = isoWeekday % 7;

    const verdict = checkAvailability({
      start_at: newStart,
      end_at: newEnd,
      barber_id: input.barber_id,
      shop_date: shopDate,
      shop_weekday: shopWeekday,
      shop_start_time: startTime,
      shop_end_time: endTime,
      hours: schedule.hours,
      daysOff: schedule.daysOff,
      existing: filteredExisting,
      blocked: schedule.blocked,
      settings: null, // admin path — no booking-flow bounds.
    });

    if (!verdict.ok) {
      return err(
        verdict.reason === 'CONFLICT_APPOINTMENT' || verdict.reason === 'CONFLICT_BLOCK'
          ? 'CONFLICT'
          : 'INVALID_INPUT',
      );
    }

    // 6. Persist the move.
    const updateRes = await sb
      .from('appointments')
      .update({
        barber_id: input.barber_id,
        start_at: newStart.toISOString(),
        end_at: newEnd.toISOString(),
      })
      .eq('id', input.id);
    if (updateRes.error) {
      // Phase 70 audit P2.16 — partial UNIQUE index can fire on the
      // UPDATE path too: if a concurrent booking lands at the
      // destination slot between checkAvailability() and the UPDATE,
      // Postgres returns 23505. Map to CONFLICT for consistent UX.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = updateRes.error as any;
      if (e?.code === '23505') return err('CONFLICT');
      return err('UNEXPECTED');
    }

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'appointments',
      entityId: input.id,
      diff: {
        before: { barber_id: appt.barber_id, start_at: appt.start_at, end_at: appt.end_at },
        after: {
          barber_id: input.barber_id,
          start_at: newStart.toISOString(),
          end_at: newEnd.toISOString(),
        },
      },
    });

    // ── Google Calendar push (Phase 34) ──────────────────────────────
    // If the barber changed (cross-column drag), the OLD barber's
    // mirrored event needs to be removed from THEIR calendar, then a
    // fresh event created on the NEW barber's calendar. If the barber
    // didn't change, a single update on the existing event ID suffices.
    if (input.barber_id !== appt.barber_id) {
      void deleteAppointmentMirror({
        appointmentId: input.id,
        barberId: appt.barber_id,
        googleEventId: await fetchGoogleEventId(input.id),
      });
      void pushAppointment({
        appointmentId: input.id,
        barberId: input.barber_id,
        startAtIso: newStart.toISOString(),
        endAtIso: newEnd.toISOString(),
        timezone,
        googleEventId: null,
        summary: 'Appointment',
      });
    } else {
      void pushAppointment({
        appointmentId: input.id,
        barberId: input.barber_id,
        startAtIso: newStart.toISOString(),
        endAtIso: newEnd.toISOString(),
        timezone,
        googleEventId: await fetchGoogleEventId(input.id),
        summary: 'Appointment',
      });
    }

    revalidatePath(APPOINTMENTS_PATH);
    return ok({ id: input.id });
  },
});

/**
 * Pull just the `google_event_id` for an appointment so the push helper
 * can decide between create-vs-update. Returns null when the column is
 * empty or the row is gone. Service-role read because the column is
 * effectively a sync handle, not user-facing data.
 */
async function fetchGoogleEventId(appointmentId: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = rawDb() as any;
  const res = await sb
    .from('appointments')
    .select('google_event_id')
    .eq('id', appointmentId)
    .single();
  const row = res.data as { google_event_id: string | null } | null;
  return row?.google_event_id ?? null;
}

// ---------------------------------------------------------------------------
// cancelAppointment
// ---------------------------------------------------------------------------
export const cancelAppointment = withAction({
  schema: cancelAppointmentSchema,
  minRole: 'barber',
  run: async (input, ctx) => {
    // Pull the row BEFORE the cancel so we have barber_id +
    // google_event_id for the mirror-delete below. Two reads instead of
    // one but keeps the cancel logic readable.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const preSb = rawDb() as any;
    const preRes = await preSb
      .from('appointments')
      .select('barber_id, google_event_id')
      .eq('id', input.id)
      .single();
    const pre = preRes.data as { barber_id: string; google_event_id: string | null } | null;

    const { error } = await (
      rawDb() as unknown as {
        from: (t: string) => {
          update: (row: Record<string, unknown>) => {
            eq: (k: string, v: string) => Promise<{ error: { message: string } | null }>;
          };
        };
      }
    )
      .from('appointments')
      .update({ status: 'cancelled' })
      .eq('id', input.id);
    if (error) return err('UNEXPECTED');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'appointments',
      entityId: input.id,
      diff: { status: 'cancelled' },
    });

    // ── Google Calendar delete (Phase 34) ────────────────────────────
    // Remove the mirrored event from the barber's personal calendar.
    // No-op when the appointment was never pushed (e.g., barber connected
    // their calendar AFTER the appointment was created).
    if (pre?.google_event_id) {
      void deleteAppointmentMirror({
        appointmentId: input.id,
        barberId: pre.barber_id,
        googleEventId: pre.google_event_id,
      });
    }

    // ── Cancellation email (Phase 25b.5) ──────────────────────────────
    // Fetch the appointment + client + services + shop in one shot, then
    // dispatch. The dispatcher itself gates on
    // `notification_automations.kind='cancellation'`, so no extra check
    // here. Best-effort: a fetch failure doesn't fail the cancel action.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = rawDb() as any;
      const apptRes = await sb
        .from('appointments')
        .select('id, start_at, client_id')
        .eq('id', input.id)
        .single();
      const appt = apptRes.data as {
        id: string;
        start_at: string;
        client_id: string;
      } | null;
      if (appt) {
        const [clientRes, servicesRes, shopRes] = await Promise.all([
          sb.from('clients').select('first_name, email').eq('id', appt.client_id).single(),
          sb.from('appointment_services').select('services(name)').eq('appointment_id', appt.id),
          sb.from('shops').select('name, timezone, phone').eq('id', ctx.shopId).single(),
        ]);
        const client = clientRes.data as { first_name: string; email: string | null } | null;
        const shop = shopRes.data as {
          name: string;
          timezone: string;
          phone: string | null;
        } | null;
        const services = (
          (servicesRes.data as Array<{ services: { name: string } | null }> | null) ?? []
        )
          .map((r) => r.services?.name)
          .filter((n): n is string => Boolean(n))
          .map((name) => ({ name }));
        if (client?.email && shop) {
          await sendEmail({
            shopId: ctx.shopId,
            kind: 'cancellation',
            to: client.email,
            // V1.5 will derive locale from client preference; for now we
            // send in the shop's default language (French for new shops).
            subject: `Annulation — ${shop.name}`,
            template: AppointmentCancellation({
              locale: 'fr',
              shop: { name: shop.name, phone: shop.phone, timezone: shop.timezone },
              client: { firstName: client.first_name },
              appointment: { startAt: appt.start_at, services },
              // V1 schema doesn't carry a reason field — add one once the
              // cancel modal grows a "reason" textarea.
              reason: null,
            }),
            tags: [
              { name: 'kind', value: 'cancellation' },
              { name: 'shop', value: ctx.shopId },
            ],
          });
        }
      }
    } catch {
      // Swallow — the audit log already records the cancel, and the
      // dispatcher captures its own send errors.
    }

    revalidatePath(APPOINTMENTS_PATH);
    return ok({ id: input.id });
  },
});

// ---------------------------------------------------------------------------
// blockTime
// ---------------------------------------------------------------------------
export const blockTime = withAction({
  schema: blockTimeSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const sb = rawDb() as unknown as {
      from: (t: string) => {
        select: (cols: string) => {
          eq: (k: string, v: string) => Promise<{ data: unknown; error: unknown }>;
        };
        insert: (row: Record<string, unknown>) => {
          select: (cols: string) => {
            single: () => Promise<{
              data: { id: string } | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
    };
    const shopRes = await sb.from('shops').select('timezone').eq('id', ctx.shopId);
    const timezone =
      (shopRes.data as Array<{ timezone: string }> | null)?.[0]?.timezone ?? 'America/Toronto';

    const startAt = combineShopDateTime(input.date, input.start_time, timezone);
    const endAt = combineShopDateTime(input.date, input.end_time, timezone);
    if (endAt.getTime() <= startAt.getTime()) return err('INVALID_INPUT');

    const insertRes = await sb
      .from('blocked_time')
      .insert({
        shop_id: ctx.shopId,
        barber_id: input.barber_id,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        reason: input.reason,
      })
      .select('id')
      .single();
    if (insertRes.error || !insertRes.data) return err('UNEXPECTED');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'insert',
      entity: 'blocked_time',
      entityId: insertRes.data.id,
      diff: { after: input },
    });
    revalidatePath(APPOINTMENTS_PATH);
    return ok({ id: insertRes.data.id });
  },
});

// ---------------------------------------------------------------------------
// chargeAppointment — Phase 38 (Stripe deposit/charge on an appointment).
//
// Returns the PaymentIntent's `clientSecret`. The client then renders
// Stripe Elements (Phase 38b — V1.1 UI work) with this secret and the
// user enters their card. Webhook payment_intent.succeeded flips
// payment_status to 'paid'.
//
// No-ops with INVALID_INPUT when:
//   - Stripe isn't configured (env vars absent)
//   - The shop has no connected Stripe account
//   - The appointment already has a paid/pending intent (avoid duplicates)
// ---------------------------------------------------------------------------
export const chargeAppointment = withAction<
  typeof chargeAppointmentSchema,
  { clientSecret: string; paymentIntentId: string }
>({
  schema: chargeAppointmentSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    if (!stripeConfigured()) return err('UNEXPECTED');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = rawDb() as any;
    const [apptRes, shopRes] = await Promise.all([
      sb
        .from('appointments')
        .select('id, shop_id, payment_intent_id, payment_status, client_id')
        .eq('id', input.id)
        .single(),
      sb
        .from('shops')
        .select('stripe_account_id, stripe_connect_status')
        .eq('id', ctx.shopId)
        .single(),
    ]);

    const appt = apptRes.data as {
      id: string;
      shop_id: string;
      payment_intent_id: string | null;
      payment_status: 'unpaid' | 'pending' | 'paid' | 'refunded' | 'failed';
      client_id: string;
    } | null;
    const shop = shopRes.data as {
      stripe_account_id: string | null;
      stripe_connect_status: string;
    } | null;
    if (!appt) return err('NOT_FOUND');
    if (appt.shop_id !== ctx.shopId) return err('NOT_FOUND');

    // Shop must have an active Stripe Connect account to receive funds.
    if (!shop?.stripe_account_id || shop.stripe_connect_status !== 'active') {
      return err('INVALID_INPUT', { stripe: 'not_connected' });
    }

    // If a paid intent already exists, refuse silently (idempotent).
    if (appt.payment_status === 'paid') {
      return err('CONFLICT', { payment: 'already_paid' });
    }

    // Pull the client's email so Stripe can mail them a receipt.
    const clientRes = await sb.from('clients').select('email').eq('id', appt.client_id).single();
    const client = clientRes.data as { email: string | null } | null;

    try {
      const intent = await createDepositPaymentIntent({
        connectedAccountId: shop.stripe_account_id,
        appointmentId: appt.id,
        amountCents: input.amount_cents,
        customerEmail: client?.email ?? undefined,
      });
      // Persist the intent ID + flip status to 'pending'. Webhook flips
      // to 'paid' on success — until then, the UI shows "Pending payment."
      await sb
        .from('appointments')
        .update({
          payment_intent_id: intent.id,
          payment_status: 'pending',
          deposit_amount_cents: input.amount_cents,
        })
        .eq('id', appt.id);
      await logAuditAction({
        shopId: ctx.shopId,
        actorId: ctx.userId,
        action: 'update',
        entity: 'appointments',
        entityId: appt.id,
        diff: { payment_intent_created: input.amount_cents },
      });
      revalidatePath(APPOINTMENTS_PATH);
      return ok({
        clientSecret: intent.client_secret ?? '',
        paymentIntentId: intent.id,
      });
    } catch (e) {
      captureException(e, {
        tags: { layer: 'stripe-payments', action: 'chargeAppointment' },
      });
      return err('UNEXPECTED');
    }
  },
});

// ---------------------------------------------------------------------------
// refundAppointment — Phase 38.
//
// Issues a full refund against the appointment's PaymentIntent. Webhook
// `charge.refunded` updates payment_status to 'refunded'.
//
// Used internally by `cancelAppointment` when the appointment was paid,
// but also exposed standalone so a manager can refund without cancelling.
// ---------------------------------------------------------------------------
export const refundAppointment = withAction({
  schema: refundAppointmentSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    if (!stripeConfigured()) return err('UNEXPECTED');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = rawDb() as any;
    const apptRes = await sb
      .from('appointments')
      .select('id, shop_id, payment_intent_id, payment_status')
      .eq('id', input.id)
      .single();
    const appt = apptRes.data as {
      id: string;
      shop_id: string;
      payment_intent_id: string | null;
      payment_status: 'unpaid' | 'pending' | 'paid' | 'refunded' | 'failed';
    } | null;
    if (!appt) return err('NOT_FOUND');
    if (appt.shop_id !== ctx.shopId) return err('NOT_FOUND');
    if (!appt.payment_intent_id) return err('INVALID_INPUT', { payment: 'no_intent' });
    if (appt.payment_status !== 'paid') {
      return err('INVALID_INPUT', { payment: 'not_paid' });
    }

    try {
      await refundPaymentIntent({ paymentIntentId: appt.payment_intent_id });
      await logAuditAction({
        shopId: ctx.shopId,
        actorId: ctx.userId,
        action: 'update',
        entity: 'appointments',
        entityId: appt.id,
        diff: { refunded: true },
      });
      revalidatePath(APPOINTMENTS_PATH);
      return ok({ id: appt.id });
    } catch (e) {
      captureException(e, {
        tags: { layer: 'stripe-payments', action: 'refundAppointment' },
      });
      return err('UNEXPECTED');
    }
  },
});
