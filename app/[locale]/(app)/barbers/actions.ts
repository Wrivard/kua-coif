'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { revalidatePublicShopSurfaces } from '@/lib/server-actions/revalidate';
import { logAuditAction } from '@/lib/audit-log';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import {
  barberSchema,
  deleteBarberSchema,
  disconnectGoogleSchema,
  setBarberStatusSchema,
  updateBarberSchema,
} from './schema';

const BARBERS_PATH = '/barbers';

// Same shaping trick as services/actions.ts — narrow the supabase client to a
// minimal structural type until db/types.ts codegen lands.
function db() {
  return createSupabaseServerClient() as unknown as {
    from: (table: string) => {
      insert: (row: Record<string, unknown>) => {
        select: (cols: string) => {
          single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }>;
        };
      };
      update: (row: Record<string, unknown>) => {
        eq: (k: string, v: string) => Promise<{ error: { message: string } | null }>;
      };
      delete: () => {
        eq: (k: string, v: string) => Promise<{ error: { message: string } | null }>;
      };
    };
  };
}

export const createBarber = withAction({
  schema: barberSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const { data, error } = await db()
      .from('barbers')
      .insert({ shop_id: ctx.shopId, ...input })
      .select('id')
      .single();
    if (error || !data) return err('UNEXPECTED');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'insert',
      entity: 'barbers',
      entityId: data.id,
      diff: { after: input },
    });
    revalidatePath(BARBERS_PATH);
    // Confirmed-barber list drives the public booking + embed widget — bust
    // their caches too so admins see staff changes propagate immediately.
    revalidatePublicShopSurfaces();
    return ok({ id: data.id });
  },
});

export const updateBarber = withAction({
  schema: updateBarberSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const { id, ...rest } = input;
    const { error } = await db().from('barbers').update(rest).eq('id', id);
    if (error) return err('UNEXPECTED');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'barbers',
      entityId: id,
      diff: { after: rest },
    });
    revalidatePath(BARBERS_PATH);
    // Confirmed-barber list drives the public booking + embed widget — bust
    // their caches too so admins see staff changes propagate immediately.
    revalidatePublicShopSurfaces();
    return ok({ id });
  },
});

export const deleteBarber = withAction({
  schema: deleteBarberSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    // Soft-delete: flip status to 'deleted' rather than removing the row, so
    // historic appointments keep their FK reference intact.
    const { error } = await db().from('barbers').update({ status: 'deleted' }).eq('id', input.id);
    if (error) return err('UNEXPECTED');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'barbers',
      entityId: input.id,
      diff: { after: { status: 'deleted' } },
    });
    revalidatePath(BARBERS_PATH);
    // Confirmed-barber list drives the public booking + embed widget — bust
    // their caches too so admins see staff changes propagate immediately.
    revalidatePublicShopSurfaces();
    return ok({ id: input.id });
  },
});

export const setBarberStatus = withAction({
  schema: setBarberStatusSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const { error } = await db()
      .from('barbers')
      .update({ status: input.status })
      .eq('id', input.id);
    if (error) return err('UNEXPECTED');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'barbers',
      entityId: input.id,
      diff: { status: input.status },
    });
    revalidatePath(BARBERS_PATH);
    // Confirmed-barber list drives the public booking + embed widget — bust
    // their caches too so admins see staff changes propagate immediately.
    revalidatePublicShopSurfaces();
    return ok({ id: input.id, status: input.status });
  },
});

/**
 * Phase 34 — disconnect a barber's Google Calendar.
 *
 * Two effects:
 *   1. Delete the barber_google_calendar row. Future pushes silently
 *      no-op (resolveConnection returns null).
 *   2. Null out `appointments.google_event_id` for that barber's
 *      appointments. We DON'T attempt to delete the events on Google's
 *      side — the user explicitly wants the connection severed, so
 *      reaching back into their calendar would be presumptuous. If they
 *      reconnect later, we'll create fresh mirrors on the next push.
 *
 * Uses service-role because the barber_google_calendar table has the
 * encrypted-column REVOKE. Manager-only — barbers can ask their manager
 * to disconnect them rather than self-serve from here (no /me page yet).
 */
export const disconnectGoogleCalendar = withAction({
  schema: disconnectGoogleSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseServiceRoleClient() as any;

    // Loop 36 (P96) — orphan cleanup. Before we forget the
    // `google_event_id`s, ask Google to delete the mirrored events
    // so they don't linger on the barber's personal calendar as
    // ghost slots. Best-effort: a Google outage doesn't block the
    // disconnect — we still want the local connection torn down
    // because the user asked for it. Each delete has its own
    // captureException + retry-with-backoff inside
    // `deleteAppointmentMirror`.
    const apptsRes = await admin
      .from('appointments')
      .select('id, google_event_id')
      .eq('barber_id', input.barber_id)
      .not('google_event_id', 'is', null);
    const mirrored = (apptsRes.data as Array<{ id: string; google_event_id: string }> | null) ?? [];
    if (mirrored.length > 0) {
      const { deleteAppointmentMirror } = await import('@/lib/google/sync');
      // Fire in parallel — N events × ~300ms sequential would feel
      // sluggish to the manager. Promise.allSettled so one Google
      // error doesn't abort the rest.
      await Promise.allSettled(
        mirrored.map((m) =>
          deleteAppointmentMirror({
            appointmentId: m.id,
            barberId: input.barber_id,
            googleEventId: m.google_event_id,
          }),
        ),
      );
    }

    // Loop 50 (Phase 97) — stop the webhook channel BEFORE deleting
    // the row. The helper reads `refresh_token_enc` +
    // `webhook_channel_id` etc. off the row to call channels.stop;
    // once the row is gone we can't unsubscribe politely. The
    // helper is best-effort + Sentry-captured, so a Google outage
    // doesn't block the disconnect.
    const { unsubscribeBarberCalendar } = await import('@/lib/google/sync');
    await unsubscribeBarberCalendar(input.barber_id);

    const delRes = await admin
      .from('barber_google_calendar')
      .delete()
      .eq('barber_id', input.barber_id)
      .eq('shop_id', ctx.shopId);
    if (delRes.error) return err('UNEXPECTED');
    await admin
      .from('appointments')
      .update({ google_event_id: null })
      .eq('barber_id', input.barber_id);
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'delete',
      entity: 'barber_google_calendar',
      entityId: input.barber_id,
      diff: { orphan_events_cleaned: mirrored.length },
    });
    revalidatePath(BARBERS_PATH);
    return ok({ ok: true });
  },
});
