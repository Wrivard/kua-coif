import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireShopMember } from '@/lib/auth/server';
import { googleConfigured } from '@/lib/google/server';
import type { BarberRow } from '@/db/rows';
import { BarbersClient, type GoogleConnectionView } from './barbers-client';

export const dynamic = 'force-dynamic';

export default async function BarbersPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  await requireShopMember({ locale });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServerClient() as any;
  const [barbersRes, googleRes] = await Promise.all([
    supabase.from('barbers').select('*').order('sort_order', { ascending: true }),
    // Phase 34 — per-barber Google Calendar connection info. The
    // refresh_token column is REVOKE'd from authenticated, so this
    // select only returns the safe display fields (email + status).
    googleConfigured()
      ? supabase
          .from('barber_google_calendar')
          .select('barber_id, google_email, sync_status, last_error, last_synced_at')
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
