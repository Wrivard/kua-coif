'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import {
  revalidatePublicShopSurfaces,
  revalidateShopConfig,
} from '@/lib/server-actions/revalidate';
import { logAuditAction, logDurableAudit } from '@/lib/audit-log';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { captureException } from '@/lib/observability';
import {
  barberSchema,
  deleteBarberSchema,
  disconnectGoogleSchema,
  setBarberStatusSchema,
  updateBarberSchema,
} from './schema';

const BARBERS_PATH = '/barbers';

export const createBarber = withAction({
  schema: barberSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const { data, error } = await createSupabaseServerClient()
      .from('barbers')
      .insert({ shop_id: ctx.shopId, ...input })
      .select('id')
      .single();
    if (error || !data) {
      // B15 — the partial unique indexes reject a duplicate email/personnel_id
      // in the shop; surface a clear CONFLICT instead of a generic error.
      if (error?.code === '23505') return err('CONFLICT');
      return err('UNEXPECTED');
    }

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
    // No-arg (global page purge): the alias isn't loaded on this path.
    revalidatePublicShopSurfaces();
    // Plan 017 — the slots route caches the confirmed+bookable list
    // (`bookable-barbers:${shopId}`); bust it so a new/edited barber appears.
    revalidateShopConfig(ctx.shopId);
    return ok({ id: data.id });
  },
});

export const updateBarber = withAction({
  schema: updateBarberSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const { id, ...rest } = input;
    const { data, error } = await createSupabaseServerClient()
      .from('barbers')
      .update(rest)
      .eq('id', id)
      .select('id');
    if (error) {
      // B15 — duplicate email/personnel_id (e.g. editing into a colleague's).
      if (error.code === '23505') return err('CONFLICT');
      return err('UNEXPECTED');
    }
    // Distinguish a real update from a 0-row no-op: a nonexistent or
    // cross-tenant id is RLS-filtered to zero rows with no error, which
    // would otherwise report a false success.
    if (!data || data.length === 0) return err('NOT_FOUND');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'barbers',
      entityId: id,
      diff: { after: rest },
    });
    revalidatePath(BARBERS_PATH);
    revalidatePublicShopSurfaces();
    // Plan 017 — bust the cached bookable-barbers list (name/bookable edits).
    revalidateShopConfig(ctx.shopId);
    return ok({ id });
  },
});

export const deleteBarber = withAction({
  schema: deleteBarberSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    // Soft-delete: flip status to 'deleted' rather than removing the row, so
    // historic appointments keep their FK reference intact.
    const { data, error } = await createSupabaseServerClient()
      .from('barbers')
      .update({ status: 'deleted' })
      .eq('id', input.id)
      .select('id');
    if (error) return err('UNEXPECTED');
    if (!data || data.length === 0) return err('NOT_FOUND');

    // B16 + BR-2 — a soft-deleted barber kept a LIVE Google webhook channel
    // (Google POSTs to our webhook for ~30 days) + the connection row, so sync
    // kept running for an archived barber. Tear the connection down best-effort,
    // in this ORDER: FIRST clean the barber's FUTURE mirrored events (while the
    // connection row + token still exist — `deleteAppointmentMirror` needs them;
    // deleting the row first would orphan those events on the barber's personal
    // calendar forever), THEN stop the webhook channel + remove the row.
    // Best-effort by design — a Google/network failure must NOT block the
    // archive (the status flip is what matters).
    try {
      const admin = createSupabaseServiceRoleClient();
      // BR-2 — clean FUTURE ghost slots before severing. Bounded to future +
      // capped concurrency (mirrors disconnectGoogleCalendar) so a long history
      // can't blow the (uncapped, ~10s) server-action timeout.
      const apptsRes = await admin
        .from('appointments')
        .select('id, google_event_id')
        .eq('barber_id', input.id)
        .eq('shop_id', ctx.shopId)
        .not('google_event_id', 'is', null)
        .gte('start_at', new Date().toISOString());
      const mirrored =
        (apptsRes.data as Array<{ id: string; google_event_id: string }> | null) ?? [];
      if (mirrored.length > 0) {
        const { deleteAppointmentMirror } = await import('@/lib/google/sync');
        const CONCURRENCY = 8;
        for (let i = 0; i < mirrored.length; i += CONCURRENCY) {
          const batch = mirrored.slice(i, i + CONCURRENCY);
          await Promise.allSettled(
            batch.map((m) =>
              deleteAppointmentMirror({
                appointmentId: m.id,
                barberId: input.id,
                googleEventId: m.google_event_id,
              }),
            ),
          );
        }
      }
      // Now sever: stop the webhook channel (the helper reads the row) THEN
      // delete the connection row.
      const { unsubscribeBarberCalendar } = await import('@/lib/google/sync');
      await unsubscribeBarberCalendar(input.id);
      await admin
        .from('barber_google_calendar')
        .delete()
        .eq('barber_id', input.id)
        .eq('shop_id', ctx.shopId);
    } catch (e) {
      captureException(e, { tags: { layer: 'barbers', step: 'soft-delete-google-teardown' } });
    }

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'barbers',
      entityId: input.id,
      diff: { after: { status: 'deleted' } },
    });
    revalidatePath(BARBERS_PATH);
    revalidatePublicShopSurfaces();
    // Plan 017 — soft-delete removes the barber from the cached bookable list.
    revalidateShopConfig(ctx.shopId);
    return ok({ id: input.id });
  },
});

export const setBarberStatus = withAction({
  schema: setBarberStatusSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const { data, error } = await createSupabaseServerClient()
      .from('barbers')
      .update({ status: input.status })
      .eq('id', input.id)
      .select('id');
    if (error) return err('UNEXPECTED');
    if (!data || data.length === 0) return err('NOT_FOUND');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'barbers',
      entityId: input.id,
      diff: { status: input.status },
    });
    revalidatePath(BARBERS_PATH);
    revalidatePublicShopSurfaces();
    // Plan 017 — status flips (confirmed↔staff/deleted) change bookability.
    revalidateShopConfig(ctx.shopId);
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
    const admin = createSupabaseServiceRoleClient();

    // SECURITY (Barbers audit B2) — bind barber_id to the caller's ACTIVE
    // shop BEFORE any privileged work. The service-role reads/writes below
    // (and the lib/google/sync helpers) key off barber_id ALONE; without this
    // gate a manager of shop A could pass a barber_id from shop B and delete
    // B's barber's real Google Calendar events + wipe B's mirror linkage.
    const ownerRes = await admin
      .from('barbers')
      .select('shop_id')
      .eq('id', input.barber_id)
      .maybeSingle();
    const owner = ownerRes.data;
    if (!owner || owner.shop_id !== ctx.shopId) return err('NOT_FOUND');

    // Loop 36 (P96) — orphan cleanup. Ask Google to delete the mirrored events
    // so they don't linger on the barber's personal calendar as ghost slots.
    // Best-effort: a Google outage doesn't block the disconnect.
    //
    // Perf/reliability (Barbers audit B2b) — BOUND + CAP the fan-out:
    //  - BOUND to FUTURE events only. Those are the upcoming "ghost slots" that
    //    actually matter; cleaning a barber's entire multi-year history would
    //    blow the (uncapped, 10s default) server-action timeout and amplify a
    //    Google rate-limit, leaving a half-torn state with no record.
    //  - CAP concurrency in batches so a backlog can't fire hundreds of
    //    parallel deletes (each with its own retry + backoff) at once.
    const apptsRes = await admin
      .from('appointments')
      .select('id, google_event_id')
      .eq('barber_id', input.barber_id)
      .eq('shop_id', ctx.shopId)
      .not('google_event_id', 'is', null)
      .gte('start_at', new Date().toISOString());
    const mirrored = (apptsRes.data as Array<{ id: string; google_event_id: string }> | null) ?? [];
    let cleaned = 0;
    let cleanupFailed = 0;
    if (mirrored.length > 0) {
      const { deleteAppointmentMirror } = await import('@/lib/google/sync');
      const CONCURRENCY = 8;
      for (let i = 0; i < mirrored.length; i += CONCURRENCY) {
        const batch = mirrored.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map((m) =>
            deleteAppointmentMirror({
              appointmentId: m.id,
              barberId: input.barber_id,
              googleEventId: m.google_event_id,
            }),
          ),
        );
        for (const r of results) {
          if (r.status === 'fulfilled') cleaned += 1;
          else cleanupFailed += 1;
        }
      }
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
      .eq('barber_id', input.barber_id)
      // Scope the mirror-id wipe to the active shop — defense in depth on the
      // service-role client even though barber_id is globally unique.
      .eq('shop_id', ctx.shopId);
    // BR-1 — use logDurableAudit (service-role, durable + attributed). This
    // destructive action (severs a Google connection + deletes real future
    // events) mutates `barber_google_calendar`, which has NO audit trigger, and
    // the previous logAuditAction was a runtime no-op (user-session insert
    // dropped by audit_log RLS) — so the action left no trail at all.
    await logDurableAudit({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'delete',
      entity: 'barber_google_calendar',
      entityId: input.barber_id,
      // Record the REAL outcome (attempted = cleaned + failed), not just the
      // count attempted — so an operator can tell from the trail whether a
      // barber's future Google events were actually removed.
      diff: {
        orphan_events_cleaned: cleaned,
        orphan_events_failed: cleanupFailed,
        scope: 'future',
      },
    });
    revalidatePath(BARBERS_PATH);
    return ok({ ok: true });
  },
});
