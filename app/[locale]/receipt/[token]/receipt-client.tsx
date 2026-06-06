'use client';

import { useEffect } from 'react';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatCurrencyCAD } from '@/lib/utils';
import { formatHeaderDate, formatShopTime } from '@/lib/business/timezone';

type Appointment = {
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
};

/**
 * ReceiptClient — print-styled HTML page rendering a customer receipt.
 *
 * `@media print` rules collapse the page to clean black-on-white, hide
 * the "Print" button, and force a sensible margin. The Save-as-PDF flow
 * from any modern browser produces a 1-page A4 receipt suitable for
 * Quebec tax records.
 */
export function ReceiptClient({
  locale,
  appointment,
  lines,
}: {
  locale: string;
  appointment: Appointment;
  lines: Array<{ name: string; price: number }>;
}) {
  const isFr = locale === 'fr';
  const fmt = (n: number) => formatCurrencyCAD(n, isFr ? 'fr' : 'en');
  const accent = appointment.shop.email_accent_color ?? '#4f7d5e';

  // Receipt math (re-verified post-Loop-13 self-review):
  //   - `appointments.total_amount` = subtotal − promoDiscount −
  //     loyaltyCredit (set in bookPublicAppointment; tip NOT included).
  //   - `appointments.tip_amount_cents` is a separate column added in
  //     Phase 73 — converted to dollars here.
  //   - `discount` is the implicit promo + loyalty delta — the gap
  //     between what the services cost on paper and what we charged
  //     before the tip.
  //   - `grandTotal` is what the customer actually paid: post-discount
  //     total + tip.
  const subtotal = lines.reduce((s, l) => s + l.price, 0);
  const tip = (appointment.tip_amount_cents ?? 0) / 100;
  const totalBeforeTip = Number(appointment.total_amount ?? 0);
  const discount = Math.max(0, subtotal - totalBeforeTip);
  const grandTotal = totalBeforeTip + tip;

  // Auto-trigger print on initial load only when arriving from an
  // explicit `?print=1` query (set by the email "View receipt" link).
  // Otherwise the user sees the preview + a manual Print button.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('print') === '1') {
      // Slight delay so React paint completes first.
      window.setTimeout(() => window.print(), 400);
    }
  }, []);

  const L = isFr
    ? {
        receipt: 'Reçu',
        forVisit: 'pour votre visite',
        date: 'Date',
        time: 'Heure',
        with: 'Avec',
        services: 'Services',
        subtotal: 'Sous-total',
        discount: 'Rabais',
        tip: 'Pourboire',
        total: 'Total',
        deposit: 'Acompte payé',
        balance: 'Solde à payer en salon',
        paid: 'Payé',
        unpaid: 'Non payé',
        pending: 'En traitement',
        refunded: 'Remboursé',
        failed: 'Échec',
        confirmation: 'Confirmation',
        booked: 'Réservé',
        method: 'Méthode',
        online: 'En ligne',
        inShop: 'Au salon',
        thanks: 'Merci pour votre visite !',
        print: 'Imprimer',
      }
    : {
        receipt: 'Receipt',
        forVisit: 'for your visit',
        date: 'Date',
        time: 'Time',
        with: 'With',
        services: 'Services',
        subtotal: 'Subtotal',
        discount: 'Discount',
        tip: 'Tip',
        total: 'Total',
        deposit: 'Deposit paid',
        balance: 'Balance due in-shop',
        paid: 'Paid',
        unpaid: 'Unpaid',
        pending: 'Pending',
        refunded: 'Refunded',
        failed: 'Failed',
        confirmation: 'Confirmation',
        booked: 'Booked',
        method: 'Method',
        online: 'Online',
        inShop: 'In-shop',
        thanks: 'Thank you for your visit!',
        print: 'Print',
      };

  const statusLabel: Record<string, string> = {
    paid: L.paid,
    unpaid: L.unpaid,
    pending: L.pending,
    refunded: L.refunded,
    failed: L.failed,
  };

  const clientName = appointment.client
    ? `${appointment.client.first_name}${appointment.client.last_name ? ` ${appointment.client.last_name}` : ''}`
    : '—';

  const formattedDate = formatHeaderDate(
    new Date(appointment.start_at),
    isFr ? 'fr' : 'en',
    appointment.shop.timezone,
  );
  const formattedTime = `${formatShopTime(appointment.start_at, appointment.shop.timezone, 'HH:mm')} – ${formatShopTime(appointment.end_at, appointment.shop.timezone, 'HH:mm')}`;

  return (
    <>
      {/* Print-only stylesheet — collapses the screen view to a clean
          black-on-white A4 page when the browser sends to print/PDF.
          The `.no-print` utility hides the action bar; the page margin
          becomes 12mm via @page. */}
      <style jsx global>{`
        @media print {
          body {
            background: white !important;
          }
          .no-print {
            display: none !important;
          }
          .receipt-card {
            box-shadow: none !important;
            border: none !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          @page {
            margin: 12mm;
          }
        }
      `}</style>

      <div className="min-h-screen bg-bg-base p-6 print:bg-white">
        <div className="mx-auto max-w-2xl">
          {/* Action bar — hidden when printing. */}
          <div className="no-print mb-4 flex justify-end">
            <Button variant="secondary" size="sm" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> {L.print}
            </Button>
          </div>

          {/* Receipt card */}
          <div className="receipt-card rounded-xl border border-border bg-bg-surface p-8 shadow-md print:bg-white print:text-black">
            {/* Header — shop logo (or wordmark) + receipt label */}
            <div className="flex items-start justify-between gap-4">
              <div>
                {appointment.shop.email_logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={appointment.shop.email_logo_url}
                    alt={appointment.shop.name}
                    style={{ height: 36, maxWidth: 180, objectFit: 'contain' }}
                  />
                ) : (
                  <p className="text-lg font-semibold tracking-tight text-text-primary print:text-black">
                    {appointment.shop.name}
                  </p>
                )}
                {appointment.shop.street ? (
                  <p className="mt-1 text-xs text-text-muted print:text-gray-700">
                    {appointment.shop.street}
                    {appointment.shop.municipality ? `, ${appointment.shop.municipality}` : ''}
                    {appointment.shop.province ? `, ${appointment.shop.province}` : ''}
                    {appointment.shop.postal_code ? ` ${appointment.shop.postal_code}` : ''}
                  </p>
                ) : null}
                {appointment.shop.phone ? (
                  <p className="text-xs text-text-muted print:text-gray-700">
                    {appointment.shop.phone}
                  </p>
                ) : null}
              </div>
              <div className="text-right">
                <p
                  className="text-xs font-semibold uppercase tracking-wide"
                  style={{ color: accent }}
                >
                  {L.receipt}
                </p>
                <p className="font-mono text-[10px] text-text-muted print:text-gray-700">
                  #{appointment.id.slice(0, 8).toUpperCase()}
                </p>
              </div>
            </div>

            <hr className="my-6 border-border print:border-gray-300" />

            {/* Client + date */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted print:text-gray-600">
                  {L.with}
                </p>
                <p className="font-medium text-text-primary print:text-black">
                  {appointment.barber?.display_name ?? '—'}
                </p>
                <p className="text-xs text-text-secondary print:text-gray-700">{clientName}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted print:text-gray-600">
                  {L.date}
                </p>
                <p className="font-medium text-text-primary print:text-black">{formattedDate}</p>
                <p className="text-xs text-text-secondary print:text-gray-700">{formattedTime}</p>
              </div>
            </div>

            <hr className="my-6 border-border print:border-gray-300" />

            {/* Service lines */}
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted print:text-gray-600">
              {L.services}
            </p>
            <ul className="space-y-2 text-sm">
              {lines.map((l, i) => (
                <li key={i} className="flex items-center justify-between">
                  <span className="text-text-primary print:text-black">{l.name}</span>
                  <span className="font-mono tabular-nums text-text-secondary print:text-gray-800">
                    {fmt(l.price)}
                  </span>
                </li>
              ))}
            </ul>

            <hr className="my-6 border-border print:border-gray-300" />

            {/* Totals */}
            <div className="space-y-1 text-sm">
              <Row label={L.subtotal} value={fmt(subtotal)} fmt={fmt} />
              {discount > 0 ? (
                <Row label={L.discount} value={`−${fmt(discount)}`} fmt={fmt} />
              ) : null}
              {tip > 0 ? <Row label={L.tip} value={fmt(tip)} fmt={fmt} /> : null}
              <hr className="my-2 border-border print:border-gray-300" />
              <Row label={L.total} value={fmt(grandTotal)} fmt={fmt} bold />
              {(appointment.deposit_amount_cents ?? 0) > 0 ? (
                <>
                  <Row
                    label={L.deposit}
                    value={`−${fmt((appointment.deposit_amount_cents ?? 0) / 100)}`}
                    fmt={fmt}
                  />
                  <Row
                    label={L.balance}
                    value={fmt(
                      Math.max(0, grandTotal - (appointment.deposit_amount_cents ?? 0) / 100),
                    )}
                    fmt={fmt}
                    bold
                  />
                </>
              ) : null}
            </div>

            <hr className="my-6 border-border print:border-gray-300" />

            <div className="flex items-center justify-between text-xs text-text-muted print:text-gray-700">
              <span>
                {L.method} ·{' '}
                <span className="text-text-secondary print:text-gray-800">
                  {appointment.source === 'online' ? L.online : L.inShop}
                </span>
              </span>
              <span>{statusLabel[appointment.payment_status] ?? appointment.payment_status}</span>
            </div>

            <p className="mt-6 text-center text-xs text-text-muted print:text-gray-700">
              {L.thanks}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

function Row({
  label,
  value,
  fmt: _fmt,
  bold,
}: {
  label: string;
  value: string;
  fmt: (n: number) => string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span
        className={
          bold
            ? 'font-semibold text-text-primary print:text-black'
            : 'text-text-secondary print:text-gray-700'
        }
      >
        {label}
      </span>
      <span
        className={
          'font-mono tabular-nums ' +
          (bold
            ? 'text-base font-semibold text-text-primary print:text-black'
            : 'text-text-secondary print:text-gray-800')
        }
      >
        {value}
      </span>
    </div>
  );
}
