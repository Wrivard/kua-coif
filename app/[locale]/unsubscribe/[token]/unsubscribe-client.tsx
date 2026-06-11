'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
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
 *
 * Plan 041 (UX-09) — copy moved from the inline `isFr` map to the
 * `pages.unsubscribe` namespace (tu-register, like the sibling token pages).
 */
export function UnsubscribeClient({
  token,
  shopName,
  firstName,
  alreadyUnsubscribed,
}: {
  token: string;
  shopName: string;
  firstName: string;
  alreadyUnsubscribed: boolean;
}) {
  const t = useTranslations('pages.unsubscribe');
  const { show } = useToast();
  const [done, setDone] = useState(alreadyUnsubscribed);
  const [isPending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await unsubscribeFromMarketing({ token });
      if (result.ok) {
        setDone(true);
        show({ variant: 'success', title: t('toasts.done') });
      } else {
        show({ variant: 'danger', title: t('toasts.failed') });
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
            <h1 className="text-lg font-semibold text-[var(--text-primary)]">{t('doneTitle')}</h1>
            <p className="text-sm text-[var(--text-secondary)]">{t('doneBody', { shopName })}</p>
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
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">{t('title')}</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            {t('body', { firstName, shopName })}
          </p>
          <Button onClick={confirm} disabled={isPending} variant="primary" className="w-full">
            {isPending ? t('confirmPending') : t('confirm')}
          </Button>
          <p className="text-xs text-[var(--text-muted)]">{t('note')}</p>
        </CardBody>
      </Card>
    </div>
  );
}
