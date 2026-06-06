import createNextIntlPlugin from 'next-intl/plugin';
import { withSentryConfig } from '@sentry/nextjs';
import bundleAnalyzer from '@next/bundle-analyzer';

const withNextIntl = createNextIntlPlugin('./i18n.ts');

/**
 * Loop 40 (P116) — `pnpm analyze` triggers the bundle analyzer:
 *   ANALYZE=true pnpm build
 * Opens an interactive treemap of every route's JS chunks so we can
 * spot unexpectedly large deps. The wrapper is a no-op without the
 * env var so the regular `pnpm build` is unchanged.
 */
const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

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

  // Stripe Elements (Phase 56 / Loop 5) injects an iframe from js.stripe.com
  // for the card-input UI and posts tokenization requests to api.stripe.com.
  // Without these entries the booking wizard's payment step renders a blank
  // PaymentElement and Stripe.js silently fails. Card-brand icons load from
  // *.stripe.com so img-src needs them too. Static includes — when Stripe
  // env vars are absent the SDK never initializes and the rules are no-ops.
  const stripeJs = 'https://js.stripe.com';
  const stripeApi = 'https://api.stripe.com';
  const stripeHooks = 'https://hooks.stripe.com';

  // Sentry browser SDK (Phase 81 / Loop 17) POSTs error + performance events
  // to the `*.ingest.sentry.io` endpoint derived from the DSN. Without this
  // connect-src entry the SDK initializes fine but every event gets blocked
  // by CSP — symptoms are silent (no console errors visible to the user,
  // but zero events land in Sentry). Wildcard covers all ingest regions
  // (us/eu/relay) without forcing region-specific entries.
  const sentryIngest = 'https://*.sentry.io';

  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${turnstileHost} ${stripeJs}${isProd ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https://${supabaseHost} https://*.stripe.com`,
    "font-src 'self' data:",
    `connect-src 'self' https://${supabaseHost} wss://${supabaseHost} ${turnstileHost} ${stripeApi} ${sentryIngest}`,
    // `'self'` is required so admin surfaces can iframe their own
    // `/embed/[shopSlug]` route for the live preview pane in
    // /settings/widget. Stripe Elements iframes (`js.stripe.com`,
    // `hooks.stripe.com` for 3DS) gate the booking payment step.
    `frame-src 'self' ${turnstileHost} ${stripeJs} ${stripeHooks}`,
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
  // Perf: guarantee tree-shaking of heavy barrel-imported libs regardless
  // of version (lucide-react is pinned to an unusual 1.16.0; without this a
  // barrel `import { Icon } from 'lucide-react'` can pull the whole set).
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts', 'date-fns'],
  },
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

// Compose: bundle-analyzer wraps Sentry wraps next-intl wraps nextConfig.
// Analyzer outermost so it sees the final webpack config Sentry produced.
export default withBundleAnalyzer(withSentryConfig(withNextIntl(nextConfig), sentryOpts));
