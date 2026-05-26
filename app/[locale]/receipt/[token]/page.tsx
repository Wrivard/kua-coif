import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { verifyToken } from '@/lib/security/signed-tokens';
import { ReceiptClient } from './receipt-client';

export const dynamic = 'force-dynamic';

/**
 * Phase 71 — Printable customer receipt.
 *
 * Reached via a signed token (kind='receipt') the customer received in
 * their booking confirmation email or via a "Receipt link" button on
 * the admin appointment detail drawer.
 *
 * Implementation tradeoff: server-rendered HTML with a `@media print`
 * stylesheet instead of a real PDF (no @react-pdf/renderer / puppeteer
 * dependency added). The customer hits "Print" in their browser →
 * "Save as PDF" → done. Same artifact, ~100KB lighter bundle.
 */
export default async function ReceiptPage({
  params: { locale, token },
}: {
  params: { locale: string; token: string };
}) {
  setRequestLocale(locale);

  const payload = verifyToken(decodeURIComponent(token), 'receipt');
  if (!payload) notFound();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServiceRoleClient() as any;

  // Fetch everything needed to render the receipt in two queries:
  // appointment (with shop + barber + client joined) and the service
  // line items separately.
  const apptRes = await supabase
    .from('appointments')
    .select(
      `id, start_at, end_at, total_amount, deposit_amount_cents, tip_amount_cents,
       payment_status, payment_intent_id, source,
       shop:shops(name, street, municipality, province, postal_code, phone, email,
                  email_logo_url, email_accent_color, timezone),
       barber:barbers(display_name),
       client:clients(first_name, last_name, email, phone)`,
    )
    .eq('id', payload.resourceId)
    .limit(1);
  const appt = ((apptRes.data as Array<{
    id: string;
    start_at: string;
    end_at: string;
    total_amount: number;
    deposit_amount_cents: number | null;
    tip_amount_cents: number | null;
    payment_status: string;
    payment_intent_id: string | null;
    source: string;
    shop: {
      name: string;
      street: string | null;
      municipality: string | null;
      province: string | null;
      postal_code: string | null;
      phone: string | null;
      email: string | null;
      email_logo_url: string | null;
      email_accent_color: string | null;
      timezone: string;
    };
    barber: { display_name: string } | null;
    client: {
      first_name: string;
      last_name: string | null;
      email: string | null;
      phone: string | null;
    } | null;
  }> | null) ?? [])[0];
  if (!appt) notFound();

  const linksRes = await supabase
    .from('appointment_services')
    .select('price_snapshot, service:services(name)')
    .eq('appointment_id', appt.id);
  const lines = (
    (linksRes.data as Array<{
      price_snapshot: number;
      service: { name: string } | null;
    }> | null) ?? []
  ).map((l) => ({
    name: l.service?.name ?? '—',
    price: Number(l.price_snapshot ?? 0),
  }));

  return <ReceiptClient locale={locale} appointment={appt} lines={lines} />;
}
