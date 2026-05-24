import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireShopMember } from '@/lib/auth/server';
import type { BarberRow } from '@/db/rows';
import { BarberSettingsClient, type BarberSettingsRow } from './barber-settings-client';

export const dynamic = 'force-dynamic';

export default async function BarberSettingsPage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  setRequestLocale(locale);
  await requireShopMember({ locale });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServerClient() as any;
  const [barbersRes, settingsRes] = await Promise.all([
    supabase
      .from('barbers')
      .select('id, display_name, sort_order, status')
      .eq('status', 'confirmed')
      .order('sort_order', { ascending: true }),
    supabase.from('barber_settings').select('*'),
  ]);

  const barbers = (barbersRes.data as BarberRow[] | null) ?? [];
  const settings = (settingsRes.data as BarberSettingsRow[] | null) ?? [];

  return <BarberSettingsClient barbers={barbers} settings={settings} />;
}
