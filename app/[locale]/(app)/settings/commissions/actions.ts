'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { logAuditAction } from '@/lib/audit-log';
import { commissionBatchSchema } from './schema';

const PATH = '/settings/commissions';

export const saveCommissions = withAction({
  schema: commissionBatchSchema,
  minRole: 'owner',
  run: async (input, ctx) => {
    // Upsert every row at once. UNIQUE (shop_id, barber_id, scope) makes this
    // a single SQL statement under the hood.
    const sb = createSupabaseServerClient();
    const rows = input.rows.map((r) => ({ shop_id: ctx.shopId, ...r }));
    const { error } = await sb
      .from('commission_tiers')
      .upsert(rows, { onConflict: 'shop_id,barber_id,scope' });
    if (error) return err('UNEXPECTED');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'commission_tiers',
      diff: { rows: input.rows.length },
    });
    revalidatePath(PATH);
    return ok({ count: rows.length });
  },
});
