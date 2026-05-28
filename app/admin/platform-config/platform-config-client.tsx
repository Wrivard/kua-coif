'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { updatePlatformAppFee, type UpdateAppFeeState } from './actions';

type Props = {
  /** Current app fee in basis points (100 = 1%). */
  initialAppFeeBps: number;
  /** ISO timestamp of the last save, null when never set. */
  updatedAt: string | null;
  /** Email of the super-admin who made the last save. Null when their
   *  profile is missing (e.g. account deleted). */
  updatedByEmail: string | null;
};

export function PlatformConfigClient({ initialAppFeeBps, updatedAt, updatedByEmail }: Props) {
  // Track the percentage as a string so the input behaves naturally with
  // decimals and the user can clear/type freely. We initialize from BPS.
  const initialPct = (initialAppFeeBps / 100).toString();
  const [pct, setPct] = useState<string>(initialPct);
  const [state, formAction] = useFormState<UpdateAppFeeState | undefined, FormData>(
    updatePlatformAppFee,
    undefined,
  );

  const fieldError = state?.kind === 'invalid' ? (state.fieldErrors?.app_fee_pct ?? null) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Platform config</h1>
        <p className="text-sm text-text-secondary">
          Küa-wide settings. The application fee BPS drives every Stripe Connect destination charge
          across all shops. Changes take effect on the next PaymentIntent on this serverless
          instance (force-invalidated locally on save); other instances refresh on their own 30s
          TTL.
        </p>
      </div>

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
                <p className="mt-1 text-xs text-danger">{state.message}</p>
              ) : null}
            </div>
            <div className="flex justify-end">
              <SaveButton />
            </div>
          </form>
          <div className="rounded border border-border bg-bg-surface-2 p-3 text-xs text-text-secondary">
            <p className="font-semibold text-text-primary">Last update</p>
            <p>
              {updatedAt ? new Date(updatedAt).toLocaleString() : 'Never'}
              {updatedByEmail ? ` · by ${updatedByEmail}` : ''}
            </p>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How the fee works</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2 text-sm text-text-secondary">
          <p>
            <strong className="text-text-primary">Destination charges.</strong> Each Stripe Connect
            PaymentIntent uses{' '}
            <code className="rounded bg-bg-base px-1">transfer_data.destination</code> to route the
            bulk of the charge to the shop and{' '}
            <code className="rounded bg-bg-base px-1">application_fee_amount</code> to keep the
            platform fee in Küa&apos;s Stripe account.
          </p>
          <p>
            <strong className="text-text-primary">Fee math.</strong> Computed at PI mint time as{' '}
            <code>round(amount_cents × bps / 10_000)</code>. A $50 charge at 1% (= 100 BPS) yields a
            $0.50 platform fee; the shop receives $49.50 net (minus Stripe&apos;s processing fee).
          </p>
          <p>
            <strong className="text-text-primary">Transparency.</strong> Each shop&apos;s owner sees
            the current percentage on their{' '}
            <code className="rounded bg-bg-base px-1">/settings/payments</code> page so they know
            what comes off the top.
          </p>
        </CardBody>
      </Card>
    </div>
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
