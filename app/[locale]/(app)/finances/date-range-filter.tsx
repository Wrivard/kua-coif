'use client';

import { useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

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

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const params = new URLSearchParams({
      start: String(data.get('start') ?? ''),
      end: String(data.get('end') ?? ''),
    });
    startTransition(() => router.push(`?${params.toString()}`));
  }

  return (
    <form
      // The inputs are uncontrolled (defaultValue), mirroring the old GET
      // form; the key remounts them whenever the RESOLVED range changes so a
      // reset to "this month" refreshes what they display.
      key={`${rangeStartIso}:${rangeEndIso}`}
      onSubmit={handleSubmit}
      className="flex flex-wrap items-end gap-3 rounded-lg bg-bg-surface p-4 shadow-sm"
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
  );
}
