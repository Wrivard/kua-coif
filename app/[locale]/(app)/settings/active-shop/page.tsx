import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { getCurrentShopId, getShopMemberships, requireShopMember } from '@/lib/auth/server';
import { PageHeader } from '@/components/ui/page-header';
import { ActiveShopClient } from './active-shop-client';

export const dynamic = 'force-dynamic';

/**
 * Phase 65 — Active shop selector.
 *
 * Surfaced for users who are confirmed members of more than one shop.
 * Single-membership users see a "you only have one shop" message; no
 * meaningful action.
 *
 * The actual switching happens via the `selectShop` server action
 * (writes the `kua_active_shop` cookie); this page is the UI gate.
 */
export default async function ActiveShopPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);
  await requireShopMember({ locale });

  const [memberships, activeShopId] = await Promise.all([getShopMemberships(), getCurrentShopId()]);

  // Resolve shop names — `getShopMemberships` only carries the IDs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServiceRoleClient() as any;
  const shopIds = memberships.map((m) => m.shop_id);
  const namesRes =
    shopIds.length > 0
      ? await supabase.from('shops').select('id, name').in('id', shopIds)
      : { data: [] };
  const nameById = new Map<string, string>(
    ((namesRes.data as Array<{ id: string; name: string }> | null) ?? []).map((s) => [
      s.id,
      s.name,
    ]),
  );

  const rows = memberships.map((m) => ({
    shop_id: m.shop_id,
    name: nameById.get(m.shop_id) ?? '?',
    role: m.role,
  }));

  return (
    <>
      <PageHeader title="Active shop" />
      <ActiveShopClient activeShopId={activeShopId} rows={rows} />
    </>
  );
}
