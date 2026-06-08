'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import type { DragEndEvent } from '@dnd-kit/core';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Lock,
  Plus,
  Trash2,
  XOctagon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Tabs } from '@/components/ui/tabs';
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
import { bulkCancelAppointments, rescheduleAppointment } from './actions';
import { OnboardingCard } from '@/components/features/shell/onboarding-card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

// Heavy children — code-split out of the initial calendar bundle. They only
// mount when the user opens a drawer (clicks a block) or a modal (clicks
// "Add appointment" / empty slot). Until then the JS doesn't ship.
// ssr:false avoids the initial server-render of an empty modal/drawer
// (they're behind state gates anyway).
const AppointmentDetailDrawer = dynamic(
  () => import('./appointment-detail-drawer').then((m) => ({ default: m.AppointmentDetailDrawer })),
  { ssr: false },
);
const AppointmentFormModal = dynamic(
  () => import('./appointment-form-modal').then((m) => ({ default: m.AppointmentFormModal })),
  { ssr: false },
);
const BlockTimeFormModal = dynamic(
  () => import('./block-time-form-modal').then((m) => ({ default: m.BlockTimeFormModal })),
  { ssr: false },
);
// Week + List views: code-split out of the side-by-side default bundle so
// the home route ("/") doesn't ship all three view renderers. Unlike the
// drawer/modals above, these CAN be the initial server-rendered view (via
// ?view=week|list), so keep default SSR (no ssr:false) to avoid a hydration
// flash on a direct link — they still load as separate chunks only when
// their view is active.
const AppointmentsWeekView = dynamic(() =>
  import('./appointments-week-view').then((m) => ({ default: m.AppointmentsWeekView })),
);
const AppointmentsListView = dynamic(() =>
  import('./appointments-list-view').then((m) => ({ default: m.AppointmentsListView })),
);
// Side-by-Side drag grid — lazy (ssr:false) so the @dnd-kit runtime stays off
// the home route's initial bundle. It's the default view, but drag is a
// client-only power feature; a grid skeleton holds the layout while the chunk
// loads (near-instant on warm cache, a brief skeleton on a cold first login).
const AppointmentsGrid = dynamic(
  () => import('./appointments-grid').then((m) => ({ default: m.AppointmentsGrid })),
  { ssr: false, loading: () => <GridSkeleton /> },
);

function GridSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg bg-bg-base shadow-warm-sm">
      <div className="flex min-w-[600px]">
        <div className="w-16 shrink-0 border-r border-border-soft">
          <div className="h-12 border-b border-border-soft" />
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="min-w-[180px] flex-1 border-r border-border-faint last:border-r-0"
          >
            <div className="flex h-12 items-center gap-2.5 border-b border-border-soft bg-bg-surface-2 px-3">
              <div className="h-6 w-6 shrink-0 animate-pulse rounded-full bg-border" />
              <div className="h-3 w-20 animate-pulse rounded bg-border" />
            </div>
            <div className="h-[420px] bg-bg-base" />
          </div>
        ))}
      </div>
    </div>
  );
}

export type CalendarView = 'side-by-side' | 'week' | 'list';

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
  // Loop 25 — surfaced so the detail drawer can show "Cancel" vs
  // "Cancel & refund" based on whether the appointment was paid.
  payment_status?: 'unpaid' | 'pending' | 'paid' | 'refunded' | 'failed';
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

type GoogleBusyPerBarber = {
  barberId: string;
  periods: Array<{ start: string; end: string }>;
};

type Props = {
  locale: string;
  /** owner/manager may move money (issue refunds); strict barbers may not. */
  canManageMoney: boolean;
  timezone: string;
  isoDate: string;
  /**
   * Phase 5 — seed view from the server (`?view=`). Defaults to
   * Side-by-Side. The toggle below keeps `view` in local state; both
   * views render against the same day-scoped dataset, so switching
   * never triggers a refetch.
   */
  initialView?: CalendarView;
  barbers: BarberRow[];
  services: ServiceRow[];
  categories: ServiceCategoryRow[];
  clients: ClientRow[];
  hours: Hours[];
  daysOff: string[];
  appointments: CalendarAppointment[];
  /**
   * Week view dataset — the full Mon..Sun range containing `isoDate`.
   * Empty unless `initialView === 'week'` (the server only pays for the
   * extra fetch when the week view is actually requested). Side-by-Side
   * and List always render against the day-scoped `appointments`.
   */
  weekAppointments?: CalendarAppointment[];
  /** The 7 shop-local ISO dates (Mon..Sun) that the week grid renders. */
  weekDays?: string[];
  blocked: Blocked[];
  /**
   * Phase 34 — per-barber personal busy periods pulled from their
   * connected Google Calendar. Rendered as a muted overlay distinct
   * from shop-side blocked time. Empty when Google isn't configured
   * or no barber has connected.
   */
  googleBusy?: GoogleBusyPerBarber[];
  /**
   * Phase 45 — onboarding completion signals. When omitted or all
   * fields are "done", the OnboardingCard auto-hides.
   */
  onboarding?: {
    shopAddressFilled: boolean;
    hoursConfigured: boolean;
    servicesCount: number;
    barbersCount: number;
  };
};

// Pixels per minute on the vertical axis. 1.8 gives a 30-min slot ~54px
// of vertical space — matches the breathing room of the Squire-style
// reference calendar without making a 12-hour day require excessive
// scrolling (~648px of grid + 48px header = ~700px on a typical
// laptop screen).
export const PX_PER_MIN = 1.8;
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

export function statusToColor(status: AppointmentStatus): string {
  switch (status) {
    // arrived = in the chair right now: the loudest block (green fill + success spine).
    case 'arrived':
      return 'bg-appt-green border-l-success';
    // confirmed = a locked-in yes: faint brand-sage fill + accent spine
    // (was bg-appt-purple, off-brand lavender after the sage rebrand).
    case 'confirmed':
      return 'bg-accent-subtle border-l-accent';
    // completed = done and settled: muted surface, success spine. The
    // "done" read comes from muted block text, NOT block-wide opacity
    // (which crushed text contrast below AA).
    case 'completed':
      return 'bg-bg-surface-2 border-l-success';
    // booked = tentative: cool info blue.
    case 'booked':
      return 'bg-appt-blue border-l-info';
    // no_show = needs attention: warning.
    case 'no_show':
      return 'bg-warning-subtle border-l-warning';
    // cancelled = ghosted out (via muted + struck text, not opacity).
    case 'cancelled':
      return 'bg-bg-surface-2 border-l-border';
    default:
      return 'bg-appt-blue border-l-info';
  }
}

type ModalState = { kind: 'closed' } | { kind: 'create'; barberId: string; minutes: number };

export function AppointmentsCalendar({
  locale,
  canManageMoney,
  timezone,
  isoDate,
  initialView = 'side-by-side',
  barbers,
  services,
  categories,
  clients,
  hours,
  daysOff,
  appointments,
  weekAppointments = [],
  weekDays = [],
  blocked,
  googleBusy = [],
  onboarding,
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

  // Phase 5 — Side-by-Side ⇄ List view toggle. Pure client state seeded
  // from the server; switching never refetches (both views share the
  // day-scoped dataset).
  const [view, setView] = useState<CalendarView>(initialView);
  const [selectedBarbers, setSelectedBarbers] = useState<Set<string>>(
    () => new Set(barbers.map((b) => b.id)),
  );
  const [drawer, setDrawer] = useState<CalendarAppointment | null>(null);
  // Stable handler so memoized appointment blocks don't re-render when an
  // unrelated parent state change (drawer open, 60s now-tick, filter) fires.
  const handleApptClick = useCallback((a: CalendarAppointment) => setDrawer(a), []);
  const [modal, setModal] = useState<ModalState>({ kind: 'closed' });
  // Loop 27 — separate state for the Block Time modal. It doesn't
  // share the create-appointment modal state because the trigger
  // (header button) doesn't carry a starting barber/minute pair —
  // the form picks sensible defaults itself.
  const [blockTimeOpen, setBlockTimeOpen] = useState(false);
  // Loop 28 — confirmation modal state for the "Cancel day" button.
  // `alsoRefund` is the optional toggle: when on, the bulk action
  // also refunds every paid appointment in the same call. We keep it
  // as a separate useState (not RHF) because the confirm modal is
  // intentionally lightweight — one checkbox + two buttons.
  const [bulkCancelOpen, setBulkCancelOpen] = useState(false);
  const [bulkAlsoRefund, setBulkAlsoRefund] = useState(false);
  const [bulkPending, startBulkTransition] = useTransition();
  // Brief "Updated" pill shown for ~1.5s whenever a Realtime event triggers a
  // refresh. Tells the user the view is fresh without being intrusive.
  const [justRefreshed, setJustRefreshed] = useState(false);
  // Realtime connection health — when the socket drops we'd miss inserts/
  // cancels, so the grid may be stale. Surface an indicator + poll fallback.
  const [realtimeStale, setRealtimeStale] = useState(false);

  // ── "Now" indicator — only renders if the calendar is displaying today's
  // date. The state holds minutes-from-shop-midnight; we re-derive on a 60s
  // interval so the line ticks down the screen during a long-running session.
  const isToday = isoDate === today;
  const [nowMin, setNowMin] = useState<number | null>(() =>
    isToday ? minutesFromShopMidnight(new Date(), timezone) : null,
  );
  useEffect(() => {
    if (!isToday) {
      setNowMin(null);
      return;
    }
    setNowMin(minutesFromShopMidnight(new Date(), timezone));
    const id = window.setInterval(() => {
      setNowMin(minutesFromShopMidnight(new Date(), timezone));
    }, 60_000);
    return () => window.clearInterval(id);
  }, [isToday, timezone]);

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
  // toggles, filter chips, router refreshes). Without memoization, the
  // following derivations recompute O(barbers × appointments) per render —
  // measurable lag once the shop reaches ~20 barbers / hundreds of appts.
  const visibleBarbers = useMemo(
    () => barbers.filter((b) => selectedBarbers.has(b.id)),
    [barbers, selectedBarbers],
  );

  // Loop 28 — IDs of appointments that the "Cancel day" button would
  // actually cancel. Filters to the visible-barber set (so the owner
  // can scope to one chair) and excludes anything already cancelled /
  // no_show / completed. We also count paid rows so the confirm
  // dialog can surface "N paid will be refunded" when the toggle is
  // on. Memoized off the same inputs the calendar grid uses, so the
  // count stays in sync with what's on screen.
  const bulkCancelTargets = useMemo(() => {
    const visibleIds = new Set(visibleBarbers.map((b) => b.id));
    const ids: string[] = [];
    let paidCount = 0;
    for (const a of appointments) {
      if (!visibleIds.has(a.barber_id)) continue;
      if (a.status === 'cancelled' || a.status === 'no_show' || a.status === 'completed') continue;
      ids.push(a.id);
      if (a.payment_status === 'paid') paidCount += 1;
    }
    return { ids, paidCount };
  }, [appointments, visibleBarbers]);

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

  // Phase 5 — List view dataset. Honors the Barbers filter the same way
  // the Side-by-Side grid does (via `selectedBarbers`), so toggling chips
  // updates both views consistently. Already `start_at asc` from the
  // server → chronological by default.
  const listAppointments = useMemo(
    () => effectiveAppointments.filter((a) => selectedBarbers.has(a.barber_id)),
    [effectiveAppointments, selectedBarbers],
  );

  // Week view dataset. Honors the Barbers filter the same way Side-by-Side
  // and List do. Optimistic drag overrides only touch the day-scoped set,
  // so the week grid renders the server-provided rows directly.
  const weekListAppointments = useMemo(
    () => weekAppointments.filter((a) => selectedBarbers.has(a.barber_id)),
    [weekAppointments, selectedBarbers],
  );

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

  // Precompute each appointment's pixel geometry ONCE per data/timezone/grid
  // change, instead of running ~3 Intl-backed timezone conversions per block
  // inside every BarberColumn render (which re-fires on filter toggles, drawer
  // opens, and the 60s now-tick). Memoized blocks then get stable numeric
  // props and skip re-render entirely when nothing moved.
  const apptLayout = useMemo(() => {
    const m = new Map<string, { top: number; height: number }>();
    for (const a of effectiveAppointments) {
      const startM = minutesFromShopMidnight(a.start_at, timezone);
      const endM = minutesFromShopMidnight(a.end_at, timezone);
      m.set(a.id, {
        top: (startM - startMin) * PX_PER_MIN,
        height: (endM - startM) * PX_PER_MIN,
      });
    }
    return m;
  }, [effectiveAppointments, timezone, startMin]);

  // Phase 34 — Google busy bucketed by barber for O(1) lookup. The page
  // already filtered out barbers with no busy periods; here we just turn
  // the array into a Map.
  const googleBusyByBarber = useMemo(() => {
    const m = new Map<string, Array<{ start: string; end: string }>>();
    for (const g of googleBusy) m.set(g.barberId, g.periods);
    return m;
  }, [googleBusy]);

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
    // Loop 27 self-review — `postgres_changes` broadcasts one event
    // PER ROW. A 52-week recurring block insert previously caused 52
    // separate `router.refresh()` calls in rapid succession, each
    // re-running ~9 server queries. Debounce so a burst of events
    // (e.g. recurring inserts, bulk cancellations, scheduled-emails
    // status flips) collapses to a single refresh ~250ms after the
    // last event lands.
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const onChange = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        router.refresh();
        setJustRefreshed(true);
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(() => setJustRefreshed(false), 1500);
      }, 250);
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
      .subscribe((status) => {
        // The grid is only trustworthy while SUBSCRIBED. CHANNEL_ERROR /
        // TIMED_OUT / CLOSED mean we may now be missing row events → flag
        // stale so the UI warns + the poll fallback (below) kicks in.
        if (status === 'SUBSCRIBED') setRealtimeStale(false);
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setRealtimeStale(true);
        }
      });
    return () => {
      if (hideTimer) clearTimeout(hideTimer);
      if (refreshTimer) clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [barbers, router]);

  // Poll fallback: while the realtime socket is down, refetch every 60s so a
  // long disconnect can't pin a silently stale grid (the realtime client also
  // auto-reconnects; this is belt-and-braces against a wedged socket).
  useEffect(() => {
    if (!realtimeStale) return;
    const id = setInterval(() => router.refresh(), 60_000);
    return () => clearInterval(id);
  }, [realtimeStale, router]);

  // ── Phase 27 — DnD plumbing ───────────────────────────────────────────
  // handleDragEnd owns the optimistic-override state, so it stays in the
  // calendar and is passed into the lazy <AppointmentsGrid>, which supplies
  // the DndContext + sensors (the 6px activation distance is tuned there).
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

  // View toggle. Side-by-Side ⇄ List is instant local state (both share the
  // day-scoped dataset). Switching to/from Week also syncs `?view=` so the
  // Server Component (re)fetches the week-range dataset — the week grid has
  // no data otherwise. We keep local `view` in sync immediately so the tab
  // reflects the choice before the navigation resolves.
  const changeView = useCallback(
    (next: CalendarView) => {
      setView(next);
      if (next === 'week' || view === 'week') {
        const url = new URL(window.location.href);
        url.searchParams.set('view', next);
        router.push(url.pathname + '?' + url.searchParams.toString());
      }
    },
    [router, view],
  );

  const onSlotClick = useCallback(
    (barberId: string, e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const offsetPx = e.clientY - rect.top;
      const minuteOffset = Math.floor(offsetPx / PX_PER_MIN / 5) * 5; // snap to 5min
      setModal({ kind: 'create', barberId, minutes: startMin + minuteOffset });
    },
    [startMin],
  );

  // Loop 28 — confirmed handler for bulk-cancel. Captures the
  // current `bulkCancelTargets` IDs at click time (not at render
  // time) so a realtime event landing mid-modal can't accidentally
  // shift the cancel set. Refund toast count comes from the server's
  // response so we don't double-count Stripe failures.
  const onConfirmBulkCancel = useCallback(() => {
    const ids = bulkCancelTargets.ids;
    if (ids.length === 0) return;
    startBulkTransition(async () => {
      const result = await bulkCancelAppointments({ ids, also_refund: bulkAlsoRefund });
      if (result.ok) {
        toast.show({
          variant: 'success',
          title: t('bulkCancel.toasts.cancelled', { count: result.data.count }),
          description:
            bulkAlsoRefund && result.data.refunded > 0
              ? t('bulkCancel.toasts.refundedSuffix', { refunded: result.data.refunded })
              : undefined,
        });
        setBulkCancelOpen(false);
        setBulkAlsoRefund(false);
      } else {
        toast.show({
          variant: 'danger',
          title: t('bulkCancel.toasts.failed'),
        });
      }
    });
  }, [bulkCancelTargets.ids, bulkAlsoRefund, t, toast]);

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={
          <span className="text-xl font-semibold tabular-nums tracking-tight text-text-primary">
            {formatHeaderDate(dayRef, locale === 'fr' ? 'fr' : 'en', timezone)}
          </span>
        }
        center={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => shiftDate(-1)}
              aria-label={t('prevDay')}
              className="rounded-md p-1.5 text-text-muted transition-colors duration-150 ease-out-quint hover:bg-bg-surface-2 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
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
              className="rounded-md p-1.5 text-text-muted transition-colors duration-150 ease-out-quint hover:bg-bg-surface-2 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            {/* Phase 26 — Realtime refresh indicator. CSS-only fade keeps it
                from stealing focus; aria-live='polite' announces to screen
                readers without interrupting. */}
            <span
              aria-live="polite"
              className={cn(
                'border-success/30 bg-success/10 inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium text-success shadow-sm transition-opacity duration-300',
                justRefreshed ? 'opacity-100' : 'pointer-events-none opacity-0',
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              {t('liveUpdate')}
            </span>
            {/* Realtime socket down — the grid may be missing recent changes.
                Persistent (not auto-hiding) until the channel re-subscribes. */}
            <span
              aria-live="polite"
              className={cn(
                'border-warning/30 bg-warning/10 inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium text-warning shadow-sm transition-opacity duration-300',
                realtimeStale ? 'opacity-100' : 'pointer-events-none opacity-0',
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-warning" />
              {t('staleData')}
            </span>
          </div>
        }
        actions={
          <div className="flex items-center gap-2">
            {/* Loop 28 — "Cancel day" — emergency / sick-day bulk
                cancel scoped to the visible barbers. Disabled when
                there's nothing to cancel so the affordance reads as
                "no actionable rows here today". */}
            <Button
              onClick={() => setBulkCancelOpen(true)}
              size="sm"
              variant="secondary"
              disabled={bulkCancelTargets.ids.length === 0}
              title={t('bulkCancel.buttonTitle', { count: bulkCancelTargets.ids.length })}
            >
              <Trash2 className="h-4 w-4" /> {t('bulkCancel.button')}
            </Button>
            {/* Loop 27 — "Block time" button (spec section 5.A). Sits
                left of "Add appointment" because it's the less common
                action and the eye lands on Add first as the primary. */}
            <Button onClick={() => setBlockTimeOpen(true)} size="sm" variant="secondary">
              <XOctagon className="h-4 w-4" /> {t('blockTimeButton')}
            </Button>
            <Button
              onClick={() =>
                setModal({
                  kind: 'create',
                  barberId: visibleBarbers[0]?.id ?? '',
                  minutes: startMin,
                })
              }
              size="sm"
            >
              <Plus className="h-4 w-4" /> {t('addAppointment')}
            </Button>
          </div>
        }
      />

      <div className="space-y-6 p-6">
        {/* Phase 5 — view toggle. Side-by-Side is the default; List is the
            chronological table; Week is the 7-day grid. Side-by-Side and
            List share the day-scoped dataset (switching is instant); Week
            renders the week-range dataset fetched by the server when
            `?view=week`. */}
        <Tabs
          aria-label={t('viewLabel')}
          value={view}
          onChange={changeView}
          items={[
            { value: 'side-by-side', label: t('views.sideBySide') },
            { value: 'week', label: t('views.week'), count: weekListAppointments.length },
            { value: 'list', label: t('views.list'), count: listAppointments.length },
          ]}
        />

        {/* Phase 45 — onboarding hint. Auto-hides once setup is complete. */}
        {onboarding ? (
          <OnboardingCard
            locale={locale}
            shopAddressFilled={onboarding.shopAddressFilled}
            hoursConfigured={onboarding.hoursConfigured}
            servicesCount={onboarding.servicesCount}
            barbersCount={onboarding.barbersCount}
          />
        ) : null}

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
                  // Phase 48 — chips get accent-glow when active so the
                  // active row reads as "lit up" instead of just "purple",
                  // and shadow-sm when inactive for subtle depth.
                  'inline-flex h-7 items-center gap-1 rounded-full px-3 text-xs font-medium transition-all duration-150 ease-out-quint',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base',
                  isActive
                    ? 'bg-accent text-accent-fg shadow-accent-glow'
                    : 'border border-border bg-bg-surface text-text-secondary shadow-sm hover:bg-bg-surface-2 hover:text-text-primary',
                )}
              >
                {b.display_name}
              </button>
            );
          })}
        </div>

        {isClosed && (
          // Phase 48 — informational, not alarming. The padlock icon
          // carries the "closed" semantic; the muted neutral palette
          // keeps it out of the way visually while the lock icon makes
          // it instantly recognizable.
          <div className="flex items-center gap-2.5 rounded-lg bg-bg-surface px-3.5 py-2.5 text-xs text-text-secondary shadow-sm">
            <Lock className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden />
            <span>{t('shopClosedDay')}</span>
          </div>
        )}

        {/* Calendar grid — Phase 33 round 2 dialed the visual noise way
            down to match the Squire-style reference: NO alternating
            hour bands (uniform background), borders at 20-25% opacity,
            container on bg-bg-base (pure dark) instead of bg-bg-surface
            (the gray-tinted surface). Appointments pop now because the
            grid recedes. */}
        {view === 'side-by-side' && (
          <AppointmentsGrid
            visibleBarbers={visibleBarbers}
            apptsByBarber={apptsByBarber}
            apptLayout={apptLayout}
            blocksByBarber={blocksByBarber}
            googleBusyByBarber={googleBusyByBarber}
            timezone={timezone}
            startMin={startMin}
            endMin={endMin}
            gridHeightPx={gridHeightPx}
            hourLabels={hourLabels}
            nowMin={nowMin}
            locale={locale}
            onSlotClick={onSlotClick}
            onApptClick={handleApptClick}
            onDragEnd={handleDragEnd}
            t={t}
          />
        )}

        {view === 'week' && (
          <AppointmentsWeekView
            appointments={weekListAppointments}
            weekDays={weekDays}
            selectedIsoDate={isoDate}
            barbers={barbers}
            timezone={timezone}
            daysOff={daysOff}
            onApptClick={handleApptClick}
          />
        )}

        {view === 'list' && (
          <AppointmentsListView
            appointments={listAppointments}
            barbers={barbers}
            timezone={timezone}
            locale={locale}
            onApptClick={handleApptClick}
          />
        )}
      </div>

      <AppointmentDetailDrawer
        appointment={drawer}
        timezone={timezone}
        canManageMoney={canManageMoney}
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

      {/* Loop 27 — block-time modal. Lazily code-split (see dynamic
          import above) so the JS only ships when the owner opens it. */}
      {blockTimeOpen ? (
        <BlockTimeFormModal
          isoDate={isoDate}
          barbers={barbers}
          onClose={() => setBlockTimeOpen(false)}
        />
      ) : null}

      {/* Loop 28 — bulk-cancel confirm. The ConfirmDialog is light
          enough that we render it unconditionally; `open` gates the
          actual mount of the underlying Modal. The refund checkbox
          only renders when there's at least one paid row in the
          target set — no point asking the question otherwise. */}
      <ConfirmDialog
        open={bulkCancelOpen}
        title={t('bulkCancel.confirmTitle')}
        description={
          <div className="space-y-3">
            <p>
              {t('bulkCancel.confirmDescription', {
                count: bulkCancelTargets.ids.length,
                barbers: visibleBarbers.length,
              })}
            </p>
            {bulkCancelTargets.paidCount > 0 ? (
              <label className="flex items-start gap-2 rounded-md bg-bg-surface-2 p-2.5 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={bulkAlsoRefund}
                  onChange={(e) => setBulkAlsoRefund(e.target.checked)}
                  disabled={bulkPending}
                  className="mt-0.5 h-4 w-4 rounded border-border bg-bg-surface text-accent focus:ring-focus"
                />
                <span>{t('bulkCancel.alsoRefund', { paid: bulkCancelTargets.paidCount })}</span>
              </label>
            ) : null}
          </div>
        }
        confirmLabel={t('bulkCancel.confirmButton')}
        cancelLabel={t('bulkCancel.cancelButton')}
        destructive
        loading={bulkPending}
        onConfirm={onConfirmBulkCancel}
        onCancel={() => {
          if (bulkPending) return;
          setBulkCancelOpen(false);
          setBulkAlsoRefund(false);
        }}
      />
    </>
  );
}
