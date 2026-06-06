import { setRequestLocale, getTranslations } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentShop, requireShopMember, requireRoleInCurrentShop } from '@/lib/auth/server';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatCurrencyCAD } from '@/lib/utils';
import {
  formatHeaderDate,
  parseShopIsoDate,
  shopDayEnd,
  shopIsoDate,
} from '@/lib/business/timezone';
import { CloseOutClient } from './close-out-client';

export const dynamic = 'force-dynamic';

/**
 * `/finances/today` — Daily close-out report (Loop 26, P1.86 from
 * AUDIT_PHASE70.md). The page an owner pulls up at 8pm to reconcile
 * the cash drawer, see the day's revenue, tips, and per-barber
 * tipout — then prints or saves to PDF for end-of-day filing.
 *
 * Scope (server-rendered, manager+):
 *  - KPI strip: gross revenue, tips, completed count, outstanding count
 *  - Per-barber tipout table (revenue + tips + commission base = total)
 *  - Payment-method breakdown (paid online / unpaid in-shop / refunded)
 *  - Outstanding bookings still in non-terminal status
 *  - Cash drawer expected total = default_cash_drawer_balance + unpaid cash
 *  - Print-friendly stylesheet via `<CloseOutClient>` (auto-fires on
 *    `?print=1`)
 *
 * Deliberately out of scope (deferred to future loop):
 *  - Cron-based email digest (needs notification_automations 'daily_closeout'
 *    schedule). The print + PDF flow covers the daily ritual; an automated
 *    digest is a nice-to-have, not a blocker.
 *  - Editable "actual cash counted" field — would need a new table
 *    (`shop_daily_closes`) to persist owner-entered values. Today the
 *    owner subtracts in their head and writes it in their own ledger.
 *
 * URL contract: `?date=YYYY-MM-DD` overrides today, otherwise the page
 * resolves "today" in the shop's local timezone. Useful when the owner
 * forgot to print yesterday's close-out and wants to retrieve it.
 */
type SearchParams = { date?: string; print?: string };

export default async function CloseOutPage({
  params: { locale },
  searchParams,
}: {
  params: { locale: string };
  searchParams: SearchParams;
}) {
  setRequestLocale(locale);
  await requireShopMember({ locale });
  await requireRoleInCurrentShop('manager');

  const [t, shop] = await Promise.all([
    getTranslations({ locale, namespace: 'pages.finances.today' }),
    getCurrentShop(),
  ]);
  const timezone = shop?.timezone ?? 'America/Toronto';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServerClient() as any;

  // ── Day resolution ────────────────────────────────────────────────
  // ?date=YYYY-MM-DD overrides; otherwise today in shop tz.
  const isoToday = shopIsoDate(new Date(), timezone);
  const dateIso = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date ?? '')
    ? searchParams.date!
    : isoToday;
  const dayStart = parseShopIsoDate(dateIso, timezone);
  const dayEnd = shopDayEnd(dayStart, timezone);
  const isToday = dateIso === isoToday;

  // Perf: the cash-drawer balance (a single `shops` column not in the
  // cached projection) and the day's appointment set are independent —
  // fetch them in one parallel round instead of two serial hops. The
  // appointment set covers both completed (revenue) and non-completed
  // (outstanding) rows; we resolve names for them below.
  const [drawerRes, apptsRes] = await Promise.all([
    shop?.id
      ? supabase.from('shops').select('default_cash_drawer_balance').eq('id', shop.id).single()
      : Promise.resolve({ data: null }),
    supabase
      .from('appointments')
      .select(
        'id, barber_id, client_id, total_amount, status, payment_status, tip_amount_cents, source, start_at, end_at',
      )
      .gte('start_at', dayStart.toISOString())
      .lt('start_at', dayEnd.toISOString())
      .order('start_at', { ascending: true }),
  ]);
  const cashDrawerStart = Number(
    (drawerRes.data as { default_cash_drawer_balance: number | null } | null)
      ?.default_cash_drawer_balance ?? 0,
  );

  type ApptRow = {
    id: string;
    barber_id: string;
    client_id: string | null;
    total_amount: number;
    status: 'booked' | 'confirmed' | 'arrived' | 'completed' | 'cancelled' | 'no_show';
    payment_status: 'unpaid' | 'pending' | 'paid' | 'refunded' | 'failed';
    tip_amount_cents: number | null;
    source: 'admin' | 'online';
    start_at: string;
    end_at: string;
  };
  const appts = (apptsRes.data as ApptRow[] | null) ?? [];

  // ── Headline metrics ──────────────────────────────────────────────
  // Revenue is only counted on completed appointments — the same rule
  // as /finances. Tips collected = sum of tip_amount_cents on completed
  // rows. Outstanding = anything still in a non-terminal state (the
  // owner needs to know if there's a 7pm appt still going).
  const completed = appts.filter((a) => a.status === 'completed');
  const outstanding = appts.filter(
    (a) => a.status === 'booked' || a.status === 'confirmed' || a.status === 'arrived',
  );
  const grossRevenue = completed.reduce((s, a) => s + Number(a.total_amount ?? 0), 0);
  const tipsCents = completed.reduce((s, a) => s + (a.tip_amount_cents ?? 0), 0);
  const tipsTotal = tipsCents / 100;
  const completedCount = completed.length;
  const outstandingCount = outstanding.length;

  // ── Payment-status breakdown ──────────────────────────────────────
  // The owner expects to count physical cash for the `unpaid` slice —
  // that's the money still in the drawer. `paid` is Stripe (already
  // landed in the connected account, the owner gets a payout
  // separately). `refunded` we surface in red so a problem day is
  // visible at a glance.
  const paid = completed.filter((a) => a.payment_status === 'paid');
  const unpaid = completed.filter((a) => a.payment_status === 'unpaid');
  const refunded = completed.filter((a) => a.payment_status === 'refunded');
  const paidTotal = paid.reduce((s, a) => s + Number(a.total_amount ?? 0), 0);
  const unpaidTotal = unpaid.reduce((s, a) => s + Number(a.total_amount ?? 0), 0);
  const refundedTotal = refunded.reduce((s, a) => s + Number(a.total_amount ?? 0), 0);

  // Expected cash drawer = start balance + unpaid (in-shop cash) +
  // tips on unpaid appointments (cash tips). Tips on paid appts went
  // through Stripe so we don't count them in the drawer.
  const unpaidTipsCents = unpaid.reduce((s, a) => s + (a.tip_amount_cents ?? 0), 0);
  const expectedDrawer = cashDrawerStart + unpaidTotal + unpaidTipsCents / 100;

  // ── Per-barber tipout ─────────────────────────────────────────────
  // Each barber's row carries: completed visits, services revenue
  // (sum of total_amount), tips collected, and the line total =
  // revenue + tips for quick eyeball. We don't compute commission here
  // — that lives on `/finances` with the proper tier config. This page
  // is the cash-out story, not the payroll story.
  const byBarber = new Map<string, { count: number; revenue: number; tips: number }>();
  for (const a of completed) {
    const bucket = byBarber.get(a.barber_id) ?? { count: 0, revenue: 0, tips: 0 };
    bucket.count += 1;
    bucket.revenue += Number(a.total_amount ?? 0);
    bucket.tips += (a.tip_amount_cents ?? 0) / 100;
    byBarber.set(a.barber_id, bucket);
  }
  const barberIds = Array.from(byBarber.keys());

  // Perf: resolve every name lookup in ONE parallel round. The completed-
  // barber and outstanding-barber lookups both hit `barbers`, so they merge
  // into a single `.in()` over the union of ids; the client-name lookup
  // runs alongside it (was 2-3 serial hops).
  const outstandingClientIds = Array.from(
    new Set(outstanding.map((o) => o.client_id).filter((id): id is string => Boolean(id))),
  );
  const allBarberIds = Array.from(new Set([...barberIds, ...outstanding.map((o) => o.barber_id)]));

  const [barberNamesRes, clientNamesRes] = await Promise.all([
    allBarberIds.length > 0
      ? supabase.from('barbers').select('id, display_name').in('id', allBarberIds)
      : Promise.resolve({ data: [] }),
    outstandingClientIds.length > 0
      ? supabase.from('clients').select('id, first_name, last_name').in('id', outstandingClientIds)
      : Promise.resolve({ data: [] }),
  ]);

  const barberNameById = new Map(
    ((barberNamesRes.data as Array<{ id: string; display_name: string }> | null) ?? []).map(
      (b) => [b.id, b.display_name] as const,
    ),
  );
  const clientNameById = new Map(
    (
      (clientNamesRes.data as Array<{
        id: string;
        first_name: string;
        last_name: string | null;
      }> | null) ?? []
    ).map((c) => [c.id, `${c.first_name}${c.last_name ? ` ${c.last_name}` : ''}`]),
  );

  const barberRows = barberIds
    .map((id) => {
      const b = byBarber.get(id)!;
      return {
        id,
        display_name: barberNameById.get(id) ?? '?',
        count: b.count,
        revenue: b.revenue,
        tips: b.tips,
        total: b.revenue + b.tips,
      };
    })
    .sort((a, b) => b.total - a.total);
  const outstandingRows = outstanding.map((o) => ({
    id: o.id,
    clientName: o.client_id ? (clientNameById.get(o.client_id) ?? '–') : '–',
    barberName: barberNameById.get(o.barber_id) ?? '?',
    start_at: o.start_at,
    end_at: o.end_at,
    status: o.status,
  }));

  const fmtCAD = (n: number) => formatCurrencyCAD(n, locale === 'fr' ? 'fr' : 'en');
  const headerDate = formatHeaderDate(dayStart, locale === 'fr' ? 'fr' : 'en', timezone);
  const subtitle = isToday ? t('subtitleToday', { date: headerDate }) : headerDate;

  return (
    <CloseOutClient locale={locale} autoPrint={searchParams.print === '1'}>
      <PageHeader title={t('title')} subtitle={subtitle} />
      <div className="space-y-6 p-6">
        {/* KPI strip — four cards at a glance. The "outstanding" KPI
            is wrapped in a tooltip color when > 0 so the owner can't
            miss that there are still un-completed appointments before
            calling it a day. */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label={t('kpis.gross')} value={fmtCAD(grossRevenue)} />
          <Kpi label={t('kpis.tips')} value={fmtCAD(tipsTotal)} />
          <Kpi label={t('kpis.completed')} value={String(completedCount)} />
          <Kpi
            label={t('kpis.outstanding')}
            value={String(outstandingCount)}
            warning={outstandingCount > 0}
          />
        </div>

        {/* Cash drawer expected total — Phase 86. The math is: start
            balance + cash from unpaid completed appts + cash tips on
            those. The owner manually counts the drawer and writes the
            delta in their own ledger. We don't persist an "actual"
            value here (no schema change). */}
        <Card>
          <CardHeader>
            <CardTitle>{t('drawer.title')}</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            <DrawerLine label={t('drawer.startBalance')} value={fmtCAD(cashDrawerStart)} />
            <DrawerLine label={t('drawer.unpaidCash')} value={fmtCAD(unpaidTotal)} />
            <DrawerLine label={t('drawer.cashTips')} value={fmtCAD(unpaidTipsCents / 100)} />
            <div className="border-t border-border pt-2">
              <DrawerLine
                label={t('drawer.expectedTotal')}
                value={fmtCAD(expectedDrawer)}
                emphasis
              />
            </div>
            <p className="text-[11px] text-text-muted">{t('drawer.helper')}</p>
          </CardBody>
        </Card>

        {/* Per-barber tipout table — the night-end pay-out cheat
            sheet. Sorted by total desc so the busiest chair leads. */}
        <Card>
          <CardHeader>
            <CardTitle>{t('byBarber.title')}</CardTitle>
            <Badge variant="default">{barberRows.length}</Badge>
          </CardHeader>
          <CardBody>
            {barberRows.length === 0 ? (
              <p className="text-sm text-text-muted">{t('byBarber.empty')}</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                      {t('byBarber.columns.barber')}
                    </th>
                    <th className="py-2 text-right text-[11px] font-semibold uppercase tabular-nums tracking-wide text-text-muted">
                      {t('byBarber.columns.visits')}
                    </th>
                    <th className="py-2 text-right text-[11px] font-semibold uppercase tabular-nums tracking-wide text-text-muted">
                      {t('byBarber.columns.revenue')}
                    </th>
                    <th className="py-2 text-right text-[11px] font-semibold uppercase tabular-nums tracking-wide text-text-muted">
                      {t('byBarber.columns.tips')}
                    </th>
                    <th className="py-2 text-right text-[11px] font-semibold uppercase tabular-nums tracking-wide text-text-muted">
                      {t('byBarber.columns.total')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {barberRows.map((b) => (
                    <tr key={b.id} className="border-b border-border last:border-b-0">
                      <td className="py-2 font-medium text-text-primary">{b.display_name}</td>
                      <td className="py-2 text-right tabular-nums text-text-secondary">
                        {b.count}
                      </td>
                      <td className="py-2 text-right tabular-nums text-text-secondary">
                        {fmtCAD(b.revenue)}
                      </td>
                      <td className="py-2 text-right tabular-nums text-text-secondary">
                        {fmtCAD(b.tips)}
                      </td>
                      <td className="py-2 text-right font-semibold tabular-nums text-text-primary">
                        {fmtCAD(b.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>

        {/* Payment status breakdown — three rows. Refunded shows in
            red so the eye lands on a bad day instantly. */}
        <Card>
          <CardHeader>
            <CardTitle>{t('payment.title')}</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            <PaymentRow label={t('payment.paid')} count={paid.length} amount={fmtCAD(paidTotal)} />
            <PaymentRow
              label={t('payment.unpaid')}
              count={unpaid.length}
              amount={fmtCAD(unpaidTotal)}
            />
            <PaymentRow
              label={t('payment.refunded')}
              count={refunded.length}
              amount={fmtCAD(refundedTotal)}
              tone={refunded.length > 0 ? 'danger' : 'muted'}
            />
          </CardBody>
        </Card>

        {/* Outstanding bookings — appointments still booked /
            confirmed / arrived but not completed. On a typical close-
            out this is empty by 8pm; if it's not, the owner needs to
            close those rows first. */}
        {outstandingRows.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('outstanding.title')}</CardTitle>
              <Badge variant="warning">{outstandingRows.length}</Badge>
            </CardHeader>
            <CardBody>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                      {t('outstanding.columns.client')}
                    </th>
                    <th className="py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                      {t('outstanding.columns.barber')}
                    </th>
                    <th className="py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                      {t('outstanding.columns.time')}
                    </th>
                    <th className="py-2 text-right text-[11px] font-semibold uppercase tabular-nums tracking-wide text-text-muted">
                      {t('outstanding.columns.status')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {outstandingRows.map((o) => (
                    <tr key={o.id} className="border-b border-border last:border-b-0">
                      <td className="py-2 font-medium text-text-primary">{o.clientName}</td>
                      <td className="py-2 text-text-secondary">{o.barberName}</td>
                      {/* Loop 37 (P114) — time range column in mono
                          so the HH:mm – HH:mm values line up. */}
                      <td className="py-2 font-mono tabular-nums text-text-secondary">
                        {formatTimeRange(o.start_at, o.end_at, timezone)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        <Badge variant="warning">{t(`outstanding.statuses.${o.status}`)}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </CloseOutClient>
  );
}

function Kpi({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <Card>
      <CardBody className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</p>
        <p
          className={
            warning
              ? 'text-display-sm tabular-nums text-warning'
              : 'text-display-sm tabular-nums text-text-primary'
          }
        >
          {value}
        </p>
      </CardBody>
    </Card>
  );
}

function DrawerLine({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={emphasis ? 'font-semibold text-text-primary' : 'text-text-secondary'}>
        {label}
      </span>
      <span
        className={
          emphasis
            ? 'text-lg font-semibold tabular-nums text-text-primary'
            : 'tabular-nums text-text-primary'
        }
      >
        {value}
      </span>
    </div>
  );
}

function PaymentRow({
  label,
  count,
  amount,
  tone = 'default',
}: {
  label: string;
  count: number;
  amount: string;
  tone?: 'default' | 'danger' | 'muted';
}) {
  const colorClass =
    tone === 'danger' ? 'text-danger' : tone === 'muted' ? 'text-text-muted' : 'text-text-primary';
  return (
    <div className="flex items-center justify-between">
      <span className="text-text-secondary">
        {label}
        <span className="ml-2 text-[11px] text-text-muted">({count})</span>
      </span>
      <span className={`font-semibold tabular-nums ${colorClass}`}>{amount}</span>
    </div>
  );
}

function formatTimeRange(startIso: string, endIso: string, timezone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone,
  });
  return `${fmt.format(new Date(startIso))} – ${fmt.format(new Date(endIso))}`;
}
