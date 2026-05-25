'use client';

import { useEffect, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { setupPasswordAction, type SetupPasswordState } from './actions';

const initialState: SetupPasswordState = { kind: 'idle' };

type ExchangeState = 'pending' | 'ok' | 'failed' | 'no-code';

type Props = {
  locale: string;
  labels: { password: string; confirm: string; submit: string; submitting: string };
};

/**
 * Twin of `reset-password-form.tsx` but for the first-login case (Phase 22).
 *
 * - Reads `code` from the URL (Supabase PKCE invite link).
 * - Exchanges it for a session via the browser client.
 * - Renders the password form.
 * - The Server Action then sets the password AND flips
 *   `shop_members.status = 'confirmed'` for every pending row this user owns.
 */
export function SetupPasswordForm({ locale, labels }: Props) {
  const t = useTranslations('auth.setup');
  const [exchange, setExchange] = useState<ExchangeState>('pending');

  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    if (!code) {
      setExchange('no-code');
      return;
    }
    const supabase = createSupabaseBrowserClient();
    supabase.auth
      .exchangeCodeForSession(code)
      .then(({ error }) => setExchange(error ? 'failed' : 'ok'))
      .catch(() => setExchange('failed'));
  }, []);

  if (exchange === 'pending') {
    return (
      <div className="mt-6 flex items-center justify-center gap-2 text-sm text-text-secondary">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t('exchanging')}
      </div>
    );
  }
  if (exchange === 'no-code' || exchange === 'failed') {
    return (
      <p
        role="alert"
        className="border-danger/40 bg-danger/10 mt-6 rounded border px-3 py-2 text-xs text-danger"
      >
        {t(exchange === 'no-code' ? 'errorNoCode' : 'errorFailed')}
      </p>
    );
  }

  return <PasswordForm locale={locale} labels={labels} />;
}

function PasswordForm({ locale, labels }: Props) {
  const [state, formAction] = useFormState(setupPasswordAction, initialState);
  const t = useTranslations('auth.setup');

  return (
    <form action={formAction} className="mt-6 space-y-4" noValidate>
      <input type="hidden" name="locale" value={locale} />

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
        />
      </div>

      <div>
        <Label htmlFor="confirm" required>
          {labels.confirm}
        </Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
        />
      </div>

      {state.kind === 'invalid' ? (
        <p
          role="alert"
          className="border-danger/40 bg-danger/10 rounded border px-3 py-2 text-xs text-danger"
        >
          {t(state.reason === 'mismatch' ? 'errorMismatch' : 'errorWeak')}
        </p>
      ) : null}
      {state.kind === 'rate-limited' ? (
        <p
          role="alert"
          className="border-warning/40 bg-warning/10 rounded border px-3 py-2 text-xs text-warning"
        >
          {t('errorRateLimited')}
        </p>
      ) : null}
      {state.kind === 'error' ? (
        <p
          role="alert"
          className="border-danger/40 bg-danger/10 rounded border px-3 py-2 text-xs text-danger"
        >
          {t('errorGeneric')}
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
