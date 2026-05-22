'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';
import { Input } from './input';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'suffix'> & {
  invalid?: boolean;
};

export const PercentInput = forwardRef<HTMLInputElement, Props>(function PercentInput(
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
      max={100}
      suffix="%"
      invalid={invalid}
      {...rest}
    />
  );
});
