'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import { err, ok, type Result } from '@/lib/server-actions/result';
import { captureException } from '@/lib/observability';
import { logAuditAction } from '@/lib/audit-log';
import { verifyToken } from '@/lib/security/signed-tokens';
import { effectiveLoyaltyBalanceCents } from '@/lib/business/loyalty';

/**
 * Phase 68 — Self-service Loi 25 export.
 *
 * Mirrors the admin-side `exportClientData` action but token-gated
 * (no user session). Returns the same JSON shape so the customer can
 * archive it or feed it to another platform if they want.
 *
 * Rate limit: 10 / hour / IP — exports are expensive (full appointment
 * scan) and one customer rarely needs more than that.
 */

const schema = z.object({
  token: z.string().trim().min(10).max(4096),
});

export type ExportMyDataInput = z.infer<typeof schema>;

function clientIp(): string {
  const h = headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? 'unknown';
}

export type SelfExport = {
  exported_at: string;
  client: {
    id: string;
    first_name: string;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    created_at: string;
    loyalty_balance_cents: number;
  };
  appointments: Array<{
    id: string;
    start_at: string;
    end_at: string;
    status: string;
    total_amount: number;
    payment_status: string;
    barber_display_name: string | null;
    services: Array<{ name: string; price_snapshot: number }>;
  }>;
};

export async function exportMyData(raw: ExportMyDataInput): Promise<Result<SelfExport>> {
  try {
    const ip = clientIp();
    const rl = await checkRateLimit(`me-export:${ip}`, { max: 10, windowMs: 60 * 60 * 1000 });
    if (!rl.allowed) return err('RATE_LIMITED');

    const parsed = schema.safeParse(raw);
    if (!parsed.success) return err('INVALID_INPUT');

    const payload = verifyToken(parsed.data.token, 'me');
    if (!payload) return err('INVALID_INPUT');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createSupabaseServiceRoleClient() as any;

    const clientRes = await supabase
      .from('clients')
      // Loop 35 self-review — include `loyalty_balance_expires_at` so
      // the /me self-export shows the effective (post-expiry) balance
      // rather than the raw column value. A customer seeing "$10"
      // here that's actually expired would be confused on their next
      // booking attempt.
      .select(
        'id, shop_id, first_name, last_name, email, phone, created_at, loyalty_balance_cents, loyalty_balance_expires_at, anonymized_at',
      )
      .eq('id', payload.resourceId)
      .limit(1);
    const client = ((clientRes.data as Array<{
      id: string;
      shop_id: string;
      first_name: string;
      last_name: string | null;
      email: string | null;
      phone: string | null;
      created_at: string;
      loyalty_balance_cents: number | null;
      loyalty_balance_expires_at: string | null;
      anonymized_at: string | null;
    }> | null) ?? [])[0];
    if (!client || client.anonymized_at) return err('NOT_FOUND');

    const effectiveBalanceCents = await effectiveLoyaltyBalanceCents({
      clientId: client.id,
      balanceCents: client.loyalty_balance_cents ?? 0,
      expiresAt: client.loyalty_balance_expires_at,
    });

    const apptRes = await supabase
      .from('appointments')
      .select(
        'id, start_at, end_at, status, total_amount, payment_status, barber:barbers(display_name), services:appointment_services(price_snapshot, service:services(name))',
      )
      .eq('client_id', client.id)
      .order('start_at', { ascending: false });

    type ApptJoin = {
      id: string;
      start_at: string;
      end_at: string;
      status: string;
      total_amount: number;
      payment_status: string;
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
      barber_display_name: a.barber?.display_name ?? null,
      services: (a.services ?? [])
        .filter((s) => s.service)
        .map((s) => ({ name: s.service!.name, price_snapshot: s.price_snapshot })),
    }));

    await logAuditAction({
      shopId: client.shop_id,
      actorId: '00000000-0000-0000-0000-000000000000',
      action: 'custom',
      entity: 'clients',
      entityId: client.id,
      diff: { loi25_self_export: true, appointments_count: appointments.length },
    });

    return ok({
      exported_at: new Date().toISOString(),
      client: {
        id: client.id,
        first_name: client.first_name,
        last_name: client.last_name,
        email: client.email,
        phone: client.phone,
        created_at: client.created_at,
        loyalty_balance_cents: effectiveBalanceCents,
      },
      appointments,
    });
  } catch (e) {
    captureException(e, { tags: { layer: 'self-export' } });
    return err('UNEXPECTED');
  }
}
