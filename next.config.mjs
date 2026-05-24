import createNextIntlPlugin from 'next-intl/plugin';

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
// Build a CSP string, parameterized on the `frame-ancestors` directive so we
// can apply a strict policy globally and a relaxed one for the embed widget.
function buildCsp(frameAncestors) {
  return [
    "default-src 'self'",
    // Next.js streaming + HMR need eval and inline.
    `script-src 'self' 'unsafe-inline' 'unsafe-eval'${isProd ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https://${supabaseHost}`,
    "font-src 'self' data:",
    `connect-src 'self' https://${supabaseHost} wss://${supabaseHost}`,
    `frame-ancestors ${frameAncestors}`,
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    isProd ? 'upgrade-insecure-requests' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

const securityHeaders = [
  { key: 'Content-Security-Policy', value: buildCsp("'none'") },
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

// Embed-friendly overrides for `/:locale/embed/*`. We swap the CSP for one
// that allows `frame-ancestors *` (V1 — V1.1 will read a per-shop whitelist
// via middleware) and clear `X-Frame-Options` since it conflicts with CSP
// when the latter wants to permit cross-origin embedding.
const embedHeaders = [
  { key: 'Content-Security-Policy', value: buildCsp('*') },
  // The empty-string trick removes the header that the global rule set.
  // Next.js's `headers()` merges by key with the LAST match winning.
  { key: 'X-Frame-Options', value: '' },
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
    // Order matters: rules are applied top-to-bottom, and for duplicate keys
    // the LAST matching rule wins. Strict headers go first, then embed and
    // widget.js override the bits they need to relax.
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
      {
        source: '/:locale(fr|en)/embed/:path*',
        headers: embedHeaders,
      },
      {
        source: '/widget.js',
        headers: widgetJsHeaders,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
