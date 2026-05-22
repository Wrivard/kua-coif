import { getRequestConfig } from 'next-intl/server';

export const locales = ['fr', 'en'] as const;
export const defaultLocale = 'fr' as const;
export type Locale = (typeof locales)[number];

function isLocale(value: string | undefined): value is Locale {
  return !!value && (locales as readonly string[]).includes(value);
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale: Locale = isLocale(requested) ? requested : defaultLocale;

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
