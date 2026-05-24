import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast';

/**
 * Embed layout — the chrome for `/embed/[shopSlug]`.
 *
 * Key differences with `/book/[shopSlug]`:
 *   - No global `<main>` skip-link / no `min-h-screen` / no horizontal padding.
 *     The widget is iframed at the size the parent picks; we let content flow
 *     and the page emits its height via `postMessage` so the parent resizes.
 *   - No max-width container — the parent iframe controls width.
 *   - Background is transparent-ish so a parent with a non-dark theme still
 *     blends; the wizard card has its own surface color so it stands out.
 */
export default function EmbedLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <div className="widget-root bg-bg-base px-3 py-4 sm:px-5">{children}</div>
    </ToastProvider>
  );
}
