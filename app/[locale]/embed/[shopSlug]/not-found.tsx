import { useTranslations } from 'next-intl';
import { CalendarX2 } from 'lucide-react';

/**
 * Plan 038 (UX-07) — segment-level not-found for the embed iframe. A bad or
 * retired alias used to render the full-app 404 (headline + "back home" CTA
 * into the console) INSIDE the salon's own website; this compact card keeps
 * the failure scoped to the widget. No phone line: the alias didn't resolve,
 * so there is no shop row to read one from.
 */
export default function EmbedNotFound() {
  const t = useTranslations('pages.embed.unavailable');
  return (
    <div className="flex min-h-[320px] items-center justify-center bg-bg-base p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-lg bg-bg-surface px-6 py-10 text-center shadow-sm">
        <CalendarX2 className="h-8 w-8 text-text-muted" aria-hidden />
        <h1 className="text-base font-semibold text-text-primary">{t('title')}</h1>
        <p className="text-sm text-text-secondary">{t('body')}</p>
      </div>
    </div>
  );
}
