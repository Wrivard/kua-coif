'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { logDurableAudit } from '@/lib/audit-log';
import { revalidateShopConfig } from '@/lib/server-actions/revalidate';
import { barberSettingsBatchSchema } from './schema';

const PATH = '/settings/barbers';

/**
 * Save the whole barber-settings grid (the shop-default row + N per-barber
 * rows) in ONE transaction via the `save_barber_settings` RPC.
 *
 * Barbers audit B1 — the previous hand-rolled update-then-insert idiom was
 * broken: `.update()` without `{count:'exact'}` returns count=null so the
 * insert always fired (hitting the partial unique index and erroring silently,
 * unchecked), and the N+1 writes were non-atomic → silent data loss + green
 * toast on partial failure. The RPC uses the real partial unique indexes as
 * ON CONFLICT arbiters, is atomic, and validates per-barber tenancy (B11).
 *
 * Service-role because the function is SECURITY DEFINER + granted to
 * service_role only (never browser-callable). withAction already gated this to
 * manager+ in the active shop, and the RPC receives the validated ctx.shopId.
 */
export const saveBarberSettings = withAction({
  schema: barberSettingsBatchSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseServiceRoleClient() as any;
    const { error } = await admin.rpc('save_barber_settings', {
      p_shop: ctx.shopId,
      p_rows: input.rows,
    });
    // A real failure now surfaces (no more swallowed insert errors / partial
    // saves reported as success).
    if (error) return err('UNEXPECTED');

    // Durable audit (B4) — the settings table has no trigger and the previous
    // logAuditAction was RLS-dropped, so barber-settings changes had NO trail.
    // logDurableAudit (service-role) captures the manager's identity, which a
    // table trigger couldn't (the RPC runs under service-role, no auth.uid()).
    await logDurableAudit({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'barber_settings',
      diff: { rows: input.rows.length },
    });
    revalidatePath(PATH);
    // Plan 017 — the slots route caches barber_settings
    // (`barber-settings:${shopId}`); bust it so a changed booking interval /
    // lead-time window takes effect immediately instead of after the 300s TTL.
    revalidateShopConfig(ctx.shopId);
    return ok({ count: input.rows.length });
  },
});
