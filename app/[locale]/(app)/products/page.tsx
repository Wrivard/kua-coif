import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentShopId, requireShopMember } from '@/lib/auth/server';
import { getCachedTaxes } from '@/lib/data/taxes';
import type { ProductBrandRow, ProductCategoryRow, ProductRow } from '@/db/rows';
import { ProductsClient } from './products-client';

export const dynamic = 'force-dynamic';

export default async function ProductsPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);
  await requireShopMember({ locale });
  const shopId = await getCurrentShopId();
  // Scoping fix (services-audit annex) — `requireShopMember` guarantees a
  // membership; the null guard is defensive, mirroring /settings/audit-log.
  if (!shopId) {
    return (
      <ProductsClient
        locale={locale}
        products={[]}
        brands={[]}
        categories={[]}
        taxes={[]}
        links={[]}
      />
    );
  }

  const supabase = createSupabaseServerClient();
  const sb = supabase as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (
          k: string,
          v: string,
        ) => {
          order: (
            k: string,
            opts?: { ascending?: boolean },
          ) => Promise<{ data: unknown; error: unknown }>;
        };
        order: (
          k: string,
          opts?: { ascending?: boolean },
        ) => Promise<{ data: unknown; error: unknown }>;
      };
    };
  };

  // Taxes come from the shared Data Cache (getCachedTaxes) — the same rows
  // /settings/taxes caches, busted by the tax mutations; the rest are
  // per-request reads, all run in one parallel round.
  //
  // Scoping fix (services-audit annex) — these reads relied on RLS alone,
  // which returns rows for EVERY shop the member belongs to: a multi-shop
  // owner saw all shops' catalogs interleaved. Scope to the ACTIVE shop.
  // `product_taxes` carries no shop_id (pure M:N) — its links are filtered
  // in memory against the scoped products below instead.
  const [productsResult, brandsResult, categoriesResult, taxes, linksResult] = await Promise.all([
    sb.from('products').select('*').eq('shop_id', shopId).order('name', { ascending: true }),
    sb.from('product_brands').select('*').eq('shop_id', shopId).order('name', { ascending: true }),
    sb
      .from('product_categories')
      .select('*')
      .eq('shop_id', shopId)
      .order('name', { ascending: true }),
    getCachedTaxes(shopId),
    sb.from('product_taxes').select('*').order('product_id', { ascending: true }),
  ]);

  const products = (productsResult.data as ProductRow[] | null) ?? [];
  const brands = (brandsResult.data as ProductBrandRow[] | null) ?? [];
  const categories = (categoriesResult.data as ProductCategoryRow[] | null) ?? [];
  const productIds = new Set(products.map((p) => p.id));
  const links = (
    (linksResult.data as Array<{ product_id: string; tax_id: string }> | null) ?? []
  ).filter((l) => productIds.has(l.product_id));

  return (
    <ProductsClient
      locale={locale}
      products={products}
      brands={brands}
      categories={categories}
      taxes={taxes}
      links={links}
    />
  );
}
