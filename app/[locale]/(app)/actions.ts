'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { logAuditAction } from '@/lib/audit-log';
import { checkAvailability, type ExistingAppointment } from '@/lib/business/availability';
import {
  combineShopDateTime,
  shopDayEnd,
  shopDayStart,
  shopIsoDate,
} from '@/lib/business/timezone';
import {
  appointmentSchema,
  blockTimeSchema,
  cancelAppointmentSchema,
  updateAppointmentSchema,
} from './schema';

const APPOINTMENTS_PATH = '/';

type ServiceRowLite = { id: string; duration_min: number; price: number };
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
    .select('id, duration_min, price')
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
    if (insertRes.error || !insertRes.data) return err('UNEXPECTED');

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
      .update({ status, notes })
      .eq('id', id);
    if (error) return err('UNEXPECTED');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'appointments',
      entityId: id,
      diff: { status, notes },
    });
    revalidatePath(APPOINTMENTS_PATH);
    return ok({ id });
  },
});

// ---------------------------------------------------------------------------
// cancelAppointment
// ---------------------------------------------------------------------------
export const cancelAppointment = withAction({
  schema: cancelAppointmentSchema,
  minRole: 'barber',
  run: async (input, ctx) => {
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
