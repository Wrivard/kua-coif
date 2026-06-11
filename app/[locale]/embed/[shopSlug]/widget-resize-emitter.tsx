'use client';

import { useEffect } from 'react';

/**
 * Posts the document height to the parent window whenever it changes.
 *
 * Snippet in `public/widget.js` listens for `{ type: 'kua-widget', height }`
 * and resizes the iframe accordingly. We rate-limit via `requestAnimationFrame`
 * so a flurry of layout changes (typing, slot loading, etc.) collapses into a
 * single message per frame.
 *
 * Plan 038 (UX-06) — also posts `{kind:'step-change'}` when the wizard moves
 * between steps, so widget.js can scroll the iframe back into view (a mobile
 * visitor mid-page otherwise lands "nowhere" after tapping Continue). The
 * step is read from the wizard's progress chips (the `<ol>` whose reached
 * `<li>`s widen to `w-10` — booking-wizard.tsx renders one per step), since
 * the shared wizard exposes no callback and is out of scope here. If that
 * styling ever changes, this degrades to "no scroll sync" — nothing breaks.
 *
 * Targeting `*` here is safe because we only emit a number (no PII); CSP
 * `frame-ancestors` is what actually locks down who can embed us.
 */
export function WidgetResizeEmitter() {
  useEffect(() => {
    if (typeof window === 'undefined' || window.parent === window) return;

    let rafId = 0;
    let lastHeight = 0;
    let lastStep = -1;

    const emit = () => {
      rafId = 0;
      // Step signature first — the count of widened progress chips IS the
      // current step. -1 until first observed; emit only on a CHANGE so the
      // initial mount doesn't scroll the host page.
      const step = document.querySelectorAll('ol > li.w-10').length;
      if (step > 0 && step !== lastStep) {
        if (lastStep !== -1) {
          window.parent.postMessage({ type: 'kua-widget', kind: 'step-change' }, '*');
        }
        lastStep = step;
      }
      const height = Math.ceil(document.documentElement.scrollHeight);
      if (height === lastHeight) return;
      lastHeight = height;
      window.parent.postMessage({ type: 'kua-widget', kind: 'resize', height }, '*');
    };

    const schedule = () => {
      if (rafId !== 0) return;
      rafId = window.requestAnimationFrame(emit);
    };

    schedule(); // initial size

    const ro = new ResizeObserver(schedule);
    ro.observe(document.documentElement);

    // Also catch route-internal navigation (wizard step changes don't always
    // trigger ResizeObserver since the same element gets new children).
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      ro.disconnect();
      mo.disconnect();
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, []);

  return null;
}
