'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  resolveDocs,
  type DocArticle,
  type DocBlock,
  type DocFeature,
  type DocLocale,
} from './content';

export function DocumentationBrowser({ locale }: { locale: DocLocale }) {
  const t = useTranslations('pages.documentation');
  const features = useMemo(() => resolveDocs(locale), [locale]);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(features[0]?.id ?? '');

  const q = query.trim().toLowerCase();
  const selected = features.find((f) => f.id === selectedId) ?? features[0];

  // Search mode: flat list of every article whose precomputed blob matches.
  const results = useMemo(() => {
    if (!q) return [];
    const out: Array<{ feature: DocFeature; article: DocArticle }> = [];
    for (const f of features) {
      for (const a of f.articles) {
        if (a.search.includes(q) || f.title.toLowerCase().includes(q)) {
          out.push({ feature: f, article: a });
        }
      }
    }
    return out;
  }, [q, features]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="relative mb-6">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
          className="w-full rounded-lg border border-border bg-bg-surface py-2.5 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-focus"
        />
      </div>

      {q ? (
        results.length === 0 ? (
          <p className="rounded-lg border border-border bg-bg-surface px-4 py-10 text-center text-sm text-text-muted">
            {t('noResults', { query })}
          </p>
        ) : (
          <div className="space-y-2.5">
            <p className="px-1 text-xs text-text-muted">
              {t('resultsCount', { count: results.length })}
            </p>
            {results.map(({ feature, article }) => (
              <ArticleCard
                key={`${feature.id}-${article.id}`}
                article={article}
                featureLabel={feature.title}
                defaultOpen
              />
            ))}
          </div>
        )
      ) : (
        <div className="flex flex-col gap-6 md:flex-row">
          <nav className="md:w-60 md:shrink-0" aria-label={t('featuresLabel')}>
            <ul className="flex flex-wrap gap-1.5 md:sticky md:top-[88px] md:flex-col md:gap-1">
              {features.map((f) => {
                const Icon = f.icon;
                const active = f.id === selected?.id;
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(f.id)}
                      aria-current={active ? 'true' : undefined}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                        active
                          ? 'bg-bg-surface-2 font-semibold text-text-primary shadow-sm'
                          : 'text-text-secondary hover:bg-bg-surface-2 hover:text-text-primary',
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      <span className="truncate">{f.title}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="min-w-0 flex-1">
            {selected ? (
              <>
                <div className="mb-4">
                  <h2 className="text-lg font-semibold tracking-tight text-text-primary">
                    {selected.title}
                  </h2>
                  <p className="mt-1 text-sm text-text-secondary">{selected.summary}</p>
                </div>
                <div className="space-y-2.5">
                  {selected.articles.map((a) => (
                    <ArticleCard key={a.id} article={a} />
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function ArticleCard({
  article,
  featureLabel,
  defaultOpen,
}: {
  article: DocArticle;
  featureLabel?: string;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="group rounded-lg border border-border bg-bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-text-primary [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          {featureLabel ? (
            <span className="mr-2 rounded bg-bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
              {featureLabel}
            </span>
          ) : null}
          {article.title}
        </span>
        <ChevronDown
          aria-hidden
          className="h-4 w-4 shrink-0 text-text-muted transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="space-y-3 border-t border-border-soft px-4 py-3.5">
        {article.blocks.map((b, i) => (
          <Block key={i} block={b} />
        ))}
      </div>
    </details>
  );
}

function Block({ block }: { block: DocBlock }) {
  switch (block.kind) {
    case 'p':
      return <p className="text-sm leading-relaxed text-text-secondary">{block.text}</p>;
    case 'list':
      return (
        <ul className="ml-5 list-disc space-y-1.5 text-sm leading-relaxed text-text-secondary">
          {block.items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ul>
      );
    case 'steps':
      return (
        <ol className="ml-5 list-decimal space-y-1.5 text-sm leading-relaxed text-text-secondary">
          {block.items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ol>
      );
    case 'note':
      return (
        <div
          className={cn(
            'rounded-md border px-3 py-2 text-sm leading-relaxed text-text-secondary',
            block.tone === 'warn'
              ? 'border-warning/30 bg-warning-subtle'
              : 'border-accent/20 bg-accent-subtle',
          )}
        >
          {block.text}
        </div>
      );
  }
}
