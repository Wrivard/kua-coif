'use client';

import { MessageCircle, Calculator } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  onSupportClick?: () => void;
  onPosClick?: () => void;
  supportLabel?: string;
  posLabel?: string;
  className?: string;
};

/**
 * Two floating action buttons anchored to the bottom-right of the viewport.
 * Bottom: support chat (green). Top: POS / cash register (accent).
 * V1: decorative — wiring to real flows happens later.
 */
export function FabButtons({
  onSupportClick,
  onPosClick,
  supportLabel = 'Support',
  posLabel = 'POS',
  className,
}: Props) {
  return (
    <div className={cn('fixed bottom-6 right-6 z-40 flex flex-col items-end gap-3', className)}>
      <button
        type="button"
        onClick={onPosClick}
        aria-label={posLabel}
        title={posLabel}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-fg shadow-lg transition-transform hover:scale-105 hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
      >
        <Calculator className="h-6 w-6" />
      </button>
      <button
        type="button"
        onClick={onSupportClick}
        aria-label={supportLabel}
        title={supportLabel}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-success text-white shadow-lg transition-transform hover:scale-105 hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-success focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
      >
        <MessageCircle className="h-6 w-6" />
      </button>
    </div>
  );
}
