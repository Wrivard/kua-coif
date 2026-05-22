import createMiddleware from 'next-intl/middleware';
import { defaultLocale, locales } from './i18n';

export default createMiddleware({
  locales,
  defaultLocale,
  localePrefix: 'always',
});

export const config = {
  // Match all routes except: API, Next.js internals, static assets.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
