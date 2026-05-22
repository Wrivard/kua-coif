'use client';

import { Select } from './select';
import { cn } from '@/lib/utils';

type Props = {
  /** Total minutes (e.g. 5h 30m → 330). */
  valueMinutes: number;
  onChange: (totalMinutes: number) => void;
  /** Highest hours value selectable (inclusive). */
  maxHours?: number;
  /** Step in minutes for the minutes dropdown. */
  minuteStep?: number;
  className?: string;
  disabled?: boolean;
};

export function TimeRangeSelect({
  valueMinutes,
  onChange,
  maxHours = 48,
  minuteStep = 5,
  className,
  disabled,
}: Props) {
  const hours = Math.floor(valueMinutes / 60);
  const minutes = valueMinutes % 60;
  const hoursList = Array.from({ length: maxHours + 1 }, (_, i) => i);
  const minutesList = Array.from({ length: Math.floor(60 / minuteStep) }, (_, i) => i * minuteStep);

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Select
        aria-label="hours"
        value={hours}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value) * 60 + minutes)}
      >
        {hoursList.map((h) => (
          <option key={h} value={h}>
            {h}h
          </option>
        ))}
      </Select>
      <Select
        aria-label="minutes"
        value={minutes}
        disabled={disabled}
        onChange={(e) => onChange(hours * 60 + Number(e.target.value))}
      >
        {minutesList.map((m) => (
          <option key={m} value={m}>
            {m}m
          </option>
        ))}
      </Select>
    </div>
  );
}
