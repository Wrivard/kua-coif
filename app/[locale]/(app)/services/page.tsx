import { setRequestLocale } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireShopMember } from '@/lib/auth/server';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Construction } from 'lucide-react';
import type { ServiceCategoryRow, ServiceRow, TaxRow } from '@/db/rows';
import { ServicesClient } from './services-client';

export const dynamic = 'force-dynamic';

type Props = { params: { locale: string } };

export default async function ServicesPage({ params: { locale } }: Props) {
  setRequestLocale(locale);

  // Auth + shop scope. If the user has no confirmed shop, redirect away.
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

  // Three lightweight reads; each is RLS-protected so we don't pass shop_id
  // explicitly. Could be parallelized via Promise.all if it ever becomes hot.
  const [servicesResult, categoriesResult, taxesResult, linksResult] = await Promise.all([
    sb.from('services').select('*').order('sort_order', { ascending: true }),
    sb.from('service_categories').select('*').order('sort_order', { ascending: true }),
    sb.from('taxes').select('*').order('name', { ascending: true }),
    sb.from('service_taxes').select('*').order('service_id', { ascending: true }),
  ]);

  const services = (servicesResult.data as ServiceRow[] | null) ?? [];
  const categories = (categoriesResult.data as ServiceCategoryRow[] | null) ?? [];
  const taxes = (taxesResult.data as TaxRow[] | null) ?? [];
  const links = (linksResult.data as Array<{ service_id: string; tax_id: string }> | null) ?? [];

  return (
    <ServicesView
      locale={locale}
      services={services}
      categories={categories}
      taxes={taxes}
      links={links}
    />
  );
}

function ServicesView({
  locale,
  services,
  categories,
  taxes,
  links,
}: {
  locale: string;
  services: ServiceRow[];
  categories: ServiceCategoryRow[];
  taxes: TaxRow[];
  links: Array<{ service_id: string; tax_id: string }>;
}) {
  const t = useTranslations('pages.services');
  const tEmpty = useTranslations('common');

  if (services.length === 0 && categories.length === 0) {
    return (
      <>
        <PageHeader title={t('title')} />
        <div className="p-6">
          <EmptyState
            icon={<Construction className="h-8 w-8" />}
            title={tEmpty('actions.add')}
            description={t('emptyHint')}
          />
        </div>
      </>
    );
  }

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
