import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ComponentType, SVGProps } from 'react';
import {
  ArrowLeft,
  CalendarClock,
  CircleDollarSign,
  Gift,
  Mail,
  Phone,
  XCircle,
} from 'lucide-react';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import {
  getCurrentBarberId,
  getCurrentShop,
  getCurrentShopId,
  getShopMemberships,
  requireShopMember,
} from '@/lib/auth/server';
import { effectiveLoyaltyBalanceCents } from '@/lib/business/loyalty';
import { excludeRefunded } from '@/lib/business/finances';
import { formatCurrencyCAD } from '@/lib/utils';
import { formatShopTime } from '@/lib/business/timezone';
import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
// Plan 040 (CAL-10) — this page's local STATUS_VARIANT copy became the
// canonical shared map; import it so the fiche can never drift from the
// list view again.
import { APPOINTMENT_STATUS_VARIANT } from '@/components/ui/appointment-status';

export const dynamic = 'force-dynamic';

type ApptStatus = 'booked' | 'confirmed' | 'arrived' | 'completed' | 'cancelled' | 'no_show';

export default async function ClientDetailPage(props: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const params = await props.params;

  const { locale, id } = params;

  setRequestLocale(locale);
  await requireShopMember({ locale });

  // Active-shop scope (cookie-aware) + strict-barber gate, mirroring the list.
  const memberships = await getShopMemberships();
  const activeShopId = await getCurrentShopId();
  const activeMembership = memberships.find((m) => m.shop_id === activeShopId) ?? memberships[0];
  const shopId = activeMembership?.shop_id ?? activeShopId;
  if (!shopId) notFound();
  const viewerRole = activeMembership?.role ?? 'barber';
  const viewerBarberId = viewerRole === 'barber' ? await getCurrentBarberId() : null;

  const shop = await getCurrentShop();
  const timezone = shop?.timezone ?? 'America/Toronto';

  // Service-role for the joins (RLS-friendly), backstopped by the explicit
  // shop_id filter + the barber-ownership check below.
  const admin = createSupabaseServiceRoleClient();

  // Plan 034 (PERF-07) — the client row, the barber-ownership probe and the
  // appointment history key only on `id`/`shopId`/`viewerBarberId`, so they
  // can run in ONE round-trip. The notFound() gates below keep their original
  // order and semantics (client absent → 404 BEFORE the ownership verdict;
  // the history result is simply discarded when a gate fires).
  const [clientRes, ownRes, apptRes, statsRes] = await Promise.all([
    admin
      .from('clients')
      .select(
        'id, shop_id, first_name, last_name, email, phone, date_of_birth, notes, created_at, anonymized_at, loyalty_balance_cents, loyalty_balance_expires_at',
      )
      .eq('id', id)
      .eq('shop_id', shopId)
      .maybeSingle(),
    // Strict-barber ownership probe — only meaningful (and only run) when the
    // viewer is a barber with a linked barber row.
    viewerRole === 'barber' && viewerBarberId
      ? admin
          .from('appointments')
          .select('id')
          .eq('client_id', id)
          .eq('barber_id', viewerBarberId)
          .limit(1)
      : null,
    // Appointment history — same join shape as exportClient, capped at 100.
    admin
      .from('appointments')
      .select(
        'id, start_at, status, total_amount, barber:barbers(display_name), services:appointment_services(service:services(name))',
      )
      .eq('client_id', id)
      .eq('shop_id', shopId)
      .order('start_at', { ascending: false })
      .limit(100),
    // MED-2 — all-time stats from a SEPARATE lightweight query (no joins, high
    // cap) so totalSpent/visits/noShows stay exact past the 100-row history cap
    // used for the display table above.
    admin
      .from('appointments')
      .select('status, total_amount, payment_status')
      .eq('client_id', id)
      .eq('shop_id', shopId)
      .limit(2000),
  ]);
  const client = clientRes.data;
  if (!client) notFound();

  // Strict barber: only a client they've actually served.
  if (viewerRole === 'barber') {
    if (!viewerBarberId) notFound();
    if ((ownRes?.data ?? []).length === 0) notFound();
  }
  const appts = (apptRes.data ?? []).map((a) => ({
    id: a.id,
    start_at: a.start_at,
    status: a.status,
    total_amount: a.total_amount,
    barber: a.barber?.display_name ?? null,
    services: (a.services ?? [])
      .map((s) => s.service?.name)
      .filter((n): n is string => Boolean(n))
      .join(' + '),
  }));

  // MED-1 + MED-2 — stats come from the separate all-time stats query (NOT the
  // 100-capped history above), and totalSpent NETS refunds via the shared
  // excludeRefunded rule (FIN-UX-01): a fully-refunded completed appt counts as
  // a visit but contributes 0 to spend.
  const statsRows = statsRes.data ?? [];
  const completedStats = statsRows.filter((a) => a.status === 'completed');
  const totalSpent = excludeRefunded(completedStats).reduce(
    (s, a) => s + Number(a.total_amount ?? 0),
    0,
  );
  const visits = completedStats.length;
  const noShows = statsRows.filter((a) => a.status === 'no_show').length;
  const loyaltyCents = await effectiveLoyaltyBalanceCents({
    clientId: id,
    balanceCents: client.loyalty_balance_cents ?? 0,
    expiresAt: client.loyalty_balance_expires_at ?? null,
  });

  const t = await getTranslations({ locale, namespace: 'pages.clients.detail' });
  const tNav = await getTranslations({ locale, namespace: 'nav' });
  const tStatus = await getTranslations({ locale, namespace: 'pages.clients.detail.statuses' });
  const dl: 'fr' | 'en' = locale === 'fr' ? 'fr' : 'en';
  const fullName = `${client.first_name}${client.last_name ? ` ${client.last_name}` : ''}`;

  return (
    <>
      <PageHeader eyebrow={tNav('clients')} title={fullName} />
      <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
        <Link
          href={`/${locale}/clients`}
          className="inline-flex items-center gap-1.5 rounded text-sm text-text-secondary transition-colors hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </Link>

        {client.anonymized_at ? (
          <div className="rounded-md border border-warning/30 bg-warning-subtle px-3 py-2 text-sm text-text-secondary">
            {t('anonymizedNotice')}
          </div>
        ) : null}

        {/* Contact + meta */}
        <div className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-bg-surface p-4 sm:grid-cols-2">
          <ContactRow icon={Mail} label={t('email')} value={client.email} />
          <ContactRow icon={Phone} label={t('phone')} value={client.phone} mono />
          <ContactRow icon={Gift} label={t('dob')} value={client.date_of_birth} mono />
          <ContactRow
            icon={CalendarClock}
            label={t('memberSince')}
            value={formatShopTime(client.created_at, timezone, 'yyyy-MM-dd')}
            mono
          />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat
            icon={CircleDollarSign}
            label={t('totalSpent')}
            value={formatCurrencyCAD(totalSpent, dl)}
          />
          <Stat icon={CalendarClock} label={t('visits')} value={String(visits)} />
          <Stat icon={XCircle} label={t('noShows')} value={String(noShows)} />
          <Stat
            icon={Gift}
            label={t('loyalty')}
            value={formatCurrencyCAD(loyaltyCents / 100, dl)}
          />
        </div>

        {/* Notes */}
        <section>
          <h2 className="mb-2 text-sm font-semibold tracking-tight text-text-primary">
            {t('notes')}
          </h2>
          <p className="whitespace-pre-wrap rounded-lg border border-border bg-bg-surface px-4 py-3 text-sm text-text-secondary">
            {client.notes?.trim() ? (
              client.notes
            ) : (
              <span className="text-text-muted">{t('noNotes')}</span>
            )}
          </p>
        </section>

        {/* History */}
        <section>
          <h2 className="mb-2 text-sm font-semibold tracking-tight text-text-primary">
            {t('history')}
          </h2>
          {appts.length === 0 ? (
            <p className="rounded-lg border border-border bg-bg-surface px-4 py-8 text-center text-sm text-text-muted">
              {t('historyEmpty')}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-bg-surface">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-soft text-left text-[11px] uppercase tracking-wide text-text-muted">
                    <th className="px-4 py-2.5 font-semibold">{t('col.date')}</th>
                    <th className="px-4 py-2.5 font-semibold">{t('col.barber')}</th>
                    <th className="px-4 py-2.5 font-semibold">{t('col.services')}</th>
                    <th className="px-4 py-2.5 font-semibold">{t('col.status')}</th>
                    <th className="px-4 py-2.5 text-right font-semibold">{t('col.amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {appts.map((a) => (
                    <tr key={a.id} className="border-b border-border-faint last:border-b-0">
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono tabular-nums text-text-secondary">
                        {formatShopTime(a.start_at, timezone, 'yyyy-MM-dd · HH:mm')}
                      </td>
                      <td className="px-4 py-2.5 text-text-secondary">{a.barber ?? '—'}</td>
                      <td className="px-4 py-2.5 text-text-primary">{a.services || '—'}</td>
                      <td className="px-4 py-2.5">
                        <Badge variant={APPOINTMENT_STATUS_VARIANT[a.status] ?? 'default'}>
                          {tStatus(a.status)}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono tabular-nums text-text-primary">
                        {formatCurrencyCAD(a.total_amount ?? 0, dl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-surface p-4">
      <div className="flex items-center gap-1.5 text-text-muted">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        <span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-1.5 text-xl font-semibold tabular-nums text-text-primary">{value}</p>
    </div>
  );
}

function ContactRow({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
      <span className="w-28 shrink-0 text-xs text-text-muted">{label}</span>
      <span
        className={`min-w-0 truncate text-sm text-text-primary ${mono ? 'font-mono tabular-nums' : ''}`}
      >
        {value ?? <span className="text-text-muted">—</span>}
      </span>
    </div>
  );
}
