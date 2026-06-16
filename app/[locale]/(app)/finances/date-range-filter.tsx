'use client';

import { useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Props = {
  rangeStartIso: string;
  rangeEndIso: string;
  isDefaultRange: boolean;
};

/**
 * Date-range filter — plan 034 (PERF-08). Same fields and URL contract as the
 * old `<form method="get">` (`?start=YYYY-MM-DD&end=YYYY-MM-DD`, shareable /
 * bookmarkable), but Apply/reset go through router.push inside a transition,
 * so changing the range is a SOFT navigation: the server page re-renders with
 * the new searchParams while the shell/sidebar stay mounted — no full document
 * reload, no theme re-init. The page itself stays a server component.
 */
export function DateRangeFilter({ rangeStartIso, rangeEndIso, isDefaultRange }: Props) {
  const t = useTranslations('pages.finances');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function applyRange(start: string, end: string) {
    const params = new URLSearchParams({ start, end });
    startTransition(() => router.push(`?${params.toString()}`));
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    applyRange(String(data.get('start') ?? ''), String(data.get('end') ?? ''));
  }

  // Quick-range presets, derived from "now" at render. Each posts the same
  // ?start&end strings the manual form does; the page interprets them in the
  // SHOP's timezone (resolveRange), so the only tz-sensitive choice here is
  // which calendar day counts as "today" — for an operator working their own
  // shop the browser tz matches the shop's.
  const now = new Date();
  const sevenAgo = new Date(now);
  sevenAgo.setDate(now.getDate() - 6);
  const presets: Array<{ key: string; label: string; start: string; end: string }> = [
    {
      key: 'today',
      label: t('rangeForm.presets.today'),
      start: toIsoDate(now),
      end: toIsoDate(now),
    },
    {
      key: 'last7',
      label: t('rangeForm.presets.last7'),
      start: toIsoDate(sevenAgo),
      end: toIsoDate(now),
    },
    {
      key: 'thisMonth',
      label: t('rangeForm.presets.thisMonth'),
      start: toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)),
      end: toIsoDate(now),
    },
    {
      key: 'lastMonth',
      label: t('rangeForm.presets.lastMonth'),
      start: toIsoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      end: toIsoDate(new Date(now.getFullYear(), now.getMonth(), 0)),
    },
    {
      key: 'ytd',
      label: t('rangeForm.presets.ytd'),
      start: toIsoDate(new Date(now.getFullYear(), 0, 1)),
      end: toIsoDate(now),
    },
  ];

  return (
    <div className="space-y-3 rounded-lg bg-bg-surface p-4 shadow-sm">
      {/* Quick-range presets — one click sets the ?start&end range. The chip
          matching the active range reads "lit up" (accent), mirroring the
          calendar's filter chips. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          {t('rangeForm.presetsLabel')}
        </span>
        {presets.map((p) => {
          const isActive = p.start === rangeStartIso && p.end === rangeEndIso;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => applyRange(p.start, p.end)}
              aria-pressed={isActive}
              className={cn(
                'inline-flex h-7 items-center rounded-full px-3 text-xs font-medium transition-all duration-150 ease-out-quint',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base',
                isActive
                  ? 'bg-accent text-accent-fg shadow-accent-glow'
                  : 'border border-border bg-bg-surface text-text-secondary shadow-sm hover:bg-bg-surface-2 hover:text-text-primary',
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <form
        // The inputs are uncontrolled (defaultValue), mirroring the old GET
        // form; the key remounts them whenever the RESOLVED range changes so a
        // reset to "this month" refreshes what they display.
        key={`${rangeStartIso}:${rangeEndIso}`}
        onSubmit={handleSubmit}
        className="flex flex-wrap items-end gap-3"
      >
        <div className="flex flex-col gap-1">
          <label
            htmlFor="start"
            className="text-[11px] font-semibold uppercase tracking-wide text-text-muted"
          >
            {t('rangeForm.start')}
          </label>
          <input
            id="start"
            name="start"
            type="date"
            defaultValue={rangeStartIso}
            className="h-10 rounded-lg bg-bg-surface-2 px-3 text-sm text-text-primary shadow-sm transition-colors duration-150 ease-out-quint focus:outline-none focus:ring-2 focus:ring-focus"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor="end"
            className="text-[11px] font-semibold uppercase tracking-wide text-text-muted"
          >
            {t('rangeForm.end')}
          </label>
          <input
            id="end"
            name="end"
            type="date"
            defaultValue={rangeEndIso}
            className="h-10 rounded-lg bg-bg-surface-2 px-3 text-sm text-text-primary shadow-sm transition-colors duration-150 ease-out-quint focus:outline-none focus:ring-2 focus:ring-focus"
          />
        </div>
        {/* Wrap button + reset link in their own flex row so they baseline with
            the date inputs' bottom edge instead of floating midway. `pb-px`
            nudges them down 1px to align perfectly with the 40px-tall inputs. */}
        <div className="flex items-center gap-2 pb-px">
          <Button type="submit" size="sm" loading={isPending}>
            {t('rangeForm.apply')}
          </Button>
          {!isDefaultRange ? (
            <button
              type="button"
              onClick={() => startTransition(() => router.push('?'))}
              className="rounded-md px-3 py-2 text-xs font-medium text-text-secondary transition-colors duration-150 ease-out-quint hover:bg-bg-surface-2 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              {t('rangeForm.thisMonth')}
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}

/**
 * Local calendar date (browser tz) as YYYY-MM-DD — the wall-clock day the
 * operator sees. The page anchors these strings to the shop's timezone, so we
 * deliberately avoid UTC here (which could land on the wrong day near
 * midnight).
 */
function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
