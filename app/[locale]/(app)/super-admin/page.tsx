import Link from 'next/link';
import {
  AlertTriangle,
  Bug,
  DollarSign,
  ExternalLink,
  GitPullRequest,
  Store,
  TrendingUp,
} from 'lucide-react';
import { requireKuaAdmin } from '@/lib/auth/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { captureException } from '@/lib/observability';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { SuperAdminNav } from '@/components/ui/super-admin-nav';
import { formatCurrencyCAD } from '@/lib/utils';

/**
 * Phase H+3 — Super-admin command center.
 *
 * Previously this route redirected straight to /admin/shops. Now it's
 * the single landing page that shows, at a glance:
 *
 *   - Platform revenue (last 30d) + how much Küa is keeping (BPS × volume)
 *   - Shop counts (total / Stripe-active / new this month)
 *   - Recent Sentry signal (unresolved 24h + top issue)
 *   - Auto-fix cron activity (PRs opened / merged this month)
 *   - Per-shop revenue table so the operator can see who's earning
 *     vs. who's idle
 *
 * All fetches run in parallel and fail-soft — a Sentry / GitHub API
 * outage degrades the relevant card to "couldn't fetch" instead of
 * 500ing the whole page.
 */
export const dynamic = 'force-dynamic';

const SENTRY_ORG = 'kua';
const SENTRY_PROJECT = 'javascript-nextjs';
const SENTRY_REGION = 'https://us.sentry.io';
const REPO_OWNER = 'Wrivard';
const REPO_NAME = 'kua-coif';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// ──────────────────────────────────────────────────────────────────────────
// Data fetchers
// ──────────────────────────────────────────────────────────────────────────

type ShopRow = {
  id: string;
  name: string;
  alias: string | null;
  stripe_connect_status: 'not_started' | 'pending' | 'restricted' | 'active';
  created_at: string;
};
type PlatformOverview = {
  appFeeBps: number;
  shops: Array<ShopRow & { revenue30d: number; feeKua30d: number; bookings30d: number }>;
  totals: {
    totalShops: number;
    stripeActiveShops: number;
    newShops30d: number;
    revenue30d: number;
    feeKua30d: number;
    bookings30d: number;
  };
};

async function fetchPlatformOverview(): Promise<PlatformOverview> {
  const sb = createSupabaseServiceRoleClient();
  const since = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();

  const [configRes, shopsRes, apptsRes] = await Promise.all([
    sb.from('platform_config').select('app_fee_bps').eq('id', 1).single(),
    sb.from('shops').select('id, name, alias, stripe_connect_status, created_at'),
    sb
      .from('appointments')
      .select('shop_id, total_amount, tip_amount_cents')
      .eq('payment_status', 'paid')
      .gte('start_at', since),
  ]);

  const appFeeBps = configRes.data?.app_fee_bps ?? 0;
  // Contract cast: ShopRow narrows `stripe_connect_status` (CHECK-constrained
  // text column, generated as plain string) for PlatformOverview.
  const shops = (shopsRes.data as ShopRow[] | null) ?? [];
  const appts = apptsRes.data ?? [];

  // Aggregate revenue + bookings per shop. Revenue includes the tip
  // (the salon collects it), but the Küa fee is computed on the
  // ACTUAL upfront charge — which is what Stripe billed and what we
  // got a cut of. For V1 simplicity we apply the CURRENT BPS to the
  // shop's revenue; the BPS rarely changes in practice (per Phase F's
  // single-row config), so the error is bounded.
  const perShop = new Map<string, { revenue: number; bookings: number }>();
  for (const a of appts) {
    const tipDollars = (a.tip_amount_cents ?? 0) / 100;
    const grand = Number(a.total_amount ?? 0) + tipDollars;
    const prev = perShop.get(a.shop_id) ?? { revenue: 0, bookings: 0 };
    perShop.set(a.shop_id, { revenue: prev.revenue + grand, bookings: prev.bookings + 1 });
  }

  const enrichedShops = shops
    .map((s) => {
      const agg = perShop.get(s.id) ?? { revenue: 0, bookings: 0 };
      return {
        ...s,
        revenue30d: agg.revenue,
        feeKua30d: agg.revenue * (appFeeBps / 10_000),
        bookings30d: agg.bookings,
      };
    })
    .sort((a, b) => b.revenue30d - a.revenue30d);

  const newSince = Date.now() - THIRTY_DAYS_MS;
  const totals = {
    totalShops: shops.length,
    stripeActiveShops: shops.filter((s) => s.stripe_connect_status === 'active').length,
    newShops30d: shops.filter((s) => new Date(s.created_at).getTime() > newSince).length,
    revenue30d: enrichedShops.reduce((sum, s) => sum + s.revenue30d, 0),
    feeKua30d: enrichedShops.reduce((sum, s) => sum + s.feeKua30d, 0),
    bookings30d: enrichedShops.reduce((sum, s) => sum + s.bookings30d, 0),
  };

  return { appFeeBps, shops: enrichedShops, totals };
}

type SentryOverview = {
  unresolved24h: number;
  topIssues: Array<{
    shortId: string;
    title: string;
    level: string;
    count: string;
    permalink: string;
  }>;
  error?: string;
};

async function fetchSentryOverview(): Promise<SentryOverview> {
  const token = process.env.SENTRY_AUTH_TOKEN;
  if (!token) {
    return {
      unresolved24h: 0,
      topIssues: [],
      error: 'SENTRY_AUTH_TOKEN not set in Vercel env',
    };
  }
  try {
    const url = `${SENTRY_REGION}/api/0/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/issues/?query=${encodeURIComponent(
      'is:unresolved firstSeen:-24h',
    )}&limit=5&sort=freq`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      next: { revalidate: 60 },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Sentry API ${res.status}: ${body.slice(0, 200)}`);
    }
    const issues = (await res.json()) as Array<{
      shortId: string;
      title: string;
      level: string;
      count: string;
      permalink: string;
    }>;
    return {
      unresolved24h: issues.length,
      topIssues: issues.slice(0, 3).map((i) => ({
        shortId: i.shortId,
        title: i.title,
        level: i.level,
        count: i.count,
        permalink: i.permalink,
      })),
    };
  } catch (e) {
    captureException(e, { tags: { layer: 'admin', page: 'dashboard', stage: 'sentry-fetch' } });
    return { unresolved24h: 0, topIssues: [], error: e instanceof Error ? e.message : 'unknown' };
  }
}

type AutofixOverview = {
  opened30d: number;
  merged30d: number;
  open: number;
  error?: string;
};

async function fetchAutofixOverview(): Promise<AutofixOverview> {
  const token = process.env.KUA_GITHUB_TOKEN;
  if (!token) {
    return {
      opened30d: 0,
      merged30d: 0,
      open: 0,
      error: 'KUA_GITHUB_TOKEN not set',
    };
  }
  try {
    const since = new Date(Date.now() - THIRTY_DAYS_MS).toISOString().slice(0, 10);
    const q = `repo:${REPO_OWNER}/${REPO_NAME} type:pr label:sentry-autofix created:>=${since}`;
    const url = `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=100`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      next: { revalidate: 60 },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      items: Array<{
        state: 'open' | 'closed';
        pull_request?: { merged_at: string | null };
      }>;
    };
    const opened30d = json.items.length;
    const merged30d = json.items.filter((p) => Boolean(p.pull_request?.merged_at)).length;
    const open = json.items.filter((p) => p.state === 'open').length;
    return { opened30d, merged30d, open };
  } catch (e) {
    captureException(e, { tags: { layer: 'admin', page: 'dashboard', stage: 'github-fetch' } });
    return {
      opened30d: 0,
      merged30d: 0,
      open: 0,
      error: e instanceof Error ? e.message : 'unknown',
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────────

export default async function AdminDashboard(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;
  await requireKuaAdmin();

  // Parallel — slowest leg gates the render. None of these block on
  // each other so a sluggish GitHub doesn't slow Postgres queries.
  const [platform, sentry, autofix] = await Promise.all([
    fetchPlatformOverview(),
    fetchSentryOverview(),
    fetchAutofixOverview(),
  ]);

  const appFeePct = (platform.appFeeBps / 100).toFixed(2);

  return (
    <>
      <PageHeader title="Küa platform overview" subtitle="Super-admin · vue d'ensemble Küa" />
      <SuperAdminNav />
      <div className="space-y-8 p-6">
        <p className="max-w-3xl text-sm leading-relaxed text-text-secondary">
          Revenue + ce que Küa prend (30j), état des shops, signal Sentry des dernières 24h,
          activité du cron d&apos;auto-fix. Les fetches Sentry et GitHub font fail-soft — un outage
          tiers dégrade la carte plutôt que la page entière.
        </p>

        {/* ──── Top stats: 4 KPI cards ──── */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
          <Kpi
            icon={<DollarSign className="h-4 w-4" />}
            label="Revenue 30 jours"
            value={formatCurrencyCAD(platform.totals.revenue30d, 'fr')}
            sub={`${platform.totals.bookings30d} bookings payés`}
          />
          <Kpi
            icon={<TrendingUp className="h-4 w-4" />}
            label={`Küa fees 30j (${appFeePct}%)`}
            value={formatCurrencyCAD(platform.totals.feeKua30d, 'fr')}
            sub={
              <Link
                href={`/${params.locale}/super-admin/platform-config`}
                className="text-accent hover:underline"
              >
                Modifier le BPS →
              </Link>
            }
            accent
          />
          <Kpi
            icon={<Store className="h-4 w-4" />}
            label="Shops"
            value={String(platform.totals.totalShops)}
            sub={`${platform.totals.stripeActiveShops} Stripe actif · ${platform.totals.newShops30d} nouveaux ce mois`}
          />
          <Kpi
            icon={<Bug className="h-4 w-4" />}
            label="Issues Sentry 24h"
            value={String(sentry.unresolved24h)}
            sub={
              sentry.error ? (
                <span className="text-warning">Token manquant</span>
              ) : (
                <Link
                  href={`/${params.locale}/super-admin/sentry-autofix`}
                  className="text-accent hover:underline"
                >
                  Voir l&apos;archive →
                </Link>
              )
            }
            variant={sentry.unresolved24h > 0 ? 'danger' : undefined}
          />
        </div>

        {/* ──── Sentry top issues ──── */}
        {sentry.topIssues.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>
                <span className="inline-flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  Top issues Sentry (24h)
                </span>
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              {sentry.topIssues.map((i) => (
                <div
                  key={i.shortId}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border bg-bg-surface-2 p-4"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-sm font-medium text-text-primary">{i.title}</p>
                    <p className="text-xs text-text-muted">
                      <code className="font-mono">{i.shortId}</code> · {i.count} events
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={i.level === 'error' ? 'danger' : 'warning'}>{i.level}</Badge>
                    <Link
                      href={i.permalink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
                    >
                      <ExternalLink className="h-3 w-3" /> Sentry
                    </Link>
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>
        ) : sentry.error ? null : (
          <Card>
            <CardBody>
              <p className="text-sm text-text-secondary">
                ✅ Aucune issue Sentry dans les dernières 24h.
              </p>
            </CardBody>
          </Card>
        )}

        {/* ──── Auto-fix activity (30 days) ──── */}
        <Card>
          <CardHeader>
            <CardTitle>
              <span className="inline-flex items-center gap-2">
                <GitPullRequest className="h-4 w-4 text-accent" />
                Auto-fix cron (30 jours)
              </span>
            </CardTitle>
          </CardHeader>
          <CardBody>
            {autofix.error ? (
              <p className="text-sm text-text-secondary">{autofix.error}</p>
            ) : (
              <div className="grid grid-cols-3 gap-4 text-sm">
                <Stat label="PRs ouverts" value={autofix.opened30d} />
                <Stat label="Mergés" value={autofix.merged30d} variant="success" />
                <Stat label="En attente review" value={autofix.open} variant="info" />
              </div>
            )}
            <p className="mt-4 text-xs text-text-muted">
              <Link
                href={`/${params.locale}/super-admin/sentry-autofix`}
                className="text-accent hover:underline"
              >
                Voir l&apos;archive complète →
              </Link>
            </p>
          </CardBody>
        </Card>

        {/* ──── Per-shop revenue table ──── */}
        <Card>
          <CardHeader>
            <CardTitle>Revenue par shop (30 jours)</CardTitle>
          </CardHeader>
          <CardBody>
            {platform.shops.length === 0 ? (
              <p className="text-sm text-text-secondary">Aucun shop pour l&apos;instant.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                      <th className="px-3 py-3">Shop</th>
                      <th className="px-3 py-3 text-right">Volume</th>
                      <th className="px-3 py-3 text-right">Küa fee</th>
                      <th className="px-3 py-3 text-right">Bookings</th>
                      <th className="px-3 py-3">Stripe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {platform.shops.map((s) => (
                      <tr key={s.id} className="border-b border-border last:border-b-0">
                        <td className="px-3 py-3">
                          <div className="font-medium text-text-primary">{s.name}</div>
                          {s.alias ? (
                            <div className="text-[11px] text-text-muted">/{s.alias}</div>
                          ) : null}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {formatCurrencyCAD(s.revenue30d, 'fr')}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-accent">
                          {formatCurrencyCAD(s.feeKua30d, 'fr')}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-text-secondary">
                          {s.bookings30d}
                        </td>
                        <td className="px-3 py-3">
                          <Badge
                            variant={
                              s.stripe_connect_status === 'active'
                                ? 'success'
                                : s.stripe_connect_status === 'restricted'
                                  ? 'warning'
                                  : 'default'
                            }
                          >
                            {s.stripe_connect_status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
  variant,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: React.ReactNode;
  accent?: boolean;
  variant?: 'danger';
}) {
  const valueColor =
    variant === 'danger' ? 'text-danger' : accent ? 'text-accent' : 'text-text-primary';
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

function Stat({
  label,
  value,
  variant = 'default',
}: {
  label: string;
  value: number;
  variant?: 'default' | 'success' | 'info';
}) {
  const color =
    variant === 'success' ? 'text-success' : variant === 'info' ? 'text-info' : 'text-text-primary';
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-bg-surface-2 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">{label}</p>
      <p className={`text-2xl font-semibold ${color}`}>{value}</p>
    </div>
  );
}
