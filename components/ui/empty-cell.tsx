import { cn } from '@/lib/utils';

/**
 * EmptyCell — the canonical "no value here" placeholder for table cells and
 * data rows (contract C9: zero em-dashes). The codebase used to hand-roll
 * `<span className="text-text-muted">—</span>` in a handful of places; this
 * renders a muted mid-dot instead, so an empty cell reads as intentional —
 * not broken, and never as the banned em-dash glyph. Optional `label` adds
 * an sr-only announcement when the emptiness is semantically meaningful.
 */
export function EmptyCell({ className, label }: { className?: string; label?: string }) {
  return (
    <span className={cn('select-none text-text-muted', className)}>
      <span aria-hidden>·</span>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
