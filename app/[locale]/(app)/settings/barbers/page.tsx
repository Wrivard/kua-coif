import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentShopId, requireRoleInCurrentShop, requireShopMember } from '@/lib/auth/server';
import type { BarberRow } from '@/db/rows';
import { BarberSettingsClient, type BarberSettingsRow } from './barber-settings-client';

export const dynamic = 'force-dynamic';

export default async function BarberSettingsPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);
  await requireShopMember({ locale });
  // B19 — manager+ only (the settings save already is). A barber-role user is
  // FORBIDDEN here.
  await requireRoleInCurrentShop('manager');

  // Scope to the ACTIVE shop (Barbers audit B10): without an explicit shop_id
  // filter, RLS (is_shop_member) returns barbers + settings from EVERY shop the
  // user belongs to, merged — a multi-shop owner would see/edit the wrong
  // shop's grid.
  const shopId = await getCurrentShopId();
  if (!shopId) throw new Error('Barber settings load failed: no active shop resolved');

  const supabase = createSupabaseServerClient();
  const [barbersRes, settingsRes] = await Promise.all([
    supabase
      .from('barbers')
      .select('id, display_name, sort_order, status')
      .eq('shop_id', shopId)
      .eq('status', 'confirmed')
      .order('sort_order', { ascending: true }),
    supabase.from('barber_settings').select('*').eq('shop_id', shopId),
  ]);

  const barbers = (barbersRes.data as BarberRow[] | null) ?? [];
  const settings = settingsRes.data ?? [];

  return <BarberSettingsClient barbers={barbers} settings={settings} />;
}
