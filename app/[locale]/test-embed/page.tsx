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
  params: { locale: string };
  searchParams: { slug?: string };
};

export default function TestEmbedPage({ params: { locale }, searchParams }: Props) {
  setRequestLocale(locale);
  const slug = (searchParams?.slug ?? '').trim();
  const widgetLocale = locale === 'en' ? 'en' : 'fr';

  return (
    <div className="min-h-screen bg-bg-base text-text-primary">
      {/* TEST banner — makes it obvious this isn't a real salon site */}
      <div className="border-accent/30 border-b bg-accent-subtle px-4 py-3 text-center text-xs font-medium text-accent">
        <span className="inline-flex items-center gap-2">
          <Info className="h-3.5 w-3.5" />
          Test embed harness — mounted via the same widget.js public sites use.
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
            {/* The placeholder + script — copied verbatim from the snippet card */}
            <section className="rounded-lg border border-border bg-bg-surface p-6 shadow-sm">
              {/* eslint-disable-next-line react/no-unknown-property */}
              <div data-kua-widget={slug} data-kua-locale={widgetLocale} />
            </section>

            <Script src="/widget.js" strategy="afterInteractive" />

            <section className="rounded-lg border border-border bg-bg-surface-2 p-4 text-xs text-text-secondary">
              <p className="mb-2 font-semibold text-text-primary">Snippet rendered above</p>
              <pre className="overflow-x-auto rounded bg-bg-base p-3 leading-relaxed">
                {`<!-- Küa booking widget -->
<div data-kua-widget="${slug}" data-kua-locale="${widgetLocale}"></div>
<script src="/widget.js" async></script>`}
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
          <section className="border-warning/30 bg-warning/10 rounded-lg border p-6 text-sm text-warning">
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
