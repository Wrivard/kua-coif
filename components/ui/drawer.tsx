'use client';

import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

type Props = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  side?: 'right' | 'left';
  /**
   * Tailwind width class applied at the md+ breakpoint. Mobile always
   * goes full-width (bottom sheet). Defaults to `md:w-96`. Callers
   * can pass arbitrary tw classes like `md:w-[480px]` — kept as a
   * literal string so Tailwind's content-scanner picks the class up
   * at build time (template-string interpolation does NOT work).
   */
  width?: string;
  className?: string;
};

export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  side = 'right',
  width = 'md:w-96',
  className,
}: Props) {
  const tA11y = useTranslations('a11y');
  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [open, onClose]);

  // Loop 61 SR — on mobile (<md) the Drawer becomes a bottom sheet,
  // mirroring the Modal treatment. The desktop side-panel behavior is
  // preserved for md+. The transform classes are scoped with `md:`
  // breakpoints so a single component handles both axes.
  const closedSidePanel = side === 'right' ? 'md:translate-x-full' : 'md:-translate-x-full';
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-hidden={!open}
      className={cn('pointer-events-none fixed inset-0 z-50', open ? 'pointer-events-auto' : '')}
    >
      <div
        onClick={onClose}
        // 200ms ease-out-quint matches toast + modal so all overlay
        // surfaces share one motion language. `backdrop-blur-sm` adds
        // the same soft frost as the Modal post-Loop 61.
        className={cn(
          'absolute inset-0 bg-bg-overlay backdrop-blur-sm transition-opacity duration-200 ease-out-quint',
          open ? 'opacity-100' : 'opacity-0',
        )}
      />
      <aside
        className={cn(
          // Mobile: bottom sheet — full-width, anchored to bottom, rounded
          // top corners only, slide up from below when closed.
          'absolute inset-x-0 bottom-0 flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-bg-elevated text-text-primary shadow-xl transition-transform duration-200 ease-out-quint',
          // Desktop: side panel — back to inset-y-0 full height, rounded
          // corners reset, slides horizontally from the chosen side.
          'md:inset-x-auto md:bottom-auto md:top-0 md:max-h-none md:rounded-none md:rounded-t-none',
          'md:h-full',
          // Width applies only on md+ where the side panel makes sense;
          // on mobile we always go full width. `width` already carries
          // the `md:` prefix (see prop docs) so we pass it through.
          width,
          side === 'right'
            ? 'md:right-0 md:border-l md:border-border'
            : 'md:left-0 md:border-r md:border-border',
          // Animation:
          //   open → translate-y-0 (mobile) / translate-x-0 (md+)
          //   closed mobile → translate-y-full (slides off bottom)
          //   closed desktop → translate-x-full/-full (slides off side)
          open
            ? 'translate-y-0 md:translate-x-0'
            : ['translate-y-full md:translate-y-0', closedSidePanel],
          className,
        )}
      >
        {/* Header — bumped to text-lg tracking-tight + larger close
         *  button to match the Modal upgrade. border-soft so the divider
         *  doesn't over-anchor the eye. */}
        <div className="flex items-center justify-between gap-4 border-b border-border-soft px-5 py-5 md:px-6">
          <h2 className="text-lg font-semibold tracking-tight text-text-primary">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={tA11y('close')}
            className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-surface-2 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-6">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-border-soft px-5 py-4 md:px-6">
            {footer}
          </div>
        ) : null}
      </aside>
    </div>
  );
}
