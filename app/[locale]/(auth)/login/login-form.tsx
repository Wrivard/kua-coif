'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { FieldHint, Input, Label } from '@/components/ui/input';
import { signInAction, type AuthActionState } from '@/lib/auth/actions';
import type { AuthErrorCode } from '@/lib/auth/errors';

type Props = {
  locale: string;
  redirectTo: string;
  labels: { email: string; password: string; submit: string; submitting: string };
};

const initialState: AuthActionState = { ok: true };

export function LoginForm({ locale, redirectTo, labels }: Props) {
  const [state, formAction] = useFormState(signInAction, initialState);
  const tErr = useTranslations('auth.errors');

  return (
    <form action={formAction} className="mt-6 space-y-4" noValidate>
      <input type="hidden" name="locale" value={locale} />
      {redirectTo ? <input type="hidden" name="redirect" value={redirectTo} /> : null}

      <div>
        <Label htmlFor="email" required>
          {labels.email}
        </Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          invalid={Boolean(state && 'fieldErrors' in state && state.fieldErrors?.email)}
        />
        {state && 'fieldErrors' in state && state.fieldErrors?.email ? (
          <FieldHint error>{tErr('field.email')}</FieldHint>
        ) : null}
      </div>

      <div>
        <Label htmlFor="password" required>
          {labels.password}
        </Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
          invalid={Boolean(state && 'fieldErrors' in state && state.fieldErrors?.password)}
        />
        {state && 'fieldErrors' in state && state.fieldErrors?.password ? (
          <FieldHint error>{tErr('field.password')}</FieldHint>
        ) : null}
      </div>

      {state && !state.ok && !state.fieldErrors ? (
        <Callout variant="danger">{tErr(state.errorCode satisfies AuthErrorCode)}</Callout>
      ) : null}

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
