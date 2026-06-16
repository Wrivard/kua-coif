'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { CreditCard } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { APPOINTMENT_STATUS_VARIANT } from '@/components/ui/appointment-status';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { EmptyCell } from '@/components/ui/empty-cell';
import { formatShopTime } from '@/lib/business/timezone';
import { formatCurrencyCAD } from '@/lib/utils';
import type { BarberRow } from '@/db/rows';
import type { CalendarAppointment } from './appointments-calendar';

type Props = {
  appointments: CalendarAppointment[];
  barbers: BarberRow[];
  timezone: string;
  locale: string;
  onApptClick: (a: CalendarAppointment) => void;
};

// Plan 040 (CAL-10) — badge variants come from the ONE shared map. The
// local copy had drifted: no_show read as a muted nothing here while the
// grid painted it as a needs-attention warning.

/**
 * Phase 5 — Appointments "List" view. Presentational only: it renders the
 * day's appointments (already day-scoped + sorted `start_at asc` by the
 * Server Component) as a chronological table. The parent owns the single
 * mounted `AppointmentDetailDrawer`; clicking a row just calls back through
 * `onApptClick`.
 */
export function AppointmentsListView({
  appointments,
  barbers,
  timezone,
  locale,
  onApptClick,
}: Props) {
  const t = useTranslations('pages.appointments');
  const tStatus = useTranslations('pages.appointments.statuses');
  const lang = locale === 'fr' ? 'fr' : 'en';

  const barberName = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of barbers) m.set(b.id, b.display_name);
    return m;
  }, [barbers]);

  const columns: ColumnDef<CalendarAppointment>[] = [
    {
      id: 'time',
      header: t('time'),
      // tabular-nums keeps the start/end columns vertically aligned down
      // the chronological list.
      cell: (a) => (
        <span className="font-mono tabular-nums text-text-secondary">
          {formatShopTime(a.start_at, timezone, 'HH:mm')}–
          {formatShopTime(a.end_at, timezone, 'HH:mm')}
        </span>
      ),
      sortable: true,
      sortValue: (a) => new Date(a.start_at).getTime(),
    },
    {
      id: 'client',
      header: t('client'),
      cell: (a) => <span className="font-medium text-text-primary">{a.client_name}</span>,
      sortable: true,
      sortValue: (a) => a.client_name,
    },
    {
      id: 'barber',
      header: t('list.barber'),
      cell: (a) => barberName.get(a.barber_id) ?? <EmptyCell />,
      sortable: true,
      sortValue: (a) => barberName.get(a.barber_id) ?? '',
    },
    {
      id: 'services',
      header: t('services'),
      cell: (a) => a.services.map((s) => s.name).join(' + '),
    },
    {
      id: 'status',
      header: t('status'),
      cell: (a) => (
        <Badge variant={APPOINTMENT_STATUS_VARIANT[a.status]}>{tStatus(a.status)}</Badge>
      ),
    },
    {
      id: 'amount',
      header: t('list.amount'),
      // Mirror the day-grid / week-view glyph: a CreditCard marks a collected
      // (paid) appointment so the List view carries the same "money is in"
      // signal. aria-hidden glyph + sr-only label for screen readers.
      cell: (a) => (
        <span className="inline-flex items-center gap-1.5">
          {a.payment_status === 'paid' ? (
            <>
              <CreditCard aria-hidden className="h-3.5 w-3.5 text-success" />
              <span className="sr-only">{t('paid')}</span>
            </>
          ) : null}
          {formatCurrencyCAD(a.total_amount, lang)}
        </span>
      ),
      align: 'right',
      sortable: true,
      sortValue: (a) => a.total_amount,
    },
  ];

  return (
    <DataTable
      data={appointments}
      columns={columns}
      getRowKey={(a) => a.id}
      onRowClick={onApptClick}
      emptyState={{
        title: t('list.emptyTitle'),
        description: t('list.emptyDescription'),
      }}
    />
  );
}
