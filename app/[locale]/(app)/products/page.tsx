import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentShopId, requireShopMember } from '@/lib/auth/server';
import { getCachedTaxes } from '@/lib/data/taxes';
import type { ProductBrandRow, ProductCategoryRow, ProductRow, TaxRow } from '@/db/rows';
import { ProductsClient } from './products-client';

export const dynamic = 'force-dynamic';

export default async function ProductsPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);
  await requireShopMember({ locale });
  const shopId = await getCurrentShopId();

  const supabase = createSupabaseServerClient();
  const sb = supabase as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
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
  const [productsResult, brandsResult, categoriesResult, taxes, linksResult] = await Promise.all([
    sb.from('products').select('*').order('name', { ascending: true }),
    sb.from('product_brands').select('*').order('name', { ascending: true }),
    sb.from('product_categories').select('*').order('name', { ascending: true }),
    shopId ? getCachedTaxes(shopId) : Promise.resolve([] as TaxRow[]),
    sb.from('product_taxes').select('*').order('product_id', { ascending: true }),
  ]);

  const products = (productsResult.data as ProductRow[] | null) ?? [];
  const brands = (brandsResult.data as ProductBrandRow[] | null) ?? [];
  const categories = (categoriesResult.data as ProductCategoryRow[] | null) ?? [];
  const links = (linksResult.data as Array<{ product_id: string; tax_id: string }> | null) ?? [];

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
