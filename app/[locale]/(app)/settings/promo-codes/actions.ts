'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { logAuditAction } from '@/lib/audit-log';
import { deletePromoCodeSchema, promoCodeSchema, updatePromoCodeSchema } from './schema';

const PATH = '/settings/promo-codes';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  return createSupabaseServerClient();
}

export const createPromoCode = withAction({
  schema: promoCodeSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const { data, error } = await db()
      .from('promo_codes')
      .insert({
        shop_id: ctx.shopId,
        code: input.code.toUpperCase(),
        type: input.type,
        value: input.value,
        first_appointment_only: input.first_appointment_only,
        one_time: input.one_time,
        expiration_date: input.expiration_date,
      })
      .select('id')
      .single();
    if (error || !data) return err('UNEXPECTED');
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'insert',
      entity: 'promo_codes',
      entityId: data.id,
      diff: { after: input },
    });
    revalidatePath(PATH);
    return ok({ id: data.id });
  },
});

export const updatePromoCode = withAction({
  schema: updatePromoCodeSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const { id, code, ...rest } = input;
    const { error } = await db()
      .from('promo_codes')
      .update({ code: code.toUpperCase(), ...rest })
      .eq('id', id);
    if (error) return err('UNEXPECTED');
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'promo_codes',
      entityId: id,
      diff: { after: rest },
    });
    revalidatePath(PATH);
    return ok({ id });
  },
});

export const deletePromoCode = withAction({
  schema: deletePromoCodeSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const { error } = await db().from('promo_codes').delete().eq('id', input.id);
    if (error) return err('UNEXPECTED');
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'delete',
      entity: 'promo_codes',
      entityId: input.id,
    });
    revalidatePath(PATH);
    return ok({ id: input.id });
  },
});
