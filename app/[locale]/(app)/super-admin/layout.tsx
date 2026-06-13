import type { ReactNode } from 'react';
import { requireKuaAdmin } from '@/lib/auth/server';

/**
 * SUPER-01 — defense-in-depth guard for the whole /super-admin section.
 *
 * Every super-admin page already calls `requireKuaAdmin()` itself (the belt).
 * This server layout is the suspenders: a future page added under
 * /super-admin WITHOUT its own guard still can't render to a non-admin,
 * because this runs `requireKuaAdmin()` before any child. The per-page guards
 * are intentionally kept — this is an additional backstop, not a replacement.
 */
export const dynamic = 'force-dynamic';

export default async function SuperAdminLayout({ children }: { children: ReactNode }) {
  await requireKuaAdmin();
  return <>{children}</>;
}
