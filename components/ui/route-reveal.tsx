'use client';

import { useRef, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';

/**
 * RouteReveal — GSAP page-load reveal of a screen's structural blocks.
 *
 * Wraps the authenticated route content. On mount and on every route change
 * it staggers a subtle fade + rise of the top-level blocks (masthead, then
 * content), so every screen gets a confident entrance instead of a hard cut.
 * This is the app's ONE page-load motion system (revamp contract C1);
 * always-present component transitions (toasts/modals/dropdowns) stay on the
 * CSS keyframes in globals.css.
 *
 * Targets, in order of preference:
 *   1. elements marked `[data-reveal]` (a screen can opt into a finer
 *      block-by-block cascade), otherwise
 *   2. the wrapper's direct children (PageHeader + content = a 2-beat
 *      cascade with zero per-screen work).
 *
 * Honors prefers-reduced-motion via gsap.matchMedia (no animation; the
 * content is simply present). Degrades gracefully without JS: nothing is
 * hidden in CSS, so content is always visible. useGSAP runs in a layout
 * effect, so the from-state is applied before paint on client navigations.
 */
export function RouteReveal({ children }: { children: ReactNode }) {
  const scope = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useGSAP(
    () => {
      const root = scope.current;
      if (!root) return;
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const marked = root.querySelectorAll('[data-reveal]');
        const targets: ArrayLike<Element> = marked.length ? marked : root.children;
        if (!targets.length) return;
        gsap.from(targets, {
          autoAlpha: 0,
          y: 16,
          duration: 0.5,
          ease: 'power3.out',
          stagger: 0.06,
          clearProps: 'transform,opacity,visibility',
        });
      });
      return () => mm.revert();
    },
    { scope, dependencies: [pathname] },
  );

  // display:contents keeps the wrapper transparent to the parent flex layout.
  return (
    <div ref={scope} className="contents">
      {children}
    </div>
  );
}
