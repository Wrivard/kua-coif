import { getTranslations } from 'next-intl/server';
import { Star } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Public-safe review row — mirrors the `reviews_public` view
 * (supabase/migrations/20260528060000_reviews_public_view.sql), which
 * exposes only the columns the booking page needs. The view already
 * filters to `status = 'published'`, so anything we read here is safe to
 * surface to anonymous visitors. The underlying `reviews` table has NO
 * anon-SELECT policy; anon can only read through this view.
 */
export type PublicReview = {
  id: string;
  rating: number;
  comment: string | null;
  client_name: string | null;
  created_at: string;
};

/**
 * Server-rendered "what clients say" block for the public booking page.
 *
 * Shows the shop's average rating + total published-review count, then a
 * handful of recent snippets (only reviews that carry a comment). Renders
 * nothing when the shop has no published reviews yet — a salon that just
 * went live shouldn't show an empty "0 reviews" placeholder.
 *
 * Pure presentation: the page fetches `reviews_public` via the service-role
 * client and passes the rows in. No Supabase access here.
 */
export async function ReviewsSection({
  reviews,
  locale,
}: {
  reviews: PublicReview[];
  locale: string;
}) {
  if (reviews.length === 0) return null;

  const t = await getTranslations({ locale, namespace: 'pages.booking.reviews' });

  const count = reviews.length;
  const average = reviews.reduce((sum, r) => sum + r.rating, 0) / count;
  // One decimal place, locale-aware (FR uses a comma).
  const averageLabel = new Intl.NumberFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(average);

  // Recent snippets — newest first, only ones with an actual comment, capped
  // at 3 so the section stays a teaser rather than a full review wall.
  const snippets = reviews
    .filter((r) => (r.comment ?? '').trim().length > 0)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 3);

  const dateFmt = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', {
    year: 'numeric',
    month: 'short',
  });

  return (
    <section aria-labelledby="reviews-heading" className="mt-8">
      <Card>
        <CardBody className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <h2
              id="reviews-heading"
              className="text-sm font-semibold tracking-tight text-text-primary"
            >
              {t('title')}
            </h2>
            <div className="flex items-center gap-2">
              <StarRating rating={Math.round(average)} />
              <span className="text-sm font-semibold tracking-tight text-text-primary">
                {averageLabel}
              </span>
              <span className="text-xs text-text-muted">{t('count', { count })}</span>
            </div>
          </div>

          {snippets.length > 0 ? (
            <ul className="space-y-3">
              {snippets.map((r) => (
                <li
                  key={r.id}
                  className="rounded-lg border border-border bg-bg-base p-4 text-sm shadow-sm"
                >
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <StarRating rating={r.rating} size="sm" />
                    <span className="text-[11px] text-text-muted">
                      {dateFmt.format(new Date(r.created_at))}
                    </span>
                  </div>
                  <p className="text-pretty leading-relaxed text-text-secondary">{r.comment}</p>
                  {r.client_name ? (
                    <p className="mt-1.5 text-xs font-medium text-text-muted">
                      {t('by', { name: r.client_name })}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </CardBody>
      </Card>
    </section>
  );
}

/**
 * Five-star meter. Filled stars use the warning (gold) token; the rest sit
 * at the muted token so the rating reads at a glance. `aria-hidden` on the
 * icons — the numeric average + count label carries the accessible text.
 */
function StarRating({ rating, size = 'md' }: { rating: number; size?: 'sm' | 'md' }) {
  const px = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  return (
    <span className="flex items-center gap-0.5" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={cn(px, i < rating ? 'fill-warning text-warning' : 'text-text-muted')}
        />
      ))}
    </span>
  );
}
