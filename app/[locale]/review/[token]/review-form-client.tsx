'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { submitPublicReview } from './actions';

/**
 * Phase 63b — Review submission form. Star rating + comment.
 *
 * The token authenticates the customer to a specific appointment, so
 * the form needs no email/phone input — the server already knows who
 * they are.
 */
export function ReviewFormClient({
  locale,
  token,
  shopName,
  barberName,
  alreadySubmitted,
  submittedRating: knownSubmittedRating,
  initialRating,
  publicReviewUrl,
}: {
  locale: string;
  token: string;
  shopName: string;
  barberName: string | null;
  alreadySubmitted: boolean;
  /** Plan 043 — the rating already on file (returning visitor), if any. */
  submittedRating: number | null;
  /** Plan 043 — pre-selection from the email's `?rating=N` deep-link (0 = none). */
  initialRating: number;
  /** Plan 043 — the shop's Google listing for the thank-you handoff. */
  publicReviewUrl: string | null;
}) {
  // Plan 041 (residual sweep) — copy comes from pages.review.
  const t = useTranslations('pages.review');
  const { show } = useToast();
  // Plan 043 (step 1) — seeded from the email deep-link; submitting still
  // takes an explicit button press (a mis-tap must never post a review).
  const [rating, setRating] = useState(initialRating);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [clientName, setClientName] = useState('');
  const [submitted, setSubmitted] = useState(alreadySubmitted);
  // Plan 043 (step 2) — the rating the thank-you echoes: the one ACTUALLY on
  // file. Null when unknown (duplicate detected server-side mid-session) —
  // the star row is hidden rather than showing a made-up count.
  const [submittedRating, setSubmittedRating] = useState<number | null>(knownSubmittedRating);
  const [isPending, startTransition] = useTransition();

  function submit() {
    if (rating < 1 || rating > 5) return;
    startTransition(async () => {
      const result = await submitPublicReview({
        token,
        rating,
        comment: comment.trim() || null,
        client_name: clientName.trim() || null,
      });
      if (result.ok) {
        setSubmittedRating(rating);
        setSubmitted(true);
        show({
          variant: 'success',
          title: t('toasts.thanks'),
        });
      } else if (result.fieldErrors?.review === 'already_submitted') {
        // Plan 043 (CORRECTNESS-07) — the review IS saved (first submit /
        // another tab won). Success, not "link expired". We don't know the
        // stored rating here, so the thank-you omits the star echo.
        setSubmitted(true);
        show({
          variant: 'success',
          title: t('toasts.alreadySaved'),
        });
      } else {
        show({
          variant: 'danger',
          title: t('toasts.failed'),
        });
      }
    });
  }

  if (submitted) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <Card>
          <CardBody className="space-y-4 py-10 text-center">
            {/* Plan 043 (step 2) — echo the ACTUAL submitted rating. A 2★
                reviewer used to see five filled stars (reads as the salon
                inflating their rating). Hidden when the rating is unknown. */}
            {submittedRating !== null && submittedRating >= 1 ? (
              <div className="flex justify-center gap-1" aria-hidden>
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star
                    key={s}
                    className={
                      'h-7 w-7 ' +
                      (s <= submittedRating ? 'fill-warning text-warning' : 'text-text-muted')
                    }
                  />
                ))}
              </div>
            ) : null}
            <h1 className="text-display-sm text-text-primary">{t('doneTitle')}</h1>
            <p className="text-sm text-text-secondary">{t('doneBody', { shopName })}</p>
            {/* Plan 043 (step 4) — Google handoff. Shown to EVERYONE (no
                review-gating: only inviting 4-5★ reviewers onward violates
                Google's policy); first-party reviews become local-SEO ones. */}
            {publicReviewUrl ? (
              <p className="text-sm">
                <a
                  href={publicReviewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-accent underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  {t('googleCta')}
                </a>
              </p>
            ) : null}
          </CardBody>
        </Card>
      </div>
    );
  }

  const formTitle = barberName
    ? t('titleWithBarber', { name: barberName })
    : t('titleShop', { shopName });

  return (
    <div className="mx-auto max-w-lg p-6">
      <Card>
        <CardHeader>
          <CardTitle>{formTitle}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-5">
          <div>
            <Label>{t('rating')}</Label>
            {/* Plan 043 (UX-04) — the radio roles violated the ARIA radio
                pattern (no roving tabindex, no arrow keys). Plain toggle
                buttons with aria-pressed are the simpler CONFORMANT shape:
                five tab stops, native Enter/Space, no custom key handling.
                Hit area bumped to 48px (h-9 star + p-1.5 ≥ the 44px floor). */}
            <div className="flex items-center gap-1.5" role="group" aria-label={t('rating')}>
              {[1, 2, 3, 4, 5].map((star) => {
                const active = (hoverRating || rating) >= star;
                return (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                    aria-pressed={rating === star}
                    aria-label={`${star} / 5`}
                    className="rounded-md p-1.5 transition-transform duration-150 ease-out-quint hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    <Star
                      className={
                        'h-9 w-9 ' + (active ? 'fill-warning text-warning' : 'text-text-muted')
                      }
                    />
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <Label htmlFor="review_name">{t('name')}</Label>
            <Input
              id="review_name"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              maxLength={80}
              autoComplete="given-name"
            />
          </div>

          <div>
            <Label htmlFor="review_comment">{t('comment')}</Label>
            <Textarea
              id="review_comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              maxLength={1000}
            />
          </div>

          <div className="flex justify-end">
            <Button onClick={submit} loading={isPending} disabled={rating < 1}>
              {t('submit')}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
