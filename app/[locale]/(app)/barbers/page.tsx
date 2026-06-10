import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentShopId, requireRoleInCurrentShop, requireShopMember } from '@/lib/auth/server';
import { googleConfigured } from '@/lib/google/server';
import type { BarberRow } from '@/db/rows';
import { BarbersClient, type GoogleConnectionView } from './barbers-client';

export const dynamic = 'force-dynamic';

export default async function BarbersPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);
  await requireShopMember({ locale });
  // B19 — the roster exposes colleague PII (email/phone) and is a management
  // surface; gate to manager+ (consistent with the CSV export gate + the
  // finances/audit-log pages). A barber-role user is FORBIDDEN here.
  await requireRoleInCurrentShop('manager');

  // Scope to the ACTIVE shop (Barbers audit B10): without an explicit shop_id
  // filter, RLS (is_shop_member) returns barbers from EVERY shop the user
  // belongs to, merged into one roster — and a multi-shop owner could edit a
  // barber that belongs to a non-active shop. Mirrors the clients/page + CSV
  // export fix.
  const shopId = await getCurrentShopId();
  if (!shopId) throw new Error('Barbers load failed: no active shop resolved');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServerClient() as any;
  const [barbersRes, googleRes] = await Promise.all([
    supabase
      .from('barbers')
      .select('*')
      .eq('shop_id', shopId)
      .order('sort_order', { ascending: true }),
    // Phase 34 — per-barber Google Calendar connection info. The
    // refresh_token column is REVOKE'd from authenticated, so this
    // select only returns the safe display fields (email + status).
    googleConfigured()
      ? supabase
          .from('barber_google_calendar')
          .select('barber_id, google_email, sync_status, last_error, last_synced_at')
          .eq('shop_id', shopId)
      : Promise.resolve({ data: [] }),
  ]);

  const barbers = (barbersRes.data as BarberRow[] | null) ?? [];
  const googleConnections =
    (googleRes.data as Array<{
      barber_id: string;
      google_email: string;
      sync_status: 'active' | 'paused' | 'error';
      last_error: string | null;
      last_synced_at: string | null;
    }> | null) ?? [];

  const googleByBarber: Record<string, GoogleConnectionView> = {};
  for (const g of googleConnections) {
    googleByBarber[g.barber_id] = {
      googleEmail: g.google_email,
      syncStatus: g.sync_status,
      lastError: g.last_error,
      lastSyncedAt: g.last_synced_at,
    };
  }

  return (
    <BarbersClient
      locale={locale}
      barbers={barbers}
      googleConfigured={googleConfigured()}
      googleByBarber={googleByBarber}
    />
  );
}
