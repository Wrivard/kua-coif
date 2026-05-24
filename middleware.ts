import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { defaultLocale, locales } from './i18n';
import { refreshSupabaseSession } from './lib/supabase/middleware';

const handleI18n = createIntlMiddleware({
  locales,
  defaultLocale,
  localePrefix: 'always',
});

// Public path prefixes (under the locale segment). Anything else inside the
// authenticated shell requires a session — see redirect logic below.
const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/book', // public booking flow (Phase 8)
  '/kitchen-sink', // design system gallery — always accessible for review
];

function stripLocale(pathname: string): string {
  const segs = pathname.split('/').filter(Boolean);
  if (segs.length === 0) return '/';
  if ((locales as readonly string[]).includes(segs[0]!)) {
    const rest = segs.slice(1).join('/');
    return rest ? `/${rest}` : '/';
  }
  return pathname;
}

function isPublicPath(pathname: string): boolean {
  const withoutLocale = stripLocale(pathname);
  return PUBLIC_PATH_PREFIXES.some((p) => withoutLocale === p || withoutLocale.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  // 1. next-intl handles the locale segment (redirects /foo → /fr/foo etc.).
  //    Whatever response it produces is the base we'll mutate.
  const response = handleI18n(request);

  // If next-intl already issued a redirect, just refresh the session on top of
  // it and let the redirect happen — no point gating against an unauthenticated
  // user before they've even reached the right URL.
  if (response.headers.get('location')) {
    await refreshSupabaseSession(request, response);
    return response;
  }

  // 2. Refresh the Supabase session and learn who's logged in.
  const { user, skipped } = await refreshSupabaseSession(request, response);

  // If Supabase isn't configured yet, behave like the design system: allow
  // everything through. Phase 4+ will require real env vars.
  if (skipped) return response;

  const pathname = request.nextUrl.pathname;
  const isPublic = isPublicPath(pathname);

  // Not authenticated → bounce to login (preserve where they were going).
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    const segs = pathname.split('/').filter(Boolean);
    const locale = (locales as readonly string[]).includes(segs[0] ?? '') ? segs[0] : defaultLocale;
    url.pathname = `/${locale}/login`;
    url.searchParams.set('redirect', pathname);
    return NextResponse.redirect(url);
  }

  // Authenticated user hitting /login or /signup → send them home.
  if (user && (pathname.endsWith('/login') || pathname.endsWith('/signup'))) {
    const url = request.nextUrl.clone();
    const segs = pathname.split('/').filter(Boolean);
    const locale = (locales as readonly string[]).includes(segs[0] ?? '') ? segs[0] : defaultLocale;
    url.pathname = `/${locale}/`;
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Match all routes except: API, Next.js internals, static assets.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
