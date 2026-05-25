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
  width = 'w-96',
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-hidden={!open}
      className={cn('pointer-events-none fixed inset-0 z-50', open ? 'pointer-events-auto' : '')}
    >
      <div
        onClick={onClose}
        // Tailwind's default `transition-opacity` duration is 150ms; bump
        // to 220ms so the backdrop fade matches the drawer slide and
        // doesn't feel snappy. Same easing as toast/modal for consistency.
        className={cn(
          'absolute inset-0 bg-black/60 transition-opacity duration-200 ease-out',
          open ? 'opacity-100' : 'opacity-0',
        )}
      />
      <aside
        className={cn(
          'absolute top-0 flex h-full flex-col border-border bg-bg-elevated text-text-primary shadow-2xl transition-transform duration-200 ease-out',
          width,
          side === 'right' ? 'right-0 border-l' : 'left-0 border-r',
          open ? 'translate-x-0' : side === 'right' ? 'translate-x-full' : '-translate-x-full',
          className,
        )}
      >
        <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold text-text-primary">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={tA11y('close')}
            className="rounded p-1 text-text-muted transition-colors hover:bg-bg-surface-2 hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            {footer}
          </div>
        ) : null}
      </aside>
    </div>
  );
}
