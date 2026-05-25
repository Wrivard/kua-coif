'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { createShopAction, type CreateShopState } from './actions';

const initialState: CreateShopState = { kind: 'idle' };

export function CreateShopForm() {
  const [state, formAction] = useFormState(createShopAction, initialState);

  return (
    <form action={formAction} className="max-w-xl space-y-5" noValidate>
      <div>
        <Label htmlFor="name" required>
          Shop name
        </Label>
        <Input
          id="name"
          name="name"
          autoComplete="organization"
          required
          invalid={state.kind === 'invalid' && Boolean(state.fieldErrors.name)}
        />
        <p className="mt-1 text-xs text-text-muted">
          Public-facing name (shown on the booking page, emails, etc.).
        </p>
      </div>

      <div>
        <Label htmlFor="alias" required>
          URL alias
        </Label>
        <Input
          id="alias"
          name="alias"
          autoComplete="off"
          placeholder="axum"
          required
          invalid={state.kind === 'invalid' && Boolean(state.fieldErrors.alias)}
        />
        <p className="mt-1 text-xs text-text-muted">
          Lowercase letters, digits, and dashes. Used as <code>/book/&lt;alias&gt;</code> and the
          widget identifier.
        </p>
      </div>

      <div>
        <Label htmlFor="ownerFullName">Owner full name</Label>
        <Input id="ownerFullName" name="ownerFullName" autoComplete="name" placeholder="Optional" />
      </div>

      <div>
        <Label htmlFor="ownerEmail" required>
          Owner email
        </Label>
        <Input
          id="ownerEmail"
          name="ownerEmail"
          type="email"
          autoComplete="email"
          required
          invalid={state.kind === 'invalid' && Boolean(state.fieldErrors.ownerEmail)}
        />
        <p className="mt-1 text-xs text-text-muted">
          An invitation email is sent here. If the address already has a Küa profile (multi-shop
          owner), we skip the email and add them directly as confirmed.
        </p>
      </div>

      {state.kind === 'conflict' ? (
        <p
          role="alert"
          className="border-danger/40 bg-danger/10 rounded border px-3 py-2 text-xs text-danger"
        >
          {state.reason === 'alias-taken'
            ? 'That alias is already in use. Pick another.'
            : 'That email is already the owner of this shop.'}
        </p>
      ) : null}
      {state.kind === 'error' ? (
        <p
          role="alert"
          className="border-danger/40 bg-danger/10 rounded border px-3 py-2 text-xs text-danger"
        >
          {state.message}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      {pending ? 'Creating…' : 'Create shop'}
    </Button>
  );
}
