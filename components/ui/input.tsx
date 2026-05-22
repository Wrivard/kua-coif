import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> & {
  prefix?: ReactNode;
  suffix?: ReactNode;
  invalid?: boolean;
};

const baseField =
  'h-10 w-full bg-bg-surface-2 text-sm text-text-primary placeholder:text-text-muted ' +
  'border border-border rounded px-3 ' +
  'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, prefix, suffix, invalid, ...rest },
  ref,
) {
  if (!prefix && !suffix) {
    return (
      <input
        ref={ref}
        className={cn(baseField, invalid && 'border-danger focus:border-danger focus:ring-danger', className)}
        {...rest}
      />
    );
  }
  return (
    <div
      className={cn(
        'flex h-10 w-full items-center rounded border border-border bg-bg-surface-2',
        'focus-within:border-accent focus-within:ring-1 focus-within:ring-accent',
        invalid && 'border-danger focus-within:border-danger focus-within:ring-danger',
        className,
      )}
    >
      {prefix ? (
        <span className="flex h-full items-center border-r border-border px-3 text-sm text-text-muted">
          {prefix}
        </span>
      ) : null}
      <input
        ref={ref}
        className={cn(
          'h-full flex-1 bg-transparent px-3 text-sm text-text-primary placeholder:text-text-muted',
          'focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        )}
        {...rest}
      />
      {suffix ? (
        <span className="flex h-full items-center border-l border-border px-3 text-sm text-text-muted">
          {suffix}
        </span>
      ) : null}
    </div>
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ className, invalid, rows = 4, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        'w-full bg-bg-surface-2 text-sm text-text-primary placeholder:text-text-muted',
        'border border-border rounded px-3 py-2',
        'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        invalid && 'border-danger focus:border-danger focus:ring-danger',
        className,
      )}
      {...rest}
    />
  );
});

export function Label({
  children,
  htmlFor,
  className,
  required,
}: {
  children: ReactNode;
  htmlFor?: string;
  className?: string;
  required?: boolean;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn('mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted', className)}
    >
      {children}
      {required ? <span className="ml-1 text-danger">*</span> : null}
    </label>
  );
}

export function FieldHint({ children, error }: { children: ReactNode; error?: boolean }) {
  return <p className={cn('mt-1 text-xs', error ? 'text-danger' : 'text-text-muted')}>{children}</p>;
}
