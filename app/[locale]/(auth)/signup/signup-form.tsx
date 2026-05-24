'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { FieldHint, Input, Label } from '@/components/ui/input';
import { signUpAction, type AuthActionState } from '@/lib/auth/actions';

type Props = {
  locale: string;
  labels: {
    fullName: string;
    email: string;
    password: string;
    submit: string;
    submitting: string;
  };
};

const initialState: AuthActionState = { ok: true };

export function SignupForm({ locale, labels }: Props) {
  const [state, formAction] = useFormState(signUpAction, initialState);

  return (
    <form action={formAction} className="mt-6 space-y-4" noValidate>
      <input type="hidden" name="locale" value={locale} />

      <div>
        <Label htmlFor="fullName" required>
          {labels.fullName}
        </Label>
        <Input
          id="fullName"
          name="fullName"
          type="text"
          autoComplete="name"
          required
          minLength={1}
          maxLength={120}
          invalid={Boolean(state && 'fieldErrors' in state && state.fieldErrors?.fullName)}
        />
        {state && 'fieldErrors' in state && state.fieldErrors?.fullName ? (
          <FieldHint error>{state.fieldErrors.fullName}</FieldHint>
        ) : null}
      </div>

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
          <FieldHint error>{state.fieldErrors.email}</FieldHint>
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
          autoComplete="new-password"
          required
          minLength={8}
          invalid={Boolean(state && 'fieldErrors' in state && state.fieldErrors?.password)}
        />
        {state && 'fieldErrors' in state && state.fieldErrors?.password ? (
          <FieldHint error>{state.fieldErrors.password}</FieldHint>
        ) : null}
      </div>

      {state && !state.ok && !state.fieldErrors ? (
        <p
          role="alert"
          className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
        >
          {state.error}
        </p>
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
