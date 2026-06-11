'use client';

import { useState, useTransition } from 'react';
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
  const isFr = locale === 'fr';
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
          title: isFr ? 'Merci pour ton avis !' : 'Thanks for your review!',
        });
      } else if (result.fieldErrors?.review === 'already_submitted') {
        // Plan 043 (CORRECTNESS-07) — the review IS saved (first submit /
        // another tab won). Success, not "link expired". We don't know the
        // stored rating here, so the thank-you omits the star echo.
        setSubmitted(true);
        show({
          variant: 'success',
          title: isFr ? 'Ton avis était déjà enregistré.' : 'Your review was already saved.',
        });
      } else {
        show({
          variant: 'danger',
          title: isFr
            ? 'Impossible d’enregistrer l’avis. Le lien est peut-être expiré.'
            : 'Could not save the review. The link may have expired.',
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
            <h1 className="text-display-sm text-text-primary">
              {isFr ? 'Avis reçu' : 'Review received'}
            </h1>
            <p className="text-sm text-text-secondary">
              {isFr
                ? `Merci d’avoir pris le temps. ${shopName} verra ton avis dans quelques instants.`
                : `Thanks for taking the time. ${shopName} will see your review shortly.`}
            </p>
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
                  {isFr ? 'Ça nous aiderait aussi sur Google →' : 'It would also help us on Google →'}
                </a>
              </p>
            ) : null}
          </CardBody>
        </Card>
      </div>
    );
  }

  const labels = isFr
    ? {
        title: barberName
          ? `Comment était ta visite avec ${barberName} ?`
          : `Comment était ta visite chez ${shopName} ?`,
        rating: 'Ta note',
        comment: 'Un mot ? (optionnel)',
        name: 'Ton prénom (affiché publiquement, optionnel)',
        submit: 'Envoyer mon avis',
      }
    : {
        title: barberName
          ? `How was your visit with ${barberName}?`
          : `How was your visit at ${shopName}?`,
        rating: 'Your rating',
        comment: 'A few words? (optional)',
        name: 'Your first name (shown publicly, optional)',
        submit: 'Submit my review',
      };

  return (
    <div className="mx-auto max-w-lg p-6">
      <Card>
        <CardHeader>
          <CardTitle>{labels.title}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-5">
          <div>
            <Label>{labels.rating}</Label>
            {/* Plan 043 (UX-04) — the radio roles violated the ARIA radio
                pattern (no roving tabindex, no arrow keys). Plain toggle
                buttons with aria-pressed are the simpler CONFORMANT shape:
                five tab stops, native Enter/Space, no custom key handling.
                Hit area bumped to 48px (h-9 star + p-1.5 ≥ the 44px floor). */}
            <div className="flex items-center gap-1.5" role="group" aria-label={labels.rating}>
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
            <Label htmlFor="review_name">{labels.name}</Label>
            <Input
              id="review_name"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              maxLength={80}
              autoComplete="given-name"
            />
          </div>

          <div>
            <Label htmlFor="review_comment">{labels.comment}</Label>
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
              {labels.submit}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
