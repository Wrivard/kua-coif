'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Input, Label } from '@/components/ui/input';
import { forgotPasswordAction, type ForgotPasswordState } from './actions';

const initialState: ForgotPasswordState = { kind: 'idle' };

type Props = {
  locale: string;
  labels: { email: string; submit: string; submitting: string };
};

export function ForgotPasswordForm({ locale, labels }: Props) {
  const [state, formAction] = useFormState(forgotPasswordAction, initialState);
  const t = useTranslations('auth.forgot');

  // Success branch is sticky — we don't want the user to retry and accidentally
  // trigger the rate limit. They can come back via the email link or hit
  // /forgot-password fresh if needed.
  if (state.kind === 'ok') {
    return (
      <Callout variant="success" className="mt-6 p-4 text-center">
        <CheckCircle2 className="mx-auto h-8 w-8" aria-hidden />
        <p className="mt-2 font-medium">{t('successTitle')}</p>
        <p className="mt-1 text-xs">{t('successHint')}</p>
      </Callout>
    );
  }

  return (
    <form action={formAction} className="mt-6 space-y-4" noValidate>
      <input type="hidden" name="locale" value={locale} />

      <div>
        <Label htmlFor="email" required>
          {labels.email}
        </Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>

      {state.kind === 'invalid' ? <Callout variant="danger">{t('errorInvalid')}</Callout> : null}
      {state.kind === 'rate-limited' ? (
        <Callout variant="warning">{t('errorRateLimited')}</Callout>
      ) : null}
      {state.kind === 'error' ? <Callout variant="danger">{t('errorGeneric')}</Callout> : null}

      <SubmitButton labels={labels} />
    </form>
  );
}

function SubmitButton({ labels }: { labels: Props['labels'] }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" loading={pending}>
      {pending ? labels.submitting : labels.submit}
    </Button>
  );
}
