'use client';

import { Input } from './input';
import { cn } from '@/lib/utils';

export type DateRangeValue = {
  start: string; // YYYY-MM-DD
  end: string;
};

type Props = {
  value: DateRangeValue;
  onChange: (next: DateRangeValue) => void;
  className?: string;
  disabled?: boolean;
  labels?: { start: string; end: string };
};

export function DateRangePicker({
  value,
  onChange,
  className,
  disabled,
  labels = { start: 'Start', end: 'End' },
}: Props) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">{labels.start}</span>
        <Input
          type="date"
          value={value.start}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, start: e.target.value })}
          className="h-10 w-40"
        />
      </div>
      <span className="text-text-muted">—</span>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">{labels.end}</span>
        <Input
          type="date"
          value={value.end}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, end: e.target.value })}
          className="h-10 w-40"
        />
      </div>
    </div>
  );
}
