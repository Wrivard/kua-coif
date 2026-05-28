import type { ReactNode } from 'react';

// Phase H+4 — minimal root layout so the legacy `/admin` page can render
// long enough to fire its redirect() to `/{defaultLocale}/super-admin`.
// Next.js requires every page to have an ancestor root layout with
// <html> + <body>; the actual super-admin shell lives under
// `app/[locale]/(app)/super-admin/*` now and inherits the full sidebar
// from the (app) layout.
export default function AdminLegacyLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
