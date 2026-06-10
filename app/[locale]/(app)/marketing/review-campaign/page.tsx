import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRoleInCurrentShop, requireShopMember, getCurrentShopId } from '@/lib/auth/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { ReviewCampaignClient, type Candidate } from './review-campaign-client';

export const dynamic = 'force-dynamic';

// 60-day look-back. Tuneable — too long and clients forget the visit,
// too short and we miss the long-tail of slower responders. 60d
// matches the audit doc's "lapsed client" definition ceiling.
const LOOKBACK_DAYS = 60;

/**
 * Loop 63 — Bulk review-campaign page.
 *
 * Lists every appointment in the last 60 days that:
 *   - has status='completed' (clients didn't show won't review well)
 *   - has a non-anonymized client with an email OR phone
 *   - has no review yet (reviews.appointment_id miss)
 *   - has no review_request already sent (client_marketing_sends miss)
 *
 * Operator selects rows + hits "Send review request"; the server action
 * generates signed tokens per appointment + dispatches email + SMS.
 */
export default async function ReviewCampaignPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);
  await requireShopMember({ locale });
  await requireRoleInCurrentShop('manager');

  const shopId = await getCurrentShopId();
  if (!shopId) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createSupabaseServiceRoleClient() as any;

  // 1. Pull completed appointments in the window + join client info +
  //    services in one query. Supabase's embedded-resource syntax does
  //    the join client-side.
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const apptsRes = await admin
    .from('appointments')
    .select(
      `id, start_at, status,
       client:clients(id, first_name, last_name, email, phone, anonymized_at),
       appointment_services(services(name))`,
    )
    .eq('shop_id', shopId)
    .eq('status', 'completed')
    .gte('start_at', since)
    .order('start_at', { ascending: false });

  type ApptRow = {
    id: string;
    start_at: string;
    status: string;
    client: {
      id: string;
      first_name: string;
      last_name: string | null;
      email: string | null;
      phone: string | null;
      anonymized_at: string | null;
    } | null;
    appointment_services: Array<{ services: { name: string } | null }> | null;
  };
  const allAppts = (apptsRes.data as ApptRow[] | null) ?? [];

  // 2. Filter out anonymized clients + clients with no contact info.
  const contactable = allAppts.filter(
    (a) => a.client && !a.client.anonymized_at && (a.client.email || a.client.phone),
  );
  if (contactable.length === 0) {
    return <ReviewCampaignClient locale={locale} candidates={[]} />;
  }

  // 3. Exclude appointments that already have a review OR already had a
  //    campaign request sent. Two batched lookups — same pattern as
  //    the reminder cron's alreadySet.
  const ids = contactable.map((a) => a.id);
  const reviewsRes = await admin.from('reviews').select('appointment_id').in('appointment_id', ids);
  const reviewed = new Set(
    ((reviewsRes.data as Array<{ appointment_id: string }> | null) ?? []).map(
      (r) => r.appointment_id,
    ),
  );
  const sentRes = await admin
    .from('client_marketing_sends')
    .select('recurrence_key')
    .eq('kind', 'review_request')
    .in('recurrence_key', ids);
  const sent = new Set(
    ((sentRes.data as Array<{ recurrence_key: string }> | null) ?? []).map((r) => r.recurrence_key),
  );

  const candidates: Candidate[] = contactable
    .filter((a) => !reviewed.has(a.id) && !sent.has(a.id))
    .map((a) => ({
      appointmentId: a.id,
      startAt: a.start_at,
      client: {
        firstName: a.client!.first_name,
        lastName: a.client!.last_name,
        email: a.client!.email,
        phone: a.client!.phone,
      },
      services: (a.appointment_services ?? [])
        .map((s) => s.services?.name)
        .filter((n): n is string => Boolean(n)),
    }));

  const t = await getTranslations('pages.marketing.reviewCampaign');
  return (
    <ReviewCampaignClient
      locale={locale}
      candidates={candidates}
      labels={{
        title: t('title'),
        subtitle: t('subtitle', { days: LOOKBACK_DAYS }),
        emptyTitle: t('emptyTitle'),
        emptyDescription: t('emptyDescription'),
        columns: {
          client: t('columns.client'),
          lastVisit: t('columns.lastVisit'),
          services: t('columns.services'),
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
