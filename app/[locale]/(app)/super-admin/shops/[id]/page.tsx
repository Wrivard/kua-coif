import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Calendar,
  CreditCard,
  DollarSign,
  ExternalLink,
  Mail,
  MapPin,
  Phone,
  Store,
  User,
  Users,
} from 'lucide-react';
import { requireKuaAdmin } from '@/lib/auth/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { EmptyCell } from '@/components/ui/empty-cell';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { SuperAdminNav } from '@/components/ui/super-admin-nav';
import { formatCurrencyCAD } from '@/lib/utils';

/**
 * Phase H+6 — Super-admin shop detail page.
 *
 * Drill-down view from the shops list. Shows everything a Küa team
 * member needs to know about a single shop in one place:
 *   - Header: name + alias + Stripe Connect badge
 *   - 4 KPI cards: lifetime revenue, lifetime Küa fees, lifetime
 *     bookings, members count
 *   - Identity card: created at, timezone, email, phone, address
 *   - Members card: shop_members listed with role + status + email
 *   - Payments card: payment_mode, Stripe Connect status, payment
 *     profile verification, default cash drawer balance
 *   - Recent activity: 10 most recent appointments with amount +
 *     payment status
 *   - Public links: booking widget URL + embed code anchor
 *
 * Single Postgres trip per concern, parallel via Promise.all. Service-
 * role read so we cross tenants safely (gated by requireKuaAdmin).
 */
export const dynamic = 'force-dynamic';

type Props = { params: { locale: string; id: string } };

type ShopRow = {
  id: string;
  name: string;
  alias: string | null;
  email: string | null;
  phone: string | null;
  timezone: string;
  default_language: string | null;
  description: string | null;
  street: string | null;
  municipality: string | null;
  province: string | null;
  postal_code: string | null;
  country: string | null;
  created_at: string;
  stripe_connect_status: 'not_started' | 'pending' | 'restricted' | 'active';
  payment_mode: 'full' | 'deposit' | 'none';
  default_cash_drawer_balance: number | null;
};

type MemberRow = {
  id: string;
  role: 'owner' | 'manager' | 'barber';
  status: 'staff' | 'confirmed' | 'deleted';
  user_id: string;
  created_at: string;
};

type ApptRow = {
  id: string;
  start_at: string;
  status: 'booked' | 'confirmed' | 'arrived' | 'completed' | 'cancelled' | 'no_show';
  total_amount: number;
  tip_amount_cents: number | null;
  payment_status: 'unpaid' | 'pending' | 'paid' | 'refunded' | 'failed' | null;
  source: 'admin' | 'online';
  client_name_snapshot: string | null;
};

export default async function ShopDetailPage({ params }: Props) {
  await requireKuaAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createSupabaseServiceRoleClient() as any;

  // Parallel fetches — none depend on each other. Shop existence
  // gates the rest via notFound() before render.
  const [shopRes, membersRes, configRes, apptStatsRes, recentApptsRes, paymentProfileRes] =
    await Promise.all([
      sb
        .from('shops')
        .select(
          'id, name, alias, email, phone, timezone, default_language, description, street, municipality, province, postal_code, country, created_at, stripe_connect_status, payment_mode, default_cash_drawer_balance',
        )
        .eq('id', params.id)
        .maybeSingle(),
      sb
        .from('shop_members')
        .select('id, role, status, user_id, created_at')
        .eq('shop_id', params.id)
        .neq('status', 'deleted')
        .order('role', { ascending: true }),
      sb.from('platform_config').select('app_fee_bps').eq('id', 1).maybeSingle(),
      sb
        .from('appointments')
        .select('total_amount, tip_amount_cents, payment_status')
        .eq('shop_id', params.id)
        .eq('payment_status', 'paid'),
      sb
        .from('appointments')
        .select(
          'id, start_at, status, total_amount, tip_amount_cents, payment_status, source, client_name_snapshot',
        )
        .eq('shop_id', params.id)
        .order('start_at', { ascending: false })
        .limit(10),
      sb
        .from('payment_profiles')
        .select('verified, legal_name')
        .eq('shop_id', params.id)
        .maybeSingle(),
    ]);

  const shop = shopRes.data as ShopRow | null;
  if (!shop) notFound();

  const members = (membersRes.data as MemberRow[] | null) ?? [];
  const appFeeBps = (configRes.data as { app_fee_bps: number } | null)?.app_fee_bps ?? 0;
  const paidAppts =
    (apptStatsRes.data as Array<{
      total_amount: number;
      tip_amount_cents: number | null;
      payment_status: string | null;
    }> | null) ?? [];
  const recent = (recentApptsRes.data as ApptRow[] | null) ?? [];
  const paymentProfile = paymentProfileRes.data as {
    verified: boolean;
    legal_name: string | null;
  } | null;

  // Resolve member emails in one batch.
  const memberUserIds = members.map((m) => m.user_id);
  const profilesRes =
    memberUserIds.length > 0
      ? await sb.from('profiles').select('id, email, full_name').in('id', memberUserIds)
      : { data: [] };
  const profilesById = new Map<string, { email: string; full_name: string | null }>(
    (
      (profilesRes.data as Array<{ id: string; email: string; full_name: string | null }> | null) ??
      []
    ).map((p) => [p.id, { email: p.email, full_name: p.full_name }]),
  );

  // KPIs — lifetime.
  const lifetimeRevenue = paidAppts.reduce(
    (sum, a) => sum + Number(a.total_amount ?? 0) + (a.tip_amount_cents ?? 0) / 100,
    0,
  );
  const lifetimeFee = lifetimeRevenue * (appFeeBps / 10_000);
  const totalBookings = paidAppts.length;
  const memberCount = members.length;

  const addressLine = [shop.street, shop.municipality, shop.province, shop.postal_code]
    .filter(Boolean)
    .join(', ');

  const appFeePct = (appFeeBps / 100).toFixed(2);
  const embedUrl = `/${shop.alias ?? shop.id}`;
  const bookingUrl = `/${params.locale}/book/${shop.alias ?? shop.id}`;

  return (
    <>
      <PageHeader
        title={shop.name}
        subtitle={
          <>
            <Badge
              variant={
                shop.stripe_connect_status === 'active'
                  ? 'success'
                  : shop.stripe_connect_status === 'restricted'
                    ? 'warning'
                    : 'default'
              }
            >
              Stripe: {shop.stripe_connect_status}
            </Badge>{' '}
            · {shop.alias ? `/${shop.alias}` : `id: ${shop.id.slice(0, 8)}…`}
          </>
        }
        actions={
          <Link
            href={`/${params.locale}/super-admin/shops`}
            className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
          >
            ← All shops
          </Link>
        }
      />
      <SuperAdminNav />
      <div className="space-y-8 p-6">
        {/* KPIs */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
          <Kpi
            icon={<DollarSign className="h-4 w-4" />}
            label="Revenue cumulé"
            value={formatCurrencyCAD(lifetimeRevenue, 'fr')}
            sub={`${totalBookings} bookings payés`}
          />
          <Kpi
            icon={<DollarSign className="h-4 w-4" />}
            label={`Küa fees (${appFeePct}%)`}
            value={formatCurrencyCAD(lifetimeFee, 'fr')}
            accent
          />
          <Kpi
            icon={<Calendar className="h-4 w-4" />}
            label="Bookings cumulés"
            value={String(totalBookings)}
          />
          <Kpi
            icon={<Users className="h-4 w-4" />}
            label="Membres actifs"
            value={String(memberCount)}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Identity */}
          <Card>
            <CardHeader>
              <CardTitle>
                <span className="inline-flex items-center gap-2">
                  <Store className="h-4 w-4 text-accent" />
                  Identité
                </span>
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-3 text-sm">
              <Row label="Créé le" value={new Date(shop.created_at).toLocaleDateString('fr-CA')} />
              <Row label="Timezone" value={shop.timezone} />
              <Row label="Langue par défaut" value={shop.default_language ?? <EmptyCell />} />
              <Row
                label="Email"
                value={shop.email ?? <EmptyCell />}
                icon={<Mail className="h-3 w-3" />}
              />
              <Row
                label="Téléphone"
                value={shop.phone ?? <EmptyCell />}
                icon={<Phone className="h-3 w-3" />}
              />
              <Row
                label="Adresse"
                value={addressLine || <EmptyCell />}
                icon={<MapPin className="h-3 w-3" />}
              />
              {shop.description ? (
                <div className="border-t border-border pt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                    Description
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                    {shop.description}
                  </p>
                </div>
              ) : null}
            </CardBody>
          </Card>

          {/* Payments */}
          <Card>
            <CardHeader>
              <CardTitle>
                <span className="inline-flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-accent" />
                  Paiements
                </span>
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-3 text-sm">
              <Row
                label="Stripe Connect"
                value={
                  <Badge
                    variant={
                      shop.stripe_connect_status === 'active'
                        ? 'success'
                        : shop.stripe_connect_status === 'restricted'
                          ? 'warning'
                          : 'default'
                    }
                  >
                    {shop.stripe_connect_status}
                  </Badge>
                }
              />
              <Row label="Payment mode" value={<Badge variant="info">{shop.payment_mode}</Badge>} />
              <Row
                label="Payment profile vérifié"
                value={
                  paymentProfile?.verified ? (
                    <Badge variant="success">Verified</Badge>
                  ) : (
                    <Badge variant="default">Not verified</Badge>
                  )
                }
              />
              {paymentProfile?.legal_name ? (
                <Row label="Nom légal" value={paymentProfile.legal_name} />
              ) : null}
              <Row
                label="Cash drawer"
                value={formatCurrencyCAD(shop.default_cash_drawer_balance ?? 0, 'fr')}
              />
              <Row label="App fee BPS" value={`${appFeeBps} (${appFeePct}%)`} />
            </CardBody>
          </Card>
        </div>

        {/* Members */}
        <Card>
          <CardHeader>
            <CardTitle>
              <span className="inline-flex items-center gap-2">
                <User className="h-4 w-4 text-accent" />
                Membres ({memberCount})
              </span>
            </CardTitle>
          </CardHeader>
          <CardBody>
            {members.length === 0 ? (
              <p className="text-sm text-text-secondary">Aucun membre actif.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                      <th className="px-3 py-3">Email</th>
                      <th className="px-3 py-3">Nom</th>
                      <th className="px-3 py-3">Rôle</th>
                      <th className="px-3 py-3">Statut</th>
                      <th className="px-3 py-3">Ajouté</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => {
                      const profile = profilesById.get(m.user_id);
                      return (
                        <tr key={m.id} className="border-b border-border last:border-b-0">
                          <td className="px-3 py-3 font-mono text-xs text-text-secondary">
                            {profile?.email ?? <EmptyCell />}
                          </td>
                          <td className="px-3 py-3">{profile?.full_name ?? <EmptyCell />}</td>
                          <td className="px-3 py-3">
                            <Badge
                              variant={
                                m.role === 'owner'
                                  ? 'success'
                                  : m.role === 'manager'
                                    ? 'info'
                                    : 'default'
                              }
                            >
                              {m.role}
                            </Badge>
                          </td>
                          <td className="px-3 py-3">
                            <Badge variant={m.status === 'confirmed' ? 'success' : 'warning'}>
                              {m.status}
                            </Badge>
                          </td>
                          <td className="px-3 py-3 text-xs text-text-muted">
                            {new Date(m.created_at).toLocaleDateString('fr-CA')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Recent activity */}
        <Card>
          <CardHeader>
            <CardTitle>10 derniers rendez-vous</CardTitle>
          </CardHeader>
          <CardBody>
            {recent.length === 0 ? (
              <p className="text-sm text-text-secondary">Aucun rendez-vous pour l&apos;instant.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                      <th className="px-3 py-3">Date</th>
                      <th className="px-3 py-3">Client</th>
                      <th className="px-3 py-3">Source</th>
                      <th className="px-3 py-3 text-right">Montant</th>
                      <th className="px-3 py-3">Paiement</th>
                      <th className="px-3 py-3">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((a) => {
                      const tip = (a.tip_amount_cents ?? 0) / 100;
                      const grand = Number(a.total_amount ?? 0) + tip;
                      return (
                        <tr key={a.id} className="border-b border-border last:border-b-0">
                          <td className="px-3 py-3 text-xs">
                            {new Date(a.start_at).toLocaleDateString('fr-CA', {
                              year: 'numeric',
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                          <td className="px-3 py-3">{a.client_name_snapshot ?? <EmptyCell />}</td>
                          <td className="px-3 py-3 text-xs">
                            <Badge variant={a.source === 'online' ? 'info' : 'default'}>
                              {a.source}
                            </Badge>
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums">
                            {formatCurrencyCAD(grand, 'fr')}
                          </td>
                          <td className="px-3 py-3">
                            <Badge
                              variant={
                                a.payment_status === 'paid'
                                  ? 'success'
                                  : a.payment_status === 'refunded'
                                    ? 'warning'
                                    : a.payment_status === 'failed'
                                      ? 'danger'
                                      : 'default'
                              }
                            >
                              {a.payment_status ?? <EmptyCell />}
                            </Badge>
                          </td>
                          <td className="px-3 py-3">
                            <Badge
                              variant={
                                a.status === 'completed'
                                  ? 'success'
                                  : a.status === 'cancelled' || a.status === 'no_show'
                                    ? 'danger'
                                    : 'info'
                              }
                            >
                              {a.status}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Public surfaces */}
        <Card>
          <CardHeader>
            <CardTitle>Surfaces publiques</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg-surface-2 p-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  Page de réservation
                </p>
                <p className="truncate font-mono text-xs text-text-secondary">{bookingUrl}</p>
              </div>
              <Link
                href={bookingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> Ouvrir
              </Link>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg-surface-2 p-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  Code d&apos;intégration widget
                </p>
                <p className="truncate font-mono text-xs text-text-secondary">/embed{embedUrl}</p>
              </div>
              <Link
                href={`/${params.locale}/embed${embedUrl}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> Aperçu
              </Link>
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Tiny presentational helpers
// ──────────────────────────────────────────────────────────────────────────

function Kpi({
  icon,
  label,
  value,
  sub,
  accent = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: React.ReactNode;
  accent?: boolean;
}) {
  const valueColor = accent ? 'text-accent' : 'text-text-primary';
  return (
    <Card>
      <CardBody className="space-y-2">
        <div className="flex items-center gap-2 text-text-muted">
          {icon}
          <span className="text-[10px] font-semibold uppercase tracking-wide">{label}</span>
        </div>
        <p className={`text-3xl font-semibold tracking-tight ${valueColor}`}>{value}</p>
        {sub ? <div className="mt-1 text-xs leading-relaxed text-text-secondary">{sub}</div> : null}
      </CardBody>
    </Card>
  );
}

function Row({
  label,
  value,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
        {icon}
        {label}
      </span>
      <span className="text-right text-sm text-text-primary">{value}</span>
    </div>
  );
}
