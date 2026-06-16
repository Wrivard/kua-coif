'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { logAuditAction } from '@/lib/audit-log';
import { deleteDiscountSchema, discountSchema, updateDiscountSchema } from './schema';

const PATH = '/settings/discounts';
function db(): ReturnType<typeof createSupabaseServerClient> {
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
    // 23505 = duplicate discount name in this shop (discounts_shop_name_unique,
    // added in 20260613130000) → CONFLICT, not a generic UNEXPECTED.
    if (error?.code === '23505') return err('CONFLICT', { name: 'duplicate' });
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
    // T6 — shop-scoped write + rows-check (Services W2 pattern): RLS spans every
    // shop the user belongs to, so without the explicit scope a multi-shop
    // manager could edit ANOTHER of their shops' discounts by id — and a 0-row
    // write returned a lying ok.
    const { data: rows, error } = await db()
      .from('discounts')
      .update(rest)
      .eq('id', id)
      .eq('shop_id', ctx.shopId)
      .select('id');
    // 23505 = rename collision with another discount in this shop → CONFLICT.
    if (error?.code === '23505') return err('CONFLICT', { name: 'duplicate' });
    if (error) return err('UNEXPECTED');
    if ((rows?.length ?? 0) === 0) return err('NOT_FOUND');
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
    const { data: rows, error } = await db()
      .from('discounts')
      .delete()
      .eq('id', input.id)
      .eq('shop_id', ctx.shopId)
      .select('id');
    if (error) return err('UNEXPECTED');
    if ((rows?.length ?? 0) === 0) return err('NOT_FOUND');
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
