import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { defaultLocale, locales } from './i18n';
import { refreshSupabaseSession } from './lib/supabase/middleware';
import { frameAncestorsFor, parseWidgetConfig } from './lib/business/widget-config';

const handleI18n = createIntlMiddleware({
  locales,
  defaultLocale,
  localePrefix: 'always',
});

// Public path prefixes (under the locale segment). Anything else inside the
// authenticated shell requires a session — see redirect logic below.
//
// `/signup` is intentionally absent: self-signup is disabled by the whitelist
// auth model (Phase 22). The route itself doesn't exist anymore — accounts
// are created via `/admin/shops/new` (Küa) or `/settings/users` (shop
// owners/managers), both behind auth.
const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/forgot-password',
  '/reset-password',
  '/setup-password', // first-login flow for invitees (Phase 22)
  '/book', // public booking flow (Phase 8)
  '/embed', // embeddable widget (Phase 10) — must be unauthenticated
  '/kitchen-sink', // design system gallery — always accessible for review
  '/privacy', // legal — Loi 25 Quebec (Phase 9)
  '/terms',
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

// ---------------------------------------------------------------------------
// Embed-route CSP — Phase 20
// ---------------------------------------------------------------------------
// `/[locale]/embed/[shopSlug]` is excluded from the static `headers()` rule in
// next.config.mjs because its `frame-ancestors` directive is per-shop, read
// from `shops.widget_config.allowed_origins`. We build the whole security
// header set here so the strict global CSP can't clobber what we computed.

const EMBED_MATCH = /^\/(fr|en)\/embed\/([^/]+)/u;

type EmbedConfigCacheEntry = { allowedOrigins: string[]; expiresAt: number };

/**
 * Module-level LRU keyed by `shopSlug`. State is per-Edge-instance, so this
 * is "best effort" caching — cold starts drop it. With a 60-second TTL the
 * worst case is one Supabase round-trip per slug per Edge instance per minute,
 * which trades cleanly against the iframe load latency budget.
 */
const embedConfigCache = new Map<string, EmbedConfigCacheEntry>();
const EMBED_CACHE_TTL_MS = 60_000;

const isProdRuntime = process.env.NODE_ENV === 'production';

function getSupabaseHost(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return '*.supabase.co';
  try {
    return new URL(url).host;
  } catch {
    return '*.supabase.co';
  }
}

/**
 * Build the CSP for an embed page. Mirrors `buildStrictCsp()` in
 * next.config.mjs but with the `frame-ancestors` directive computed from the
 * shop's whitelist. Keep this in sync with that builder — both must allow
 * the same Supabase host / inline scripts / etc., otherwise the widget will
 * silently break for one but not the other.
 */
function buildEmbedCsp(frameAncestors: string): string {
  const supabaseHost = getSupabaseHost();
  // Cloudflare Turnstile (Phase 30) — same whitelist as the strict CSP in
  // next.config.mjs. The embed iframe also runs the booking wizard, so it
  // needs Turnstile entries too if the env vars are configured.
  const turnstileHost = 'https://challenges.cloudflare.com';
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${turnstileHost}${isProdRuntime ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https://${supabaseHost}`,
    "font-src 'self' data:",
    `connect-src 'self' https://${supabaseHost} wss://${supabaseHost} ${turnstileHost}`,
    `frame-src ${turnstileHost}`,
    `frame-ancestors ${frameAncestors}`,
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    isProdRuntime ? 'upgrade-insecure-requests' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

/**
 * Resolve the `allowed_origins` whitelist for a shop's widget config. Cached
 * for `EMBED_CACHE_TTL_MS`. Falls back to `[]` (which `frameAncestorsFor`
 * turns into `*`) on any error or when Supabase env vars are missing —
 * we'd rather serve a permissive widget than a 500.
 *
 * Uses a direct PostgREST fetch instead of `@supabase/supabase-js` to keep
 * the Edge middleware bundle as small as possible.
 */
async function resolveEmbedAllowedOrigins(shopSlug: string): Promise<string[]> {
  const now = Date.now();
  const cached = embedConfigCache.get(shopSlug);
  if (cached && cached.expiresAt > now) return cached.allowedOrigins;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    embedConfigCache.set(shopSlug, { allowedOrigins: [], expiresAt: now + EMBED_CACHE_TTL_MS });
    return [];
  }

  try {
    const res = await fetch(
      `${url}/rest/v1/shops?alias=eq.${encodeURIComponent(shopSlug)}&select=widget_config&limit=1`,
      {
        // Service-role bypasses RLS — fine because we only read the widget
        // config column, which is non-sensitive by design.
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        // Edge cache: 30s lets multiple iframes load over a short burst
        // without hammering Supabase. Our own in-memory cache is longer.
        cache: 'force-cache',
        next: { revalidate: 30 },
      },
    );
    if (!res.ok) {
      embedConfigCache.set(shopSlug, { allowedOrigins: [], expiresAt: now + EMBED_CACHE_TTL_MS });
      return [];
    }
    const data = (await res.json()) as Array<{ widget_config: unknown }>;
    const cfg = parseWidgetConfig(data[0]?.widget_config);
    embedConfigCache.set(shopSlug, {
      allowedOrigins: cfg.allowed_origins,
      expiresAt: now + EMBED_CACHE_TTL_MS,
    });
    return cfg.allowed_origins;
  } catch {
    embedConfigCache.set(shopSlug, { allowedOrigins: [], expiresAt: now + EMBED_CACHE_TTL_MS });
    return [];
  }
}

/**
 * Apply the full security header set for an embed page. We set every header
 * the global `next.config.mjs` rule would have set, plus the per-shop CSP,
 * minus `X-Frame-Options` (which can't coexist with cross-origin
 * `frame-ancestors` — modern browsers ignore it when CSP is present anyway,
 * but legacy browsers would honor the `DENY` and block the iframe).
 */
async function applyEmbedSecurityHeaders(response: NextResponse, shopSlug: string): Promise<void> {
  const allowed = await resolveEmbedAllowedOrigins(shopSlug);
  // We synthesize a minimal WidgetConfig-shaped object — `frameAncestorsFor`
  // only reads the `allowed_origins` field so we don't need to round-trip a
  // full parse.
  const frameAncestors = frameAncestorsFor({
    allowed_origins: allowed,
    // Stub the rest so TypeScript is happy.
    show_address: true,
    show_phone: false,
    mode: 'dark',
    font_family: 'system',
    border_radius: 'rounded',
    show_professional_first: false,
    allow_multi_service: true,
    show_tip_step: false,
    show_promo_code: false,
    default_locale: 'fr',
  });

  response.headers.set('Content-Security-Policy', buildEmbedCsp(frameAncestors));
  response.headers.delete('X-Frame-Options');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  );
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  response.headers.set('X-DNS-Prefetch-Control', 'on');
}

// ---------------------------------------------------------------------------
// Main middleware
// ---------------------------------------------------------------------------

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

  const pathname = request.nextUrl.pathname;

  // 3. Embed routes get their own dynamic CSP (Phase 20). We compute it even
  //    when Supabase is "skipped" — `resolveEmbedAllowedOrigins` handles that
  //    case and falls back to a permissive default.
  const embedMatch = EMBED_MATCH.exec(pathname);
  if (embedMatch) {
    await applyEmbedSecurityHeaders(response, decodeURIComponent(embedMatch[2]!));
  }

  // If Supabase isn't configured yet, behave like the design system: allow
  // everything through. Phase 4+ will require real env vars.
  if (skipped) return response;

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

  // Authenticated user hitting /login → send them home. (`/signup` no longer
  // exists; the matching clause was removed in Phase 22.)
  if (user && pathname.endsWith('/login')) {
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
