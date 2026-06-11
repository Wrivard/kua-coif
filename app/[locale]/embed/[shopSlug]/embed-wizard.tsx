'use client';

import { useState, type ComponentProps } from 'react';
import { BookingWizard } from '../../book/[shopSlug]/booking-wizard';

type Source = 'inline' | 'floating-button' | 'modal' | 'direct';

type Props = Omit<ComponentProps<typeof BookingWizard>, 'analyticsSource'>;

/**
 * Plan 038 (PERF-01) — thin client wrapper that derives the analytics
 * `source` tag from `location.search` instead of the server reading
 * `searchParams` (which opted the whole embed route into request-time
 * rendering). Computed synchronously in the first client render (lazy
 * initializer) so the wizard's mount-time `impression` event already
 * carries the right source; the value is never rendered into the DOM, so
 * the SSR 'direct' placeholder can't cause a hydration mismatch.
 */
export function EmbedWizard(props: Props) {
  const [source] = useState<Source>(() => {
    if (typeof window === 'undefined') return 'direct';
    const m = /[?&]source=(inline|floating-button|modal)(&|$)/.exec(window.location.search);
    return (m?.[1] as Source | undefined) ?? 'direct';
  });
  return <BookingWizard {...props} analyticsSource={source} />;
}
