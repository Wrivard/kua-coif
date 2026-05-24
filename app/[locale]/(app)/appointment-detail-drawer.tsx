'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Drawer } from '@/components/ui/drawer';
import { useToast } from '@/components/ui/toast';
import { formatShopTime } from '@/lib/business/timezone';
import { cancelAppointment } from './actions';
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

  function onCancel() {
    if (!appointment) return;
    startTransition(async () => {
      const result = await cancelAppointment({ id: appointment.id });
      if (result.ok) {
        show({ variant: 'success', title: t('toasts.cancelled') });
        onClose();
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  return (
    <Drawer
      open={appointment !== null}
      onClose={onClose}
      title={t('detailTitle')}
      footer={
        appointment && !isCancelled ? (
          <Button variant="danger" onClick={onCancel} loading={isPending}>
            {t('cancelAppointment')}
          </Button>
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
          <p className="text-[10px] text-text-muted">{tCommon('actions.edit')} — V1.1</p>
        </div>
      ) : null}
    </Drawer>
  );
}
