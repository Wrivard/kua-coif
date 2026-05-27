import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRoleInCurrentShop, requireShopMember, getCurrentShopId } from '@/lib/auth/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { WinbackClient, type Candidate } from './winback-client';

export const dynamic = 'force-dynamic';

// 90 days = our definition of "lapsed". Tunable. Too short and we
// hassle clients between trims (avg 5-8 weeks for men's barbershop);
// too long and the relationship has cooled past recovery.
const LAPSED_THRESHOLD_DAYS = 90;

/**
 * Loop 64 — Lapsed-client win-back page.
 *
 * Lists every client who:
 *   - has at least one completed appointment ever (otherwise we don't
 *     know them — could be a one-off booking that fizzled)
 *   - has NO non-cancelled appointment in the last 90 days
 *   - is not anonymized
 *   - has email OR phone
 *   - hasn't been winback-asked already this year (one ask per year
 *     per channel via client_marketing_sends.recurrence_key)
 *
 * Operator picks rows + clicks "Send"; action dispatches email + SMS
 * with a link to the public booking page.
 */
export default async function WinbackPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  await requireShopMember({ locale });
  await requireRoleInCurrentShop('manager');

  const shopId = await getCurrentShopId();
  if (!shopId) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createSupabaseServiceRoleClient() as any;

  // 1. Every non-anonymized contactable client in the shop. We then
  //    filter further by appointment activity below.
  const clientsRes = await admin
    .from('clients')
    .select('id, first_name, last_name, email, phone')
    .eq('shop_id', shopId)
    .is('anonymized_at', null);
  type ClientRow = {
    id: string;
    first_name: string;
    last_name: string | null;
    email: string | null;
    phone: string | null;
  };
  const clients = ((clientsRes.data as ClientRow[] | null) ?? []).filter((c) => c.email || c.phone);
  if (clients.length === 0) return <WinbackClient locale={locale} candidates={[]} />;

  // 2. All appointments for these clients (any status, any time).
  //    We aggregate in JS rather than running per-client subqueries.
  //    For shop sizes V1 cares about (<10k appointments), this is
  //    cheap; at scale this should become a Postgres function or a
  //    materialized "client_activity" view.
  const clientIds = clients.map((c) => c.id);
  const apptsRes = await admin
    .from('appointments')
    .select('client_id, start_at, status')
    .eq('shop_id', shopId)
    .in('client_id', clientIds);
  type ApptRow = { client_id: string; start_at: string; status: string };
  const appts = (apptsRes.data as ApptRow[] | null) ?? [];

  const stats = new Map<string, { latestActiveAt: string | null; hasCompleted: boolean }>();
  for (const a of appts) {
    const cur = stats.get(a.client_id) ?? { latestActiveAt: null, hasCompleted: false };
    // Cancelled / no_show don't count as "they came in" — they don't
    // reset the lapsed clock.
    if (a.status !== 'cancelled' && a.status !== 'no_show') {
      if (!cur.latestActiveAt || a.start_at > cur.latestActiveAt) {
        cur.latestActiveAt = a.start_at;
      }
    }
    if (a.status === 'completed') cur.hasCompleted = true;
    stats.set(a.client_id, cur);
  }

  // 3. Filter: hasCompleted (proves they're a known client) AND
  //    latestActiveAt is more than 90 days ago.
  const lapsedCutoff = new Date(Date.now() - LAPSED_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);
  const lapsed = clients.filter((c) => {
    const s = stats.get(c.id);
    if (!s || !s.hasCompleted || !s.latestActiveAt) return false;
    return new Date(s.latestActiveAt) < lapsedCutoff;
  });

  // 4. Exclude clients already winback-asked this year.
  const yearStr = String(new Date().getFullYear());
  const lapsedIds = lapsed.map((c) => c.id);
  const sentRes =
    lapsedIds.length === 0
      ? { data: [] }
      : await admin
          .from('client_marketing_sends')
          .select('client_id')
          .eq('kind', 'winback')
          .eq('recurrence_key', yearStr)
          .in('client_id', lapsedIds);
  const alreadyAskedThisYear = new Set(
    ((sentRes.data as Array<{ client_id: string }> | null) ?? []).map((r) => r.client_id),
  );

  const candidates: Candidate[] = lapsed
    .filter((c) => !alreadyAskedThisYear.has(c.id))
    .map((c) => ({
      clientId: c.id,
      firstName: c.first_name,
      lastName: c.last_name,
      email: c.email,
      phone: c.phone,
      lastVisitAt: stats.get(c.id)!.latestActiveAt!,
    }))
    .sort((a, b) => (a.lastVisitAt < b.lastVisitAt ? -1 : 1)); // oldest-lapsed first

  const t = await getTranslations('pages.marketing.winback');
  return (
    <WinbackClient
      locale={locale}
      candidates={candidates}
      labels={{
        title: t('title'),
        subtitle: t('subtitle', { days: LAPSED_THRESHOLD_DAYS }),
        emptyTitle: t('emptyTitle'),
        emptyDescription: t('emptyDescription'),
        columns: {
          client: t('columns.client'),
          lastVisit: t('columns.lastVisit'),
          contact: t('columns.contact'),
        },
        selectAll: t('selectAll'),
        send: t('send'),
        sending: t('sending'),
        selectedSummary: t('selectedSummary'),
        sentToast: t('sentToast'),
        partialToast: t('partialToast'),
        failedToast: t('failedToast'),
        confirm: t('confirm'),
      }}
    />
  );
}
