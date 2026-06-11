'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

type Props = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
};

const sizes = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
} as const;

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  className,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [closing, setClosing] = useState(false);
  const tA11y = useTranslations('a11y');

  // Sync the controlled `open` prop to the native dialog. Opening is immediate;
  // closing first plays the exit keyframe (data-closing → globals.css), then
  // calls dialog.close() on the panel's animationend. Reduced motion or a missing
  // panel close instantly, and a fallback timeout guarantees the dialog never
  // sticks open if animationend doesn't fire.
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
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      // Loop 61 — `items-end md:items-center` flips between a bottom
      // sheet on mobile and a centered card on desktop, matching the
      // animation choice made in globals.css. `backdrop-blur-sm` softens
      // the underlying content for a more "elevated" feel — falls back
      // to a plain dim on browsers that don't support backdrop-filter.
      className={cn(
        'w-full bg-transparent p-0',
        'backdrop:bg-black/60 backdrop:backdrop-blur-sm',
        'open:flex open:justify-center',
        'open:items-end md:open:items-center',
        sizes[size],
      )}
    >
      <div
        ref={panelRef}
        // Loop 61:
        //   - mobile (default): `rounded-t-2xl rounded-b-none` + full-
        //     width sheet anchored to the bottom edge.
        //   - md+: `md:rounded-lg` reverts to the standard floating card.
        //   - `max-h-[92vh]` prevents the sheet from blowing past the
        //     viewport on long forms; the body region scrolls internally.
        //   - `shadow-xl` stays — already a multi-layer stack defined
        //     in globals.css. No CSS border, shadow-as-border handles it.
        className={cn(
          'flex w-full flex-col bg-bg-elevated text-text-primary shadow-modal',
          'max-h-[92vh] rounded-b-none rounded-t-xl md:max-h-[88vh] md:rounded-lg',
          'animate-modal-content',
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || description) && (
          // Loop 61 — slightly more breathing room (py-5 vs py-4),
          // larger title (text-lg vs text-base) with tracking-tight to
          // match the heading curve in globals.css. Border keyed to
          // `border-soft` instead of `border` so the divider doesn't
          // anchor the eye away from the title.
          <div className="flex items-start justify-between gap-4 border-b border-border-soft px-5 py-6 md:px-6">
            <div className="min-w-0 flex-1">
              {title ? (
                <h2 className="text-xl font-semibold tracking-tight text-text-primary">{title}</h2>
              ) : null}
              {description ? (
                <p className="mt-1.5 text-sm text-text-secondary">{description}</p>
              ) : null}
            </div>
            {/* Larger touch target (h-8 w-8) so it works for thumbs on
             *  mobile + meets WCAG 2.5.5 target-size guidance. Focus
             *  ring matches the design-system focus color. */}
            <button
              type="button"
              onClick={onClose}
              aria-label={tA11y('close')}
              className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-surface-2 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {/* The body is the only scrollable region — keeps the header +
         *  footer always visible while long forms scroll internally. */}
        {/* Phase H+8 — px-5 py-5 → px-5 py-6 so modal forms breathe
            consistently with the Card primitive bump. Footer goes
            py-4 → py-5 for the same rhythm reason. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-6">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-border-soft px-5 py-5 md:px-6">
            {footer}
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
