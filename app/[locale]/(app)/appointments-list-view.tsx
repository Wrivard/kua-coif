'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { formatShopTime } from '@/lib/business/timezone';
import { formatCurrencyCAD } from '@/lib/utils';
import type { BarberRow } from '@/db/rows';
import type { AppointmentStatus } from '@/db/enums';
import type { CalendarAppointment } from './appointments-calendar';

type Props = {
  appointments: CalendarAppointment[];
  barbers: BarberRow[];
  timezone: string;
  locale: string;
  onApptClick: (a: CalendarAppointment) => void;
};

// Mirror of `statusToColor` in the calendar, but mapped to the Badge
// variant vocabulary: confirmed/arrived/completed read as "good" (success),
// booked as a neutral-but-active info, terminal statuses as a muted default.
function statusBadgeVariant(status: AppointmentStatus): BadgeVariant {
  switch (status) {
    case 'confirmed':
    case 'arrived':
    case 'completed':
      return 'success';
    case 'booked':
      return 'info';
    case 'cancelled':
    case 'no_show':
      return 'default';
    default:
      return 'accent';
  }
}

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
      cell: (a) => barberName.get(a.barber_id) ?? '—',
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
      cell: (a) => <Badge variant={statusBadgeVariant(a.status)}>{tStatus(a.status)}</Badge>,
    },
    {
      id: 'amount',
      header: t('list.amount'),
      cell: (a) => formatCurrencyCAD(a.total_amount, lang),
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
