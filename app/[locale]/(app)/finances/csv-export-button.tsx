'use client';

import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

type BarberRow = { display_name: string; count: number; revenue: number };
type CommissionRow = {
  barberName: string;
  revenue: number;
  effectivePct: number;
  cumulative: boolean;
  commission: number;
};
type CategoryRow = { name: string; apptCount: number; revenue: number };

type Props = {
  rangeStartIso: string;
  rangeEndIso: string;
  byBarber: BarberRow[];
  commissions: CommissionRow[];
  byCategory: CategoryRow[];
};

/**
 * CsvExportButton — client-side CSV export for the /finances reporting hub.
 *
 * The three on-screen tables (by-barber, commissions, by-category) are
 * read-only; an owner doing payroll or bookkeeping needs the numbers OUT of
 * the page. This builds one CSV from the data ALREADY rendered (no new API
 * route, no re-query) and downloads it via a Blob URL — the same client-side
 * download grammar as `clients-client.tsx`'s export.
 *
 * Layout: three labelled sections in one file (title row, header row, data
 * rows, blank-line separator). Money is emitted as raw numbers (period
 * decimal, no currency glyph) so a spreadsheet can sum/sort them; a UTF-8 BOM
 * keeps accented barber/category names intact when opened in Excel.
 */
export function CsvExportButton({
  rangeStartIso,
  rangeEndIso,
  byBarber,
  commissions,
  byCategory,
}: Props) {
  const t = useTranslations('pages.finances');
  const isEmpty = byBarber.length === 0 && commissions.length === 0 && byCategory.length === 0;

  function handleExport() {
    const lines: string[] = [];

    lines.push(csvRow([t('byBarber.title')]));
    lines.push(
      csvRow([
        t('byBarber.columns.barber'),
        t('byBarber.columns.appointments'),
        t('byBarber.columns.revenue'),
      ]),
    );
    for (const b of byBarber) {
      lines.push(csvRow([b.display_name, b.count, b.revenue.toFixed(2)]));
    }
    lines.push('');

    lines.push(csvRow([t('commissions.title')]));
    lines.push(
      csvRow([
        t('commissions.columns.barber'),
        t('commissions.columns.revenue'),
        t('commissions.columns.rate'),
        t('commissions.columns.mode'),
        t('commissions.columns.commission'),
      ]),
    );
    for (const c of commissions) {
      lines.push(
        csvRow([
          c.barberName,
          c.revenue.toFixed(2),
          c.effectivePct.toFixed(1),
          c.cumulative ? t('commissions.modeCumulative') : t('commissions.modeSingle'),
          c.commission.toFixed(2),
        ]),
      );
    }
    lines.push('');

    lines.push(csvRow([t('byCategory.title')]));
    lines.push(
      csvRow([
        t('byCategory.columns.category'),
        t('byCategory.columns.appointments'),
        t('byCategory.columns.revenue'),
      ]),
    );
    for (const c of byCategory) {
      lines.push(csvRow([c.name, c.apptCount, c.revenue.toFixed(2)]));
    }

    // Prepend a UTF-8 byte-order mark (U+FEFF) so Excel reads accented
    // names correctly; \r\n line endings per RFC 4180.
    const csv = String.fromCharCode(0xfeff) + lines.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kua-finances-${rangeStartIso}_${rangeEndIso}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <Button type="button" size="sm" variant="secondary" onClick={handleExport} disabled={isEmpty}>
      <Download className="h-3.5 w-3.5" /> {t('export.button')}
    </Button>
  );
}

/**
 * Quote a CSV cell only when it contains a delimiter, quote, or newline
 * (RFC 4180): wrap in double quotes and double any internal quote.
 */
function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(cells: Array<string | number>): string {
  return cells.map(csvCell).join(',');
}
