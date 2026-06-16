'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { formatCurrencyCAD } from '@/lib/utils';

type Props = {
  expectedDrawer: number;
  locale: 'fr' | 'en';
};

/**
 * CashCountField — client-only cash reconciliation for the close-out drawer.
 *
 * The owner types the cash they physically counted; we show the live
 * over/short delta vs the expected drawer total. Display-only: nothing is
 * persisted (no schema change), matching the page's "write it in your own
 * ledger" model — this just does the subtraction for them, in real time.
 */
export function CashCountField({ expectedDrawer, locale }: Props) {
  const t = useTranslations('pages.finances.today.drawer');
  const [raw, setRaw] = useState('');

  const counted = parseAmount(raw);
  const delta = counted === null ? null : counted - expectedDrawer;

  return (
    <div className="space-y-2 border-t border-border pt-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="counted-cash" className="text-text-secondary">
          {t('countedLabel')}
        </label>
        <input
          id="counted-cash"
          type="text"
          inputMode="decimal"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={t('countedPlaceholder')}
          className="w-32 rounded-sm border border-border bg-bg-surface px-2 py-1 text-right tabular-nums text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        />
      </div>
      {delta !== null ? (
        <div className="flex items-center justify-between">
          <span className="text-text-secondary">{t('delta')}</span>
          <span className={`font-semibold tabular-nums ${deltaClass(delta)}`}>
            {formatDelta(delta, locale)} ({t(deltaWordKey(delta))})
          </span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Parse the owner's free-text amount. Keeps digits + separators, then treats
 * the RIGHTMOST `,`/`.` as the decimal point so both "1 234,56" (fr) and
 * "1,234.56" (en) parse correctly. Returns null on empty/unparseable input so
 * the delta line simply stays hidden until a real number is typed.
 */
function parseAmount(raw: string): number | null {
  const trimmed = raw.replace(/[^0-9,.]/g, '');
  if (trimmed === '') return null;
  const decimalPos = Math.max(trimmed.lastIndexOf(','), trimmed.lastIndexOf('.'));
  const normalized =
    decimalPos === -1
      ? trimmed
      : `${trimmed.slice(0, decimalPos).replace(/[,.]/g, '')}.${trimmed
          .slice(decimalPos + 1)
          .replace(/[,.]/g, '')}`;
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

function deltaClass(delta: number): string {
  if (delta === 0) return 'text-success';
  return delta < 0 ? 'text-danger' : 'text-warning';
}

function deltaWordKey(delta: number): 'balanced' | 'short' | 'over' {
  if (delta === 0) return 'balanced';
  return delta < 0 ? 'short' : 'over';
}

/**
 * Signed currency for the delta — a surplus gets an explicit "+" prefix
 * (Intl only renders "-" for negatives) so over vs short reads at a glance.
 */
function formatDelta(delta: number, locale: 'fr' | 'en'): string {
  const formatted = formatCurrencyCAD(Math.abs(delta), locale);
  if (delta > 0) return `+${formatted}`;
  if (delta < 0) return `-${formatted}`;
  return formatted;
}
