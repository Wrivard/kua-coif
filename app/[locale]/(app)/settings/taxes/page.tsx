import { setRequestLocale } from 'next-intl/server';
import { getCurrentShopId, requireShopMember } from '@/lib/auth/server';
import { getCachedTaxes } from '@/lib/data/taxes';
import { TaxesClient } from './taxes-client';

// The page is dynamic regardless (requireShopMember reads auth cookies); the
// perf win is the cross-request Data Cache on the taxes query (getCachedTaxes),
// not static rendering — so force-dynamic stays accurate.
export const dynamic = 'force-dynamic';

export default async function TaxesPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  await requireShopMember({ locale });

  const shopId = await getCurrentShopId();
  const taxes = shopId ? await getCachedTaxes(shopId) : [];

  return <TaxesClient taxes={taxes} />;
}
