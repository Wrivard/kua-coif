'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { logAuditAction } from '@/lib/audit-log';
import { clientSchema, deleteClientSchema, updateClientSchema } from './schema';

const CLIENTS_PATH = '/clients';

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

export const createClient = withAction({
  schema: clientSchema,
  minRole: 'barber',
  run: async (input, ctx) => {
    const { data, error } = await db()
      .from('clients')
      .insert({ shop_id: ctx.shopId, ...input })
      .select('id')
      .single();
    if (error || !data) return err('UNEXPECTED');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'insert',
      entity: 'clients',
      entityId: data.id,
      diff: { after: input },
    });
    revalidatePath(CLIENTS_PATH);
    return ok({ id: data.id });
  },
});

export const updateClient = withAction({
  schema: updateClientSchema,
  minRole: 'barber',
  run: async (input, ctx) => {
    const { id, ...rest } = input;
    const { error } = await db().from('clients').update(rest).eq('id', id);
    if (error) return err('UNEXPECTED');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'clients',
      entityId: id,
      diff: { after: rest },
    });
    revalidatePath(CLIENTS_PATH);
    return ok({ id });
  },
});

export const deleteClient = withAction({
  schema: deleteClientSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    // Hard delete OK here: appointments reference clients via FK ON DELETE
    // RESTRICT — Postgres will refuse if any appointment is attached. The
    // user will get UNEXPECTED in that case, with audit log showing the
    // attempt. Phase 5 will add a clearer "client has appointments" error.
    const { error } = await db().from('clients').delete().eq('id', input.id);
    if (error) return err('CONFLICT');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'delete',
      entity: 'clients',
      entityId: input.id,
    });
    revalidatePath(CLIENTS_PATH);
    return ok({ id: input.id });
  },
});
