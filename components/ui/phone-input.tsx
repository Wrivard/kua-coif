'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';
import { Input } from './input';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'prefix'> & {
  invalid?: boolean;
  /** ISO-3166 alpha-2 — only "CA" / "US" are NANP-compatible. Defaults to CA for the QC market. */
  country?: 'CA' | 'US';
};

const flags: Record<'CA' | 'US', string> = {
  CA: '🇨🇦',
  US: '🇺🇸',
};

export const PhoneInput = forwardRef<HTMLInputElement, Props>(function PhoneInput(
  { invalid, country = 'CA', placeholder = '+1 ### ### ####', ...rest },
  ref,
) {
  return (
    <Input
      ref={ref}
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      placeholder={placeholder}
      prefix={
        <span className="flex items-center gap-1">
          <span aria-label={country} className="text-base leading-none">
            {flags[country]}
          </span>
          <span>+1</span>
        </span>
      }
      invalid={invalid}
      {...rest}
    />
  );
});
