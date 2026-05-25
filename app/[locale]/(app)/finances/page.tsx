import { setRequestLocale, getTranslations } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentShop, requireShopMember, requireRoleInCurrentShop } from '@/lib/auth/server';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatCurrencyCAD } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * Finances — Phase 44 simple reports.
 *
 * Three views, each scoped to the current month in the shop's local
 * timezone:
 *   1. Headline cards: gross revenue, count of completed appointments,
 *      avg ticket size, loyalty balance outstanding.
 *   2. Sales per barber — ordered desc by revenue.
 *
 * Manager+ only — barbers shouldn't see shop-wide revenue. They can
 * still see their own appointments on the calendar.
 */
export default async function FinancesPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  await requireShopMember({ locale });
  await requireRoleInCurrentShop('manager');

  const [t, shop] = await Promise.all([
    getTranslations({ locale, namespace: 'pages.finances' }),
    getCurrentShop(),
  ]);
  const timezone = shop?.timezone ?? 'America/Toronto';

  // ── Month window in shop tz ────────────────────────────────────────
  // First day of the current month at 00:00 shop time → first day of
  // next month at 00:00 shop time.
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
  const monthStart = new Date(`${year}-${month}-01T00:00:00${tzOffsetSuffix(timezone, now)}`);
  const monthEnd = new Date(monthStart);
  monthEnd.setMonth(monthEnd.getMonth() + 1);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServerClient() as any;

  const [apptsRes, clientsRes] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, barber_id, total_amount, status')
      .eq('status', 'completed')
      .gte('start_at', monthStart.toISOString())
      .lt('start_at', monthEnd.toISOString()),
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

  const fmtCAD = (n: number) => formatCurrencyCAD(n, locale === 'fr' ? 'fr' : 'en');
  const monthLabel = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', {
    month: 'long',
    year: 'numeric',
    timeZone: timezone,
  }).format(now);

  return (
    <>
      <PageHeader title={t('title')} subtitle={monthLabel} />
      <div className="space-y-6 p-6">
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
