'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { INDUSTRIES, INDUSTRY_KINDS, type IndustryKind } from '@/lib/industries';
import { createShopAction, type CreateShopState } from './actions';

const initialState: CreateShopState = { kind: 'idle' };

export function CreateShopForm() {
  const [state, formAction] = useFormState(createShopAction, initialState);
  const [industry, setIndustry] = useState<IndustryKind>('hair_salon');

  return (
    <form action={formAction} className="max-w-xl space-y-6" noValidate>
      {/* Industry picker — drives the catalog seed + feature flags after
          submission. We keep this controlled (`useState` + hidden input)
          rather than a native radio because the card UI is friendlier than
          stacked radios for 6 options. */}
      <fieldset>
        <legend className="text-sm font-semibold">Industry</legend>
        <p className="mt-1 text-xs text-text-muted">
          We seed a starter catalog (services + categories) that matches this vertical. The shop
          owner can edit everything afterwards.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {INDUSTRY_KINDS.map((id) => {
            const def = INDUSTRIES[id];
            const active = industry === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setIndustry(id)}
                aria-pressed={active}
                className={cn(
                  'rounded border p-3 text-left text-sm transition-colors',
                  active
                    ? 'border-accent bg-accent-subtle text-text-primary'
                    : 'border-border bg-bg-base text-text-secondary hover:bg-bg-surface-2',
                )}
              >
                <p className="font-medium">{def.displayName.en}</p>
                <p className="mt-0.5 text-[11px] text-text-muted">
                  {def.catalog.services.length} services pre-loaded
                </p>
              </button>
            );
          })}
        </div>
        <input type="hidden" name="industry" value={industry} />
      </fieldset>

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
          className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
        >
          {state.reason === 'alias-taken'
            ? 'That alias is already in use. Pick another.'
            : 'That email is already the owner of this shop.'}
        </p>
      ) : null}
      {state.kind === 'error' ? (
        <p
          role="alert"
          className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
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
