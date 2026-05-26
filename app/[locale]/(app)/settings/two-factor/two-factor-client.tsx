'use client';

import { useEffect, useState, useTransition } from 'react';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';

/**
 * Phase 67 — TOTP enrollment + listing + unenroll, backed by Supabase
 * Auth MFA. Three states:
 *
 *  - `loading` — initial listFactors fetch in flight.
 *  - `none` — no TOTP factors yet; user can enroll.
 *  - `enrolling` — enroll() returned a secret + QR; waiting for the
 *    user to scan + enter the 6-digit code so we can verify.
 *  - `enrolled` — list of active TOTP factors with per-row unenroll.
 *
 * Recovery codes are NOT exposed yet — Supabase Auth doesn't ship
 * per-factor recovery codes out of the box; the user would need to
 * recover via the support flow if they lose their authenticator. Out
 * of scope for V1.
 */

type Factor = {
  id: string;
  friendly_name?: string | null;
  status: 'verified' | 'unverified';
};

export function TwoFactorClient() {
  const supabase = createSupabaseBrowserClient();
  const { show } = useToast();
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [enrollment, setEnrollment] = useState<{
    factorId: string;
    qrCode: string;
    secret: string;
  } | null>(null);
  const [code, setCode] = useState('');
  const [isPending, startTransition] = useTransition();

  async function refresh() {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) {
      show({ variant: 'danger', title: error.message });
      setFactors([]);
      return;
    }
    setFactors(data?.totp ?? []);
  }

  useEffect(() => {
    refresh();
    // refresh is stable across renders for this component scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startEnrollment() {
    startTransition(async () => {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `Authenticator (${new Date().toISOString().slice(0, 10)})`,
      });
      if (error) {
        show({ variant: 'danger', title: error.message });
        return;
      }
      if (data) {
        setEnrollment({
          factorId: data.id,
          qrCode: data.totp.qr_code,
          secret: data.totp.secret,
        });
      }
    });
  }

  function cancelEnrollment() {
    if (!enrollment) return;
    startTransition(async () => {
      // Best-effort — if the user backed out mid-enrollment, drop the
      // unverified factor so they don't see it stuck in the list.
      await supabase.auth.mfa.unenroll({ factorId: enrollment.factorId });
      setEnrollment(null);
      setCode('');
      await refresh();
    });
  }

  function verifyEnrollment() {
    if (!enrollment || code.trim().length !== 6) return;
    startTransition(async () => {
      const challenge = await supabase.auth.mfa.challenge({ factorId: enrollment.factorId });
      if (challenge.error || !challenge.data) {
        show({ variant: 'danger', title: challenge.error?.message ?? 'Challenge failed' });
        return;
      }
      const verify = await supabase.auth.mfa.verify({
        factorId: enrollment.factorId,
        challengeId: challenge.data.id,
        code: code.trim(),
      });
      if (verify.error) {
        show({ variant: 'danger', title: verify.error.message });
        return;
      }
      show({ variant: 'success', title: 'Two-factor enabled' });
      setEnrollment(null);
      setCode('');
      await refresh();
    });
  }

  function unenroll(factorId: string) {
    if (!window.confirm('Disable this two-factor method?')) return;
    startTransition(async () => {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) {
        show({ variant: 'danger', title: error.message });
        return;
      }
      show({ variant: 'success', title: 'Two-factor removed' });
      await refresh();
    });
  }

  if (factors === null) {
    return (
      <div className="max-w-2xl space-y-3 p-6">
        <Skeleton className="h-32 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6 p-6">
      {/* Status card */}
      <Card>
        <CardHeader>
          <CardTitle>Authenticator app</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          {factors.length === 0 && !enrollment ? (
            <>
              <div className="flex items-center gap-3">
                <ShieldOff className="h-5 w-5 shrink-0 text-text-muted" />
                <p className="text-sm text-text-secondary">
                  Two-factor authentication is off. Enable it to require a one-time code from your
                  authenticator app at sign-in.
                </p>
              </div>
              <Button onClick={startEnrollment} loading={isPending}>
                Enable two-factor
              </Button>
            </>
          ) : null}

          {factors.length > 0 && !enrollment ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <ShieldCheck className="h-5 w-5 shrink-0 text-success" />
                <p className="text-sm text-text-secondary">
                  Two-factor is active on {factors.length} method
                  {factors.length === 1 ? '' : 's'}.
                </p>
              </div>
              {factors.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between rounded-lg bg-bg-base px-3 py-2 shadow-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-text-primary">
                      {f.friendly_name ?? 'Authenticator'}
                    </p>
                    <p className="text-[11px] uppercase tracking-wide text-text-muted">
                      {f.status}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => unenroll(f.id)}
                    disabled={isPending}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <div className="pt-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={startEnrollment}
                  disabled={isPending}
                >
                  Add another
                </Button>
              </div>
            </div>
          ) : null}

          {enrollment ? (
            <div className="space-y-4">
              <p className="text-sm text-text-secondary">
                Scan the QR with your authenticator app (Google Authenticator, 1Password, etc.),
                then enter the 6-digit code it shows.
              </p>
              <div className="flex justify-center">
                {/* The QR is returned as an SVG data URL by Supabase. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={enrollment.qrCode}
                  alt="2FA QR code"
                  className="h-48 w-48 rounded-lg border border-border bg-white p-2"
                />
              </div>
              <div className="rounded-lg bg-bg-base px-3 py-2 text-center font-mono text-xs text-text-secondary shadow-sm">
                {enrollment.secret}
              </div>
              <div>
                <Label htmlFor="totp_code">Verification code</Label>
                <Input
                  id="totp_code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={cancelEnrollment} disabled={isPending}>
                  Cancel
                </Button>
                <Button onClick={verifyEnrollment} loading={isPending} disabled={code.length !== 6}>
                  Verify
                </Button>
              </div>
            </div>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
