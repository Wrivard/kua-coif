'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

export type TabItem<V extends string> = {
  value: V;
  label: ReactNode;
  count?: number;
  disabled?: boolean;
};

type Props<V extends string> = {
  value: V;
  onChange: (next: V) => void;
  items: ReadonlyArray<TabItem<V>>;
  className?: string;
  'aria-label'?: string;
};

// useLayoutEffect warns during SSR; fall back to useEffect on the server.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function Tabs<V extends string>({ value, onChange, items, className, ...rest }: Props<V>) {
  const tablistRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef(new Map<V, HTMLButtonElement>());
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  // The underline only animates once it has been measured, so it appears in
  // place on mount instead of growing out of the left edge.
  const [slide, setSlide] = useState(false);

  // Measure the active tab and park the sliding underline under it. Re-runs on
  // selection + items change, and on resize. Pre-paint (layout effect) so there
  // is no first-frame flash.
  useIsomorphicLayoutEffect(() => {
    const measure = () => {
      const list = tablistRef.current;
      const activeEl = tabRefs.current.get(value);
      if (!list || !activeEl) return;
      const listRect = list.getBoundingClientRect();
      const tabRect = activeEl.getBoundingClientRect();
      setIndicator({ left: tabRect.left - listRect.left, width: tabRect.width });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [value, items]);

  useEffect(() => setSlide(true), []);

  function selectTab(next: V) {
    onChange(next);
    tabRefs.current.get(next)?.focus();
  }

  // Roving-tabindex keyboard nav: arrows + Home/End move focus AND selection
  // across the non-disabled tabs (automatic-activation tab pattern).
  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const enabled = items.filter((it) => !it.disabled);
    if (enabled.length === 0) return;
    const current = enabled.findIndex((it) => it.value === value);
    let nextIndex: number;
    switch (e.key) {
      case 'ArrowRight':
        nextIndex = (current + 1) % enabled.length;
        break;
      case 'ArrowLeft':
        nextIndex = (current - 1 + enabled.length) % enabled.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = enabled.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    const next = enabled[nextIndex];
    if (next) selectTab(next.value);
  }

  return (
    <div
      ref={tablistRef}
      role="tablist"
      aria-label={rest['aria-label']}
      onKeyDown={handleKeyDown}
      className={cn('relative flex items-center gap-6 border-b border-border-soft', className)}
    >
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            ref={(el) => {
              if (el) tabRefs.current.set(it.value, el);
              else tabRefs.current.delete(it.value);
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            disabled={it.disabled}
            onClick={() => onChange(it.value)}
            className={cn(
              // border-b-2 border-transparent keeps each tab's geometry identical
              // to the old colored-border version; the colored underline is now
              // the single sliding <span> below.
              'relative -mb-px flex items-center gap-2 border-b-2 border-transparent px-1 pb-3 pt-1 text-sm font-medium transition-colors',
              'focus:outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base',
              active ? 'text-accent-text' : 'text-text-secondary hover:text-text-primary',
              it.disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            {it.label}
            {typeof it.count === 'number' ? (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                  active ? 'bg-accent-subtle text-accent-text' : 'bg-bg-surface-2 text-text-muted',
                )}
              >
                {it.count}
              </span>
            ) : null}
          </button>
        );
      })}
      {/* Sliding active-tab underline — replaces the per-tab border color swap so
          the indicator glides between tabs (instant under reduced motion via the
          global transition override). Hidden until first measured. */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute -bottom-px h-0.5 bg-accent',
          slide && 'transition-[left,width] duration-[250ms] ease-out',
        )}
        style={
          indicator
            ? { left: indicator.left, width: indicator.width }
            : { left: 0, width: 0, opacity: 0 }
        }
      />
    </div>
  );
}
