'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { logAuditAction } from '@/lib/audit-log';
import {
  anonymizeClientSchema,
  clientSchema,
  deleteClientSchema,
  exportClientSchema,
  updateClientSchema,
} from './schema';

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
    // attempt. For clients WITH appointments, use anonymizeClient instead
    // (Loi 25 anonymization preserves fiscal trail).
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

// ---------------------------------------------------------------------------
// Phase 40 — Loi 25 (Quebec privacy law) compliance.
//
// Two operations clients can request via their shop (V1 — admin-mediated;
// self-service /me page is V1.5):
//   - `exportClient`     — returns a full JSON snapshot of every data
//                          point the platform holds about them.
//   - `anonymizeClient`  — replaces PII fields with placeholders and
//                          stamps `anonymized_at`. The row stays for
//                          fiscal retention (6 years, Revenu Québec).
//                          Appointment history is preserved but
//                          de-identified.
// ---------------------------------------------------------------------------

type ExportedClient = {
  exported_at: string;
  client: {
    id: string;
    first_name: string;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    notes: string | null;
    created_at: string;
    anonymized_at: string | null;
  };
  appointments: Array<{
    id: string;
    start_at: string;
    end_at: string;
    status: string;
    total_amount: number;
    payment_status: string;
    payment_intent_id: string | null;
    barber_display_name: string | null;
    services: Array<{ name: string; price_snapshot: number }>;
  }>;
};

export const exportClient = withAction<typeof exportClientSchema, ExportedClient>({
  schema: exportClientSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    // Service-role to dodge RLS friction on joins (we already verified
    // the manager belongs to the shop via withAction).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseServiceRoleClient() as any;

    const clientRes = await admin
      .from('clients')
      .select('id, shop_id, first_name, last_name, email, phone, notes, created_at, anonymized_at')
      .eq('id', input.id)
      .single();
    const client = clientRes.data as
      | (ExportedClient['client'] & { shop_id: string })
      | null;
    if (!client) return err('NOT_FOUND');
    if (client.shop_id !== ctx.shopId) return err('NOT_FOUND');

    const apptRes = await admin
      .from('appointments')
      .select(
        'id, start_at, end_at, status, total_amount, payment_status, payment_intent_id, barber:barbers(display_name), services:appointment_services(price_snapshot, service:services(name))',
      )
      .eq('client_id', input.id)
      .eq('shop_id', ctx.shopId)
      .order('start_at', { ascending: false });

    type ApptJoin = {
      id: string;
      start_at: string;
      end_at: string;
      status: string;
      total_amount: number;
      payment_status: string;
      payment_intent_id: string | null;
      barber: { display_name: string } | null;
      services: Array<{ price_snapshot: number; service: { name: string } | null }> | null;
    };
    const appointments = ((apptRes.data as ApptJoin[] | null) ?? []).map((a) => ({
      id: a.id,
      start_at: a.start_at,
      end_at: a.end_at,
      status: a.status,
      total_amount: a.total_amount,
      payment_status: a.payment_status,
      payment_intent_id: a.payment_intent_id,
      barber_display_name: a.barber?.display_name ?? null,
      services: (a.services ?? [])
        .filter((s) => s.service)
        .map((s) => ({ name: s.service!.name, price_snapshot: s.price_snapshot })),
    }));

    // Audit log: "custom" action with a `loi25_export` tag — the union type
    // doesn't include 'export' as a first-class verb. The diff carries the
    // semantic.
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'custom',
      entity: 'clients',
      entityId: input.id,
      diff: { loi25_export: true, appointments_count: appointments.length },
    });

    const { shop_id: _, ...clientWithoutShop } = client;
    return ok({
      exported_at: new Date().toISOString(),
      client: clientWithoutShop,
      appointments,
    });
  },
});

/** Placeholder values the anonymization swap writes in place of PII. */
const ANON_FIRST_NAME = '[Anonymized]';
const ANON_PHONE = null;
const ANON_EMAIL = null;
const ANON_NOTES = null;

export const anonymizeClient = withAction({
  schema: anonymizeClientSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseServiceRoleClient() as any;

    const clientRes = await admin
      .from('clients')
      .select('id, shop_id, anonymized_at')
      .eq('id', input.id)
      .single();
    const client = clientRes.data as {
      id: string;
      shop_id: string;
      anonymized_at: string | null;
    } | null;
    if (!client) return err('NOT_FOUND');
    if (client.shop_id !== ctx.shopId) return err('NOT_FOUND');
    if (client.anonymized_at) {
      // Already anonymized — return ok so the UI doesn't dead-end.
      return ok({ id: input.id });
    }

    const { error } = await admin
      .from('clients')
      .update({
        first_name: ANON_FIRST_NAME,
        last_name: null,
        email: ANON_EMAIL,
        phone: ANON_PHONE,
        notes: ANON_NOTES,
        anonymized_at: new Date().toISOString(),
      })
      .eq('id', input.id);
    if (error) return err('UNEXPECTED');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'clients',
      entityId: input.id,
      diff: { loi25_anonymized: true },
    });
    revalidatePath(CLIENTS_PATH);
    return ok({ id: input.id });
  },
});
