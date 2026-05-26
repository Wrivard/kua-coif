import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { verifyToken } from '@/lib/security/signed-tokens';
import { MeClient } from './me-client';

export const dynamic = 'force-dynamic';

/**
 * Phase 68 — Customer self-service page.
 *
 * The customer authenticates via a signed token (`kind: 'me'`,
 * `resourceId: client_id`) embedded in a link the shop owner sends them
 * (V1 generation: ad-hoc; V1.1: auto-include in appointment confirmation
 * email).
 *
 * Loi 25 rights covered:
 *  - Right to access ("right to know what data you hold about me") —
 *    export JSON of the client's row + appointment history.
 *  - Right to be forgotten — anonymize the row (V1.1; not exposed here
 *    yet because the action is irreversible and we want the admin to
 *    walk the customer through it on the phone).
 *
 * Also surfaces the customer's loyalty balance as a "thanks for coming
 * back" hint so they know what's coming on their next visit.
 */
export default async function MePage({
  params: { locale, token },
}: {
  params: { locale: string; token: string };
}) {
  setRequestLocale(locale);

  const payload = verifyToken(decodeURIComponent(token), 'me');
  if (!payload) notFound();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServiceRoleClient() as any;
  const clientRes = await supabase
    .from('clients')
    .select(
      'id, shop_id, first_name, last_name, email, phone, loyalty_balance_cents, loyalty_counter, anonymized_at',
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
    loyalty_balance_cents: number | null;
    loyalty_counter: number | null;
    anonymized_at: string | null;
  }> | null) ?? [])[0];
  if (!client) notFound();
  if (client.anonymized_at) notFound();

  const shopRes = await supabase
    .from('shops')
    .select('name, email, phone')
    .eq('id', client.shop_id)
    .limit(1);
  const shop =
    ((shopRes.data as Array<{ name: string; email: string | null; phone: string | null }> | null) ??
      [])[0] ?? null;

  // Count completed appointments — used as a "X visits" stat on the page.
  const apptCountRes = await supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', client.id)
    .eq('status', 'completed');
  const completedCount = (apptCountRes.count as number | null) ?? 0;

  return (
    <MeClient
      locale={locale}
      token={token}
      client={{
        firstName: client.first_name,
        loyaltyBalanceCents: client.loyalty_balance_cents ?? 0,
        completedCount,
      }}
      shop={{
        name: shop?.name ?? '?',
        email: shop?.email ?? null,
        phone: shop?.phone ?? null,
      }}
    />
  );
}
