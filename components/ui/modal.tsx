'use client';

import { useEffect, useRef, type ReactNode } from 'react';
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
  const tA11y = useTranslations('a11y');

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
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
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      className={cn(
        'w-full bg-transparent p-0 backdrop:bg-black/60',
        'open:flex open:items-center open:justify-center',
        sizes[size],
      )}
    >
      <div
        // `animate-modal-content` is scoped via `dialog[open] >` in
        // globals.css — it fires every time the dialog opens (not just
        // on initial mount). Pairs with the backdrop fade defined on
        // `dialog[open]::backdrop`.
        className={cn(
          'flex w-full flex-col rounded border border-border bg-bg-elevated text-text-primary shadow-2xl',
          'animate-modal-content',
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || description) && (
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0 flex-1">
              {title ? (
                <h2 className="text-base font-semibold text-text-primary">{title}</h2>
              ) : null}
              {description ? (
                <p className="mt-1 text-sm text-text-secondary">{description}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={tA11y('close')}
              className="rounded p-1 text-text-muted transition-colors hover:bg-bg-surface-2 hover:text-text-primary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
