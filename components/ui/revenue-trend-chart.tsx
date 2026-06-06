'use client';

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

/**
 * Revenue trend — a recharts area chart themed entirely to the app's CSS
 * variable tokens (no hard-coded colors, so it tracks dark/light from one
 * source). It's the one finances view a table can't show: daily revenue
 * across the selected range, so an owner reads momentum at a glance.
 *
 * Client island (recharts measures the DOM) embedded in the server-rendered
 * finances page. The accent stroke + gradient fill is the chart's single
 * brand beat; axes and grid stay neutral (--text-muted / --border) so the
 * data line is what the eye follows.
 */
type TrendPoint = { iso: string; label: string; revenue: number };

type TooltipRenderProps = {
  active?: boolean;
  label?: string | number;
  payload?: Array<{ value?: number | string }>;
};

export function RevenueTrendChart({
  data,
  formatCurrency,
  ariaLabel,
}: {
  data: TrendPoint[];
  /** Pre-bound CAD formatter from the server (locale-aware). */
  formatCurrency: (n: number) => string;
  ariaLabel: string;
}) {
  function ChartTooltip({ active, label, payload }: TooltipRenderProps) {
    if (!active || !payload || payload.length === 0) return null;
    const value = Number(payload[0]?.value ?? 0);
    return (
      <div className="rounded-md border border-border bg-bg-elevated px-3 py-2 shadow-warm-md">
        <p className="text-[11px] text-text-muted">{label}</p>
        <p className="text-sm font-semibold tabular-nums text-text-primary">
          {formatCurrency(value)}
        </p>
      </div>
    );
  }

  return (
    <div className="h-56 w-full" role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="kua-revenue-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.32} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="label"
            tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
            axisLine={{ stroke: 'var(--border)' }}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={28}
          />
          <YAxis
            tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={56}
            tickFormatter={(v) => formatCurrency(Number(v))}
          />
          <Tooltip
            cursor={{ stroke: 'var(--accent)', strokeWidth: 1, strokeDasharray: '3 3' }}
            content={<ChartTooltip />}
          />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke="var(--accent)"
            strokeWidth={2}
            fill="url(#kua-revenue-fill)"
            dot={false}
            activeDot={{
              r: 4,
              fill: 'var(--accent)',
              stroke: 'var(--bg-surface)',
              strokeWidth: 2,
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
