'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export type ToastVariant = 'success' | 'info' | 'warning' | 'danger';

type Toast = {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  variant: ToastVariant;
  duration: number;
};

type ToastContextValue = {
  show: (toast: Omit<Toast, 'id' | 'duration'> & { duration?: number }) => void;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const variantStyles: Record<ToastVariant, { border: string; icon: ReactNode }> = {
  success: { border: 'border-l-success', icon: <CheckCircle2 className="h-4 w-4 text-success" /> },
  info: { border: 'border-l-info', icon: <Info className="h-4 w-4 text-info" /> },
  warning: { border: 'border-l-warning', icon: <AlertCircle className="h-4 w-4 text-warning" /> },
  danger: { border: 'border-l-danger', icon: <XCircle className="h-4 w-4 text-danger" /> },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const show: ToastContextValue['show'] = useCallback(({ duration = 4000, ...rest }) => {
    const id = Math.random().toString(36).slice(2, 9);
    setToasts((current) => [...current, { id, duration, ...rest }]);
  }, []);

  return (
    <ToastContext.Provider value={{ show, dismiss }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const tA11y = useTranslations('a11y');
  useEffect(() => {
    if (toast.duration <= 0) return;
    const id = window.setTimeout(onDismiss, toast.duration);
    return () => window.clearTimeout(id);
  }, [toast.duration, onDismiss]);

  const { border, icon } = variantStyles[toast.variant];

  return (
    <div
      role="status"
      className={cn(
        // `animate-toast-in` slides + fades in from the right edge of the
        // viewport (220ms). Toasts dismiss by unmounting — V1 keeps that
        // instant since users rarely watch a toast disappear; the focus is
        // on noticing it appear.
        'pointer-events-auto flex items-start gap-3 rounded border border-l-4 border-border bg-bg-elevated px-4 py-3 shadow-lg',
        'animate-toast-in',
        border,
      )}
    >
      <span className="mt-0.5">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text-primary">{toast.title}</p>
        {toast.description ? (
          <p className="mt-0.5 text-xs text-text-secondary">{toast.description}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={tA11y('close')}
        className="rounded p-0.5 text-text-muted transition-colors hover:bg-bg-surface-2 hover:text-text-primary"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
