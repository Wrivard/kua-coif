'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { logAuditAction } from '@/lib/audit-log';
import { deleteDiscountSchema, discountSchema, updateDiscountSchema } from './schema';

const PATH = '/settings/discounts';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  return createSupabaseServerClient();
}

export const createDiscount = withAction({
  schema: discountSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const { data, error } = await db()
      .from('discounts')
      .insert({ shop_id: ctx.shopId, ...input })
      .select('id')
      .single();
    if (error || !data) return err('UNEXPECTED');
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'insert',
      entity: 'discounts',
      entityId: data.id,
      diff: { after: input },
    });
    revalidatePath(PATH);
    return ok({ id: data.id });
  },
});

export const updateDiscount = withAction({
  schema: updateDiscountSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const { id, ...rest } = input;
    const { error } = await db().from('discounts').update(rest).eq('id', id);
    if (error) return err('UNEXPECTED');
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'discounts',
      entityId: id,
      diff: { after: rest },
    });
    revalidatePath(PATH);
    return ok({ id });
  },
});

export const deleteDiscount = withAction({
  schema: deleteDiscountSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const { error } = await db().from('discounts').delete().eq('id', input.id);
    if (error) return err('UNEXPECTED');
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'delete',
      entity: 'discounts',
      entityId: input.id,
    });
    revalidatePath(PATH);
    return ok({ id: input.id });
  },
});
