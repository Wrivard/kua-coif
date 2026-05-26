import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> & {
  prefix?: ReactNode;
  suffix?: ReactNode;
  invalid?: boolean;
};

// Phase 36 — refined input recipe:
//   - rounded-lg (12px) softer than the V1 default rounded (8px) so
//     inputs match the new Card radius
//   - shadow-sm provides subtle depth (drop + inset highlight)
//   - focus: 2px accent ring with offset (matches Button focus)
//   - placeholder text-muted (was text-muted, kept)
//
// Phase 47d harmonization: the prefix/suffix branch and Textarea now share
// the same rounded-lg + shadow-sm + ring-2/30 focus recipe so every field
// in the app reads as one family. Invalid state uses ring-danger/30 (was
// solid ring-danger) for a softer error glow consistent with the accent
// ring it replaces.
// Phase 75 — dropped `border border-border` (shadow-sm now stacks
// ring-border + ambient, so the CSS border was duplicating the ring).
// Focus state uses `focus:ring-2 ring-focus` per Phase 78 (Vercel
// saturated blue) — replaces the soft accent ring.
const baseField =
  'h-10 w-full bg-bg-surface-2 text-sm text-text-primary placeholder:text-text-muted ' +
  'rounded-lg px-3 shadow-sm ' +
  'transition-colors duration-150 ease-out-quint ' +
  'focus:outline-none focus:ring-2 focus:ring-focus ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

// Invalid state — Phase 75 self-review fix. The previous arbitrary
// `shadow-[...]` was a box-shadow override that REPLACED the
// shadow-sm of the base recipe, leaving invalid fields flat without
// the ambient drop. Switched to `ring-1 ring-danger` which uses
// Tailwind's ring system (separate `--tw-ring-shadow` var) and
// stacks cleanly on top of `--tw-shadow`.
const invalidField = 'ring-1 ring-danger focus:ring-2';

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, prefix, suffix, invalid, ...rest },
  ref,
) {
  if (!prefix && !suffix) {
    return (
      <input ref={ref} className={cn(baseField, invalid && invalidField, className)} {...rest} />
    );
  }
  return (
    <div
      className={cn(
        // Phase 75 — same dropping-of-border treatment as `baseField`.
        // The prefix/suffix dividers (border-r / border-l on the inner
        // spans) stay — those are INTERNAL dividers, not the outer
        // frame.
        'flex h-10 w-full items-center rounded-lg bg-bg-surface-2 shadow-sm',
        'transition-colors duration-150 ease-out-quint',
        'focus-within:ring-2 focus-within:ring-focus',
        invalid && 'ring-1 ring-danger focus-within:ring-2',
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
        'rounded-lg px-3 py-2 shadow-sm',
        'transition-colors duration-150 ease-out-quint',
        'focus:outline-none focus:ring-2 focus:ring-focus',
        'disabled:cursor-not-allowed disabled:opacity-50',
        invalid && invalidField,
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
      className={cn(
        'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted',
        className,
      )}
    >
      {children}
      {required ? <span className="ml-1 text-danger">*</span> : null}
    </label>
  );
}

export function FieldHint({ children, error }: { children: ReactNode; error?: boolean }) {
  return (
    <p className={cn('mt-1 text-xs', error ? 'text-danger' : 'text-text-muted')}>{children}</p>
  );
}
