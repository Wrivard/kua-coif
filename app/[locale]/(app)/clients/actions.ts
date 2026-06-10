'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { logAuditAction, logDurableAudit } from '@/lib/audit-log';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import type { ClientRow } from '@/db/rows';
import { normalizePhoneKey } from '@/lib/utils';
import {
  anonymizeClientSchema,
  clientSchema,
  deleteClientSchema,
  exportClientSchema,
  mergeClientsSchema,
  revokeMeAccessSchema,
  searchClientsListSchema,
  updateClientSchema,
} from './schema';

const CLIENTS_PATH = '/clients';

export const createClient = withAction({
  schema: clientSchema,
  minRole: 'barber',
  run: async (input, ctx) => {
    // Dedup-on-create: surface a CONFLICT instead of silently inserting a
    // duplicate (same normalized phone OR email in this shop, excluding
    // anonymized rows). The merge flow resolves any that still slip through.
    const dupDb = createSupabaseServiceRoleClient();
    const phoneNorm = input.phone ? normalizePhoneKey(input.phone) : '';
    if (phoneNorm.length >= 7) {
      const dup = await dupDb
        .from('clients')
        .select('id')
        .eq('shop_id', ctx.shopId)
        .eq('phone_normalized', phoneNorm)
        .is('anonymized_at', null)
        .limit(1);
      if (((dup.data as Array<{ id: string }> | null) ?? []).length > 0) {
        return err('CONFLICT', { reason: 'duplicate_phone' });
      }
    }
    if (input.email) {
      const dup = await dupDb
        .from('clients')
        .select('id')
        .eq('shop_id', ctx.shopId)
        .eq('email', input.email)
        .is('anonymized_at', null)
        .limit(1);
      if (((dup.data as Array<{ id: string }> | null) ?? []).length > 0) {
        return err('CONFLICT', { reason: 'duplicate_email' });
      }
    }

    const { data, error } = await createSupabaseServerClient()
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

    // Phase H+5 — strict barber scope. A barber can only update a
    // client they've actually served (i.e. there's at least one
    // appointment linking that client to this barber). Managers +
    // owners skip the check.
    if (ctx.role === 'barber') {
      if (!ctx.barberId) return err('FORBIDDEN', { reason: 'no_barber_row' });
      const check = await createSupabaseServerClient()
        .from('appointments')
        .select('id')
        .eq('client_id', id)
        .eq('barber_id', ctx.barberId)
        .limit(1);
      const rows = check.data ?? [];
      if (rows.length === 0) return err('FORBIDDEN', { reason: 'not_your_client' });
    }

    const { error } = await createSupabaseServerClient().from('clients').update(rest).eq('id', id);
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
    const { data, error } = await createSupabaseServerClient()
      .from('clients')
      .delete()
      .eq('id', input.id)
      .select('id');
    if (error) return err('CONFLICT');
    // Distinguish a real delete from a 0-row no-op: a nonexistent or
    // cross-tenant id is RLS-filtered to zero rows with NO error, which
    // would otherwise report a false success to the caller.
    if (!data || data.length === 0) return err('NOT_FOUND');

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
    // Loop 62 SR — Loi 25 Art. 27 right-to-portability requires
    // exporting every personal data point we hold. DOB joined the
    // schema in Loop 62; gap closed here.
    date_of_birth: string | null;
    notes: string | null;
    created_at: string;
    anonymized_at: string | null;
    loyalty_balance_cents: number;
    loyalty_counter: number;
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
  reviews: Array<{
    id: string;
    rating: number;
    comment: string | null;
    status: string;
    created_at: string;
  }>;
  marketing_sends: Array<{ kind: string; channel: string; sent_at: string }>;
  waitlist: Array<{ id: string; status: string; created_at: string }>;
};

export const exportClient = withAction<typeof exportClientSchema, ExportedClient>({
  schema: exportClientSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    // Throttle the PII-bulk path (a full client data export).
    const rl = await checkRateLimit(`client-export:${ctx.userId}`, {
      max: 20,
      windowMs: 60 * 60 * 1000,
    });
    if (!rl.allowed) return err('RATE_LIMITED');
    // Service-role to dodge RLS friction on joins (we already verified
    // the manager belongs to the shop via withAction).
    const admin = createSupabaseServiceRoleClient();

    const clientRes = await admin
      .from('clients')
      .select(
        // Loop 62 SR — `date_of_birth` added to the SELECT so the
        // exported JSON carries it (Loi 25 Art. 27).
        'id, shop_id, first_name, last_name, email, phone, date_of_birth, notes, created_at, anonymized_at, loyalty_balance_cents, loyalty_counter',
      )
      .eq('id', input.id)
      .single();
    const client = clientRes.data as (ExportedClient['client'] & { shop_id: string }) | null;
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

    // Loi 25 portability — the audit flagged that the export omitted loyalty,
    // reviews, marketing-send history and waitlist. Include them all.
    const reviewsRes = await admin
      .from('reviews')
      .select('id, rating, comment, status, created_at')
      .eq('client_id', input.id)
      .order('created_at', { ascending: false });
    const reviews = (reviewsRes.data as ExportedClient['reviews'] | null) ?? [];

    const sendsRes = await admin
      .from('client_marketing_sends')
      .select('kind, channel, sent_at')
      .eq('client_id', input.id)
      .order('sent_at', { ascending: false });
    const marketing_sends = (sendsRes.data as ExportedClient['marketing_sends'] | null) ?? [];

    // Waitlist rows have no client FK — they're matched by contact.
    const waitlistMap = new Map<string, ExportedClient['waitlist'][number]>();
    for (const [col, val] of [
      ['phone', client.phone],
      ['email', client.email],
    ] as const) {
      if (!val) continue;
      const wlRes = await admin
        .from('waiting_list_entries')
        .select('id, status, created_at')
        .eq('shop_id', ctx.shopId)
        .eq(col, val);
      for (const w of (wlRes.data as ExportedClient['waitlist'] | null) ?? []) {
        waitlistMap.set(w.id, w);
      }
    }
    const waitlist = Array.from(waitlistMap.values());

    // Audit log: "custom" action with a `loi25_export` tag — the union type
    // doesn't include 'export' as a first-class verb. The diff carries the
    // semantic.
    await logDurableAudit({
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
      reviews,
      marketing_sends,
      waitlist,
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
    // Throttle the irreversible PII-wipe path.
    const rl = await checkRateLimit(`client-anonymize:${ctx.userId}`, {
      max: 10,
      windowMs: 60 * 60 * 1000,
    });
    if (!rl.allowed) return err('RATE_LIMITED');
    const admin = createSupabaseServiceRoleClient();

    const clientRes = await admin
      .from('clients')
      .select('id, shop_id, anonymized_at, phone, email, quickbooks_customer_id')
      .eq('id', input.id)
      .single();
    const client = clientRes.data as {
      id: string;
      shop_id: string;
      anonymized_at: string | null;
      phone: string | null;
      email: string | null;
      quickbooks_customer_id: string | null;
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
        // Loop 62 SR — DOB is PII under Loi 25. Anonymization must
        // wipe it alongside name/email/phone. The cron's
        // `anonymized_at IS NULL` guard already stops birthday
        // messages, but the column would still leak the date if
        // anyone queried it after anonymization. Null it out.
        date_of_birth: null,
        notes: ANON_NOTES,
        anonymized_at: new Date().toISOString(),
      })
      .eq('id', input.id);
    if (error) return err('UNEXPECTED');

    // Loi 25 completeness — scrub the PII the clients-row wipe leaves behind in
    // linked records (the audit flagged these as un-erased). Best-effort:
    // failures here don't unwind the primary anonymization above.
    const oldPhone = client.phone;
    const oldEmail = client.email;
    // Denormalized client name on every past appointment.
    await admin
      .from('appointments')
      .update({ client_name_snapshot: ANON_FIRST_NAME })
      .eq('client_id', input.id);
    // Reviewer name on any review they left (comment text is the review
    // content, kept; the name is the identifier, wiped).
    await admin.from('reviews').update({ client_name: null }).eq('client_id', input.id);
    // Transient waitlist wishes (matched by contact, no client FK) — delete.
    if (oldPhone) {
      await admin
        .from('waiting_list_entries')
        .delete()
        .eq('shop_id', ctx.shopId)
        .eq('phone', oldPhone);
    }
    if (oldEmail) {
      await admin
        .from('waiting_list_entries')
        .delete()
        .eq('shop_id', ctx.shopId)
        .eq('email', oldEmail);
    }

    await logDurableAudit({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'clients',
      entityId: input.id,
      // `qb_customer_pending` records that an external QuickBooks customer
      // copy still holds PII — its erasure needs an authenticated QBO API call
      // (separate follow-up); flagged here so compliance can act on it.
      diff: { loi25_anonymized: true, qb_customer_pending: Boolean(client.quickbooks_customer_id) },
    });
    revalidatePath(CLIENTS_PATH);
    return ok({ id: input.id });
  },
});

// ---------------------------------------------------------------------------
// mergeClients (Clients audit W4) — fold a duplicate into the kept client.
//
// Delegates to the merge_clients(p_keep, p_merge, p_shop) Postgres function,
// which re-points appointments / reviews / marketing-sends, combines loyalty,
// backfills missing contact fields, and deletes the merged row — all in one
// transaction. Manager+ only; the function also re-verifies both clients
// belong to ctx.shopId, so a crafted id can't merge across shops.
// ---------------------------------------------------------------------------
export const mergeClients = withAction({
  schema: mergeClientsSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    if (input.keep_id === input.merge_id) return err('INVALID_INPUT');
    const rl = await checkRateLimit(`client-merge:${ctx.userId}`, {
      max: 30,
      windowMs: 60 * 60 * 1000,
    });
    if (!rl.allowed) return err('RATE_LIMITED');
    const admin = createSupabaseServiceRoleClient();
    const { error } = await admin.rpc('merge_clients', {
      p_keep: input.keep_id,
      p_merge: input.merge_id,
      p_shop: ctx.shopId,
    });
    if (error) return err('UNEXPECTED');

    await logDurableAudit({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'clients',
      entityId: input.keep_id,
      diff: { merged_from: input.merge_id },
    });
    revalidatePath(CLIENTS_PATH);
    return ok({ id: input.keep_id });
  },
});

// ---------------------------------------------------------------------------
// revokeMeAccess (Clients audit W5c) — invalidate a client's /me links.
//
// Bumps the client's me_token_version; every outstanding /me self-service
// token embeds the version it was minted with, so the bump makes them all
// fail to verify. A fresh link (next booking / generatePublicLinks) carries
// the new version and works again.
// ---------------------------------------------------------------------------
export const revokeMeAccess = withAction({
  schema: revokeMeAccessSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const admin = createSupabaseServiceRoleClient();
    const cur = await admin
      .from('clients')
      .select('me_token_version, shop_id')
      .eq('id', input.id)
      .single();
    const row = cur.data as { me_token_version: number | null; shop_id: string } | null;
    if (!row) return err('NOT_FOUND');
    if (row.shop_id !== ctx.shopId) return err('NOT_FOUND');

    const { error } = await admin
      .from('clients')
      .update({ me_token_version: (row.me_token_version ?? 0) + 1 })
      .eq('id', input.id);
    if (error) return err('UNEXPECTED');

    await logDurableAudit({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'clients',
      entityId: input.id,
      diff: { me_token_revoked: true },
    });
    revalidatePath(CLIENTS_PATH);
    return ok({ id: input.id });
  },
});

// ---------------------------------------------------------------------------
// searchClientsList (Clients audit W2) — find any client past the page cap.
//
// The clients page loads up to CLIENT_FETCH_CAP rows and filters them in the
// browser. For a shop whose roster exceeds the cap, a client past it would be
// invisible to A–Z browsing; this lets a manager find them by name / email /
// phone across the WHOLE active shop. Manager+ ONLY — barbers keep the
// served-clients scope of the page, and a server search would bypass it (the
// exact CSV-route leak the audit flagged). Returns the full ClientRow shape so
// results drop straight into the existing table / edit modal / row actions.
// ---------------------------------------------------------------------------
export const searchClientsList = withAction<typeof searchClientsListSchema, ClientRow[]>({
  schema: searchClientsListSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    // Throttle: an un-indexable 4-column ILIKE scan returning client PII,
    // fired per debounced keystroke — cap per user to block sustained
    // enumeration while staying generous for real typing (~1/s sustained).
    const rl = await checkRateLimit(`clients-list-search:${ctx.userId}`, {
      max: 60,
      windowMs: 60 * 1000,
    });
    if (!rl.allowed) return err('RATE_LIMITED');

    // Strip characters that would break the PostgREST or() grammar (commas /
    // parens / backslash) or act as LIKE wildcards. The shop scope is ANDed
    // before the .or regardless, so this only guards malformed queries —
    // never a cross-tenant leak.
    const safe = input.query.replace(/[%,()\\*]/g, ' ').trim();
    if (safe.length < 2) return ok([]);
    const pattern = `%${safe}%`;

    // User-session client → RLS stays active (defense in depth) on top of the
    // explicit shop scope, same as the page's own load.
    const sb = createSupabaseServerClient();
    const res = await sb
      .from('clients')
      .select('id, first_name, last_name, email, phone, date_of_birth, notes')
      .eq('shop_id', ctx.shopId)
      .or(
        `first_name.ilike.${pattern},last_name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern}`,
      )
      .order('first_name', { ascending: true })
      .limit(50);
    if (res.error) return err('UNEXPECTED');
    return ok((res.data as ClientRow[] | null) ?? []);
  },
});
