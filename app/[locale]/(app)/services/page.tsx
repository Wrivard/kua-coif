import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentShopId, requireShopMember } from '@/lib/auth/server';
import { getCachedTaxes } from '@/lib/data/taxes';
import type { ServiceCategoryRow, ServiceRow } from '@/db/rows';
import { ServicesClient } from './services-client';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string }> };

export default async function ServicesPage(props: Props) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);

  // Auth + shop scope. If the user has no confirmed shop, redirect away.
  await requireShopMember({ locale });
  const shopId = await getCurrentShopId();
  // `requireShopMember` guarantees a membership; treat the unreachable null
  // as a load failure → error.tsx (mirrors the calendar page's guard).
  if (!shopId) throw new Error('Services load failed: no active shop resolved');

  const supabase = createSupabaseServerClient();

  // Taxes come from the shared Data Cache (getCachedTaxes), busted by the tax
  // mutations; the service rows + link tables are per-request, parallelized.
  //
  // Services W3 (UX-05/BE-03) — every read is EXPLICITLY scoped to the active
  // shop. RLS (`is_shop_member`) spans every shop the user belongs to, so
  // without the filter a multi-shop owner saw BOTH shops' services merged in
  // one list — and the drag-reorder then rewrote interleaved cross-shop
  // sort_orders.
  const [servicesResult, categoriesResult, taxes, linksResult] = await Promise.all([
    supabase
      .from('services')
      .select('*')
      .eq('shop_id', shopId)
      .order('sort_order', { ascending: true }),
    supabase
      .from('service_categories')
      .select('*')
      .eq('shop_id', shopId)
      .order('sort_order', { ascending: true }),
    getCachedTaxes(shopId),
    supabase
      .from('service_taxes')
      .select('service_id, tax_id, services!inner(shop_id)')
      .eq('services.shop_id', shopId)
      .order('service_id', { ascending: true }),
  ]);

  // Services W3 — a failed read is NOT an empty catalog. Throwing routes to
  // the segment error.tsx (retry) instead of rendering the first-run empty
  // state over a DB hiccup.
  if (servicesResult.error || categoriesResult.error || linksResult.error) {
    throw new Error('Services load failed: catalog read errored');
  }

  const services = (servicesResult.data as ServiceRow[] | null) ?? [];
  const categories = (categoriesResult.data as ServiceCategoryRow[] | null) ?? [];
  const links = (
    (linksResult.data as Array<{ service_id: string; tax_id: string }> | null) ?? []
  ).map(({ service_id, tax_id }) => ({ service_id, tax_id }));

  return (
    <ServicesClient
      locale={locale}
      services={services}
      categories={categories}
      taxes={taxes}
      links={links}
    />
  );
}
