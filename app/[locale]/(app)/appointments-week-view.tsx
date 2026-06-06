'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { CreditCard } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { EmptyCell } from '@/components/ui/empty-cell';
import { formatShopTime, shopIsoDate } from '@/lib/business/timezone';
import { cn } from '@/lib/utils';
import type { BarberRow } from '@/db/rows';
import { statusToColor, type CalendarAppointment } from './appointments-calendar';

type Props = {
  /** Week-range appointments, already filtered to the selected barbers. */
  appointments: CalendarAppointment[];
  /** The 7 shop-local ISO dates (Mon..Sun) to render, in order. */
  weekDays: string[];
  /** The currently-selected date — its column is highlighted as "current". */
  selectedIsoDate: string;
  barbers: BarberRow[];
  timezone: string;
  /** Shop-local ISO dates that are days off — rendered muted. */
  daysOff: string[];
  onApptClick: (a: CalendarAppointment) => void;
};

/**
 * Phase 5 — Appointments "Week" view. A 7-column grid (Mon..Sun for the week
 * containing the selected date). Each column lists that day's appointments
 * compactly, sorted chronologically. Presentational only: the parent owns
 * the single mounted `AppointmentDetailDrawer`; clicking a card calls back
 * through `onApptClick`. Honors the Barbers filter via the pre-filtered
 * `appointments` prop.
 */
export function AppointmentsWeekView({
  appointments,
  weekDays,
  selectedIsoDate,
  barbers,
  timezone,
  daysOff,
  onApptClick,
}: Props) {
  const t = useTranslations('pages.appointments');

  const barberName = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of barbers) m.set(b.id, b.display_name);
    return m;
  }, [barbers]);

  // Bucket appointments by their shop-local ISO day. The server already
  // sorts `start_at asc`, so each bucket stays chronological.
  const apptsByDay = useMemo(() => {
    const m = new Map<string, CalendarAppointment[]>();
    for (const a of appointments) {
      const key = shopIsoDate(new Date(a.start_at), timezone);
      const arr = m.get(key);
      if (arr) arr.push(a);
      else m.set(key, [a]);
    }
    return m;
  }, [appointments, timezone]);

  return (
    <div className="overflow-x-auto rounded-lg bg-bg-base shadow-sm">
      <div className="grid min-w-[840px] grid-cols-7 gap-px bg-border-faint">
        {weekDays.map((iso) => {
          const dayAppts = apptsByDay.get(iso) ?? [];
          const isCurrent = iso === selectedIsoDate;
          const isDayOff = daysOff.includes(iso);
          // Render the column header label from a noon-anchored Date so DST
          // edges never shift the weekday/number.
          const dayRef = new Date(`${iso}T12:00:00Z`);
          const weekdayLabel = formatShopTime(dayRef, timezone, 'EEE');
          const dayNumber = formatShopTime(dayRef, timezone, 'd');
          return (
            <div key={iso} className="flex min-w-[120px] flex-col bg-bg-base">
              {/* Column header — Mon 18 etc. The current day reads "lit up"
                  with an accent dot, matching the active-marker convention
                  used elsewhere (never just a text-color change). */}
              <div
                className={cn(
                  'flex h-12 items-center gap-2 border-b border-border-soft px-3',
                  isCurrent ? 'bg-bg-surface-2' : 'bg-bg-surface',
                )}
              >
                {isCurrent ? (
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full bg-accent shadow-accent-glow"
                    aria-hidden
                  />
                ) : null}
                <span
                  className={cn(
                    'text-xs font-semibold uppercase tracking-wide',
                    isCurrent ? 'text-text-primary' : 'text-text-muted',
                  )}
                >
                  {weekdayLabel}
                </span>
                <span
                  className={cn(
                    'font-mono text-sm tabular-nums',
                    isCurrent ? 'text-text-primary' : 'text-text-secondary',
                  )}
                >
                  {dayNumber}
                </span>
              </div>

              {/* Day column body — compact list of appointment cards. */}
              <div
                className={cn(
                  'flex min-h-[160px] flex-1 flex-col gap-1.5 p-2',
                  isDayOff && 'opacity-60',
                )}
              >
                {dayAppts.length === 0 ? (
                  <p className="px-1 pt-2 text-center text-[11px] text-text-muted">
                    {isDayOff ? t('week.dayOff') : t('week.empty')}
                  </p>
                ) : (
                  dayAppts.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => onApptClick(a)}
                      className={cn(
                        'group relative w-full overflow-hidden rounded-md border-l-4 px-2 py-1.5 text-left text-[11px] shadow-sm transition-all duration-150 ease-out-quint hover:-translate-y-0.5 hover:shadow-md',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                        statusToColor(a.status),
                      )}
                      title={`${a.client_name} — ${formatShopTime(a.start_at, timezone, 'HH:mm')}–${formatShopTime(a.end_at, timezone, 'HH:mm')}`}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <span className="truncate font-semibold text-text-primary">
                          {a.client_name}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] tabular-nums text-text-secondary">
                          {formatShopTime(a.start_at, timezone, 'HH:mm')}
                        </span>
                      </div>
                      {a.services.length > 0 ? (
                        <div className="truncate text-[10px] text-text-secondary">
                          {a.services.map((s) => s.name).join(' + ')}
                        </div>
                      ) : null}
                      <div className="mt-0.5 truncate text-[10px] text-text-muted">
                        {barberName.get(a.barber_id) ?? <EmptyCell />}
                      </div>
                      {a.source === 'online' ? (
                        <Badge variant="info" className="mt-0.5">
                          {t('online')}
                        </Badge>
                      ) : null}
                      <CreditCard
                        aria-hidden
                        className="absolute bottom-1 right-1 h-3 w-3 text-success"
                      />
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
