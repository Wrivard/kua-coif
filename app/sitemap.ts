import type { MetadataRoute } from 'next';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';

/**
 * Sitemap — public surface only.
 *
 * Listed:
 *   - locale roots (/fr, /en)
 *   - /privacy and /terms
 *   - every shop's /book/[alias] (one entry per alias)
 *
 * Not listed: the authenticated back-office (it's behind login and
 * blocked by robots.txt too).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://kua-coif.vercel.app';
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/fr`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${baseUrl}/en`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${baseUrl}/fr/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/en/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/fr/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/en/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];

  // Public shop booking pages.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return staticEntries;
  }
  try {
    const supabase = createSupabaseServiceRoleClient();
    const { data } = await supabase
      .from('shops')
      .select('alias, updated_at')
      .not('alias', 'is', null);
    const shops = data ?? [];
    const bookEntries: MetadataRoute.Sitemap = shops.flatMap((s) => [
      {
        url: `${baseUrl}/fr/book/${s.alias}`,
        lastModified: new Date(s.updated_at),
        changeFrequency: 'daily' as const,
        priority: 0.8,
      },
      {
        url: `${baseUrl}/en/book/${s.alias}`,
        lastModified: new Date(s.updated_at),
        changeFrequency: 'daily' as const,
        priority: 0.8,
      },
    ]);
    return [...staticEntries, ...bookEntries];
  } catch {
    return staticEntries;
  }
}
