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

const variantStyles: Record<ToastVariant, { border: string; halo: string; icon: ReactNode }> = {
  success: {
    border: 'border-l-success',
    halo: 'bg-success-subtle',
    icon: <CheckCircle2 className="h-4 w-4 text-success" />,
  },
  info: {
    border: 'border-l-info',
    halo: 'bg-info-subtle',
    icon: <Info className="h-4 w-4 text-info" />,
  },
  warning: {
    border: 'border-l-warning',
    halo: 'bg-warning-subtle',
    icon: <AlertCircle className="h-4 w-4 text-warning" />,
  },
  danger: {
    border: 'border-l-danger',
    halo: 'bg-danger-subtle',
    icon: <XCircle className="h-4 w-4 text-danger" />,
  },
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
  const [closing, setClosing] = useState(false);

  // Start the exit: under reduced motion remove immediately; otherwise mark the
  // item closing (→ .animate-toast-out) and let onAnimationEnd / a fallback
  // timeout pull it from state.
  const beginDismiss = useCallback(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      onDismiss();
      return;
    }
    setClosing(true);
  }, [onDismiss]);

  useEffect(() => {
    if (toast.duration <= 0) return;
    const id = window.setTimeout(beginDismiss, toast.duration);
    return () => window.clearTimeout(id);
  }, [toast.duration, beginDismiss]);

  // Fallback so a missed animationend can't strand the toast on screen.
  useEffect(() => {
    if (!closing) return;
    const id = window.setTimeout(onDismiss, 220);
    return () => window.clearTimeout(id);
  }, [closing, onDismiss]);

  const { border, icon, halo } = variantStyles[toast.variant];
  // B23 (Barbers audit) — error toasts must interrupt the screen reader
  // (assertive `role="alert"`) instead of waiting politely behind other output;
  // info/success stay polite so they don't talk over the user.
  const isAlert = toast.variant === 'danger';

  return (
    <div
      role={isAlert ? 'alert' : 'status'}
      onAnimationEnd={closing ? onDismiss : undefined}
      className={cn(
        // Phase 36 — refined: rounded-lg + shadow-lg (drop + inset
        // highlight). Slide-in animation tuned to 200ms ease-out-quint
        // in globals.css; exit swaps to the slide/fade-out keyframe.
        'pointer-events-auto flex items-start gap-3 rounded-lg border border-l-4 border-border bg-bg-elevated px-4 py-3 shadow-warm-lg',
        closing ? 'animate-toast-out' : 'animate-toast-in',
        border,
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
          halo,
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text-primary">{toast.title}</p>
        {toast.description ? (
          <p className="mt-0.5 text-xs text-text-secondary">{toast.description}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={beginDismiss}
        aria-label={tA11y('close')}
        className="rounded-md p-0.5 text-text-muted transition-colors duration-150 ease-out-quint hover:bg-bg-surface-2 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
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
