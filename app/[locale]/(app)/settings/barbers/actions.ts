'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withAction } from '@/lib/server-actions/with-action';
import { ok } from '@/lib/server-actions/result';
import { logAuditAction } from '@/lib/audit-log';
import { barberSettingsBatchSchema } from './schema';

const PATH = '/settings/barbers';

/**
 * Save the whole barber-settings grid in one shot. Each row upserts on
 * either (shop_id, scope='shop') or (shop_id, barber_id, scope='barber')
 * — the partial unique indexes from Phase 2 enforce uniqueness.
 *
 * The DB has TWO unique indexes (one for the shop row, one per-barber),
 * so a single onConflict isn't enough. We split the rows by scope.
 */
export const saveBarberSettings = withAction({
  schema: barberSettingsBatchSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createSupabaseServerClient() as any;

    const shopRow = input.rows.find((r) => r.scope === 'shop');
    const barberRows = input.rows.filter((r) => r.scope === 'barber');

    // Shop default row — there's a UNIQUE partial index `barber_settings_shop_unique`.
    if (shopRow) {
      // Try update first; if no row, insert.
      const upd = await sb
        .from('barber_settings')
        .update({ ...shopRow, shop_id: ctx.shopId })
        .eq('shop_id', ctx.shopId)
        .eq('scope', 'shop');
      if (upd.error || (upd.count ?? 0) === 0) {
        await sb.from('barber_settings').insert({ shop_id: ctx.shopId, ...shopRow });
      }
    }

    // Per-barber rows — UNIQUE partial index on (barber_id) where scope='barber'.
    for (const r of barberRows) {
      const upd = await sb
        .from('barber_settings')
        .update({ ...r, shop_id: ctx.shopId })
        .eq('shop_id', ctx.shopId)
        .eq('scope', 'barber')
        .eq('barber_id', r.barber_id);
      if (upd.error || (upd.count ?? 0) === 0) {
        await sb.from('barber_settings').insert({ shop_id: ctx.shopId, ...r });
      }
    }

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'barber_settings',
      diff: { rows: input.rows.length },
    });
    revalidatePath(PATH);
    return ok({ count: input.rows.length });
  },
});
