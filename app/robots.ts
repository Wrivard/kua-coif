import type { MetadataRoute } from 'next';

/**
 * Robots.txt for crawlers.
 *
 * We let bots index the public booking pages (so a shop's URL ranks on
 * Google) and the locale roots, but explicitly disallow everything under
 * /(fr|en)/(app)/* — those are gated by auth anyway, but defense in
 * depth keeps them out of search results entirely.
 */
export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://kua-coif.vercel.app';
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/fr', '/en', '/fr/book/', '/en/book/'],
        disallow: [
          '/fr/clients',
          '/fr/services',
          '/fr/barbers',
          '/fr/products',
          '/fr/finances',
          '/fr/marketing',
          '/fr/support',
          '/fr/settings',
          '/fr/kitchen-sink',
          '/en/clients',
          '/en/services',
          '/en/barbers',
          '/en/products',
          '/en/finances',
          '/en/marketing',
          '/en/support',
          '/en/settings',
          '/en/kitchen-sink',
          '/api/',
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
