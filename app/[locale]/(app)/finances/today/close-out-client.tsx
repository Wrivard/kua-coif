'use client';

import { useEffect, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * CloseOutClient — wraps the daily close-out page with print-styled CSS,
 * a "Print / Save as PDF" action button, and an auto-print trigger on
 * `?print=1` (used by a future email link "Open and print today's
 * close-out").
 *
 * Pattern mirrored from `app/[locale]/receipt/[token]/receipt-client.tsx`:
 * inline `<style jsx global>` with `@media print` rules to collapse the
 * page to clean black-on-white, hide `.no-print` chrome (sidebar, FAB,
 * the action bar), and force a sensible `@page` margin.
 */
export function CloseOutClient({
  autoPrint,
  children,
}: {
  autoPrint: boolean;
  children: ReactNode;
}) {
  // Plan 041 (FIN-04) — the hardcoded 'Imprimer'/'Print' pair was the last
  // component-code string on this page; route it through next-intl like
  // everything else (and drop the now-unused locale prop).
  const t = useTranslations('pages.finances.today');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (autoPrint) {
      // Slight delay so React paint completes first.
      window.setTimeout(() => window.print(), 400);
    }
  }, [autoPrint]);

  return (
    <>
      {/* Print stylesheet — collapses the app shell to a clean printable
          report. Loop 26 self-review: original draft hid
          `nav[aria-label='Sidebar']` (wrong — the real attribute is
          `Primary navigation`) and missed the FabButtons (they sit on
          a `position:fixed` div with no role/label). The reliable
          hammer is `position: fixed` itself — fixed positioning is
          meaningless on paper and always belongs to floating chrome
          (FAB, sticky action bar, mobile-sidebar overlay). We still
          target `aside` explicitly to cover the desktop sidebar which
          is sticky, not fixed. */}
      <style jsx global>{`
        @media print {
          body {
            background: white !important;
          }
          .no-print,
          .fixed {
            display: none !important;
          }
          aside {
            display: none !important;
          }
          main {
            margin-left: 0 !important;
            padding: 0 !important;
          }
          .rounded-lg,
          .rounded-md,
          .shadow-sm,
          .shadow-md,
          .shadow-lg {
            box-shadow: none !important;
            border-radius: 0 !important;
          }
          table {
            page-break-inside: avoid;
          }
          @page {
            margin: 12mm;
          }
        }
      `}</style>

      <div className="no-print sticky top-[--header-h] z-10 flex justify-end gap-2 border-b border-border bg-bg-base/95 px-6 py-3 backdrop-blur">
        <Button type="button" size="sm" variant="secondary" onClick={() => window.print()}>
          <Printer className="h-3.5 w-3.5" /> {t('print')}
        </Button>
      </div>

      {children}
    </>
  );
}
