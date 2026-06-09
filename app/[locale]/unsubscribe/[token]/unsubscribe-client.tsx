'use client';

import { useState, useTransition } from 'react';
import { BellOff, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { unsubscribeFromMarketing } from './actions';

/**
 * Clients audit W6b — marketing unsubscribe confirm UI.
 *
 * One button. The page already verified the token; clicking confirms
 * the opt-out (the mutating POST), so an email-scanner prefetch that
 * merely GETs the link can't unsubscribe anyone.
 */
export function UnsubscribeClient({
  locale,
  token,
  shopName,
  firstName,
  alreadyUnsubscribed,
}: {
  locale: string;
  token: string;
  shopName: string;
  firstName: string;
  alreadyUnsubscribed: boolean;
}) {
  const isFr = locale === 'fr';
  const { show } = useToast();
  const [done, setDone] = useState(alreadyUnsubscribed);
  const [isPending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await unsubscribeFromMarketing({ token });
      if (result.ok) {
        setDone(true);
        show({
          variant: 'success',
          title: isFr ? 'Tu es désabonné·e.' : 'You’re unsubscribed.',
        });
      } else {
        show({
          variant: 'danger',
          title: isFr
            ? 'Impossible de te désabonner. Le lien est peut-être expiré.'
            : 'Could not unsubscribe. The link may have expired.',
        });
      }
    });
  }

  if (done) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <Card>
          <CardBody className="space-y-4 py-10 text-center">
            <div className="flex justify-center" aria-hidden>
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent-subtle)] text-[var(--accent)]">
                <Check className="h-6 w-6" />
              </span>
            </div>
            <h1 className="text-lg font-semibold text-[var(--text-primary)]">
              {isFr ? 'Tu es désabonné·e' : 'You’re unsubscribed'}
            </h1>
            <p className="text-sm text-[var(--text-secondary)]">
              {isFr
                ? `Tu ne recevras plus d’emails marketing de ${shopName}. Les messages liés à tes rendez-vous (confirmations, rappels) continueront d’être envoyés.`
                : `You’ll no longer receive marketing emails from ${shopName}. Messages about your appointments (confirmations, reminders) are not affected.`}
            </p>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg p-6">
      <Card>
        <CardBody className="space-y-5 py-10 text-center">
          <div className="flex justify-center" aria-hidden>
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-surface-2)] text-[var(--text-secondary)]">
              <BellOff className="h-6 w-6" />
            </span>
          </div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">
            {isFr ? 'Se désabonner du marketing' : 'Unsubscribe from marketing'}
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            {isFr
              ? `${firstName}, confirme que tu ne veux plus recevoir d’emails marketing (offres, anniversaire, demandes d’avis) de ${shopName}.`
              : `${firstName}, confirm you no longer want marketing emails (offers, birthday, review requests) from ${shopName}.`}
          </p>
          <Button onClick={confirm} disabled={isPending} variant="primary" className="w-full">
            {isPending
              ? isFr
                ? 'Un instant…'
                : 'One moment…'
              : isFr
                ? 'Confirmer le désabonnement'
                : 'Confirm unsubscribe'}
          </Button>
          <p className="text-xs text-[var(--text-muted)]">
            {isFr
              ? 'Les messages liés à tes rendez-vous ne sont pas affectés.'
              : 'Appointment-related messages are not affected.'}
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
