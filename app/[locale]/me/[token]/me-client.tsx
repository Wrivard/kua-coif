'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { CalendarClock, CalendarX, Download, Mail, Phone, Receipt, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { formatCurrencyCAD } from '@/lib/utils';
import { formatShopTime, formatHeaderDate } from '@/lib/business/timezone';
import { cancelMyAppointment, exportMyData } from './actions';

export type UpcomingAppointment = {
  id: string;
  startAt: string;
  endAt: string;
  status: 'booked' | 'confirmed';
  totalAmount: number;
  paymentStatus: 'unpaid' | 'pending' | 'paid' | 'refunded' | 'failed';
  hasPaymentIntent: boolean;
  barberName: string | null;
  services: Array<{ name: string; durationMin: number }>;
  // Plan 044 (DIRECTION-01) — fresh per-render tokens for this appointment's
  // reschedule + receipt pages.
  rescheduleToken: string;
  receiptToken: string;
  // Plan 044 (UX-03) — free-cancel deadline (ISO). Null = no cancellation
  // window configured (a paid deposit refunds whenever the customer cancels).
  refundCutoffAt: string | null;
  /** Deposit actually charged (cents) — the amount at stake in the dialog. */
  depositCents: number;
};

export function MeClient({
  locale,
  token,
  client,
  shop,
  upcoming,
}: {
  locale: string;
  token: string;
  client: { firstName: string; loyaltyBalanceCents: number; completedCount: number };
  shop: { name: string; email: string | null; phone: string | null; timezone: string };
  upcoming: UpcomingAppointment[];
}) {
  const isFr = locale === 'fr';
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();
  // Optimistically hide cancelled appointments so the UI stays in sync
  // before the revalidatePath round-trip lands. The server keeps the
  // source of truth — a refresh re-fetches the list.
  const [cancelledIds, setCancelledIds] = useState<Set<string>>(new Set());
  // Self-cancel confirmation gate — themed dialog instead of native confirm().
  const [pendingCancel, setPendingCancel] = useState<UpcomingAppointment | null>(null);

  function downloadExport() {
    startTransition(async () => {
      const result = await exportMyData({ token });
      if (!result.ok) {
        show({
          variant: 'danger',
          title: isFr
            ? 'Le lien semble expiré. Demande un nouveau lien au salon.'
            : 'The link seems expired. Ask the shop for a new link.',
        });
        return;
      }
      // Stream the JSON to a download. Filename includes a timestamp
      // so successive exports don't overwrite each other in the
      // customer's downloads folder.
      const blob = new Blob([JSON.stringify(result.data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kua-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      show({
        variant: 'success',
        title: isFr ? 'Téléchargement démarré' : 'Download started',
      });
    });
  }

  // Phase G — customer self-cancel.
  //
  // Confirms via a themed ConfirmDialog: the trigger just stores the
  // pending appointment; doCancel runs after the user confirms. The
  // action does the refund-policy check server-side; the UI just relays
  // the result via a toast.
  function cancelAppointment(appointment: UpcomingAppointment) {
    setPendingCancel(appointment);
  }

  function doCancel(appointment: UpcomingAppointment) {
    startTransition(async () => {
      // Phase H — forward the URL locale so the cancellation email
      // lands in the right language. The action defaults to FR when
      // the field is missing (older clients).
      const emailLocale: 'fr' | 'en' = isFr ? 'fr' : 'en';
      const result = await cancelMyAppointment({
        token,
        appointment_id: appointment.id,
        locale: emailLocale,
      });
      if (!result.ok) {
        // Phase H — shop disabled customer-initiated cancels via
        // `barber_settings.customer_cancellations`. The action surfaces
        // a specific field-error so we can show the right copy
        // ("contact the salon") instead of a generic failure.
        const cancelBlocked =
          result.errorCode === 'INVALID_INPUT' &&
          result.fieldErrors?.cancellation === 'not_allowed';
        show({
          variant: 'danger',
          title: cancelBlocked
            ? isFr
              ? 'Ce salon n’autorise pas les annulations en libre-service. Contacte-le directement.'
              : "This shop doesn't allow self-service cancellations. Please contact them directly."
            : isFr
              ? 'Annulation impossible. Contacte le salon.'
              : 'Cancel failed. Contact the shop.',
        });
        return;
      }
      // Optimistic hide so the row disappears immediately even before
      // the page revalidates.
      setCancelledIds((prev) => new Set(prev).add(appointment.id));
      const { refunded, withinNoRefundWindow } = result.data;
      const title = isFr
        ? refunded
          ? 'Rendez-vous annulé et acompte remboursé.'
          : withinNoRefundWindow
            ? 'Rendez-vous annulé. Selon la politique du salon, ton acompte n’est pas remboursé.'
            : 'Rendez-vous annulé.'
        : refunded
          ? 'Appointment cancelled and deposit refunded.'
          : withinNoRefundWindow
            ? "Appointment cancelled. Per the shop's policy, your deposit isn't refunded."
            : 'Appointment cancelled.';
      show({ variant: refunded || !withinNoRefundWindow ? 'success' : 'info', title });
    });
  }

  const visibleUpcoming = upcoming.filter((a) => !cancelledIds.has(a.id));

  const L = isFr
    ? {
        hello: `Bonjour ${client.firstName}`,
        intro: `Voici ce que ${shop.name} a sur ton compte. Tout est privé — seul le salon (et toi) y a accès.`,
        loyaltyTitle: 'Ton crédit fidélité',
        loyaltyHint: 'Appliqué automatiquement à ta prochaine réservation.',
        visits: 'visites complétées',
        loi25Title: 'Tes données (Loi 25)',
        loi25Body:
          'Tu peux télécharger une copie de toutes tes données : profil, historique de RDV, paiements. Pour supprimer ton compte, contacte le salon — c’est une opération qu’on fait avec toi pour s’assurer que rien d’important ne disparaît par erreur.',
        download: 'Télécharger mes données (JSON)',
        contactTitle: 'Contacte le salon',
        upcomingTitle: 'Tes prochains rendez-vous',
        upcomingEmpty: 'Aucun rendez-vous à venir.',
        rescheduleButton: 'Déplacer',
        receiptButton: 'Reçu',
        cancelButton: 'Annuler',
        cancelTitle: 'Annuler le rendez-vous ?',
        keepButton: 'Garder',
        paidLine: 'Acompte payé',
        depositRefundable: 'Remboursable',
        freeCancelUntil: (deadline: string) => `Annulation gratuite jusqu’au ${deadline}.`,
      }
    : {
        hello: `Hi ${client.firstName}`,
        intro: `Here's what ${shop.name} has on your account. Everything is private — only the shop (and you) sees this.`,
        loyaltyTitle: 'Your loyalty credit',
        loyaltyHint: 'Auto-applied to your next booking.',
        visits: 'visits completed',
        loi25Title: 'Your data (Quebec Loi 25)',
        loi25Body:
          'You can download a copy of everything we have on you: profile, appointment history, payments. To delete your account, contact the shop — it’s a step we walk through together so nothing important is lost by accident.',
        download: 'Download my data (JSON)',
        contactTitle: 'Contact the shop',
        upcomingTitle: 'Your upcoming appointments',
        upcomingEmpty: 'No upcoming appointments.',
        rescheduleButton: 'Reschedule',
        receiptButton: 'Receipt',
        cancelButton: 'Cancel',
        cancelTitle: 'Cancel appointment?',
        keepButton: 'Keep',
        paidLine: 'Deposit paid',
        depositRefundable: 'Refundable',
        freeCancelUntil: (deadline: string) => `Free cancellation until ${deadline}.`,
      };

  // Plan 044 (UX-03) — DEFINITIVE refund consequence, computed from the same
  // cutoff the server uses (start - mins_cancel_before_appt), instead of the
  // old "if you're inside the refund window…" the customer couldn't evaluate.
  const pendingPaid = pendingCancel
    ? pendingCancel.paymentStatus === 'paid' && pendingCancel.hasPaymentIntent
    : false;
  const pendingInsideWindow = pendingCancel?.refundCutoffAt
    ? Date.now() >= new Date(pendingCancel.refundCutoffAt).getTime()
    : false;
  const pendingDeposit =
    pendingCancel && pendingCancel.depositCents > 0
      ? formatCurrencyCAD(pendingCancel.depositCents / 100, isFr ? 'fr' : 'en')
      : null;
  const cancelDescription = isFr
    ? pendingPaid
      ? pendingInsideWindow
        ? `Ton acompte${pendingDeposit ? ` de ${pendingDeposit}` : ''} ne sera PAS remboursé (politique d’annulation du salon). Annuler quand même ?`
        : `Ton acompte${pendingDeposit ? ` de ${pendingDeposit}` : ''} te sera remboursé automatiquement.`
      : 'Annuler ce rendez-vous ?'
    : pendingPaid
      ? pendingInsideWindow
        ? `Your deposit${pendingDeposit ? ` of ${pendingDeposit}` : ''} will NOT be refunded (the shop's cancellation policy). Cancel anyway?`
        : `Your deposit${pendingDeposit ? ` of ${pendingDeposit}` : ''} will be refunded automatically.`
      : 'Cancel this appointment?';

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <header className="space-y-1">
        <p className="type-eyebrow">{shop.name}</p>
        <h1 className="text-display-md text-text-primary">{L.hello}</h1>
        <p className="text-sm text-text-secondary">{L.intro}</p>
      </header>

      {/* Phase G — upcoming appointments + self-cancel. */}
      <Card>
        <CardHeader>
          <CardTitle>{L.upcomingTitle}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          {visibleUpcoming.length === 0 ? (
            <p className="text-sm text-text-secondary">{L.upcomingEmpty}</p>
          ) : (
            visibleUpcoming.map((appt) => {
              const dateStr = formatHeaderDate(
                new Date(appt.startAt),
                isFr ? 'fr' : 'en',
                shop.timezone,
              );
              const startStr = formatShopTime(appt.startAt, shop.timezone, 'HH:mm');
              const endStr = formatShopTime(appt.endAt, shop.timezone, 'HH:mm');
              const isPaid = appt.paymentStatus === 'paid' && appt.hasPaymentIntent;
              // Plan 044 (UX-03) — surface the free-cancel deadline while it
              // still lies ahead; once past, the dialog carries the definitive
              // "not refunded" message instead.
              const cutoffMs = appt.refundCutoffAt ? new Date(appt.refundCutoffAt).getTime() : null;
              const showFreeCancelLine = isPaid && cutoffMs !== null && Date.now() < cutoffMs;
              return (
                <div
                  key={appt.id}
                  className="space-y-2 rounded-lg border border-border bg-bg-surface p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium text-text-primary">
                        {dateStr} · {startStr} – {endStr}
                      </p>
                      <p className="text-xs text-text-secondary">
                        {appt.services.map((s) => s.name).join(' + ')}
                        {appt.barberName ? ` · ${appt.barberName}` : ''}
                      </p>
                      <p className="text-xs text-text-muted">
                        {formatCurrencyCAD(appt.totalAmount, isFr ? 'fr' : 'en')}
                        {isPaid ? ` · ${L.paidLine}` : ''}
                      </p>
                      {showFreeCancelLine ? (
                        <p className="text-xs text-text-muted">
                          {L.freeCancelUntil(
                            `${formatHeaderDate(
                              new Date(appt.refundCutoffAt!),
                              isFr ? 'fr' : 'en',
                              shop.timezone,
                            )} · ${formatShopTime(appt.refundCutoffAt!, shop.timezone, 'HH:mm')}`,
                          )}
                        </p>
                      ) : null}
                    </div>
                    {/* Plan 044 (DIRECTION-01) — customers who can only cancel
                        WILL cancel; salons prefer reschedules. Reschedule leads
                        (primary), Receipt and Cancel follow. Fresh tokens are
                        minted per /me render, so these links are always live
                        even when the emailed 7-day one died. */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {/* Links styled to the Button sm recipe — nesting a
                          <button> inside an anchor is invalid HTML. */}
                      <Link
                        href={`/${locale}/reschedule/${appt.rescheduleToken}`}
                        className="inline-flex h-8 items-center justify-center gap-2 rounded-sm bg-accent px-3 text-xs font-medium text-accent-fg shadow-sm transition-all duration-150 ease-out-quint hover:bg-accent-hover hover:shadow-accent-glow focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
                      >
                        <CalendarClock className="h-4 w-4" aria-hidden /> {L.rescheduleButton}
                      </Link>
                      <Link
                        href={`/${locale}/receipt/${appt.receiptToken}`}
                        className="inline-flex h-8 items-center justify-center gap-2 rounded-sm bg-bg-surface px-3 text-xs font-medium text-text-primary shadow-sm transition-all duration-150 ease-out-quint hover:bg-bg-surface-2 hover:shadow-border-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
                      >
                        <Receipt className="h-4 w-4" aria-hidden /> {L.receiptButton}
                      </Link>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => cancelAppointment(appt)}
                        disabled={isPending}
                      >
                        <CalendarX className="h-4 w-4" /> {L.cancelButton}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </CardBody>
      </Card>

      {/* Loyalty — the page's single hero beat. */}
      <div className="surface-hero space-y-2 p-6">
        <p className="type-eyebrow inline-flex items-center gap-2 text-accent">
          <Sparkles className="h-4 w-4" />
          {L.loyaltyTitle}
        </p>
        <p className="text-display-lg tabular-nums text-text-primary">
          {formatCurrencyCAD(client.loyaltyBalanceCents / 100, isFr ? 'fr' : 'en')}
        </p>
        <p className="text-xs text-text-secondary">{L.loyaltyHint}</p>
        <p className="text-xs text-text-muted">
          {client.completedCount} {L.visits}
        </p>
      </div>

      {/* Loi 25 self-export */}
      <Card>
        <CardHeader>
          <CardTitle>{L.loi25Title}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <p className="text-sm leading-relaxed text-text-secondary">{L.loi25Body}</p>
          <Button onClick={downloadExport} loading={isPending} variant="secondary" size="sm">
            <Download className="h-4 w-4" /> {L.download}
          </Button>
        </CardBody>
      </Card>

      {/* Shop contact */}
      {shop.email || shop.phone ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {L.contactTitle} — {shop.name}
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-sm text-text-secondary">
            {shop.phone ? (
              <p className="inline-flex items-center gap-2">
                <Phone className="h-4 w-4 text-text-muted" />
                <a href={`tel:${shop.phone}`} className="hover:text-text-primary">
                  {shop.phone}
                </a>
              </p>
            ) : null}
            {shop.email ? (
              <p className="inline-flex items-center gap-2">
                <Mail className="h-4 w-4 text-text-muted" />
                <a href={`mailto:${shop.email}`} className="hover:text-text-primary">
                  {shop.email}
                </a>
              </p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      <ConfirmDialog
        open={pendingCancel !== null}
        destructive
        loading={isPending}
        title={L.cancelTitle}
        description={cancelDescription}
        confirmLabel={L.cancelButton}
        cancelLabel={L.keepButton}
        onConfirm={() => {
          const appt = pendingCancel;
          setPendingCancel(null);
          if (appt) doCancel(appt);
        }}
        onCancel={() => setPendingCancel(null)}
      />
    </div>
  );
}
