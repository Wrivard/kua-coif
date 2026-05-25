import createNextIntlPlugin from 'next-intl/plugin';
import { withSentryConfig } from '@sentry/nextjs';

const withNextIntl = createNextIntlPlugin('./i18n.ts');

const isProd = process.env.NODE_ENV === 'production';
const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host
  : '*.supabase.co';

/**
 * Content Security Policy.
 *
 * Strict-ish: only same-origin scripts (no third-party JS), images from
 * self + Supabase storage + data URIs, connect to Supabase API.
 *
 * Why `'unsafe-inline'` on script-src in dev: Next.js injects HMR/RSC
 * payloads via inline scripts and tags. In prod we keep it because the
 * RSC payload still needs `eval()` for streaming SSR; the Next.js team
 * is iterating on a nonce-based alternative but it's not stable enough
 * to enforce here. We'll switch to nonces once Next 15+ exposes them as
 * first-class metadata.
 */
/**
 * Strict CSP for everything **except** the embed widget.
 *
 * Why split: `frame-ancestors` is per-shop on `/embed/[shopSlug]` (driven by
 * `shops.widget_config.allowed_origins`), which only the middleware can
 * resolve at request-time. We keep `frame-ancestors 'none'` here for the
 * rest of the app so any third-party iframe attempt is rejected.
 *
 * `'unsafe-inline'` on `script-src` is intentional: Next.js streaming + RSC
 * payloads use inline scripts and the runtime still needs `eval()` until
 * Next 15+ exposes a stable nonce API.
 */
function buildStrictCsp() {
  // Cloudflare Turnstile (Phase 30) needs script-src + frame-src + connect-src
  // entries for `challenges.cloudflare.com`. These are no-ops at runtime when
  // Turnstile env vars are absent (the widget never loads), but the CSP rule
  // is static so we include them unconditionally.
  const turnstileHost = 'https://challenges.cloudflare.com';
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${turnstileHost}${isProd ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https://${supabaseHost}`,
    "font-src 'self' data:",
    `connect-src 'self' https://${supabaseHost} wss://${supabaseHost} ${turnstileHost}`,
    `frame-src ${turnstileHost}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    isProd ? 'upgrade-insecure-requests' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

const securityHeaders = [
  { key: 'Content-Security-Policy', value: buildStrictCsp() },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
];

// Allow third-party sites to fetch `/widget.js`. Classic `<script src>` tags
// don't strictly need CORS but a permissive header avoids surprises if a
// salon's site fetches it via `import()` or with `crossorigin=anonymous`.
const widgetJsHeaders = [
  { key: 'Cache-Control', value: 'public, max-age=600, s-maxage=3600' },
  { key: 'Access-Control-Allow-Origin', value: '*' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },
  async headers() {
    // Embed routes are excluded from the global rule via negative lookahead
    // because the middleware sets their security headers per-request (the
    // CSP `frame-ancestors` is sourced from the shop's `widget_config`).
    // If we let the static rule below match `/embed/*` too, the strict
    // header would clobber whatever the middleware computed.
    return [
      {
        source: '/((?!.+/embed/.*).*)',
        headers: securityHeaders,
      },
      {
        source: '/widget.js',
        headers: widgetJsHeaders,
      },
    ];
  },
};

// Wrap with `withSentryConfig` so the Sentry webpack plugin handles
// source-map upload + tunneling. It's a no-op at runtime when no DSN is set
// (the Sentry SDK skips `init()`), and source-map upload only fires when
// `SENTRY_AUTH_TOKEN` is present. Keeping the wrapper unconditionally lets us
// flip the feature on by adding env vars — no code change needed.
const sentryOpts = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Tunneling routes Sentry traffic through our own origin to dodge
  // ad-blockers. Only enabled when explicitly configured.
  tunnelRoute: process.env.NEXT_PUBLIC_SENTRY_TUNNEL_ROUTE,
  // Silence the "no auth token" warning during local builds.
  silent: !process.env.SENTRY_AUTH_TOKEN,
  // Tree-shake Sentry's debug logger out of the production bundle (replaces
  // the deprecated `disableLogger: true` option).
  webpack: { treeshake: { removeDebugLogging: true } },
  widenClientFileUpload: true,
};

export default withSentryConfig(withNextIntl(nextConfig), sentryOpts);
