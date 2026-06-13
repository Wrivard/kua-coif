'use client';

import { useEffect, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { SuperAdminNav } from '@/components/ui/super-admin-nav';
import { captureException } from '@/lib/observability';
import { updatePlatformAppFee, type UpdateAppFeeState } from './actions';

type Props = {
  /** Current app fee in basis points (100 = 1%). */
  initialAppFeeBps: number;
  /** ISO timestamp of the last save, null when never set. */
  updatedAt: string | null;
  /** Email of the super-admin who made the last save. Null when their
   *  profile is missing (e.g. account deleted). */
  updatedByEmail: string | null;
  /** Phase H+6 — full URL to the history sub-page. The page resolves
   *  it server-side from the locale param so the link survives FR/EN
   *  switches. */
  historyHref: string;
};

export function PlatformConfigClient({
  initialAppFeeBps,
  updatedAt,
  updatedByEmail,
  historyHref,
}: Props) {
  // Track the percentage as a string so the input behaves naturally with
  // decimals and the user can clear/type freely. We initialize from BPS.
  const initialPct = (initialAppFeeBps / 100).toString();
  const [pct, setPct] = useState<string>(initialPct);
  const [state, formAction] = useFormState<UpdateAppFeeState | undefined, FormData>(
    updatePlatformAppFee,
    undefined,
  );

  const fieldError = state?.kind === 'invalid' ? (state.fieldErrors?.app_fee_pct ?? null) : null;

  // SECRET-01 — ship the raw error detail to Sentry but never render it; the
  // UI shows a generic message below.
  useEffect(() => {
    if (state?.kind === 'error') {
      captureException(new Error(`platform-config save: ${state.message}`), {
        tags: { layer: 'platform-config', surface: 'super-admin-ui' },
      });
    }
  }, [state]);

  return (
    <>
      <PageHeader title="Platform config" subtitle="Küa-wide settings · application fee, etc." />
      <SuperAdminNav />
      <div className="max-w-3xl space-y-6 p-6">
        <p className="text-sm leading-relaxed text-text-secondary">
          The application fee BPS drives every Stripe Connect destination charge across all shops.
          Changes take effect on the next PaymentIntent on this serverless instance
          (force-invalidated locally on save); other instances refresh on their own 30s TTL.
        </p>

        <Card>
          <CardHeader>
            <CardTitle>Application fee</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <form action={formAction} className="space-y-4">
              <div>
                <Label htmlFor="app_fee_pct">App fee percentage</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="app_fee_pct"
                    name="app_fee_pct"
                    type="number"
                    min={0}
                    max={10}
                    step={0.01}
                    value={pct}
                    onChange={(e) => setPct(e.target.value)}
                    className="w-32"
                    invalid={Boolean(fieldError)}
                  />
                  <span className="text-sm text-text-secondary">%</span>
                </div>
                <p className="mt-1 text-xs text-text-muted">
                  Currently storing {initialAppFeeBps} basis points (1 BPS = 0.01%). Hard-capped at
                  10% in the form.
                </p>
                {fieldError ? (
                  <p className="mt-1 text-xs text-danger">
                    {fieldError === 'pct_min'
                      ? 'Must be 0 or higher.'
                      : fieldError === 'pct_max'
                        ? "Can't exceed 10%."
                        : 'Invalid value.'}
                  </p>
                ) : null}
                {state?.kind === 'saved' ? (
                  <p className="mt-1 text-xs text-success">
                    Saved — new fee {state.appFeeBps} BPS effective immediately.
                  </p>
                ) : null}
                {state?.kind === 'error' ? (
                  <p className="mt-1 text-xs text-danger">
                    Something went wrong saving the fee. The detail was logged for review.
                  </p>
                ) : null}
              </div>
              <div className="flex justify-end">
                <SaveButton />
              </div>
            </form>
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border bg-bg-surface-2 p-4 text-xs text-text-secondary">
              <div className="space-y-1">
                <p className="font-semibold text-text-primary">Last update</p>
                <p>
                  {updatedAt ? new Date(updatedAt).toLocaleString() : 'Never'}
                  {updatedByEmail ? ` · by ${updatedByEmail}` : ''}
                </p>
              </div>
              <a href={historyHref} className="text-accent hover:underline">
                Voir l&apos;historique →
              </a>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>How the fee works</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-sm text-text-secondary">
            <p>
              <strong className="text-text-primary">Destination charges.</strong> Each Stripe
              Connect PaymentIntent uses{' '}
              <code className="rounded bg-bg-base px-1">transfer_data.destination</code> to route
              the bulk of the charge to the shop and{' '}
              <code className="rounded bg-bg-base px-1">application_fee_amount</code> to keep the
              platform fee in Küa&apos;s Stripe account.
            </p>
            <p>
              <strong className="text-text-primary">Fee math.</strong> Computed at PI mint time as{' '}
              <code>round(amount_cents × bps / 10_000)</code>. A $50 charge at 1% (= 100 BPS) yields
              a $0.50 platform fee; the shop receives $49.50 net (minus Stripe&apos;s processing
              fee).
            </p>
            <p>
              <strong className="text-text-primary">Transparency.</strong> Each shop&apos;s owner
              sees the current percentage on their{' '}
              <code className="rounded bg-bg-base px-1">/settings/payments</code> page so they know
              what comes off the top.
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      {pending ? null : <Save className="h-4 w-4" />} Save
    </Button>
  );
}
