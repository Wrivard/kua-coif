'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { logAuditAction } from '@/lib/audit-log';
import { deleteTaxSchema, taxSchema, updateTaxSchema } from './schema';

const PATH = '/settings/taxes';

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
    if (error || !data) return err('UNEXPECTED');
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'insert',
      entity: 'taxes',
      entityId: data.id,
      diff: { after: input },
    });
    revalidatePath(PATH);
    return ok({ id: data.id });
  },
});

export const updateTax = withAction({
  schema: updateTaxSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const { id, ...rest } = input;
    const { error } = await db().from('taxes').update(rest).eq('id', id);
    if (error) return err('UNEXPECTED');
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'taxes',
      entityId: id,
      diff: { after: rest },
    });
    revalidatePath(PATH);
    return ok({ id });
  },
});

export const deleteTax = withAction({
  schema: deleteTaxSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const { error } = await db().from('taxes').delete().eq('id', input.id);
    if (error) return err('CONFLICT'); // FK service_taxes/product_taxes restrict
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'delete',
      entity: 'taxes',
      entityId: input.id,
    });
    revalidatePath(PATH);
    return ok({ id: input.id });
  },
});
