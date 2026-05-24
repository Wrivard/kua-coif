import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireShopMember } from '@/lib/auth/server';
import { parseWidgetConfig } from '@/lib/business/widget-config';
import { WidgetClient } from './widget-client';

export const dynamic = 'force-dynamic';

export default async function WidgetSettingsPage({
  params: { locale },
}: {
  params: { locale: string };
}) {
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

  return (
    <WidgetClient
      locale={locale}
      shopName={row?.name ?? ''}
      shopAlias={row?.alias ?? null}
      initial={initialConfig}
    />
  );
}
