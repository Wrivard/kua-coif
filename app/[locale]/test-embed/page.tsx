import Script from 'next/script';
import { setRequestLocale } from 'next-intl/server';
import { ArrowLeft, ExternalLink, Info } from 'lucide-react';

/**
 * Phase H+12 — public test-embed harness.
 *
 * Linked from /settings/widget so the operator can verify the embed
 * works end-to-end BEFORE pasting the snippet on their real site.
 * Mounts `widget.js` exactly the way a third-party site would, with
 * the actual `<div data-kua-widget>` placeholder, so any CSP /
 * frame-ancestors / theme / postMessage bug shows up here too.
 *
 * Query: ?slug=<shopAlias>. Without a slug we render a usage hint.
 *
 * No auth gate — anyone can hit this with any slug, same as the public
 * widget JS load itself. The only data revealed is what the salon
 * already chose to expose through the booking widget.
 */
export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ slug?: string; mode?: string; theme?: string }>;
};

const VALID_MODES = ['inline', 'floating-button', 'modal'] as const;
type WidgetMode = (typeof VALID_MODES)[number];

function snippetFor(mode: WidgetMode, slug: string, locale: 'fr' | 'en', theme: string | null) {
  const themeAttr = theme ? ` data-kua-theme="${theme}"` : '';
  if (mode === 'floating-button') {
    return `<!-- Küa booking widget (floating button) -->
<div data-kua-widget="${slug}" data-kua-locale="${locale}" data-kua-mode="floating-button"${themeAttr}></div>
<script src="/widget.js" async></script>`;
  }
  if (mode === 'modal') {
    const label = locale === 'en' ? 'Book now' : 'Réserver maintenant';
    return `<!-- Küa booking widget (modal API) -->
<button onclick="Kua.open('${slug}', { locale: '${locale}'${theme ? `, theme: '${theme}'` : ''} })">${label}</button>
<script src="/widget.js" async></script>`;
  }
  return `<!-- Küa booking widget -->
<div data-kua-widget="${slug}" data-kua-locale="${locale}"${themeAttr}></div>
<script src="/widget.js" async></script>`;
}

export default async function TestEmbedPage(props: Props) {
  const searchParams = await props.searchParams;
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);
  const slug = (searchParams?.slug ?? '').trim();
  const widgetLocale = locale === 'en' ? 'en' : 'fr';
  // Phase H+13 — pick the widget mode from `?mode=`, fall back to inline.
  const mode: WidgetMode = (VALID_MODES as readonly string[]).includes(searchParams?.mode ?? '')
    ? (searchParams!.mode as WidgetMode)
    : 'inline';
  const theme =
    searchParams?.theme === 'dark' ||
    searchParams?.theme === 'light' ||
    searchParams?.theme === 'auto'
      ? searchParams.theme
      : null;

  return (
    <div className="min-h-screen bg-bg-base text-text-primary">
      {/* TEST banner — makes it obvious this isn't a real salon site */}
      <div className="border-b border-accent/30 bg-accent-subtle px-4 py-3 text-center text-xs font-medium text-accent-text">
        <span className="inline-flex items-center gap-2">
          <Info className="h-3.5 w-3.5" />
          Test embed harness · mode: <code className="rounded bg-bg-base px-1">{mode}</code>
          {theme ? (
            <>
              {' '}
              · theme: <code className="rounded bg-bg-base px-1">{theme}</code>
            </>
          ) : null}
        </span>
      </div>
      <main className="mx-auto max-w-3xl space-y-8 px-4 py-12">
        <header className="space-y-2">
          <a
            href={`/${locale}/settings/widget`}
            className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
          >
            <ArrowLeft className="h-3 w-3" /> Back to widget settings
          </a>
          <h1 className="text-3xl font-semibold tracking-tight">
            {slug ? (
              <>
                Embedding <span className="text-accent">/{slug}</span>
              </>
            ) : (
              'Test embed'
            )}
          </h1>
          <p className="text-sm text-text-secondary">
            This page mounts the widget the same way a third-party salon site would. If the booking
            flow renders below, your embed is good to ship.
          </p>
        </header>

        {slug ? (
          <>
            {/* The placeholder — shape depends on mode. Modal mode
                renders a sample "Book now" button that calls
                Kua.open() since the placeholder div wouldn't show
                anything otherwise. */}
            <section className="rounded-lg border border-border bg-bg-surface p-6 shadow-sm">
              {mode === 'modal' ? (
                // Plain HTML button with an inline `onclick` so the
                // behaviour matches exactly what a salon would paste
                // on their site — no React, no client component, just
                // a script tag + this trigger. dangerouslySetInnerHTML
                // because Server Components can't carry an `onClick`
                // prop down to the DOM as a real listener.
                <div
                  dangerouslySetInnerHTML={{
                    __html: `<button type="button" onclick="Kua.open('${slug}', { locale: '${widgetLocale}'${
                      theme ? `, theme: '${theme}'` : ''
                    } })" style="display:inline-flex;height:44px;align-items:center;border-radius:9999px;background:#4f7d5e;color:white;padding:0 24px;font-size:14px;font-weight:600;border:0;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.15)">${
                      widgetLocale === 'en' ? 'Book now' : 'Réserver maintenant'
                    }</button>`,
                  }}
                />
              ) : (
                <div
                  data-kua-widget={slug}
                  data-kua-locale={widgetLocale}
                  data-kua-mode={mode === 'inline' ? undefined : mode}
                  data-kua-theme={theme ?? undefined}
                />
              )}
            </section>

            <Script src="/widget.js" strategy="afterInteractive" />

            <section className="rounded-lg border border-border bg-bg-surface-2 p-4 text-xs text-text-secondary">
              <p className="mb-2 font-semibold text-text-primary">Snippet rendered above</p>
              <pre className="overflow-x-auto rounded bg-bg-base p-3 leading-relaxed">
                {snippetFor(mode, slug, widgetLocale, theme)}
              </pre>
              <p className="mt-3">
                On a real site, the <code className="rounded bg-bg-base px-1">script src</code>{' '}
                points at{' '}
                <code className="rounded bg-bg-base px-1">
                  https://kua-coif.vercel.app/widget.js
                </code>
                .
              </p>
            </section>

            {/* Mode switcher so the operator can quickly compare the
                three integration styles on the same shop. */}
            <section className="flex flex-wrap gap-2 text-xs">
              <span className="self-center text-text-muted">Try another mode:</span>
              {VALID_MODES.filter((m) => m !== mode).map((m) => (
                <a
                  key={m}
                  href={`/${locale}/test-embed?slug=${encodeURIComponent(slug)}&mode=${m}${
                    theme ? `&theme=${theme}` : ''
                  }`}
                  className="rounded border border-border bg-bg-surface px-3 py-1.5 font-medium text-text-primary hover:bg-bg-surface-2"
                >
                  {m}
                </a>
              ))}
            </section>

            <a
              href={`/${locale}/embed/${encodeURIComponent(slug)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
            >
              Open the raw embed in a tab <ExternalLink className="h-3 w-3" />
            </a>
          </>
        ) : (
          <section className="rounded-lg border border-warning/30 bg-warning/10 p-6 text-sm text-warning">
            <p>
              No <code className="rounded bg-bg-base px-1 text-text-primary">?slug=</code> parameter
              found. Add one to test a specific shop, e.g.{' '}
              <code className="rounded bg-bg-base px-1 text-text-primary">
                /test-embed?slug=axum
              </code>
              .
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
