'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { logAuditAction } from '@/lib/audit-log';
import { shopDetailsSchema, shopHoursSchema } from './schema';

const PATH = '/settings/shop';

export const updateShopDetails = withAction({
  schema: shopDetailsSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createSupabaseServerClient() as any;
    const { error } = await sb.from('shops').update(input).eq('id', ctx.shopId);
    if (error) return err('UNEXPECTED');
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'shops',
      entityId: ctx.shopId,
      diff: { after: input },
    });
    revalidatePath(PATH);
    return ok({ ok: true });
  },
});

export const updateShopHours = withAction({
  schema: shopHoursSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createSupabaseServerClient() as any;
    // Upsert each weekday row. shop_hours has UNIQUE (shop_id, weekday).
    const rows = input.map((h) => ({ shop_id: ctx.shopId, ...h }));
    const { error } = await sb.from('shop_hours').upsert(rows, { onConflict: 'shop_id,weekday' });
    if (error) return err('UNEXPECTED');
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'shop_hours',
      diff: { after: input },
    });
    revalidatePath(PATH);
    return ok({ ok: true });
  },
});
