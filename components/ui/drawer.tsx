'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
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
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const [closing, setClosing] = useState(false);
  const titleId = useId();
  const tA11y = useTranslations('a11y');

  // Native <dialog> + showModal (mirrors components/ui/modal.tsx): focus is
  // TRAPPED inside the panel, the background is inert + scroll-locked, and the
  // panel renders in the top layer — so a ConfirmDialog (also a modal dialog)
  // opened from within the drawer stacks correctly above it, and there are no
  // z-index battles. Closing plays the exit keyframe (data-closing → globals.css)
  // before dialog.close(); reduced motion or a missing panel close instantly, and
  // a fallback timeout guarantees the drawer never sticks open.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;

    if (open) {
      setClosing(false);
      if (!el.open) el.showModal();
      return;
    }

    if (!el.open) return;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const panel = panelRef.current;
    if (prefersReduced || !panel) {
      el.close();
      return;
    }

    setClosing(true);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.close();
      setClosing(false);
    };
    panel.addEventListener('animationend', finish, { once: true });
    const fallback = window.setTimeout(finish, 320);
    return () => {
      panel.removeEventListener('animationend', finish);
      window.clearTimeout(fallback);
    };
  }, [open]);

  // ESC fires the dialog's native `cancel` event; route it through onClose so
  // the parent's `open` state stays the single source of truth (the default
  // would call el.close() and leave React thinking the drawer is still open).
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const handleCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    el.addEventListener('cancel', handleCancel);
    return () => el.removeEventListener('cancel', handleCancel);
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      data-closing={closing ? '' : undefined}
      aria-labelledby={titleId}
      onClick={(e) => {
        // A click that lands on the dialog box itself (the empty area beside
        // the panel) is a backdrop click → close. Clicks inside the panel are
        // stopped below.
        if (e.target === dialogRef.current) onClose();
      }}
      className={cn(
        // The dialog fills the viewport and is transparent — its ::backdrop
        // pseudo draws the dim + blur, and the panel anchors to an edge
        // inside it. Reset the UA-centered box (auto margins, fit sizing).
        'fixed inset-0 m-0 h-full max-h-none w-full max-w-none bg-transparent p-0',
        'backdrop:bg-bg-overlay backdrop:backdrop-blur-sm',
        // Anchor: bottom sheet on mobile, the chosen side full-height on md+.
        'open:flex open:items-end',
        side === 'right'
          ? 'md:open:items-stretch md:open:justify-end'
          : 'md:open:items-stretch md:open:justify-start',
      )}
    >
      <aside
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          // Mobile: bottom sheet — full-width, rounded top corners, capped
          // height with the body scrolling internally.
          'flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-bg-elevated text-text-primary shadow-xl',
          // Desktop: side panel — full height, square corners.
          'md:h-full md:max-h-none md:rounded-none',
          // Width applies only on md+ (the prop already carries the `md:`
          // prefix — see prop docs); mobile is always full width.
          width,
          side === 'right' ? 'md:border-l md:border-border' : 'md:border-r md:border-border',
          // Slide-in keyframe (globals.css): bottom on mobile, side on md+.
          side === 'right' ? 'animate-drawer-right' : 'animate-drawer-left',
          className,
        )}
      >
        {/* Header — text-lg tracking-tight title + a generous close target,
            matching the Modal. border-soft so the divider doesn't over-anchor
            the eye. */}
        <div className="flex items-center justify-between gap-4 border-b border-border-soft px-5 py-6 md:px-6">
          <h2 id={titleId} className="text-lg font-semibold tracking-tight text-text-primary">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={tA11y('close')}
            className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-surface-2 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-6">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-border-soft px-5 py-5 md:px-6">
            {footer}
          </div>
        ) : null}
      </aside>
    </dialog>
  );
}
