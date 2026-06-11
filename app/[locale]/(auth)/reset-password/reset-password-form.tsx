'use client';

import { useEffect, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { resetPasswordAction, type ResetPasswordState } from './actions';

const initialState: ResetPasswordState = { kind: 'idle' };

type ExchangeState = 'pending' | 'ok' | 'failed' | 'no-code';

type Props = {
  locale: string;
  labels: { password: string; confirm: string; submit: string; submitting: string };
};

/**
 * Resets the password for the user who just clicked the email link.
 *
 * Two phases:
 *   1. **Code exchange** (on mount) — Supabase's PKCE flow embeds a `code`
 *      query param in the reset link. We exchange it for a session via the
 *      browser client; that sets the auth cookies that the Server Action
 *      below relies on.
 *   2. **Password update** — once exchange is `ok` we render the form, and
 *      the Server Action `resetPasswordAction` calls `auth.updateUser`.
 *
 * Failure modes:
 *   - `no-code`: user hit `/reset-password` directly. We show a "request a
 *     fresh link" message.
 *   - `failed`: the code was rejected (expired or already used). Same UX.
 *   - `pending`: spinner while we round-trip Supabase.
 */
export function ResetPasswordForm({ locale, labels }: Props) {
  const t = useTranslations('auth.reset');
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
        className="mt-6 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
      >
        {t(exchange === 'no-code' ? 'errorNoCode' : 'errorFailed')}
      </p>
    );
  }

  return <PasswordForm locale={locale} labels={labels} />;
}

function PasswordForm({ locale, labels }: Props) {
  const [state, formAction] = useFormState(resetPasswordAction, initialState);
  const t = useTranslations('auth.reset');

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
          className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
        >
          {t(state.reason === 'mismatch' ? 'errorMismatch' : 'errorWeak')}
        </p>
      ) : null}
      {state.kind === 'rate-limited' ? (
        <p
          role="alert"
          className="rounded border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
        >
          {t('errorRateLimited')}
        </p>
      ) : null}
      {state.kind === 'error' ? (
        <p
          role="alert"
          className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
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
