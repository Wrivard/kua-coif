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
}: {
  locale: string;
  token: string;
  shopName: string;
  barberName: string | null;
  alreadySubmitted: boolean;
}) {
  const isFr = locale === 'fr';
  const { show } = useToast();
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [clientName, setClientName] = useState('');
  const [submitted, setSubmitted] = useState(alreadySubmitted);
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
        setSubmitted(true);
        show({
          variant: 'success',
          title: isFr ? 'Merci pour ton avis !' : 'Thanks for your review!',
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
          <CardBody className="space-y-3 text-center">
            <p className="text-2xl">★★★★★</p>
            <h1 className="text-xl font-semibold tracking-tight text-text-primary">
              {isFr ? 'Avis reçu' : 'Review received'}
            </h1>
            <p className="text-sm text-text-secondary">
              {isFr
                ? `Merci d’avoir pris le temps. ${shopName} verra ton avis dans quelques instants.`
                : `Thanks for taking the time. ${shopName} will see your review shortly.`}
            </p>
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
            <div className="flex items-center gap-1.5" role="radiogroup" aria-label={labels.rating}>
              {[1, 2, 3, 4, 5].map((star) => {
                const active = (hoverRating || rating) >= star;
                return (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                    aria-checked={rating === star}
                    role="radio"
                    aria-label={`${star} / 5`}
                    className="rounded-md p-1 transition-transform duration-150 ease-out-quint hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <Star
                      className={
                        'h-8 w-8 ' + (active ? 'fill-warning text-warning' : 'text-text-muted')
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
