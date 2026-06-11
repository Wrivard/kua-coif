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
export default async function WinbackPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);
  await requireShopMember({ locale });
  await requireRoleInCurrentShop('manager');

  const shopId = await getCurrentShopId();
  if (!shopId) return null;

  const admin = createSupabaseServiceRoleClient();

  // 1. Every non-anonymized contactable client in the shop. We then
  //    filter further by appointment activity below.
  const clientsRes = await admin
    .from('clients')
    .select('id, first_name, last_name, email, phone')
    .eq('shop_id', shopId)
    .is('anonymized_at', null);
  const clients = (clientsRes.data ?? []).filter((c) => c.email || c.phone);
  if (clients.length === 0) return <WinbackClient locale={locale} candidates={[]} />;

  // 2. Per-client activity rollup (latest non-cancelled visit + ever-completed),
  //    computed SQL-side by client_activity() — one row per client. The old path
  //    pulled the shop's ENTIRE appointment history and aggregated in JS, which
  //    the PostgREST 1000-row cap truncated silently: past the cap, active
  //    clients looked lapsed and got mass-emailed.
  const activityRes = await admin.rpc('client_activity', { p_shop: shopId });
  const activity = activityRes.data ?? [];
  const stats = new Map<string, { latestActiveAt: string | null; hasCompleted: boolean }>();
  for (const r of activity) {
    stats.set(r.client_id, { latestActiveAt: r.last_active_at, hasCompleted: r.has_completed });
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
  const alreadyAskedThisYear = new Set((sentRes.data ?? []).map((r) => r.client_id));

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
