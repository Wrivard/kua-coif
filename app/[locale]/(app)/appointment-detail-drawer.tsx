'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarSync, Link2, Receipt, Sparkles, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Drawer } from '@/components/ui/drawer';
import { useToast } from '@/components/ui/toast';
import { formatShopTime } from '@/lib/business/timezone';
import { cancelAppointment } from './actions';
import { generatePublicLinks } from './actions-public-links';
import type { CalendarAppointment } from './appointments-calendar';

type Props = {
  appointment: CalendarAppointment | null;
  timezone: string;
  onClose: () => void;
  formatAmount: (n: number) => string;
};

export function AppointmentDetailDrawer({ appointment, timezone, onClose, formatAmount }: Props) {
  const t = useTranslations('pages.appointments');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();

  const isCancelled = appointment?.status === 'cancelled' || appointment?.status === 'no_show';

  function onCancel(alsoRefund: boolean = false) {
    if (!appointment) return;
    // Loop 25 — owner intent: "I'm just cancelling" vs "Cancel and
    // refund the customer." When `alsoRefund=true`, the cancel action
    // refunds the PaymentIntent first (irreversible, customer-safe
    // order) then marks the row cancelled. Refund failure doesn't
    // block the cancel — the owner gets a toast and can retry the
    // refund via the standalone refund flow.
    startTransition(async () => {
      const result = await cancelAppointment({ id: appointment.id, also_refund: alsoRefund });
      if (result.ok) {
        show({
          variant: 'success',
          title: alsoRefund ? t('toasts.cancelledAndRefunded') : t('toasts.cancelled'),
        });
        onClose();
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  // Whether the appointment is in a payment state where a refund is
  // actually possible. "paid" is the only happy path; refunded/failed/
  // pending all skip the refund button.
  const canRefund = appointment?.payment_status === 'paid';

  // Phase 12 (post-loop-11) — generate a signed public link, prefix
  // with the live origin if the env-set base is empty (dev), then copy
  // to clipboard. The owner can paste into SMS / email / Slack — we
  // skip wiring a "send via Resend" flow until the V1.1 automated
  // post-appointment email lands.
  function copyPublicLink(kind: 'review' | 'me' | 'receipt' | 'reschedule') {
    if (!appointment) return;
    startTransition(async () => {
      const result = await generatePublicLinks({ appointment_id: appointment.id });
      if (!result.ok) {
        show({ variant: 'danger', title: tErr(result.errorCode) });
        return;
      }
      const data = result.data as {
        reviewUrl: string;
        meUrl: string | null;
        receiptUrl: string;
        rescheduleUrl: string;
      };
      const raw =
        kind === 'review'
          ? data.reviewUrl
          : kind === 'me'
            ? data.meUrl
            : kind === 'receipt'
              ? data.receiptUrl
              : data.rescheduleUrl;
      if (!raw) {
        show({ variant: 'danger', title: 'Walk-in (no client record)' });
        return;
      }
      const url = raw.startsWith('http') ? raw : `${window.location.origin}${raw}`;
      const titles = {
        review: 'Review link copied',
        me: 'Self-service link copied',
        receipt: 'Receipt link copied',
        reschedule: 'Reschedule link copied',
      };
      try {
        await navigator.clipboard.writeText(url);
        show({ variant: 'success', title: titles[kind] });
      } catch {
        // Some browsers refuse clipboard.write outside HTTPS; fall back
        // to surfacing the URL in the toast so the owner can copy it
        // manually. Truncated to fit a small toast.
        show({
          variant: 'success',
          title: url.length > 60 ? `${url.slice(0, 57)}…` : url,
        });
      }
    });
  }

  return (
    <Drawer
      open={appointment !== null}
      onClose={onClose}
      title={t('detailTitle')}
      footer={
        // Loop 25 — split into two buttons when the appointment was
        // paid. "Cancel & refund" handles the chargeback-avoidance
        // pattern in one action; plain "Cancel" stays for the unpaid
        // case (most appointments). When already cancelled, no footer.
        appointment && !isCancelled ? (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onCancel(false)} disabled={isPending}>
              {t('cancelAppointment')}
            </Button>
            {canRefund ? (
              <Button variant="danger" onClick={() => onCancel(true)} loading={isPending}>
                {t('cancelAndRefund')}
              </Button>
            ) : null}
          </div>
        ) : null
      }
    >
      {appointment ? (
        <div className="space-y-4 text-sm">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              {t('client')}
            </p>
            <p className="text-base font-semibold text-text-primary">{appointment.client_name}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                {t('time')}
              </p>
              <p>
                {formatShopTime(appointment.start_at, timezone, 'HH:mm')}
                {' – '}
                {formatShopTime(appointment.end_at, timezone, 'HH:mm')}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                {t('status')}
              </p>
              <Badge variant={isCancelled ? 'default' : 'success'}>
                {t(`statuses.${appointment.status}`)}
              </Badge>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              {t('services')}
            </p>
            <ul className="mt-1 space-y-0.5">
              {appointment.services.map((s) => (
                <li key={s.id} className="flex items-center justify-between">
                  <span>{s.name}</span>
                  <span className="text-text-muted">{s.duration_min} min</span>
                </li>
              ))}
            </ul>
          </div>
          {appointment.notes ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                {t('notes')}
              </p>
              <p className="whitespace-pre-wrap text-text-secondary">{appointment.notes}</p>
            </div>
          ) : null}
          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-xs uppercase tracking-wide text-text-muted">
              {appointment.source === 'online' ? t('online') : t('admin')}
            </span>
            <span className="text-base font-semibold">
              {formatAmount(appointment.total_amount)}
            </span>
          </div>
          {/* Phase 12 — public link generators. The owner copies a
              signed URL and pastes it into their preferred channel
              (SMS, email, Slack). Auto-send via Resend ships V1.1. */}
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              Customer links
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => copyPublicLink('receipt')}
                disabled={isPending}
              >
                <Receipt className="h-3.5 w-3.5" /> Receipt
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => copyPublicLink('reschedule')}
                disabled={isPending}
              >
                <CalendarSync className="h-3.5 w-3.5" /> Reschedule
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => copyPublicLink('review')}
                disabled={isPending}
              >
                <Star className="h-3.5 w-3.5" /> Review
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => copyPublicLink('me')}
                disabled={isPending}
              >
                <Sparkles className="h-3.5 w-3.5" /> Self-service
              </Button>
            </div>
            <p className="text-[10px] text-text-muted">
              <Link2 className="mr-1 inline h-3 w-3" /> Generates a signed URL valid 90 days
              (review) / 365 days (/me), copied to your clipboard.
            </p>
          </div>
          <p className="text-[10px] text-text-muted">{tCommon('actions.edit')} — V1.1</p>
        </div>
      ) : null}
    </Drawer>
  );
}
