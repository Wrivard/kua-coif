'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Plus,
  XOctagon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { formatCurrencyCAD, cn } from '@/lib/utils';
import {
  addDays,
  combineShopDateTime,
  formatHeaderDate,
  formatShopTime,
  minutesFromShopMidnight,
  shopIsoDate,
} from '@/lib/business/timezone';
import type { BarberRow, ClientRow, ServiceCategoryRow, ServiceRow } from '@/db/rows';
import type { AppointmentStatus } from '@/db/enums';
import { AppointmentDetailDrawer } from './appointment-detail-drawer';
import { AppointmentFormModal } from './appointment-form-modal';
import { rescheduleAppointment } from './actions';

export type CalendarAppointment = {
  id: string;
  barber_id: string;
  client_id: string;
  client_name: string;
  start_at: string;
  end_at: string;
  status: AppointmentStatus;
  notes: string | null;
  source: 'admin' | 'online';
  total_amount: number;
  services: ServiceRow[];
};

type Hours = {
  weekday: number;
  enabled: boolean;
  open_time: string | null;
  close_time: string | null;
};

type Blocked = {
  id: string;
  barber_id: string | null;
  start_at: string;
  end_at: string;
  reason: string | null;
};

type Props = {
  locale: string;
  timezone: string;
  isoDate: string;
  barbers: BarberRow[];
  services: ServiceRow[];
  categories: ServiceCategoryRow[];
  clients: ClientRow[];
  hours: Hours[];
  daysOff: string[];
  appointments: CalendarAppointment[];
  blocked: Blocked[];
};

// Pixels per minute on the vertical axis. Tuned so a 30-min slot is comfortably clickable.
const PX_PER_MIN = 1.4;
// Default visible range when the shop is closed that day (so the grid still
// renders something useful).
const FALLBACK_START_MIN = 8 * 60;
const FALLBACK_END_MIN = 20 * 60;

function timeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const [hh, mm] = t.split(':').map((x) => Number(x));
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return (hh ?? 0) * 60 + (mm ?? 0);
}

function statusToColor(status: AppointmentStatus): string {
  switch (status) {
    case 'confirmed':
    case 'arrived':
    case 'completed':
      return 'bg-appt-green border-l-success';
    case 'booked':
      return 'bg-appt-blue border-l-info';
    case 'cancelled':
    case 'no_show':
      return 'bg-bg-surface-2 border-l-border opacity-60';
    default:
      return 'bg-appt-purple border-l-accent';
  }
}

type ModalState = { kind: 'closed' } | { kind: 'create'; barberId: string; minutes: number };

export function AppointmentsCalendar({
  locale,
  timezone,
  isoDate,
  barbers,
  services,
  categories,
  clients,
  hours,
  daysOff,
  appointments,
  blocked,
}: Props) {
  const t = useTranslations('pages.appointments');
  const router = useRouter();

  const today = useMemo(() => shopIsoDate(new Date(), timezone), [timezone]);
  const dayRef = useMemo(() => new Date(`${isoDate}T12:00:00Z`), [isoDate]);
  const weekday = useMemo(() => {
    // Shop-local weekday: derive from formatter (Sun=0 … Sat=6).
    const day = formatShopTime(dayRef, timezone, 'i'); // ISO weekday 1..7
    return Number(day) % 7;
  }, [dayRef, timezone]);

  const todayHours = hours.find((h) => h.weekday === weekday);
  const dayOpen = timeToMinutes(todayHours?.open_time) ?? FALLBACK_START_MIN;
  const dayClose = timeToMinutes(todayHours?.close_time) ?? FALLBACK_END_MIN;
  const isClosed = !todayHours?.enabled || daysOff.includes(isoDate);

  const dayRangeMin = isClosed ? FALLBACK_END_MIN - FALLBACK_START_MIN : dayClose - dayOpen;
  const startMin = isClosed ? FALLBACK_START_MIN : dayOpen;
  const endMin = isClosed ? FALLBACK_END_MIN : dayClose;
  const gridHeightPx = dayRangeMin * PX_PER_MIN;

  // Build hour rule labels.
  const hourLabels = useMemo(() => {
    const ticks: number[] = [];
    const startHour = Math.floor(startMin / 60);
    const endHour = Math.ceil(endMin / 60);
    for (let h = startHour; h <= endHour; h += 1) ticks.push(h * 60);
    return ticks;
  }, [startMin, endMin]);

  const [selectedBarbers, setSelectedBarbers] = useState<Set<string>>(
    () => new Set(barbers.map((b) => b.id)),
  );
  const [drawer, setDrawer] = useState<CalendarAppointment | null>(null);
  const [modal, setModal] = useState<ModalState>({ kind: 'closed' });
  // Brief "Updated" pill shown for ~1.5s whenever a Realtime event triggers a
  // refresh. Tells the user the view is fresh without being intrusive.
  const [justRefreshed, setJustRefreshed] = useState(false);

  // ── Phase 27 — drag-to-reschedule optimistic state ────────────────────
  // While a reschedule Server Action is in flight (and until realtime
  // delivers the new truth), keep the moved appointment at its dropped
  // position locally. Keyed by appointment id.
  type ApptOverride = { barber_id: string; start_at: string; end_at: string };
  const [overrides, setOverrides] = useState<Map<string, ApptOverride>>(new Map());
  const [, startTransition] = useTransition();
  const toast = useToast();
  const tReschedule = useTranslations('pages.appointments.reschedule');

  // Drop overrides whose truth has arrived (via realtime → router.refresh →
  // new `appointments` prop). Keeps the optimistic Map from growing without
  // bound. Read overrides via setter so this effect only depends on `appointments`.
  useEffect(() => {
    setOverrides((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Map(prev);
      for (const [id, o] of next) {
        const truth = appointments.find((a) => a.id === id);
        if (
          truth &&
          truth.barber_id === o.barber_id &&
          truth.start_at === o.start_at &&
          truth.end_at === o.end_at
        ) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [appointments]);

  // ── Memoized derivations ──────────────────────────────────────────────
  // The calendar re-renders on every parent state change (modal/drawer
  // toggles, filter chips, react-query refetches). Without memoization, the
  // following derivations recompute O(barbers × appointments) per render —
  // measurable lag once the shop reaches ~20 barbers / hundreds of appts.
  const visibleBarbers = useMemo(
    () => barbers.filter((b) => selectedBarbers.has(b.id)),
    [barbers, selectedBarbers],
  );

  // Apply optimistic overrides on top of the server-provided list, then
  // bucket by barber. `effectiveAppointments` is the source of truth the
  // grid renders against.
  const effectiveAppointments = useMemo(() => {
    if (overrides.size === 0) return appointments;
    return appointments.map((a) => {
      const o = overrides.get(a.id);
      return o ? { ...a, barber_id: o.barber_id, start_at: o.start_at, end_at: o.end_at } : a;
    });
  }, [appointments, overrides]);

  // Pre-bucket appointments by barber so each column render is an O(1) lookup
  // instead of an O(appointments) scan.
  const apptsByBarber = useMemo(() => {
    const m = new Map<string, CalendarAppointment[]>();
    for (const a of effectiveAppointments) {
      const arr = m.get(a.barber_id);
      if (arr) arr.push(a);
      else m.set(a.barber_id, [a]);
    }
    return m;
  }, [effectiveAppointments]);

  // Same bucketing for blocked-time, with shop-wide blocks (barber_id = null)
  // denormalized into every barber's bucket so the render path is uniform.
  const blocksByBarber = useMemo(() => {
    const m = new Map<string, Blocked[]>();
    const shopWide: Blocked[] = [];
    for (const b of blocked) {
      if (b.barber_id === null) shopWide.push(b);
    }
    for (const barber of barbers) {
      // Seed each barber's bucket with the shop-wide blocks so the loop in
      // render doesn't have to merge two arrays.
      m.set(barber.id, shopWide.length > 0 ? [...shopWide] : []);
    }
    for (const b of blocked) {
      if (b.barber_id !== null) {
        const arr = m.get(b.barber_id);
        if (arr) arr.push(b);
        else m.set(b.barber_id, [b]);
      }
    }
    return m;
  }, [barbers, blocked]);

  // ── Phase 26 — Supabase Realtime ──────────────────────────────────────
  // Subscribe to INSERT/UPDATE/DELETE on `appointments` and `blocked_time`
  // scoped to the current shop. On any event, call `router.refresh()` which
  // re-runs the Server Component (Promise.all of ~9 queries, ~200ms) and
  // pushes fresh data into this client component.
  //
  // Why refresh instead of patching local state:
  //  - appointments carry joined rows (services, client name) — re-deriving
  //    them client-side would mean duplicating the SQL view logic. Refresh
  //    keeps a single source of truth on the server.
  //  - 200ms is invisible at the cadence calendar mutations actually happen
  //    (a few times per minute on a busy shop).
  //
  // Subscriptions require the tables to be in the `supabase_realtime`
  // publication — added in migration 20260525114840_realtime_calendar.sql.
  // RLS still applies: the browser's anon JWT must satisfy the same
  // `is_shop_member()` policy as a normal SELECT.
  useEffect(() => {
    const shopId = barbers[0]?.shop_id;
    if (!shopId) return;
    const supabase = createSupabaseBrowserClient();
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    const onChange = () => {
      router.refresh();
      setJustRefreshed(true);
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => setJustRefreshed(false), 1500);
    };
    const channel = supabase
      .channel(`calendar:${shopId}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'appointments', filter: `shop_id=eq.${shopId}` },
        onChange,
      )
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'blocked_time', filter: `shop_id=eq.${shopId}` },
        onChange,
      )
      .subscribe();
    return () => {
      if (hideTimer) clearTimeout(hideTimer);
      void supabase.removeChannel(channel);
    };
  }, [barbers, router]);

  // ── Phase 27 — DnD plumbing ───────────────────────────────────────────
  // PointerSensor with a small activation distance: clicks (open detail
  // drawer) keep working as long as the user doesn't drag more than 6px.
  // 6px is below dnd-kit's default 8 but tuned for the dense grid where
  // 8px = 5+ minutes of vertical movement and felt sticky.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over, delta } = event;
      // active.id is the appointment's UUID (matches `useDraggable({ id: appointment.id })`).
      const appt = effectiveAppointments.find((a) => a.id === String(active.id));
      if (!appt) return;
      // Don't allow moving terminal-status appointments.
      if (appt.status === 'cancelled' || appt.status === 'no_show') return;

      // Target barber: if dropped over a column, use that column's data;
      // otherwise stay in the original column (vertical-only drag).
      const overData = over?.data?.current as { barberId?: string } | undefined;
      const newBarberId = overData?.barberId ?? appt.barber_id;

      // Compute the new shop-local minute: old minute + Δy converted to
      // minutes, snapped to 5-min increments (matches `onSlotClick` snap).
      const oldMinute = minutesFromShopMidnight(appt.start_at, timezone);
      const deltaMin = Math.round(delta.y / PX_PER_MIN / 5) * 5;
      const newMinute = oldMinute + deltaMin;

      // No-op drag (click without actual movement) — bail out without
      // hitting the server.
      if (deltaMin === 0 && newBarberId === appt.barber_id) return;

      // Clamp to [0, 23:59] so we never compose an invalid time string.
      const safeMinute = Math.max(0, Math.min(24 * 60 - 1, newMinute));
      const hh = String(Math.floor(safeMinute / 60)).padStart(2, '0');
      const mm = String(safeMinute % 60).padStart(2, '0');

      // Reuse the appointment's shop-date — we never cross days from the
      // side-by-side view. Drag spans day boundaries only when a future
      // Week-view drag is added.
      const shopDate = shopIsoDate(new Date(appt.start_at), timezone);
      let newStartUtc: Date;
      try {
        newStartUtc = combineShopDateTime(shopDate, `${hh}:${mm}`, timezone);
      } catch {
        return;
      }
      const durationMs = new Date(appt.end_at).getTime() - new Date(appt.start_at).getTime();
      const newEndUtc = new Date(newStartUtc.getTime() + durationMs);

      const override: ApptOverride = {
        barber_id: newBarberId,
        start_at: newStartUtc.toISOString(),
        end_at: newEndUtc.toISOString(),
      };
      // Set optimistic state immediately so the block jumps to its new
      // position without waiting for the round-trip.
      setOverrides((prev) => new Map(prev).set(appt.id, override));

      startTransition(async () => {
        const result = await rescheduleAppointment({
          id: appt.id,
          barber_id: newBarberId,
          start_at: newStartUtc.toISOString(),
        });
        if (!result.ok) {
          // Revert optimistic override so the block snaps back to its
          // original position.
          setOverrides((prev) => {
            const next = new Map(prev);
            next.delete(appt.id);
            return next;
          });
          const code = result.errorCode;
          // CONFLICT → narrow message ("collision avec un autre RDV"),
          // everything else → generic failure.
          toast.show({
            variant: code === 'CONFLICT' ? 'warning' : 'danger',
            title: tReschedule('failedTitle'),
            description:
              code === 'CONFLICT'
                ? tReschedule('conflict')
                : code === 'INVALID_INPUT'
                  ? tReschedule('invalid')
                  : tReschedule('unexpected'),
          });
        }
        // Success path: leave the override in place. The realtime refresh
        // (Phase 26) will deliver the new truth via props and the
        // useEffect above prunes the now-redundant override.
      });
    },
    [effectiveAppointments, timezone, toast, tReschedule],
  );

  const shiftDate = useCallback(
    (deltaDays: number) => {
      const next = shopIsoDate(addDays(dayRef, deltaDays), timezone);
      const url = new URL(window.location.href);
      url.searchParams.set('date', next);
      router.push(url.pathname + '?' + url.searchParams.toString());
    },
    [dayRef, timezone, router],
  );
  const jumpToday = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('date', today);
    router.push(url.pathname + '?' + url.searchParams.toString());
  }, [router, today]);

  const onSlotClick = useCallback(
    (barberId: string, e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const offsetPx = e.clientY - rect.top;
      const minuteOffset = Math.floor(offsetPx / PX_PER_MIN / 5) * 5; // snap to 5min
      setModal({ kind: 'create', barberId, minutes: startMin + minuteOffset });
    },
    [startMin],
  );

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={formatHeaderDate(dayRef, locale === 'fr' ? 'fr' : 'en', timezone)}
        center={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => shiftDate(-1)}
              aria-label={t('prevDay')}
              className="rounded p-1.5 text-text-muted transition-colors hover:bg-bg-surface-2 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <Button variant="secondary" size="sm" onClick={jumpToday}>
              <CalendarIcon className="h-4 w-4" /> {t('today')}
            </Button>
            <button
              type="button"
              onClick={() => shiftDate(1)}
              aria-label={t('nextDay')}
              className="rounded p-1.5 text-text-muted transition-colors hover:bg-bg-surface-2 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            {/* Phase 26 — Realtime refresh indicator. CSS-only fade keeps it
                from stealing focus; aria-live='polite' announces to screen
                readers without interrupting. */}
            <span
              aria-live="polite"
              className={cn(
                'border-success/30 bg-success/10 inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium text-success transition-opacity duration-300',
                justRefreshed ? 'opacity-100' : 'pointer-events-none opacity-0',
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              {t('liveUpdate')}
            </span>
          </div>
        }
        actions={
          <Button
            onClick={() =>
              setModal({ kind: 'create', barberId: visibleBarbers[0]?.id ?? '', minutes: startMin })
            }
            size="sm"
          >
            <Plus className="h-4 w-4" /> {t('addAppointment')}
          </Button>
        }
      />

      <div className="space-y-4 p-6">
        {/* Barber filter chips */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            {t('filterBarbers')}
          </span>
          {barbers.map((b) => {
            const isActive = selectedBarbers.has(b.id);
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => {
                  setSelectedBarbers((prev) => {
                    const next = new Set(prev);
                    if (next.has(b.id)) next.delete(b.id);
                    else next.add(b.id);
                    return next;
                  });
                }}
                aria-pressed={isActive}
                className={cn(
                  'inline-flex h-7 items-center gap-1 rounded-full px-3 text-xs font-medium transition-colors',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base',
                  isActive
                    ? 'bg-accent text-accent-fg'
                    : 'border border-border text-text-secondary hover:bg-bg-surface-2 hover:text-text-primary',
                )}
              >
                {b.display_name}
              </button>
            );
          })}
        </div>

        {isClosed && (
          <div className="border-warning/40 bg-warning/10 rounded border px-3 py-2 text-xs text-warning">
            {t('shopClosedDay')}
          </div>
        )}

        {/* Calendar grid — Phase 27 wraps in DndContext so each appointment
            block (useDraggable) can be dropped on any barber column
            (useDroppable). DragEnd handler computes the new (barber, time)
            and fires the rescheduleAppointment Server Action. */}
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="overflow-x-auto rounded border border-border bg-bg-surface">
            <div className="flex min-w-[600px]">
              {/* Time axis */}
              <div className="w-14 shrink-0 border-r border-border">
                <div className="h-10 border-b border-border" />
                <div className="relative" style={{ height: `${gridHeightPx}px` }}>
                  {hourLabels.map((min) => {
                    if (min < startMin || min > endMin) return null;
                    const top = (min - startMin) * PX_PER_MIN;
                    return (
                      <div
                        key={min}
                        className="absolute right-2 -translate-y-2 text-[11px] text-text-muted"
                        style={{ top: `${top}px` }}
                      >
                        {formatHourLabel(min, locale === 'fr' ? 'fr' : 'en')}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Barber columns */}
              {visibleBarbers.map((barber) => (
                <BarberColumn
                  key={barber.id}
                  barber={barber}
                  barberAppts={apptsByBarber.get(barber.id) ?? []}
                  barberBlocks={blocksByBarber.get(barber.id) ?? []}
                  timezone={timezone}
                  startMin={startMin}
                  endMin={endMin}
                  gridHeightPx={gridHeightPx}
                  hourLabels={hourLabels}
                  onSlotClick={onSlotClick}
                  onApptClick={(a) => setDrawer(a)}
                  t={t}
                />
              ))}

              {visibleBarbers.length === 0 ? (
                <div className="flex flex-1 items-center justify-center p-12 text-sm text-text-muted">
                  {t('noBarbersSelected')}
                </div>
              ) : null}
            </div>
          </div>
        </DndContext>
      </div>

      <AppointmentDetailDrawer
        appointment={drawer}
        timezone={timezone}
        onClose={() => setDrawer(null)}
        formatAmount={(n) => formatCurrencyCAD(n, locale === 'fr' ? 'fr' : 'en')}
      />

      {modal.kind === 'create' && (
        <AppointmentFormModal
          mode={modal}
          isoDate={isoDate}
          barbers={visibleBarbers.length > 0 ? visibleBarbers : barbers}
          services={services}
          categories={categories}
          clients={clients}
          onClose={() => setModal({ kind: 'closed' })}
        />
      )}
    </>
  );
}

function formatHourLabel(minute: number, locale: 'fr' | 'en'): string {
  const h = Math.floor(minute / 60);
  if (locale === 'fr') return `${h}h`;
  const period = h < 12 ? 'a' : 'p';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}${period}`;
}

// ── Phase 27 — DnD sub-components ─────────────────────────────────────────
// Each barber column is a drop target; each appointment block is a drag
// source. Extracted so we can call useDroppable / useDraggable per item
// (hooks can't be called inside a map). Receives all rendering inputs as
// props — these are stateless except for the local DnD state from the
// hook itself.

type TFn = (key: string) => string;

type BarberColumnProps = {
  barber: BarberRow;
  barberAppts: CalendarAppointment[];
  barberBlocks: Array<{
    id: string;
    barber_id: string | null;
    start_at: string;
    end_at: string;
    reason: string | null;
  }>;
  timezone: string;
  startMin: number;
  endMin: number;
  gridHeightPx: number;
  hourLabels: number[];
  onSlotClick: (barberId: string, e: React.MouseEvent<HTMLDivElement>) => void;
  onApptClick: (a: CalendarAppointment) => void;
  t: TFn;
};

function BarberColumn({
  barber,
  barberAppts,
  barberBlocks,
  timezone,
  startMin,
  endMin,
  gridHeightPx,
  hourLabels,
  onSlotClick,
  onApptClick,
  t,
}: BarberColumnProps) {
  // The droppable id namespacing keeps barber-column drops from colliding
  // with future droppables (e.g. a trash zone for delete-on-drag).
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${barber.id}`,
    data: { barberId: barber.id },
  });
  return (
    <div className="min-w-[180px] flex-1 border-r border-border last:border-r-0">
      <div className="flex h-10 items-center gap-2 border-b border-border bg-bg-surface px-3">
        <span className="inline-block h-2 w-2 rounded-full bg-accent" aria-hidden />
        <span className="truncate text-sm font-semibold">{barber.display_name}</span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          'relative cursor-cell bg-bg-base transition-colors',
          // Subtle accent tint when a draggable is hovering this column —
          // tells the user "drop here goes to {barber}".
          isOver && 'bg-accent-subtle',
        )}
        style={{ height: `${gridHeightPx}px` }}
        onClick={(e) => onSlotClick(barber.id, e)}
      >
        {/* Hour rules (every hour) */}
        {hourLabels.map((min) => {
          if (min < startMin || min > endMin) return null;
          const top = (min - startMin) * PX_PER_MIN;
          return (
            <div
              key={min}
              className="border-border/60 absolute left-0 right-0 border-t"
              style={{ top: `${top}px` }}
              aria-hidden
            />
          );
        })}

        {/* Blocked time overlays */}
        {barberBlocks.map((b) => {
          const top = (minutesFromShopMidnight(b.start_at, timezone) - startMin) * PX_PER_MIN;
          const height =
            (minutesFromShopMidnight(b.end_at, timezone) -
              minutesFromShopMidnight(b.start_at, timezone)) *
            PX_PER_MIN;
          return (
            <div
              key={b.id}
              className="bg-danger/10 absolute left-1 right-1 flex items-center justify-center rounded-sm text-[11px] font-medium text-danger"
              style={{ top: `${top}px`, height: `${height}px` }}
              onClick={(e) => e.stopPropagation()}
            >
              <XOctagon className="mr-1 h-3 w-3" /> {b.reason ?? t('blocked')}
            </div>
          );
        })}

        {/* Appointment blocks */}
        {barberAppts.map((a) => {
          const top = (minutesFromShopMidnight(a.start_at, timezone) - startMin) * PX_PER_MIN;
          const height =
            (minutesFromShopMidnight(a.end_at, timezone) -
              minutesFromShopMidnight(a.start_at, timezone)) *
            PX_PER_MIN;
          return (
            <DraggableAppointmentBlock
              key={a.id}
              appointment={a}
              top={top}
              height={height}
              timezone={timezone}
              onClick={onApptClick}
              t={t}
            />
          );
        })}
      </div>
    </div>
  );
}

type DraggableAppointmentBlockProps = {
  appointment: CalendarAppointment;
  top: number;
  height: number;
  timezone: string;
  onClick: (a: CalendarAppointment) => void;
  t: TFn;
};

function DraggableAppointmentBlock({
  appointment,
  top,
  height,
  timezone,
  onClick,
  t,
}: DraggableAppointmentBlockProps) {
  const isTerminal = appointment.status === 'cancelled' || appointment.status === 'no_show';
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: appointment.id,
    data: { appointment },
    // Terminal-status appointments are historical — disable drag (the
    // server would reject it anyway, but disabling locally avoids the
    // visual feedback of dragging something that can't move).
    disabled: isTerminal,
  });
  const cls = statusToColor(appointment.status);
  const style: React.CSSProperties = {
    top: `${top}px`,
    height: `${height}px`,
    transform: CSS.Translate.toString(transform),
    zIndex: isDragging ? 30 : undefined,
    opacity: isDragging ? 0.9 : undefined,
    cursor: isTerminal ? 'default' : isDragging ? 'grabbing' : 'grab',
  };
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        // Suppress the click that fires at the end of a drag sequence —
        // dnd-kit already cancels click for actual drags via
        // activationConstraint.distance, but a defensive no-op keeps the
        // drawer from popping if React quirks slip a click through.
        if (isDragging) return;
        onClick(appointment);
      }}
      className={cn(
        'absolute left-1 right-1 overflow-hidden rounded-sm border-l-4 px-2 py-1 text-left text-[11px] transition-shadow hover:opacity-90',
        isDragging && 'shadow-lg ring-2 ring-accent',
        cls,
      )}
      style={style}
      title={`${appointment.client_name} — ${formatShopTime(appointment.start_at, timezone, 'HH:mm')}–${formatShopTime(appointment.end_at, timezone, 'HH:mm')}`}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="truncate font-semibold text-text-primary">{appointment.client_name}</span>
        <span className="shrink-0 text-[10px] text-text-secondary">
          {formatShopTime(appointment.start_at, timezone, 'HH:mm')}
        </span>
      </div>
      <div className="truncate text-[10px] text-text-secondary">
        {appointment.services.map((s) => s.name).join(' + ')}
      </div>
      {appointment.source === 'online' ? (
        <Badge variant="accent" className="mt-0.5">
          {t('online')}
        </Badge>
      ) : null}
      <CreditCard aria-hidden className="absolute bottom-1 right-1 h-3 w-3 text-success" />
    </button>
  );
}
