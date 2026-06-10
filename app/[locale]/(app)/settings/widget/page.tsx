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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServerClient() as any;
  // RLS limits this to the current shop. We need name+alias for the live preview
  // iframe URL and the snippet code; widget_config to seed the form.
  const { data } = await supabase.from('shops').select('id, name, alias, widget_config').limit(1);
  const row = ((data as Array<{
    id: string;
    name: string;
    alias: string | null;
    widget_config: unknown;
  }> | null) ?? [])[0];

  const initialConfig = parseWidgetConfig(row?.widget_config);

  // Phase H+14 — widget funnel stats (last 30 days). Single fetch, in-
  // memory rollup. RLS gates the read to the current shop's members.
  let funnelStats: FunnelStats = {
    impressions: 0,
    bookings: 0,
    conversionPct: 0,
    bySource: {},
  };
  if (row?.id) {
    const since = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
    const eventsRes = await supabase
      .from('widget_events')
      .select('event_type, source')
      .eq('shop_id', row.id)
      .gte('occurred_at', since)
      .limit(20000);
    type EventRow = {
      event_type: 'impression' | 'step_view' | 'booking_complete' | 'abandon';
      source: 'inline' | 'floating-button' | 'modal' | 'direct';
    };
    const events = (eventsRes.data as EventRow[] | null) ?? [];
    const bySource: FunnelStats['bySource'] = {};
    let impressions = 0;
    let bookings = 0;
    for (const e of events) {
      const bucket = bySource[e.source] ?? { impressions: 0, bookings: 0 };
      if (e.event_type === 'impression') {
        impressions++;
        bucket.impressions++;
      } else if (e.event_type === 'booking_complete') {
        bookings++;
        bucket.bookings++;
      }
      bySource[e.source] = bucket;
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
