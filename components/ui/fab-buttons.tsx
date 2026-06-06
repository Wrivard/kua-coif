'use client';

import { MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  onSupportClick?: () => void;
  supportLabel?: string;
  className?: string;
};

/**
 * Single floating support affordance, anchored bottom-right.
 *
 * Refonte (revamp Step 3): collapsed from two saturated circles (accent POS
 * + green support) to ONE neutral elevated FAB. The green was a second
 * chrome color (a slop tell); the decorative POS button is dropped until
 * there is a real V1 POS flow. Neutral surface + warm elevation + a tactile
 * press keeps it premium and unobtrusive.
 */
export function FabButtons({ onSupportClick, supportLabel = 'Support', className }: Props) {
  return (
    <div className={cn('fixed bottom-6 right-6 z-40', className)}>
      <button
        type="button"
        onClick={onSupportClick}
        aria-label={supportLabel}
        title={supportLabel}
        className="flex h-12 w-12 items-center justify-center rounded-full bg-bg-elevated text-text-secondary shadow-warm-md transition-all duration-200 ease-out-quint hover:-translate-y-0.5 hover:text-text-primary hover:shadow-warm-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base active:scale-95"
      >
        <MessageCircle className="h-5 w-5" />
      </button>
    </div>
  );
}
