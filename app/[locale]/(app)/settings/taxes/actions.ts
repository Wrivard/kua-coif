'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { logAuditAction } from '@/lib/audit-log';
import { TAXES_CACHE_TAG } from '@/lib/data/taxes';
import { deleteTaxSchema, taxSchema, updateTaxSchema } from './schema';

const PATH = '/settings/taxes';

/** Bust both the router cache (this route) and the taxes Data Cache. */
function revalidateTaxes() {
  revalidatePath(PATH);
  revalidateTag(TAXES_CACHE_TAG);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  return createSupabaseServerClient();
}

export const createTax = withAction({
  schema: taxSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const { data, error } = await db()
      .from('taxes')
      .insert({ shop_id: ctx.shopId, ...input })
      .select('id')
      .single();
    // 23505 = duplicate tax name in this shop (taxes_shop_name_unique, added
    // in 20260613130000) → CONFLICT, not a generic UNEXPECTED.
    if (error?.code === '23505') return err('CONFLICT', { name: 'duplicate' });
    if (error || !data) return err('UNEXPECTED');
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'insert',
      entity: 'taxes',
      entityId: data.id,
      diff: { after: input },
    });
    revalidateTaxes();
    return ok({ id: data.id });
  },
});

export const updateTax = withAction({
  schema: updateTaxSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const { id, ...rest } = input;
    // T6 — shop-scoped write + rows-check (Services W2 pattern): RLS spans every
    // shop the user belongs to, so without the explicit scope a multi-shop
    // manager could edit ANOTHER of their shops' taxes by id — and a 0-row write
    // returned a lying ok.
    const { data: rows, error } = await db()
      .from('taxes')
      .update(rest)
      .eq('id', id)
      .eq('shop_id', ctx.shopId)
      .select('id');
    // 23505 = rename collision with another tax in this shop → CONFLICT.
    if (error?.code === '23505') return err('CONFLICT', { name: 'duplicate' });
    if (error) return err('UNEXPECTED');
    if ((rows?.length ?? 0) === 0) return err('NOT_FOUND');
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'taxes',
      entityId: id,
      diff: { after: rest },
    });
    revalidateTaxes();
    return ok({ id });
  },
});

export const deleteTax = withAction({
  schema: deleteTaxSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const { data: rows, error } = await db()
      .from('taxes')
      .delete()
      .eq('id', input.id)
      .eq('shop_id', ctx.shopId)
      .select('id');
    if (error) return err('CONFLICT'); // FK service_taxes/product_taxes restrict
    if ((rows?.length ?? 0) === 0) return err('NOT_FOUND');
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'delete',
      entity: 'taxes',
      entityId: input.id,
    });
    revalidateTaxes();
    return ok({ id: input.id });
  },
});
