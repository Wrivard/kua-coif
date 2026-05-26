import type { ReactNode } from 'react';

/** Public-facing accessibility statement — same shell as /privacy + /terms. */
export default function AccessibilityLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="mx-auto min-h-screen max-w-3xl bg-bg-base px-6 py-12">
      {children}
    </main>
  );
}
