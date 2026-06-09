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
  bulkCancelAppointmentsSchema,
  cancelAppointmentSchema,
  chargeAppointmentSchema,
  refundAppointmentSchema,
  rescheduleAppointmentSchema,
  searchClientsSchema,
  updateAppointmentSchema,
} from './schema';
import { sendEmail } from '@/lib/email/send';
import { AppointmentCancellation } from '@/lib/email/templates/appointment-cancellation';
import { deleteAppointmentMirror, pushAppointment } from '@/lib/google/sync';
import { stripeConfigured } from '@/lib/stripe/server';
import {
  createDepositPaymentIntent,
  markRefundedByIntent,
  refundPaymentIntentFull,
} from '@/lib/stripe/payments';
import { awardLoyaltyOnCompletion } from '@/lib/business/loyalty';
import { sendReviewRequestOnCompletion } from '@/lib/business/review-request';
import { enumerateRecurringDates } from '@/lib/business/recurrence';
import { notifyMatchingWaitlistOnCancel } from '@/lib/business/waitlist-notify';
import { pushAppointmentToQuickbooks } from '@/lib/quickbooks/sync';
import { captureException } from '@/lib/observability';
import { checkRateLimit } from '@/lib/auth/rate-limit';

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
    // Admin create is for booking states only — creating 'completed' /
    // 'cancelled' / 'arrived' / 'no_show' directly would skip the
    // loyalty/review/QuickBooks side-effects that fire on the
    // updateAppointment completed-transition. Mark it complete via the drawer.
    if (input.status !== 'booked' && input.status !== 'confirmed') {
      return err('INVALID_INPUT', { reason: 'invalid_create_status' });
    }
    // Phase H+5 — strict barber scope. A barber can only create
    // appointments for THEMSELVES. We rewrite input.barber_id to
    // ctx.barberId regardless of what the form sent. Managers +
    // owners can create for any barber as before (no rewrite).
    if (ctx.role === 'barber') {
      if (!ctx.barberId) return err('FORBIDDEN', { reason: 'no_barber_row' });
      if (input.barber_id !== ctx.barberId) {
        return err('FORBIDDEN', { reason: 'not_your_chair' });
      }
    }

    const services = await fetchServices(input.service_ids, ctx.shopId);
    if (!services || services.length !== input.service_ids.length) {
      return err('NOT_FOUND');
    }

    // Validate the client belongs to THIS shop (mirrors the services check).
    // RLS permits an insert for any shop member but never binds client_id to
    // the shop, so a crafted request could otherwise link a foreign client.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clientCheck = await (rawDb() as any)
      .from('clients')
      .select('id')
      .eq('id', input.client_id)
      .eq('shop_id', ctx.shopId)
      .maybeSingle();
    if (!clientCheck.data) return err('NOT_FOUND');

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

    // Typo guard — reject a start absurdly far in the future (a fat-fingered
    // year). Past starts are allowed (back-dating a walk-in already served).
    if (startAt.getTime() - Date.now() > 2 * 365 * 24 * 60 * 60 * 1000) {
      return err('INVALID_INPUT', { reason: 'too_far_future' });
    }

    // Verify availability before insert.
    const dayStart = shopDayStart(startAt, timezone);
    const dayEnd = shopDayEnd(startAt, timezone);
    const schedule = await fetchScheduleData(ctx.shopId, dayStart, dayEnd);

    // Derive the wall-clock inputs the engine needs from the SHOP timezone,
    // mirroring rescheduleAppointment. The previous UTC arithmetic
    // (getUTCDay / getUTCHours) produced a wrong weekday + end-time for any
    // non-UTC tenant — e.g. a 19:00 America/Toronto start became "23:30",
    // tripping a false OUTSIDE_HOURS rejection of a legitimate evening
    // appointment, and rolling the weekday over near midnight UTC.
    const verdict = checkAvailability({
      start_at: startAt,
      end_at: endAt,
      barber_id: input.barber_id,
      shop_date: input.date,
      shop_weekday: Number(formatShopTime(startAt, timezone, 'i')) % 7,
      shop_start_time: input.start_time,
      shop_end_time: formatShopTime(endAt, timezone, 'HH:mm'),
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
      // 23505 = same-start UNIQUE index; 23P01 = the duration-overlap EXCLUDE
      // constraint (20260607120000). Both mean the slot was taken between the
      // availability check and the write → surface as CONFLICT.
      if (e?.code === '23505' || e?.code === '23P01') return err('CONFLICT');
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
    if (linkRes.error) {
      // Non-atomic insert recovery: the appointment row exists but its
      // service-link insert failed. An orphaned $-bearing appointment with
      // zero services corrupts finances/commission/loyalty, so roll back by
      // deleting the appointment we just created and surface UNEXPECTED.
      // (Wrapping both writes in a Postgres RPC is the proper V2 fix.)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rollbackRes = await (rawDb() as any)
        .from('appointments')
        .delete()
        .eq('id', insertRes.data.id);
      // If the compensating DELETE itself fails, the orphan persists. Don't
      // lose it behind the generic UNEXPECTED toast — capture the row id so
      // it can be reconciled (mirrors the orphan-PaymentIntent recovery on
      // the charge path).
      if (rollbackRes?.error) {
        captureException(new Error('createAppointment: orphan rollback DELETE failed'), {
          tags: { layer: 'calendar', action: 'createAppointment.rollback' },
          extra: {
            appointmentId: insertRes.data.id,
            shopId: ctx.shopId,
            linkError: String((linkRes.error as { message?: string })?.message ?? linkRes.error),
            deleteError: String(
              (rollbackRes.error as { message?: string })?.message ?? rollbackRes.error,
            ),
          },
        });
      }
      return err('UNEXPECTED');
    }

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
    // Phase H+5 — also pulls barber_id so we can run the ownership
    // check before any write.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = rawDb() as any;
    const priorRes = await sb
      .from('appointments')
      .select('status, client_id, total_amount, barber_id')
      .eq('id', id)
      .single();
    const prior = priorRes.data as {
      status: string;
      client_id: string;
      total_amount: number;
      barber_id: string;
    } | null;
    if (!prior) return err('NOT_FOUND');

    // Phase H+5 — strict barber scope. A barber can only update their
    // OWN appointments. Managers + owners can edit anyone's. ctx.barberId
    // is populated by withAction when role === 'barber'; if it's null,
    // either we couldn't resolve their barber row (data inconsistency)
    // or they're a manager+ in which case we skip the check entirely.
    if (ctx.role === 'barber' && prior.barber_id !== ctx.barberId) {
      return err('FORBIDDEN', { reason: 'not_your_appointment' });
    }

    // Block resurrecting a terminal money/loyalty-bearing row. 'completed'
    // already fired loyalty + review + QuickBooks; 'cancelled' may have been
    // refunded. 'no_show' carries no side-effects, so a late-arrival
    // correction (no_show → arrived/completed) is still allowed.
    if ((prior.status === 'completed' || prior.status === 'cancelled') && status !== prior.status) {
      return err('INVALID_INPUT', { reason: 'terminal_status_locked' });
    }

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
      // Loop 49 (Phase 99) — sync a SalesReceipt to QuickBooks on
      // the SAME transition the loyalty award fires on. Helper is
      // best-effort + idempotent via
      // `appointments.quickbooks_sales_receipt_id`, so a QB outage
      // doesn't fail the status update and a future cron could
      // backfill unsynced completes. Skipped silently when the
      // shop hasn't connected QB.
      void pushAppointmentToQuickbooks({ appointmentId: id, shopId: ctx.shopId });
      // Loop 64 — ask the client for a review on the same transition.
      // Best-effort + idempotent (one ask per appointment via the
      // client_marketing_sends ledger), so a Resend outage or a
      // re-toggle never fails or duplicates the status update.
      void sendReviewRequestOnCompletion({
        shopId: ctx.shopId,
        appointmentId: id,
        clientId: prior.client_id,
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
    // Phase H+5 — strict barber scope. A barber can only reschedule
    // their own appointments. Managers + owners can move anyone's.
    if (ctx.role === 'barber' && appt.barber_id !== ctx.barberId) {
      return err('FORBIDDEN', { reason: 'not_your_appointment' });
    }
    // A strict barber can only move an appointment WITHIN their own column —
    // they may not reassign it to another barber. Managers + owners can.
    if (ctx.role === 'barber' && input.barber_id !== ctx.barberId) {
      return err('FORBIDDEN', { reason: 'not_your_chair' });
    }
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
      // 23505 = same-start UNIQUE index; 23P01 = the duration-overlap EXCLUDE
      // constraint (20260607120000). Both mean the slot was taken between the
      // availability check and the write → surface as CONFLICT.
      if (e?.code === '23505' || e?.code === '23P01') return err('CONFLICT');
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
    // google_event_id for the mirror-delete below. Loop 25 also reads
    // payment fields to support the `also_refund` flag — same query.
    // Loop 42 — `start_at` added so the waitlist-notify helper can
    // match entries against the freed slot's date window.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const preSb = rawDb() as any;
    const preRes = await preSb
      .from('appointments')
      .select('barber_id, google_event_id, payment_intent_id, payment_status, start_at')
      .eq('id', input.id)
      .single();
    const pre = preRes.data as {
      barber_id: string;
      google_event_id: string | null;
      payment_intent_id: string | null;
      payment_status: 'unpaid' | 'pending' | 'paid' | 'refunded' | 'failed';
      start_at: string;
    } | null;
    if (!pre) return err('NOT_FOUND');

    // Phase H+5 — strict barber scope. A barber can only cancel their
    // OWN appointments. Managers + owners can cancel anyone's.
    if (ctx.role === 'barber' && pre.barber_id !== ctx.barberId) {
      return err('FORBIDDEN', { reason: 'not_your_appointment' });
    }

    // Refunds are manager+ discretion (mirrors standalone refundAppointment).
    // A barber may cancel their own appointment but not move money — the UI
    // hides the refund affordance from barbers; this enforces it server-side.
    if (input.also_refund && ctx.role === 'barber') {
      return err('FORBIDDEN', { reason: 'refund_requires_manager' });
    }

    // Throttle the money path. An `also_refund` cancel issues a full Stripe
    // refund, so it shares the SAME per-user bucket as standalone
    // refundAppointment — otherwise the 20/hr refund limit is trivially
    // bypassed by routing refunds through cancel. Only charged when money
    // actually moves (a plain cancel stays unthrottled here; bulk cancels go
    // through bulkCancelAppointments' own 5/min limit).
    if (input.also_refund) {
      const rl = await checkRateLimit(`refund:${ctx.userId}`, {
        max: 20,
        windowMs: 60 * 60 * 1000,
      });
      if (!rl.allowed) return err('RATE_LIMITED');
    }

    // Phase D — cancellation-policy gate on the auto-refund leg.
    //
    // Rule: if the appointment starts within `mins_cancel_before_appt`
    // minutes of now, the customer has missed the policy window and
    // the salon keeps the money. Admin can still force the refund
    // (e.g., goodwill gesture, the customer called in sick, etc.) but
    // they have to acknowledge the override via `force_refund: true`.
    //
    // We only gate when `also_refund=true` because the standalone
    // refund button is explicit admin discretion. The flag is checked
    // BEFORE the refund call so we don't move money against policy.
    //
    // Settings precedence: barber override (matches `pre.barber_id`)
    // beats shop default. If neither row exists we fall back to a
    // conservative 0-minute window (no policy = refund proceeds).
    if (
      input.also_refund &&
      !input.force_refund &&
      pre?.payment_status === 'paid' &&
      pre?.payment_intent_id
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = rawDb() as any;
      const settingsRes = await sb
        .from('barber_settings')
        .select('scope, barber_id, mins_cancel_before_appt')
        .eq('shop_id', ctx.shopId);
      const rows =
        (settingsRes.data as Array<{
          scope: 'shop' | 'barber';
          barber_id: string | null;
          mins_cancel_before_appt: number;
        }> | null) ?? [];
      const override = rows.find((r) => r.scope === 'barber' && r.barber_id === pre.barber_id);
      const fallback = rows.find((r) => r.scope === 'shop');
      const minsBefore = (override ?? fallback)?.mins_cancel_before_appt ?? 0;
      // 0-minute policy is interpreted as "no policy → refund proceeds"
      // (matches the customer-side cancellation semantics: no cancellation
      // window means cancellations are unrestricted). A shop that wants
      // to forbid all online refunds should disable the auto-refund flow
      // entirely via a future settings toggle rather than expressing
      // "no refunds" as a 0-minute window.
      if (minsBefore > 0) {
        const startMs = new Date(pre.start_at).getTime();
        const cutoffMs = startMs - minsBefore * 60_000;
        if (Date.now() >= cutoffMs) {
          // Within the no-refund window — reject. The client will
          // re-prompt the admin with a "force refund" confirmation
          // and retry with `force_refund: true`.
          return err('INVALID_INPUT', {
            refund_policy: 'within_no_refund_window',
            mins_cancel_before_appt: String(minsBefore),
          });
        }
      }
    }

    // Loop 25 — "Cancel & Refund" combo (P1.12 audit). When the
    // caller sets `also_refund` AND the appointment is actually paid,
    // we fire the refund FIRST (irreversible toward the customer —
    // they got their money back; safer than refunding after a cancel
    // that fails halfway through). The cancel itself proceeds even if
    // the refund errors — we'd rather have a refund'd-but-still-
    // booked row that the owner can clean up than a cancelled-but-
    // not-refunded chargeback risk.
    if (
      input.also_refund &&
      pre?.payment_status === 'paid' &&
      pre?.payment_intent_id &&
      stripeConfigured()
    ) {
      try {
        // Loop 31 (P95) — use the Full helper so the idempotency key
        // uses the explicit cent amount fetched from the PI (no
        // 'full' string fallback). Stripe-side dedup now works even
        // if a future caller passes the same amount explicitly.
        await refundPaymentIntentFull({ paymentIntentId: pre.payment_intent_id });
        // Sync-write refunded status (idempotent with the charge.refunded
        // webhook) so a dropped event can't leave the row 'paid'.
        await markRefundedByIntent(rawDb(), pre.payment_intent_id);
        await logAuditAction({
          shopId: ctx.shopId,
          actorId: ctx.userId,
          action: 'update',
          entity: 'appointments',
          entityId: input.id,
          // Phase D — `force_refund` flagged in the audit log so the
          // owner can later trace out-of-policy refunds (e.g., when
          // reviewing chargebacks or accountant questions). Only
          // present when true to keep the log payload small.
          diff: {
            refunded: true,
            source: 'cancel-and-refund',
            ...(input.force_refund ? { force_refund: true } : {}),
          },
        });
      } catch (e) {
        captureException(e, {
          tags: { layer: 'stripe-payments', action: 'cancelAppointment.refund' },
        });
        // Fall through — cancel proceeds anyway. Owner can retry the
        // refund manually via the refund button if it failed.
      }
    }

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
      // Phase C SR-of-SR — `client_id` is nullable since Phase 72
      // (walk-ins create appointments without a client row). The previous
      // type and `.single()` on `clients` would blow up on every walk-in
      // cancellation; the `try/catch` swallowed it but logged noise to
      // Sentry. Null-guarded to match the Phase C `chargeAppointment` fix.
      const appt = apptRes.data as {
        id: string;
        start_at: string;
        client_id: string | null;
      } | null;
      if (appt) {
        const [clientRes, servicesRes, shopRes] = await Promise.all([
          appt.client_id
            ? sb.from('clients').select('first_name, email').eq('id', appt.client_id).single()
            : Promise.resolve({ data: null }),
          sb.from('appointment_services').select('services(name)').eq('appointment_id', appt.id),
          // Phase H — `default_language` added so the cancellation
          // email lands in the shop's chosen language instead of the
          // hardcoded FR. Customer-preferred locale (V1.5) will
          // override per-client once we store it on `clients.locale`.
          sb
            .from('shops')
            .select('name, timezone, phone, default_language')
            .eq('id', ctx.shopId)
            .single(),
        ]);
        const client = clientRes.data as { first_name: string; email: string | null } | null;
        const shop = shopRes.data as {
          name: string;
          timezone: string;
          phone: string | null;
          default_language: string | null;
        } | null;
        const services = (
          (servicesRes.data as Array<{ services: { name: string } | null }> | null) ?? []
        )
          .map((r) => r.services?.name)
          .filter((n): n is string => Boolean(n))
          .map((name) => ({ name }));
        if (client?.email && shop) {
          const emailLocale: 'fr' | 'en' = shop.default_language === 'en' ? 'en' : 'fr';
          await sendEmail({
            shopId: ctx.shopId,
            kind: 'cancellation',
            to: client.email,
            subject:
              emailLocale === 'fr' ? `Annulation — ${shop.name}` : `Cancellation — ${shop.name}`,
            template: AppointmentCancellation({
              locale: emailLocale,
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

    // ── Loop 42 (P122) — waitlist auto-notify ─────────────────────
    // Find any waiting_list_entries whose date window covers the
    // freed slot AND who didn't explicitly prefer a different
    // barber. Send each a "slot just opened" email. The helper
    // dedups against `notified_at` (24h window) and catches its own
    // errors via Sentry, so a Resend outage doesn't block the
    // cancel. Fire-and-forget so the action's tail latency doesn't
    // pay for the email round-trips.
    if (pre) {
      // Resolve shop timezone once — the helper needs it to compute
      // the shop-local date for window matching. We cache via
      // `shop` row, same pattern as elsewhere.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tzSb = rawDb() as any;
      const shopTz = await tzSb.from('shops').select('timezone').eq('id', ctx.shopId).single();
      const timezone = (shopTz.data as { timezone: string } | null)?.timezone ?? 'America/Toronto';
      void notifyMatchingWaitlistOnCancel({
        shopId: ctx.shopId,
        barberId: pre.barber_id,
        startAtIso: pre.start_at,
        timezone,
      });
    }

    revalidatePath(APPOINTMENTS_PATH);
    return ok({ id: input.id });
  },
});

// ---------------------------------------------------------------------------
// bulkCancelAppointments — Loop 28 (P1.87)
//
// Cancel N appointments in a single round trip. Used by the calendar
// "Cancel day" button when an owner needs to clear a day (barber
// called in sick, power outage, statutory holiday slipped through).
// Mirrors `cancelAppointment` semantics:
//   - refund-first when `also_refund=true` and the row is `paid`
//   - refund failure is non-fatal — cancel still proceeds
//   - audit log gets ONE batch entry (not N rows) to keep the log
//     readable; the `count` in the diff is the audit trail
//   - Google Calendar mirror deletes happen in the background
//   - V1 does NOT send cancellation emails for bulk cancels (one
//     spammy burst of 50 emails on a "barber sick" day is worse than
//     a phone call from the shop owner). Per-row emails come back in
//     V1.5 with a "notify clients" toggle on the confirm dialog.
// ---------------------------------------------------------------------------
export const bulkCancelAppointments = withAction<
  typeof bulkCancelAppointmentsSchema,
  { count: number; refunded: number }
>({
  schema: bulkCancelAppointmentsSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    // Throttle bulk-cancel — it can refund + cancel a whole day in one call,
    // so it's the highest-blast-radius action. ~5/minute per user.
    const rl = await checkRateLimit(`bulkcancel:${ctx.userId}`, { max: 5, windowMs: 60 * 1000 });
    if (!rl.allowed) return err('RATE_LIMITED');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = rawDb() as any;
    const preRes = await sb
      .from('appointments')
      // Loop 42 — `start_at` pulled so the waitlist-notify helper at
      // the tail can match entries against each freed slot's date.
      .select(
        'id, shop_id, barber_id, google_event_id, payment_intent_id, payment_status, status, start_at',
      )
      .in('id', input.ids);
    const rows =
      (preRes.data as Array<{
        id: string;
        shop_id: string;
        barber_id: string;
        google_event_id: string | null;
        payment_intent_id: string | null;
        payment_status: 'unpaid' | 'pending' | 'paid' | 'refunded' | 'failed';
        status: string;
        start_at: string;
      }> | null) ?? [];

    // Reject early if any row belongs to a different shop. RLS would
    // already block this, but a clear error beats a partial cancel
    // that silently dropped rows. Same guard if the caller supplied
    // an unknown UUID.
    if (rows.length !== input.ids.length) return err('NOT_FOUND');
    if (rows.some((r) => r.shop_id !== ctx.shopId)) return err('NOT_FOUND');

    // Loop 28 self-review — refuse to "cancel" a row that's already
    // in a terminal state. The UI filters these out of
    // `bulkCancelTargets` already, but a stale tab (or a malicious
    // caller) could still ship them. Cancelling a `completed` row
    // silently destroys the finances trail for that visit; better
    // to bail loudly. `cancelled` / `no_show` are no-ops in the same
    // direction — same guard.
    const TERMINAL_STATES = new Set(['completed', 'cancelled', 'no_show']);
    if (rows.some((r) => TERMINAL_STATES.has(r.status))) {
      return err('INVALID_INPUT', { reason: 'terminal_status_in_batch' });
    }

    // Refund pass — only "paid" rows with a stored intent. Use
    // Promise.allSettled so one Stripe error doesn't abort the
    // others; we count successes for the toast and Sentry the
    // failures.
    let refundedCount = 0;
    if (input.also_refund && stripeConfigured()) {
      const refundable = rows.filter((r) => r.payment_status === 'paid' && r.payment_intent_id);
      const settled = await Promise.allSettled(
        refundable.map((r) => refundPaymentIntentFull({ paymentIntentId: r.payment_intent_id! })),
      );
      for (let i = 0; i < settled.length; i++) {
        const result = settled[i]!;
        if (result.status === 'fulfilled') {
          refundedCount += 1;
          // Sync-write refunded status (idempotent with the webhook) so a
          // dropped charge.refunded can't leave the row 'paid'.
          await markRefundedByIntent(sb, refundable[i]!.payment_intent_id!);
        } else {
          captureException(result.reason, {
            tags: { layer: 'stripe-payments', action: 'bulkCancelAppointments.refund' },
          });
        }
      }
    }

    // Single UPDATE for the batch. RLS still applies per-row.
    const updRes = await sb
      .from('appointments')
      .update({ status: 'cancelled' })
      .in('id', input.ids);
    if (updRes.error) return err('UNEXPECTED');

    // One audit entry for the whole batch — N entries would explode
    // the audit_log on a 50-appointment day cancel. The `entityId`
    // points at the first row so the trail is grep-able; the `diff`
    // carries the full ID list for forensics.
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'appointments',
      entityId: rows[0]?.id ?? 'batch',
      diff: {
        status: 'cancelled',
        count: rows.length,
        also_refund: input.also_refund,
        refunded_count: refundedCount,
        ids: input.ids,
      },
    });

    // Google Calendar mirror deletes in the background. We don't
    // await — the cancel UI revalidates immediately, and a slow
    // Google call shouldn't gate the toast. Each call has its own
    // captureException inside `deleteAppointmentMirror`.
    for (const r of rows) {
      if (r.google_event_id) {
        void deleteAppointmentMirror({
          appointmentId: r.id,
          barberId: r.barber_id,
          googleEventId: r.google_event_id,
        });
      }
    }

    // Loop 42 (P122) — waitlist auto-notify per freed slot. The
    // helper dedups per-entry with a 24h window so a customer who
    // happens to match three of the bulk-cancelled slots gets ONE
    // email, not three. Fire-and-forget so the cancel UI revalidates
    // before any emails leave the SMTP queue. Resolve shop tz once
    // outside the loop.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tzSb = rawDb() as any;
    const shopTz = await tzSb.from('shops').select('timezone').eq('id', ctx.shopId).single();
    const timezone = (shopTz.data as { timezone: string } | null)?.timezone ?? 'America/Toronto';
    for (const r of rows) {
      void notifyMatchingWaitlistOnCancel({
        shopId: ctx.shopId,
        barberId: r.barber_id,
        startAtIso: r.start_at,
        timezone,
      });
    }

    revalidatePath(APPOINTMENTS_PATH);
    return ok({ count: rows.length, refunded: refundedCount });
  },
});

// ---------------------------------------------------------------------------
// blockTime
// ---------------------------------------------------------------------------
export const blockTime = withAction<typeof blockTimeSchema, { ids: string[]; count: number }>({
  schema: blockTimeSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = rawDb() as any;
    const shopRes = await sb.from('shops').select('timezone').eq('id', ctx.shopId);
    const timezone =
      (shopRes.data as Array<{ timezone: string }> | null)?.[0]?.timezone ?? 'America/Toronto';

    // Loop 27 — expand the input into one or more concrete day-strings.
    // Single block when `recurrence === 'none'`; otherwise enumerate
    // dates from `input.date` to `input.until_date` by the recurrence
    // step. We cap at 53 occurrences (one year of weekly) to keep
    // payloads bounded — a longer horizon is almost certainly a typo
    // and the owner can re-run the action for the next year.
    const dates = enumerateRecurringDates({
      startIso: input.date,
      recurrence: input.recurrence,
      untilIso: input.until_date ?? null,
    });
    if (dates.length === 0) return err('INVALID_INPUT', { reason: 'recurrence_until_required' });

    // Pre-compute the (start, end) pairs in UTC and reject inverted
    // ranges before any insert. We check the FIRST date only — the
    // start/end_time pair is the same on every occurrence so if it's
    // valid once, it's valid for all.
    const firstStart = combineShopDateTime(dates[0]!, input.start_time, timezone);
    const firstEnd = combineShopDateTime(dates[0]!, input.end_time, timezone);
    if (firstEnd.getTime() <= firstStart.getTime()) return err('INVALID_INPUT');

    // Overlap guard — the create/reschedule paths already honor blocked_time,
    // so restore symmetry: don't silently paint a block over live
    // appointments. Count what each occurrence window would bury; if any and
    // the operator hasn't confirmed (force=true), return the count so the
    // modal can ask "this covers N appointments — block anyway?".
    if (!input.force) {
      let buried = 0;
      for (const d of dates) {
        const wStart = combineShopDateTime(d, input.start_time, timezone).toISOString();
        const wEnd = combineShopDateTime(d, input.end_time, timezone).toISOString();
        // Overlap = appointment.start_at < windowEnd AND appointment.end_at > windowStart.
        let q = sb
          .from('appointments')
          .select('id', { count: 'exact', head: true })
          .eq('shop_id', ctx.shopId)
          .in('status', ['booked', 'confirmed', 'arrived', 'completed'])
          .lt('start_at', wEnd)
          .gt('end_at', wStart);
        // barber_id null = shop-wide block → check EVERY barber's appointments.
        if (input.barber_id) q = q.eq('barber_id', input.barber_id);
        const res = await q;
        buried += (res.count as number | null) ?? 0;
      }
      if (buried > 0) {
        return err('INVALID_INPUT', { buried_appointments: String(buried) });
      }
    }

    const rows = dates.map((d) => ({
      shop_id: ctx.shopId,
      barber_id: input.barber_id,
      start_at: combineShopDateTime(d, input.start_time, timezone).toISOString(),
      end_at: combineShopDateTime(d, input.end_time, timezone).toISOString(),
      reason: input.reason,
    }));

    const insertRes = await sb.from('blocked_time').insert(rows).select('id');
    if (insertRes.error || !insertRes.data) return err('UNEXPECTED');
    const inserted = insertRes.data as Array<{ id: string }>;

    // Log a single audit entry that records the recurrence shape +
    // the row-count fan-out. Per-row audit lines would explode the
    // log on a 52-week block — the parent entry is enough trail.
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'insert',
      entity: 'blocked_time',
      entityId: inserted[0]?.id ?? 'unknown',
      diff: {
        after: input,
        recurrence_count: inserted.length,
        recurrence_kind: input.recurrence,
      },
    });
    revalidatePath(APPOINTMENTS_PATH);
    return ok({ ids: inserted.map((r) => r.id), count: inserted.length });
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
    // Throttle the money path — a runaway client or compromised session
    // shouldn't be able to spray charge attempts. ~20/hour per user.
    const rl = await checkRateLimit(`charge:${ctx.userId}`, { max: 20, windowMs: 60 * 60 * 1000 });
    if (!rl.allowed) return err('RATE_LIMITED');
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
      // Phase C — `client_id` is nullable on walk-in appointments
      // (Phase 72). The original `chargeAppointment` was written
      // before that change and assumed non-null; the type now
      // reflects reality and the email lookup below is null-guarded.
      client_id: string | null;
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

    // Phase C — pull the client's email so Stripe can mail them a
    // receipt, BUT skip the lookup for walk-ins (Phase 72 made
    // `client_id` nullable). Without this guard the `.single()` blew
    // up with `PGRST116` (no rows) on every walk-in charge attempt,
    // which the audit flagged as a usability regression — the
    // exported action existed but couldn't actually be called from
    // any walk-in flow.
    let customerEmail: string | undefined;
    if (appt.client_id) {
      const clientRes = await sb.from('clients').select('email').eq('id', appt.client_id).single();
      const client = clientRes.data as { email: string | null } | null;
      customerEmail = client?.email ?? undefined;
    }

    // Phase H SR — PI-create-then-DB-fail recovery.
    //
    // Pre-Phase H, the create + update lived inside a single try/catch.
    // If `paymentIntents.create` succeeded but the subsequent Supabase
    // update threw (network blip, DB locked, etc.), Stripe held a fresh
    // PI with our idempotency key `appt-deposit-${appt.id}` and our
    // appointment row had NO `payment_intent_id` link. Result: the
    // webhook fires `payment_intent.succeeded` later but
    // `persistPaymentStatus` no-ops because no row matches the intent
    // ID. Customer's money is in limbo until an operator manually
    // reconciles.
    //
    // Split into two phases:
    //   1. Create the PI — caught separately, all-or-nothing.
    //   2. Persist the link — if THIS fails after PI is live, log a
    //      CRITICAL audit row containing the intent ID so an operator
    //      can recover. The retry path is idempotent (same key returns
    //      the same PI) so the operator can re-run the action.
    let intent: Awaited<ReturnType<typeof createDepositPaymentIntent>>;
    try {
      intent = await createDepositPaymentIntent({
        connectedAccountId: shop.stripe_account_id,
        appointmentId: appt.id,
        amountCents: input.amount_cents,
        customerEmail,
      });
    } catch (e) {
      captureException(e, {
        tags: { layer: 'stripe-payments', action: 'chargeAppointment', stage: 'pi-create' },
      });
      return err('UNEXPECTED');
    }

    // PI exists now. From this point a thrown error means orphaned money.
    try {
      const updateRes = await sb
        .from('appointments')
        .update({
          payment_intent_id: intent.id,
          payment_status: 'pending',
          deposit_amount_cents: input.amount_cents,
        })
        .eq('id', appt.id);
      // Supabase doesn't throw on row-mismatch updates; treat any non-null
      // error as the PI-orphan trigger.
      if (updateRes.error) throw new Error(updateRes.error.message ?? 'update_failed');
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
      // CRITICAL: PI is live but link wasn't persisted. Log a high-
      // visibility audit row + Sentry so an operator can reconcile.
      // The intent.id is the recovery handle — manually re-run the
      // action OR PATCH the appointment row to attach this PI.
      captureException(e, {
        tags: {
          layer: 'stripe-payments',
          action: 'chargeAppointment',
          stage: 'orphan-pi',
        },
        extra: { intentId: intent.id, appointmentId: appt.id },
      });
      try {
        await logAuditAction({
          shopId: ctx.shopId,
          actorId: ctx.userId,
          action: 'update',
          entity: 'appointments',
          entityId: appt.id,
          diff: {
            orphan_payment_intent: intent.id,
            amount_cents: input.amount_cents,
            severity: 'critical',
          },
        });
      } catch {
        // Audit-log also down? Sentry has the breadcrumb above.
      }
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
    // Throttle the money path. ~20 refunds/hour per user is generous for a
    // busy front desk while blocking automated abuse.
    const rl = await checkRateLimit(`refund:${ctx.userId}`, { max: 20, windowMs: 60 * 60 * 1000 });
    if (!rl.allowed) return err('RATE_LIMITED');
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
      await refundPaymentIntentFull({ paymentIntentId: appt.payment_intent_id });
    } catch (e) {
      // The Stripe refund itself failed → no money moved. Report failure.
      captureException(e, {
        tags: { layer: 'stripe-payments', action: 'refundAppointment.stripe' },
      });
      return err('UNEXPECTED');
    }

    // The refund SUCCEEDED. From here, a DB/audit write failure must NOT tell
    // the operator the refund failed (it didn't — the money moved). The
    // charge.refunded webhook reconciles payment_status, so we capture the
    // error and still return ok(). Previously a markRefundedByIntent throw
    // surfaced "erreur inattendue" on a refund that actually went through.
    try {
      await markRefundedByIntent(sb, appt.payment_intent_id);
      await logAuditAction({
        shopId: ctx.shopId,
        actorId: ctx.userId,
        action: 'update',
        entity: 'appointments',
        entityId: appt.id,
        diff: { refunded: true },
      });
    } catch (e) {
      captureException(e, {
        tags: { layer: 'stripe-payments', action: 'refundAppointment.persist' },
      });
    }
    revalidatePath(APPOINTMENTS_PATH);
    return ok({ id: appt.id });
  },
});

// ---------------------------------------------------------------------------
// searchClients — server-side client lookup for the appointment picker.
//
// Replaces the in-memory filter over the 500-capped client payload (clients
// beyond 500 were unfindable, so operators created duplicate clients).
// Substring match on name / email / phone, scoped to the shop, capped at 30.
// ---------------------------------------------------------------------------
type ClientSearchRow = {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
};

export const searchClients = withAction<typeof searchClientsSchema, ClientSearchRow[]>({
  schema: searchClientsSchema,
  minRole: 'barber',
  run: async (input, ctx) => {
    const q = input.query.trim();
    if (q.length < 2) return ok([]);
    // Throttle: this fires per debounced keystroke and runs an un-indexable
    // 4-column ILIKE scan returning client PII, so cap it per user to block
    // sustained enumeration / DB-scan abuse while staying generous for real
    // typing (~1/s sustained). RATE_LIMITED surfaces as an empty result + a
    // soft notice in the picker, not a hard error.
    const rl = await checkRateLimit(`clientsearch:${ctx.userId}`, {
      max: 60,
      windowMs: 60 * 1000,
    });
    if (!rl.allowed) return err('RATE_LIMITED');
    // Strip characters that would break the PostgREST or() grammar
    // (commas / parens / backslash) or act as LIKE wildcards. The search is
    // shop-scoped regardless (the .eq below is ANDed before the .or), so this
    // only guards against malformed queries, not a cross-tenant leak.
    const safe = q.replace(/[%,()\\*]/g, ' ').trim();
    if (safe.length < 2) return ok([]);
    const pattern = `%${safe}%`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = rawDb() as any;
    const res = await sb
      .from('clients')
      .select('id, first_name, last_name, email, phone')
      .eq('shop_id', ctx.shopId)
      .or(
        `first_name.ilike.${pattern},last_name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern}`,
      )
      .order('first_name', { ascending: true })
      .limit(30);
    if (res.error) return err('UNEXPECTED');
    return ok((res.data as ClientSearchRow[] | null) ?? []);
  },
});
