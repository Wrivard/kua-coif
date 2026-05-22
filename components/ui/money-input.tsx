'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';
import { Input } from './input';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'prefix'> & {
  invalid?: boolean;
};

export const MoneyInput = forwardRef<HTMLInputElement, Props>(function MoneyInput(
  { invalid, inputMode = 'decimal', step = '0.01', ...rest },
  ref,
) {
  return (
    <Input
      ref={ref}
      type="number"
      inputMode={inputMode}
      step={step}
      min={0}
      prefix="$"
      invalid={invalid}
      {...rest}
    />
  );
});
