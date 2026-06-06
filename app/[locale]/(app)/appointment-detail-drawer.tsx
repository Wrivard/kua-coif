'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarSync, Check, Link2, Receipt, RotateCcw, Sparkles, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Drawer } from '@/components/ui/drawer';
import { useToast } from '@/components/ui/toast';
import { formatShopTime } from '@/lib/business/timezone';
import { APPOINTMENT_STATUSES, type AppointmentStatus } from '@/db/enums';
import { cancelAppointment, refundAppointment, updateAppointment } from './actions';
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
  const [status, setStatus] = useState<AppointmentStatus>(appointment?.status ?? 'booked');
  const [notes, setNotes] = useState(appointment?.notes ?? '');
  // Re-sync local edits when a different appointment is opened in the drawer.
  useEffect(() => {
    setStatus(appointment?.status ?? 'booked');
    setNotes(appointment?.notes ?? '');
  }, [appointment?.id, appointment?.status, appointment?.notes]);
  const dirty =
    appointment != null &&
    (status !== appointment.status || (notes || null) !== (appointment.notes || null));

  function onSave() {
    if (!appointment || !dirty) return;
    startTransition(async () => {
      const result = await updateAppointment({ id: appointment.id, status, notes: notes || null });
      if (result.ok) {
        show({ variant: 'success', title: t('toasts.updated') });
        onClose();
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  const isCancelled = appointment?.status === 'cancelled' || appointment?.status === 'no_show';

  function onCancel(alsoRefund: boolean = false, forceRefund: boolean = false) {
    if (!appointment) return;
    // Loop 25 — owner intent: "I'm just cancelling" vs "Cancel and
    // refund the customer." When `alsoRefund=true`, the cancel action
    // refunds the PaymentIntent first (irreversible, customer-safe
    // order) then marks the row cancelled. Refund failure doesn't
    // block the cancel — the owner gets a toast and can retry the
    // refund via the standalone refund flow.
    //
    // Phase D — the refund policy gate. When the appointment is
    // within `mins_cancel_before_appt` of start time, the action
    // rejects the auto-refund with `INVALID_INPUT` +
    // `fieldErrors.refund_policy='within_no_refund_window'`. We
    // catch that here, ask the operator if they want to force the
    // refund despite the policy, and retry with `force_refund=true`.
    // The forced refund still flows through Stripe normally — the
    // policy is salon-side, not Stripe-side.
    startTransition(async () => {
      const result = await cancelAppointment({
        id: appointment.id,
        also_refund: alsoRefund,
        force_refund: forceRefund,
      });
      if (result.ok) {
        show({
          variant: 'success',
          title: alsoRefund ? t('toasts.cancelledAndRefunded') : t('toasts.cancelled'),
        });
        onClose();
        return;
      }
      // Policy-gate branch: re-prompt with the policy message and
      // retry forced if the operator confirms.
      if (
        result.errorCode === 'INVALID_INPUT' &&
        result.fieldErrors?.refund_policy === 'within_no_refund_window'
      ) {
        const mins = Number(result.fieldErrors?.mins_cancel_before_appt ?? 0);
        // Format the threshold as the most natural unit so 300 minutes
        // reads as "5 hours" not "less than 300 minutes". We hand the
        // pre-formatted string to the i18n message rather than ICU-
        // plural-ing the raw minute count — ICU can pluralize but it
        // can't pick the most natural unit.
        const threshold =
          mins >= 60 && mins % 60 === 0
            ? t('refundPolicy.hours', { hours: mins / 60 })
            : t('refundPolicy.minutes', { mins });
        const prompt = t('confirmForceRefund', { threshold });
        if (confirm(prompt)) {
          onCancel(alsoRefund, true);
        }
        return;
      }
      show({ variant: 'danger', title: tErr(result.errorCode) });
    });
  }

  // Phase C — standalone refund (no cancel). Use case: deposit was
  // collected but the operator wants to refund it AND keep the
  // appointment on the calendar (e.g. customer disputes the deposit
  // policy but still plans to come in), OR the appointment was
  // already cancelled WITHOUT refund and the operator wants to refund
  // after the fact. Both cases hit `refundAppointment` directly.
  //
  // Confirms once — refunds are not reversible from this UI (the
  // operator would need to call `chargeAppointment` to re-charge).
  function onRefund() {
    if (!appointment) return;
    if (!confirm(t('confirmRefund'))) return;
    startTransition(async () => {
      const result = await refundAppointment({ id: appointment.id });
      if (result.ok) {
        show({ variant: 'success', title: t('toasts.refunded') });
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
        show({ variant: 'danger', title: t('walkInNoClient') });
        return;
      }
      const url = raw.startsWith('http') ? raw : `${window.location.origin}${raw}`;
      const titles = {
        review: t('linkCopied.review'),
        me: t('linkCopied.me'),
        receipt: t('linkCopied.receipt'),
        reschedule: t('linkCopied.reschedule'),
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
        // Loop 25 / Phase C — three states:
        //   - active appointment: Cancel + (when paid) Refund + Cancel & Refund
        //   - cancelled but paid: standalone Refund only (audit gap closed —
        //     `refundAppointment` was exported but never callable from UI)
        //   - cancelled + already refunded/unpaid: no footer
        appointment && !isCancelled ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => onCancel(false)} disabled={isPending}>
              {t('cancelAppointment')}
            </Button>
            {canRefund ? (
              <>
                <Button variant="secondary" onClick={onRefund} disabled={isPending}>
                  <RotateCcw className="h-4 w-4" /> {t('refundOnly')}
                </Button>
                <Button variant="danger" onClick={() => onCancel(true)} loading={isPending}>
                  {t('cancelAndRefund')}
                </Button>
              </>
            ) : null}
          </div>
        ) : appointment && isCancelled && canRefund ? (
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onRefund} loading={isPending}>
              <RotateCcw className="h-4 w-4" /> {t('refundOnly')}
            </Button>
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
              {/* Loop 37 (P114) — time range in mono so the
                  HH:mm – HH:mm format reads as a single timestamp
                  block rather than slipping under the proportional
                  Sans hyphen. */}
              <p className="font-mono tabular-nums">
                {formatShopTime(appointment.start_at, timezone, 'HH:mm')}
                {' – '}
                {formatShopTime(appointment.end_at, timezone, 'HH:mm')}
              </p>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
                {t('status')}
              </p>
              <Select
                value={status}
                onChange={(e) => setStatus(e.target.value as AppointmentStatus)}
                disabled={isPending}
                aria-label={t('status')}
              >
                {APPOINTMENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`statuses.${s}`)}
                  </option>
                ))}
              </Select>
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
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
              {t('notes')}
            </p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={isPending}
              rows={3}
              maxLength={2000}
              className="w-full resize-y rounded-lg bg-bg-surface-2 px-3 py-2 text-sm text-text-secondary shadow-sm transition-colors duration-150 ease-out-quint focus:outline-none focus:ring-2 focus:ring-focus disabled:opacity-50"
            />
          </div>
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
              {t('customerLinks.title')}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => copyPublicLink('receipt')}
                disabled={isPending}
              >
                <Receipt className="h-3.5 w-3.5" /> {t('customerLinks.receipt')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => copyPublicLink('reschedule')}
                disabled={isPending}
              >
                <CalendarSync className="h-3.5 w-3.5" /> {t('customerLinks.reschedule')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => copyPublicLink('review')}
                disabled={isPending}
              >
                <Star className="h-3.5 w-3.5" /> {t('customerLinks.review')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => copyPublicLink('me')}
                disabled={isPending}
              >
                <Sparkles className="h-3.5 w-3.5" /> {t('customerLinks.selfService')}
              </Button>
            </div>
            <p className="text-[10px] text-text-muted">
              <Link2 className="mr-1 inline h-3 w-3" /> {t('customerLinks.hint')}
            </p>
          </div>
          {dirty ? (
            <div className="flex justify-end border-t border-border pt-3">
              <Button onClick={onSave} loading={isPending} size="sm">
                <Check className="h-4 w-4" /> {tCommon('actions.save')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  );
}
