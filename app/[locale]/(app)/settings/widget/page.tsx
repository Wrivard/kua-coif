import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireShopMember } from '@/lib/auth/server';
import { parseWidgetConfig } from '@/lib/business/widget-config';
import { WidgetClient, type FunnelStats } from './widget-client';

export const dynamic = 'force-dynamic';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export default async function WidgetSettingsPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);
  await requireShopMember({ locale });

  const supabase = createSupabaseServerClient();
  // RLS limits this to the current shop. We need name+alias for the live preview
  // iframe URL and the snippet code; widget_config to seed the form.
  const { data } = await supabase.from('shops').select('id, name, alias, widget_config').limit(1);
  const row = (data ?? [])[0];

  const initialConfig = parseWidgetConfig(row?.widget_config);

  // Phase H+14 — widget funnel stats (last 30 days). Plan 038 (PERF-03):
  // aggregated in SQL by the `widget_funnel_stats` RPC (SECURITY INVOKER —
  // the caller's RLS gates the read to the current shop's members) instead
  // of pulling ≤20k raw rows whose cap silently truncated the rollup.
  // NOTE: the RPC ships in migration 20260611100000 — undeployed in prod
  // until the next deploy batch; the card shows zeros there until then.
  let funnelStats: FunnelStats = {
    impressions: 0,
    bookings: 0,
    conversionPct: 0,
    bySource: {},
  };
  if (row?.id) {
    const since = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
    const statsRes = await supabase.rpc('widget_funnel_stats', {
      p_shop_id: row.id,
      p_since: since,
    });
    type StatRow = {
      event_type: 'impression' | 'step_view' | 'booking_complete' | 'abandon';
      source: 'inline' | 'floating-button' | 'modal' | 'direct';
      event_count: number;
    };
    const stats = (statsRes.data as StatRow[] | null) ?? [];
    const bySource: FunnelStats['bySource'] = {};
    let impressions = 0;
    let bookings = 0;
    for (const s of stats) {
      const bucket = bySource[s.source] ?? { impressions: 0, bookings: 0 };
      const n = Number(s.event_count) || 0;
      if (s.event_type === 'impression') {
        impressions += n;
        bucket.impressions += n;
      } else if (s.event_type === 'booking_complete') {
        bookings += n;
        bucket.bookings += n;
      }
      bySource[s.source] = bucket;
    }
    funnelStats = {
      impressions,
      bookings,
      conversionPct: impressions > 0 ? (bookings / impressions) * 100 : 0,
      bySource,
    };
  }

  return (
    <WidgetClient
      locale={locale}
      shopName={row?.name ?? ''}
      shopAlias={row?.alias ?? null}
      initial={initialConfig}
      funnelStats={funnelStats}
    />
  );
}
