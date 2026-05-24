'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { logAuditAction } from '@/lib/audit-log';
import {
  barberSchema,
  deleteBarberSchema,
  setBarberStatusSchema,
  updateBarberSchema,
} from './schema';

const BARBERS_PATH = '/barbers';

// Same shaping trick as services/actions.ts — narrow the supabase client to a
// minimal structural type until db/types.ts codegen lands.
function db() {
  return createSupabaseServerClient() as unknown as {
    from: (table: string) => {
      insert: (row: Record<string, unknown>) => {
        select: (cols: string) => {
          single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }>;
        };
      };
      update: (row: Record<string, unknown>) => {
        eq: (k: string, v: string) => Promise<{ error: { message: string } | null }>;
      };
      delete: () => {
        eq: (k: string, v: string) => Promise<{ error: { message: string } | null }>;
      };
    };
  };
}

export const createBarber = withAction({
  schema: barberSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const { data, error } = await db()
      .from('barbers')
      .insert({ shop_id: ctx.shopId, ...input })
      .select('id')
      .single();
    if (error || !data) return err('UNEXPECTED');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'insert',
      entity: 'barbers',
      entityId: data.id,
      diff: { after: input },
    });
    revalidatePath(BARBERS_PATH);
    return ok({ id: data.id });
  },
});

export const updateBarber = withAction({
  schema: updateBarberSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const { id, ...rest } = input;
    const { error } = await db().from('barbers').update(rest).eq('id', id);
    if (error) return err('UNEXPECTED');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'barbers',
      entityId: id,
      diff: { after: rest },
    });
    revalidatePath(BARBERS_PATH);
    return ok({ id });
  },
});

export const deleteBarber = withAction({
  schema: deleteBarberSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    // Soft-delete: flip status to 'deleted' rather than removing the row, so
    // historic appointments keep their FK reference intact.
    const { error } = await db().from('barbers').update({ status: 'deleted' }).eq('id', input.id);
    if (error) return err('UNEXPECTED');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'barbers',
      entityId: input.id,
      diff: { after: { status: 'deleted' } },
    });
    revalidatePath(BARBERS_PATH);
    return ok({ id: input.id });
  },
});

export const setBarberStatus = withAction({
  schema: setBarberStatusSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const { error } = await db()
      .from('barbers')
      .update({ status: input.status })
      .eq('id', input.id);
    if (error) return err('UNEXPECTED');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'barbers',
      entityId: input.id,
      diff: { status: input.status },
    });
    revalidatePath(BARBERS_PATH);
    return ok({ id: input.id, status: input.status });
  },
});
