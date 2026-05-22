'use client';

import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type RadioOption<V extends string> = {
  value: V;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
};

type Props<V extends string> = {
  name: string;
  value: V;
  onChange: (next: V) => void;
  options: ReadonlyArray<RadioOption<V>>;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
};

export function RadioGroup<V extends string>({
  name,
  value,
  onChange,
  options,
  orientation = 'vertical',
  className,
}: Props<V>) {
  return (
    <div
      role="radiogroup"
      className={cn(
        orientation === 'horizontal' ? 'flex flex-wrap items-center gap-4' : 'flex flex-col gap-2',
        className,
      )}
    >
      {options.map((opt) => {
        const id = `${name}-${opt.value}`;
        const isChecked = value === opt.value;
        return (
          <label
            key={opt.value}
            htmlFor={id}
            className={cn(
              'inline-flex cursor-pointer items-start gap-2',
              opt.disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <span className="relative mt-0.5 inline-flex h-4 w-4 shrink-0">
              <input
                id={id}
                type="radio"
                name={name}
                value={opt.value}
                checked={isChecked}
                disabled={opt.disabled}
                onChange={() => onChange(opt.value)}
                className="peer h-4 w-4 cursor-pointer appearance-none rounded-full border border-border bg-bg-surface-2 checked:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base disabled:cursor-not-allowed"
              />
              <span
                aria-hidden
                className={cn(
                  'pointer-events-none absolute inset-1 rounded-full bg-accent',
                  isChecked ? 'opacity-100' : 'opacity-0',
                )}
              />
            </span>
            <span className="flex flex-col">
              <span className="text-sm text-text-primary">{opt.label}</span>
              {opt.description ? (
                <span className="text-xs text-text-muted">{opt.description}</span>
              ) : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}
