import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireShopMember } from '@/lib/auth/server';
import type { ProductBrandRow, ProductCategoryRow, ProductRow, TaxRow } from '@/db/rows';
import { ProductsClient } from './products-client';

export const dynamic = 'force-dynamic';

export default async function ProductsPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  await requireShopMember({ locale });

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

  const [productsResult, brandsResult, categoriesResult, taxesResult, linksResult] =
    await Promise.all([
      sb.from('products').select('*').order('name', { ascending: true }),
      sb.from('product_brands').select('*').order('name', { ascending: true }),
      sb.from('product_categories').select('*').order('name', { ascending: true }),
      sb.from('taxes').select('*').order('name', { ascending: true }),
      sb.from('product_taxes').select('*').order('product_id', { ascending: true }),
    ]);

  const products = (productsResult.data as ProductRow[] | null) ?? [];
  const brands = (brandsResult.data as ProductBrandRow[] | null) ?? [];
  const categories = (categoriesResult.data as ProductCategoryRow[] | null) ?? [];
  const taxes = (taxesResult.data as TaxRow[] | null) ?? [];
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
