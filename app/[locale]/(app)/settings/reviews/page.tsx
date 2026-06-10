import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireShopMember } from '@/lib/auth/server';
import { ReviewsClient, type ReviewRow } from './reviews-client';

export const dynamic = 'force-dynamic';

/**
 * Phase 63c — Admin moderation queue for reviews.
 *
 * Loads up to 100 most-recent reviews across all statuses. Client
 * component groups them by status and exposes per-row buttons
 * (publish / reject / delete). RLS already restricts to the active
 * shop's rows so the query needs no extra `.eq('shop_id', ...)`.
 */
export default async function ReviewsPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);
  await requireShopMember({ locale });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createSupabaseServerClient() as any;
  const { data } = await sb
    .from('reviews')
    .select(
      'id, rating, comment, status, client_name, barber_id, created_at, published_at, appointment_id',
    )
    .order('created_at', { ascending: false })
    .limit(100);

  const rows = (data as ReviewRow[] | null) ?? [];

  // Pull barber names for any entries with a barber_id.
  const barberIds = Array.from(
    new Set(rows.map((r) => r.barber_id).filter((id): id is string => id !== null)),
  );
  let barberNames = new Map<string, string>();
  if (barberIds.length > 0) {
    const namesRes = await sb.from('barbers').select('id, display_name').in('id', barberIds);
    barberNames = new Map(
      ((namesRes.data as Array<{ id: string; display_name: string }> | null) ?? []).map((b) => [
        b.id,
        b.display_name,
      ]),
    );
  }

  return <ReviewsClient rows={rows} barberNames={Object.fromEntries(barberNames)} />;
}
