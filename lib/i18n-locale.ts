/**
 * Coerce a shop's stored `default_language` (a free-form text column that may
 * be null or hold any string) to one of our two supported locales, defaulting
 * to FR (the Québec default).
 *
 * Plan 025e — replaces the inline `default_language`-to-locale coercion that
 * was pasted at every shop-email send site.
 */
export function shopLocale(defaultLanguage: string | null | undefined): 'fr' | 'en' {
  return defaultLanguage === 'en' ? 'en' : 'fr';
}
