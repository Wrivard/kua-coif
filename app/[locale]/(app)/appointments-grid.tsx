'use client';

import { memo, type CSSProperties, type MouseEvent } from 'react';
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
import { CreditCard, XOctagon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatShopTime, minutesFromShopMidnight } from '@/lib/business/timezone';
import type { BarberRow } from '@/db/rows';
import { statusToColor, PX_PER_MIN, type CalendarAppointment } from './appointments-calendar';

type TFn = (key: string) => string;

// Hour-axis label — French 24h ("10 h"), English 12h ("2 PM"). More legible
// than the compact "10a"/"2p" at the 11px time-axis font size.
function formatHourLabel(minute: number, locale: 'fr' | 'en'): string {
  const h = Math.floor(minute / 60);
  if (locale === 'fr') return `${h} h`;
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12} ${period}`;
}

// ── Side-by-Side drag grid ────────────────────────────────────────────────
// This whole layer (DndContext + sensors + droppable columns + draggable
// blocks) lives in a dynamically-imported module so the @dnd-kit runtime
// stays OFF the home route's ("/") initial bundle. appointments-calendar.tsx
// lazy-loads it (ssr:false) behind a grid skeleton; the drag logic itself
// (handleDragEnd, which owns the optimistic-override state) stays in the
// calendar and is passed in via onDragEnd.

type AppointmentsGridProps = {
  visibleBarbers: BarberRow[];
  apptsByBarber: Map<string, CalendarAppointment[]>;
  apptLayout: Map<string, { top: number; height: number }>;
  blocksByBarber: Map<
    string,
    Array<{
      id: string;
      barber_id: string | null;
      start_at: string;
      end_at: string;
      reason: string | null;
    }>
  >;
  googleBusyByBarber: Map<string, Array<{ start: string; end: string }>>;
  timezone: string;
  startMin: number;
  endMin: number;
  gridHeightPx: number;
  hourLabels: number[];
  nowMin: number | null;
  locale: string;
  onSlotClick: (barberId: string, e: MouseEvent<HTMLDivElement>) => void;
  onApptClick: (a: CalendarAppointment) => void;
  onDragEnd: (event: DragEndEvent) => void;
  t: TFn;
};

export function AppointmentsGrid({
  visibleBarbers,
  apptsByBarber,
  apptLayout,
  blocksByBarber,
  googleBusyByBarber,
  timezone,
  startMin,
  endMin,
  gridHeightPx,
  hourLabels,
  nowMin,
  locale,
  onSlotClick,
  onApptClick,
  onDragEnd,
  t,
}: AppointmentsGridProps) {
  // PointerSensor with a small activation distance: clicks (open detail
  // drawer) keep working as long as the user doesn't drag more than 6px.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="overflow-x-auto rounded-lg bg-bg-base shadow-warm-sm">
        <div className="flex min-w-[600px]">
          {/* Time axis — labels centered on the hour line (-translate-y-1/2). */}
          <div className="w-16 shrink-0 border-r border-border-soft bg-bg-base">
            <div className="h-12 border-b border-border-soft" />
            <div className="relative" style={{ height: `${gridHeightPx}px` }}>
              {hourLabels.map((min) => {
                if (min < startMin || min > endMin) return null;
                const top = (min - startMin) * PX_PER_MIN;
                return (
                  <div
                    key={min}
                    className="absolute right-3 -translate-y-1/2 font-mono text-[10px] font-medium uppercase tabular-nums tracking-wider text-text-muted"
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
              apptLayout={apptLayout}
              barberBlocks={blocksByBarber.get(barber.id) ?? []}
              googleBusy={googleBusyByBarber.get(barber.id) ?? []}
              timezone={timezone}
              startMin={startMin}
              endMin={endMin}
              gridHeightPx={gridHeightPx}
              hourLabels={hourLabels}
              nowMin={nowMin}
              onSlotClick={onSlotClick}
              onApptClick={onApptClick}
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
  );
}

type BarberColumnProps = {
  barber: BarberRow;
  barberAppts: CalendarAppointment[];
  /** Precomputed pixel geometry per appointment id (lifted out of render). */
  apptLayout: Map<string, { top: number; height: number }>;
  barberBlocks: Array<{
    id: string;
    barber_id: string | null;
    start_at: string;
    end_at: string;
    reason: string | null;
  }>;
  /** Phase 34 — busy windows pulled from the barber's connected Google. */
  googleBusy: Array<{ start: string; end: string }>;
  timezone: string;
  startMin: number;
  endMin: number;
  gridHeightPx: number;
  hourLabels: number[];
  /** Current time in minutes-from-shop-midnight when viewing today, else null. */
  nowMin: number | null;
  onSlotClick: (barberId: string, e: MouseEvent<HTMLDivElement>) => void;
  onApptClick: (a: CalendarAppointment) => void;
  t: TFn;
};

function BarberColumn({
  barber,
  barberAppts,
  apptLayout,
  barberBlocks,
  googleBusy,
  timezone,
  startMin,
  endMin,
  gridHeightPx,
  hourLabels,
  nowMin,
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
  // Show the "now" line only when it's actually inside the visible window
  // — otherwise it'd dangle off-screen and confuse depth perception.
  const showNow = nowMin !== null && nowMin >= startMin && nowMin <= endMin;
  return (
    <div className="min-w-[180px] flex-1 border-r border-border-faint last:border-r-0">
      {/* Header — solid bg-bg-surface-2 carries the divider from the body.
          Refonte (5b): the lane reads as a PERSON's column — an accent-tinted
          initials avatar + name + a mono count chip showing the day's load. */}
      <div className="flex h-12 items-center gap-2.5 border-b border-border-soft bg-bg-surface-2 px-3">
        <span
          aria-hidden
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-[10px] font-semibold text-accent-text"
        >
          {barber.display_name
            .split(' ')
            .map((w) => w[0])
            .slice(0, 2)
            .join('')
            .toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">
          {barber.display_name}
        </span>
        {barberAppts.length > 0 ? (
          <span className="shrink-0 rounded-full bg-bg-surface px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-text-secondary">
            {barberAppts.length}
          </span>
        ) : null}
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          'relative cursor-cell bg-bg-base transition-colors duration-150 ease-out-quint',
          // Subtle accent tint when a draggable is hovering this column —
          // tells the user "drop here goes to {barber}".
          isOver && 'bg-accent-subtle',
        )}
        style={{ height: `${gridHeightPx}px` }}
        onClick={(e) => onSlotClick(barber.id, e)}
      >
        {/* Hour rules — Phase 48: dropped to /8 opacity. At full grid
            height these lines were drawing visible white strokes even
            at /20. The hour rhythm is now barely perceptible — the
            left-rail labels carry the temporal cues; the rules just
            anchor the eye to a row. Removed alternating bands in Phase
            33; not bringing them back. */}
        {hourLabels.map((min) => {
          if (min < startMin || min > endMin) return null;
          const top = (min - startMin) * PX_PER_MIN;
          return (
            <div
              key={min}
              className="absolute left-0 right-0 border-t border-border-faint"
              style={{ top: `${top}px` }}
              aria-hidden
            />
          );
        })}

        {/* "Now" indicator — accent-colored line + dot on the left edge.
            Phase 48: dot is slightly larger (h-2.5 w-2.5) with a softer
            shadow halo for premium visibility. The horizontal line keeps
            its full accent color so it punches through the now-softer
            grid behind it. Sits above the hour rules (z-10). */}
        {showNow ? (
          <div
            className="pointer-events-none absolute left-0 right-0 z-10"
            style={{ top: `${(nowMin! - startMin) * PX_PER_MIN}px` }}
            aria-hidden
          >
            <div className="absolute -left-1.5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-accent shadow-accent-glow" />
            <div className="border-t border-accent-ring" />
          </div>
        ) : null}

        {/* Blocked time overlays — Phase 48: rounded-md (was rounded-sm)
            and slightly thicker left margins for clearer separation from
            the column edges. Still uses danger color tone since these
            are owner-enforced "do not book". */}
        {barberBlocks.map((b) => {
          const top = (minutesFromShopMidnight(b.start_at, timezone) - startMin) * PX_PER_MIN;
          const height =
            (minutesFromShopMidnight(b.end_at, timezone) -
              minutesFromShopMidnight(b.start_at, timezone)) *
            PX_PER_MIN;
          return (
            <div
              key={b.id}
              className="border-danger/20 bg-danger/10 absolute left-1.5 right-1.5 flex items-center justify-center rounded-md border text-[11px] font-medium text-danger"
              style={{ top: `${top}px`, height: `${height}px` }}
              onClick={(e) => e.stopPropagation()}
            >
              <XOctagon className="mr-1 h-3 w-3" /> {b.reason ?? t('blocked')}
            </div>
          );
        })}

        {/* Google Calendar busy overlays (Phase 34). Distinct visual from
            blocked-time: muted gray with diagonal striping suggests
            "personal, not shop-controlled." Non-interactive — clicking
            stops propagation so the slot-create flow doesn't fire. */}
        {googleBusy.map((g, idx) => {
          const top = (minutesFromShopMidnight(g.start, timezone) - startMin) * PX_PER_MIN;
          const height =
            (minutesFromShopMidnight(g.end, timezone) -
              minutesFromShopMidnight(g.start, timezone)) *
            PX_PER_MIN;
          if (height <= 0) return null;
          return (
            <div
              key={`gbusy-${idx}-${g.start}`}
              className="bg-bg-surface-2/60 absolute left-1.5 right-1.5 flex items-center justify-center rounded-md border border-border-soft text-[10px] font-medium uppercase tracking-wide text-text-muted"
              style={{
                top: `${top}px`,
                height: `${height}px`,
                backgroundImage:
                  'repeating-linear-gradient(45deg, transparent, transparent 6px, var(--dot-grid) 6px, var(--dot-grid) 12px)',
              }}
              onClick={(e) => e.stopPropagation()}
              title={t('googlePersonalBusy')}
            >
              {t('googlePersonalBusy')}
            </div>
          );
        })}

        {/* Appointment blocks */}
        {barberAppts.map((a) => {
          const layout = apptLayout.get(a.id);
          if (!layout) return null;
          const { top, height } = layout;
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

const DraggableAppointmentBlock = memo(function DraggableAppointmentBlock({
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
  const style: CSSProperties = {
    top: `${top}px`,
    height: `${height}px`,
    transform: CSS.Translate.toString(transform),
    zIndex: isDragging ? 30 : undefined,
    opacity: isDragging ? 0.9 : undefined,
    cursor: isTerminal ? 'default' : isDragging ? 'grabbing' : 'grab',
  };
  // Completed/cancelled read as inactive via MUTED TEXT (not block-wide
  // opacity, which crushed contrast below AA); cancelled also gets a strike.
  const dimmed = appointment.status === 'completed' || appointment.status === 'cancelled';
  const struck = appointment.status === 'cancelled';
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
        // Phase 48 — rounded-md (was rounded-sm), wider margin (left-1.5)
        // to match the new blocked/Google overlay spacing, shadow-sm
        // for elevation off the now-flatter grid. Hover lifts the
        // shadow to shadow-md so the block reads as "clickable card".
        'absolute left-1.5 right-1.5 overflow-hidden rounded-md border-l-4 px-2 py-1 text-left text-[11px] shadow-warm-sm transition-all duration-150 ease-out-quint hover:-translate-y-0.5 hover:shadow-warm-md focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus',
        isDragging && 'shadow-warm-lg ring-2 ring-accent',
        cls,
      )}
      style={style}
      title={`${appointment.client_name}, ${formatShopTime(appointment.start_at, timezone, 'HH:mm')}–${formatShopTime(appointment.end_at, timezone, 'HH:mm')}`}
    >
      <div className="flex items-start justify-between gap-1">
        <span
          className={cn(
            'truncate text-[13px] font-semibold leading-tight',
            dimmed ? 'text-text-muted' : 'text-text-primary',
            struck && 'line-through',
          )}
        >
          {appointment.client_name}
        </span>
        {/* Loop 37 (P114) — block timestamp in mono for column-aligned
            readability across the day's appointments. */}
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-text-secondary">
          {formatShopTime(appointment.start_at, timezone, 'HH:mm')}
        </span>
      </div>
      <div
        className={cn('truncate text-[10px]', dimmed ? 'text-text-muted' : 'text-text-secondary')}
      >
        {appointment.services.map((s) => s.name).join(' + ')}
      </div>
      {appointment.source === 'online' ? (
        <Badge variant="info" className="mt-0.5">
          {t('online')}
        </Badge>
      ) : null}
      <CreditCard aria-hidden className="absolute bottom-1 right-1 h-3 w-3 text-success" />
    </button>
  );
});
