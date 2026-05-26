import { setRequestLocale, getTranslations } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentShop, requireShopMember, requireRoleInCurrentShop } from '@/lib/auth/server';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCurrencyCAD } from '@/lib/utils';
import {
  computeCommission,
  tierConfigFromRow,
  type CommissionTierDbRow,
} from '@/lib/business/commissions';

export const dynamic = 'force-dynamic';

/**
 * Finances — Phase 44 (KPIs + by-barber) and Phase 51 (date-range filter,
 * per-category breakdown).
 *
 * URL contract: `?start=YYYY-MM-DD&end=YYYY-MM-DD` defines the inclusive
 * range in the shop's local timezone. Either parameter missing → fall back
 * to the current month. The HTML form below submits as a plain GET so we
 * stay server-rendered (no client-side state, no React-Hook-Form).
 *
 * Manager+ only — barbers shouldn't see shop-wide revenue. They can still
 * see their own appointments on the calendar.
 */
type SearchParams = { start?: string; end?: string };

export default async function FinancesPage({
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
    getTranslations({ locale, namespace: 'pages.finances' }),
    getCurrentShop(),
  ]);
  const timezone = shop?.timezone ?? 'America/Toronto';

  // ── Range resolution ──────────────────────────────────────────────
  // The form submits dates as YYYY-MM-DD strings in the shop's local
  // wall clock. We turn them into UTC instants by anchoring to local
  // midnight + the shop's GMT offset. If parsing fails (manual URL
  // mucking) we fall back to current-month bounds.
  const { rangeStart, rangeEnd, rangeStartIso, rangeEndIso, isDefaultRange } = resolveRange(
    searchParams,
    timezone,
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServerClient() as any;

  const [apptsRes, clientsRes] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, barber_id, total_amount, status')
      .eq('status', 'completed')
      .gte('start_at', rangeStart.toISOString())
      .lt('start_at', rangeEnd.toISOString()),
    supabase.from('clients').select('id, loyalty_balance_cents').gt('loyalty_balance_cents', 0),
  ]);

  type ApptRow = {
    id: string;
    barber_id: string;
    total_amount: number;
    status: string;
  };
  type ClientRow = { id: string; loyalty_balance_cents: number };

  const appts = (apptsRes.data as ApptRow[] | null) ?? [];
  const loyaltyClients = (clientsRes.data as ClientRow[] | null) ?? [];

  // ── Headline metrics ──────────────────────────────────────────────
  const grossRevenue = appts.reduce((s, a) => s + Number(a.total_amount ?? 0), 0);
  const completedCount = appts.length;
  const avgTicket = completedCount > 0 ? grossRevenue / completedCount : 0;
  const loyaltyOutstandingCents = loyaltyClients.reduce(
    (s, c) => s + (c.loyalty_balance_cents ?? 0),
    0,
  );

  // ── Sales per barber ──────────────────────────────────────────────
  const byBarber = new Map<string, { count: number; revenue: number }>();
  for (const a of appts) {
    const bucket = byBarber.get(a.barber_id) ?? { count: 0, revenue: 0 };
    bucket.count += 1;
    bucket.revenue += Number(a.total_amount ?? 0);
    byBarber.set(a.barber_id, bucket);
  }
  const barberIds = Array.from(byBarber.keys());
  let barberRows: Array<{ id: string; display_name: string; count: number; revenue: number }> = [];
  if (barberIds.length > 0) {
    const namesRes = await supabase.from('barbers').select('id, display_name').in('id', barberIds);
    const names = new Map(
      ((namesRes.data as Array<{ id: string; display_name: string }> | null) ?? []).map((b) => [
        b.id,
        b.display_name,
      ]),
    );
    barberRows = barberIds
      .map((id) => ({
        id,
        display_name: names.get(id) ?? '?',
        count: byBarber.get(id)!.count,
        revenue: byBarber.get(id)!.revenue,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }

  // ── Sales per category (Phase 51) ─────────────────────────────────
  // Three-step join — appointment_services × services × service_categories.
  // We scope the appointment_services query to the IDs we already pulled,
  // so the payload stays bounded even on a busy shop. price_snapshot is
  // the per-service amount captured at booking time; summing it gives a
  // truthful revenue figure that doesn't double-count promos or loyalty
  // (those discount the appointment total but not the line items).
  const apptIds = appts.map((a) => a.id);
  let categoryRows: Array<{
    id: string | null;
    name: string;
    revenue: number;
    apptCount: number;
  }> = [];
  if (apptIds.length > 0) {
    const apptSvcsRes = await supabase
      .from('appointment_services')
      .select('appointment_id, service_id, price_snapshot')
      .in('appointment_id', apptIds);
    type LinkRow = {
      appointment_id: string;
      service_id: string;
      price_snapshot: number;
    };
    const links = (apptSvcsRes.data as LinkRow[] | null) ?? [];

    const serviceIds = Array.from(new Set(links.map((l) => l.service_id)));
    let catByService = new Map<string, string | null>();
    let categoryNames = new Map<string | null, string>();

    if (serviceIds.length > 0) {
      const svcsRes = await supabase
        .from('services')
        .select('id, category_id')
        .in('id', serviceIds);
      const svcs = (svcsRes.data as Array<{ id: string; category_id: string | null }> | null) ?? [];
      catByService = new Map(svcs.map((s) => [s.id, s.category_id]));

      const catIds = Array.from(
        new Set(svcs.map((s) => s.category_id).filter((id): id is string => id !== null)),
      );
      if (catIds.length > 0) {
        const catRes = await supabase
          .from('service_categories')
          .select('id, name')
          .in('id', catIds);
        const cats = (catRes.data as Array<{ id: string; name: string }> | null) ?? [];
        categoryNames = new Map(cats.map((c) => [c.id, c.name]));
      }
    }

    const byCategory = new Map<string | null, { revenue: number; appts: Set<string> }>();
    for (const link of links) {
      const catId = catByService.get(link.service_id) ?? null;
      const bucket = byCategory.get(catId) ?? { revenue: 0, appts: new Set<string>() };
      bucket.revenue += Number(link.price_snapshot ?? 0);
      bucket.appts.add(link.appointment_id);
      byCategory.set(catId, bucket);
    }
    categoryRows = Array.from(byCategory.entries())
      .map(([catId, bucket]) => ({
        id: catId,
        name:
          catId !== null
            ? (categoryNames.get(catId) ?? t('byCategory.uncategorized'))
            : t('byCategory.uncategorized'),
        revenue: bucket.revenue,
        apptCount: bucket.appts.size,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }

  // ── Commission report (Phase 52) ──────────────────────────────────
  // For each barber that had revenue in the range, look up their service-
  // scoped commission_tiers row and run it through `computeCommission`.
  // Barbers with no tiers row, or a row with every tier at (0, 0%),
  // surface as commission=0 — same semantic as the spec ("not configured").
  let commissionRows: Array<{
    barberId: string;
    barberName: string;
    revenue: number;
    commission: number;
    effectivePct: number;
    cumulative: boolean;
  }> = [];
  if (barberIds.length > 0) {
    const tiersRes = await supabase
      .from('commission_tiers')
      .select(
        'barber_id, scope, cumulative, tier1_threshold, tier1_pct, tier2_threshold, tier2_pct, tier3_threshold, tier3_pct, tier4_threshold, tier4_pct, tier5_threshold, tier5_pct',
      )
      .eq('scope', 'services')
      .in('barber_id', barberIds);
    const tiersRows =
      (tiersRes.data as Array<CommissionTierDbRow & { barber_id: string }> | null) ?? [];
    const tiersByBarber = new Map(tiersRows.map((r) => [r.barber_id, tierConfigFromRow(r)]));
    const cumulativeByBarber = new Map(tiersRows.map((r) => [r.barber_id, r.cumulative]));
    commissionRows = barberRows
      .map((b) => {
        const config = tiersByBarber.get(b.id);
        if (!config) {
          return {
            barberId: b.id,
            barberName: b.display_name,
            revenue: b.revenue,
            commission: 0,
            effectivePct: 0,
            cumulative: false,
          };
        }
        const commission = computeCommission(b.revenue, config);
        return {
          barberId: b.id,
          barberName: b.display_name,
          revenue: b.revenue,
          commission,
          effectivePct: b.revenue > 0 ? (commission / b.revenue) * 100 : 0,
          cumulative: cumulativeByBarber.get(b.id) ?? false,
        };
      })
      // Sort by commission desc, then revenue desc as a tiebreak.
      .sort((a, b) => b.commission - a.commission || b.revenue - a.revenue);
  }

  const fmtCAD = (n: number) => formatCurrencyCAD(n, locale === 'fr' ? 'fr' : 'en');
  const subtitle = formatRangeLabel(
    rangeStartIso,
    rangeEndIso,
    locale === 'fr' ? 'fr-CA' : 'en-CA',
  );

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={subtitle}
        actions={
          /* Loop 26 — discoverable entrypoint into the daily close-out
             page. Lives on the main /finances header as a small link
             so an owner exploring the page finds today's snapshot
             without needing to know the route by heart. Locale prefix
             is required because a relative `today` would resolve
             against `/en/finances` (no trailing slash) and land on
             `/en/today` — the codebase's convention is `/${locale}/…`
             on every internal anchor. */
          <a
            href={`/${locale}/finances/today`}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors duration-150 ease-out-quint hover:bg-bg-surface-2 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {t('todayLink')}
          </a>
        }
      />
      <div className="space-y-6 p-6">
        {/* Date-range filter — Phase 51. Plain GET form so the URL is
            shareable / bookmarkable, and the server-side render
            re-runs with the new range without any client JS. */}
        <form
          method="get"
          className="flex flex-wrap items-end gap-3 rounded-lg bg-bg-surface p-4 shadow-sm"
        >
          <div className="flex flex-col gap-1">
            <label
              htmlFor="start"
              className="text-[11px] font-semibold uppercase tracking-wide text-text-muted"
            >
              {t('rangeForm.start')}
            </label>
            <input
              id="start"
              name="start"
              type="date"
              defaultValue={rangeStartIso}
              className="h-10 rounded-lg bg-bg-surface-2 px-3 text-sm text-text-primary shadow-sm transition-colors duration-150 ease-out-quint focus:outline-none focus:ring-2 focus:ring-focus"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="end"
              className="text-[11px] font-semibold uppercase tracking-wide text-text-muted"
            >
              {t('rangeForm.end')}
            </label>
            <input
              id="end"
              name="end"
              type="date"
              defaultValue={rangeEndIso}
              className="h-10 rounded-lg bg-bg-surface-2 px-3 text-sm text-text-primary shadow-sm transition-colors duration-150 ease-out-quint focus:outline-none focus:ring-2 focus:ring-focus"
            />
          </div>
          <Button type="submit" size="sm">
            {t('rangeForm.apply')}
          </Button>
          {!isDefaultRange ? (
            <a
              href="?"
              className="rounded-md px-3 py-2 text-xs font-medium text-text-secondary transition-colors duration-150 ease-out-quint hover:bg-bg-surface-2 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              {t('rangeForm.thisMonth')}
            </a>
          ) : null}
        </form>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label={t('kpis.grossRevenue')} value={fmtCAD(grossRevenue)} />
          <Kpi label={t('kpis.completedAppointments')} value={String(completedCount)} />
          <Kpi label={t('kpis.avgTicket')} value={fmtCAD(avgTicket)} />
          <Kpi label={t('kpis.loyaltyOutstanding')} value={fmtCAD(loyaltyOutstandingCents / 100)} />
        </div>

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
                    <th className="py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                      {t('byBarber.columns.appointments')}
                    </th>
                    <th className="py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                      {t('byBarber.columns.revenue')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {barberRows.map((b) => (
                    <tr key={b.id} className="border-b border-border last:border-b-0">
                      <td className="py-2 font-medium text-text-primary">{b.display_name}</td>
                      <td className="py-2 text-right text-text-secondary">{b.count}</td>
                      <td className="py-2 text-right font-semibold text-text-primary">
                        {fmtCAD(b.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>

        {/* Commission report — Phase 52. Each row pairs a barber's
            range revenue with the computed commission via
            `computeCommission(revenue, tierConfig)`. The mode column
            surfaces whether the barber's tier config is cumulative or
            single-tier, since the two produce very different numbers
            on the same revenue. */}
        <Card>
          <CardHeader>
            <CardTitle>{t('commissions.title')}</CardTitle>
            <Badge variant="default">{commissionRows.length}</Badge>
          </CardHeader>
          <CardBody>
            {commissionRows.length === 0 ? (
              <p className="text-sm text-text-muted">{t('commissions.empty')}</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                      {t('commissions.columns.barber')}
                    </th>
                    <th className="py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                      {t('commissions.columns.revenue')}
                    </th>
                    <th className="py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                      {t('commissions.columns.rate')}
                    </th>
                    <th className="py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                      {t('commissions.columns.mode')}
                    </th>
                    <th className="py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                      {t('commissions.columns.commission')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {commissionRows.map((c) => (
                    <tr key={c.barberId} className="border-b border-border last:border-b-0">
                      <td className="py-2 font-medium text-text-primary">{c.barberName}</td>
                      <td className="py-2 text-right text-text-secondary">{fmtCAD(c.revenue)}</td>
                      <td className="py-2 text-right text-text-secondary">
                        {c.effectivePct > 0 ? `${c.effectivePct.toFixed(1)}%` : '—'}
                      </td>
                      <td className="py-2 text-right">
                        <Badge variant={c.cumulative ? 'info' : 'default'}>
                          {c.cumulative
                            ? t('commissions.modeCumulative')
                            : t('commissions.modeSingle')}
                        </Badge>
                      </td>
                      <td className="py-2 text-right font-semibold text-text-primary">
                        {fmtCAD(c.commission)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>

        {/* Per-category breakdown — Phase 51. Same table grammar as
            by-barber so the eye reads them as parallel sections. */}
        <Card>
          <CardHeader>
            <CardTitle>{t('byCategory.title')}</CardTitle>
            <Badge variant="default">{categoryRows.length}</Badge>
          </CardHeader>
          <CardBody>
            {categoryRows.length === 0 ? (
              <p className="text-sm text-text-muted">{t('byCategory.empty')}</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                      {t('byCategory.columns.category')}
                    </th>
                    <th className="py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                      {t('byCategory.columns.appointments')}
                    </th>
                    <th className="py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                      {t('byCategory.columns.revenue')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {categoryRows.map((c) => (
                    <tr key={c.id ?? 'none'} className="border-b border-border last:border-b-0">
                      <td className="py-2 font-medium text-text-primary">{c.name}</td>
                      <td className="py-2 text-right text-text-secondary">{c.apptCount}</td>
                      <td className="py-2 text-right font-semibold text-text-primary">
                        {fmtCAD(c.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardBody className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</p>
        <p className="text-2xl font-semibold text-text-primary">{value}</p>
      </CardBody>
    </Card>
  );
}

/**
 * Parse `?start` / `?end` into a [start, end) interval, falling back to the
 * current month in the shop's timezone. Returns both the parsed Date instants
 * (for the SQL query) and the ISO date strings (for the form defaultValue).
 */
function resolveRange(
  searchParams: SearchParams,
  timezone: string,
): {
  rangeStart: Date;
  rangeEnd: Date;
  rangeStartIso: string;
  rangeEndIso: string;
  isDefaultRange: boolean;
} {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  const startValid = !!searchParams.start && dateRegex.test(searchParams.start);
  const endValid = !!searchParams.end && dateRegex.test(searchParams.end);
  const customRange = startValid && endValid;

  if (customRange) {
    const offset = tzOffsetSuffix(timezone, new Date());
    const rangeStart = new Date(`${searchParams.start}T00:00:00${offset}`);
    // `end` is inclusive from the user's perspective — add one day so the
    // half-open interval [start, end+1) covers the chosen last day.
    const endDate = new Date(`${searchParams.end}T00:00:00${offset}`);
    endDate.setDate(endDate.getDate() + 1);
    return {
      rangeStart,
      rangeEnd: endDate,
      rangeStartIso: searchParams.start!,
      rangeEndIso: searchParams.end!,
      isDefaultRange: false,
    };
  }

  const now = new Date();
  const tzFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = tzFormatter.formatToParts(now);
  const year = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const offset = tzOffsetSuffix(timezone, now);
  const monthStart = new Date(`${year}-${month}-01T00:00:00${offset}`);
  const monthEnd = new Date(monthStart);
  monthEnd.setMonth(monthEnd.getMonth() + 1);

  // ISO defaults for the form: first of the month + today.
  const todayIso = `${year}-${month}-${parts.find((p) => p.type === 'day')?.value ?? '01'}`;
  return {
    rangeStart: monthStart,
    rangeEnd: monthEnd,
    rangeStartIso: `${year}-${month}-01`,
    rangeEndIso: todayIso,
    isDefaultRange: true,
  };
}

function formatRangeLabel(startIso: string, endIso: string, locale: 'fr-CA' | 'en-CA'): string {
  const fmt = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  // Render in UTC to avoid any local-tz shift on the label.
  const start = fmt.format(new Date(`${startIso}T12:00:00Z`));
  const end = fmt.format(new Date(`${endIso}T12:00:00Z`));
  return `${start} — ${end}`;
}

/**
 * Build the timezone offset suffix (e.g. "-05:00") for the given instant
 * + tz. Used to compose an ISO string Postgres can parse as
 * "first-of-the-month in the shop's local time."
 */
function tzOffsetSuffix(timezone: string, now: Date): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
    });
    const parts = fmt.formatToParts(now);
    const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    const match = /GMT([+-]\d{1,2})(?::(\d{2}))?/.exec(name);
    if (!match) return 'Z';
    const sign = match[1]!.startsWith('-') ? '-' : '+';
    const hours = match[1]!.replace(/^[+-]/, '').padStart(2, '0');
    const mins = (match[2] ?? '00').padStart(2, '0');
    return `${sign}${hours}:${mins}`;
  } catch {
    return 'Z';
  }
}
