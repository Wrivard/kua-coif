'use client';

import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { Check, ExternalLink, Pencil, RefreshCw, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { BUSINESS_TYPES } from '@/db/enums';
import type { PaymentProfileRow, StripeConnectState } from './page';
import {
  openStripeDashboard,
  refreshStripeStatus,
  startStripeConnect,
  updatePaymentProfile,
} from './actions';
import { paymentProfileSchema, type PaymentProfileInput } from './schema';

type Props = {
  profile: PaymentProfileRow | null;
  currentUser: { email: string; fullName: string | null };
  stripe: StripeConnectState;
};

export function PaymentsClient({ profile, currentUser, stripe }: Props) {
  const t = useTranslations('pages.settings.payments');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PaymentProfileInput>({
    resolver: zodResolver(paymentProfileSchema),
    defaultValues: {
      legal_name: profile?.legal_name ?? null,
      business_type: profile?.business_type ?? null,
      dob: profile?.dob ?? null,
    },
  });

  function onSubmit(values: PaymentProfileInput) {
    startTransition(async () => {
      const result = await updatePaymentProfile(values);
      if (result.ok) {
        show({ variant: 'success', title: t('toasts.saved') });
        setEditing(false);
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  const initials =
    (currentUser.fullName ?? currentUser.email)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join('') || '??';

  return (
    <>
      <PageHeader title={t('title')} />
      <div className="grid grid-cols-1 gap-4 p-6 lg:grid-cols-3">
        {/* ─── Stripe Connect (Phase 28) ──────────────────────────────────
            Only renders when STRIPE_SECRET_KEY is set server-side. The
            page-level helper passes `stripe.configured` through props. */}
        {stripe.configured ? (
          <StripeConnectCard stripe={stripe} t={t} tErr={tErr} show={show} />
        ) : null}

        {/* ─── Profile card ────────────────────────────────────────────── */}
        {/* ─── Profile card ────────────────────────────────────────────── */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>{t('profile.title')}</CardTitle>
            {profile?.verified ? (
              <Badge variant="success">
                <Check className="h-3 w-3" /> {t('profile.verified')}
              </Badge>
            ) : null}
          </CardHeader>
          <CardBody className="space-y-4 text-sm">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-info text-base font-bold text-white">
                {initials}
              </span>
              <div>
                <p className="font-semibold text-text-primary">{currentUser.fullName ?? '—'}</p>
                <p className="text-xs text-text-secondary">{currentUser.email}</p>
              </div>
            </div>
            <ProvidedRow label={t('profile.sin')} provided={profile?.sin_provided ?? false} t={t} />
            <Row label={t('profile.dob')} value={profile?.dob ?? '—'} />
            <Row label={t('profile.createdAt')} value={profile?.created_at?.slice(0, 10) ?? '—'} />
          </CardBody>
        </Card>

        {/* ─── Business details ───────────────────────────────────────── */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>{t('business.title')}</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="info">
                {t(`business.types.${profile?.business_type ?? 'individual'}`)}
              </Badge>
              <button
                type="button"
                aria-label={tCommon('actions.edit')}
                onClick={() => setEditing(true)}
                className="rounded p-1 text-text-muted hover:bg-bg-surface-2 hover:text-text-primary"
              >
                <Pencil className="h-4 w-4" />
              </button>
            </div>
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            <Row label={t('business.legalName')} value={profile?.legal_name ?? '—'} />
            <ProvidedRow
              label={t('business.taxId')}
              provided={profile?.tax_id_provided ?? false}
              t={t}
            />
            <p className="text-xs text-text-muted">{t('business.sensitiveHint')}</p>
          </CardBody>
        </Card>

        {/* ─── Destination accounts ───────────────────────────────────── */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>{t('destination.title')}</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            {profile?.destination_bank_name ? (
              <div className="rounded border border-border bg-bg-surface-2 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                  {profile.destination_bank_name}
                </p>
                <p className="font-mono text-sm">•••• {profile.destination_last4 ?? '••••'}</p>
              </div>
            ) : (
              <p className="text-xs text-text-muted">{t('destination.empty')}</p>
            )}
          </CardBody>
        </Card>

        {/* ─── Rapid Transfer promo (V1 placeholder) ─────────────────── */}
        <Card className="lg:col-span-3">
          <CardBody className="flex flex-col items-start gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold text-text-primary">{t('rapidTransfer.title')}</p>
              <p className="mt-1 text-xs text-text-secondary">{t('rapidTransfer.body')}</p>
            </div>
            <Button variant="secondary" size="sm" disabled>
              {t('rapidTransfer.cta')}
            </Button>
          </CardBody>
        </Card>
      </div>

      {/* ─── Edit business modal ─────────────────────────────────────── */}
      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title={t('business.editTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(false)} disabled={isPending}>
              <X className="h-4 w-4" /> {tCommon('actions.cancel')}
            </Button>
            <Button onClick={handleSubmit(onSubmit)} loading={isPending}>
              <Check className="h-4 w-4" /> {tCommon('actions.save')}
            </Button>
          </>
        }
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div>
            <Label htmlFor="legal_name">{t('business.legalName')}</Label>
            <Input
              id="legal_name"
              invalid={Boolean(errors.legal_name)}
              {...register('legal_name')}
            />
          </div>
          <div>
            <Label htmlFor="business_type">{t('business.type')}</Label>
            <Select id="business_type" {...register('business_type')}>
              <option value="">—</option>
              {BUSINESS_TYPES.map((b) => (
                <option key={b} value={b}>
                  {t(`business.types.${b}`)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="dob">{t('profile.dob')}</Label>
            <Input id="dob" type="date" {...register('dob')} />
          </div>
        </form>
      </Modal>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-2 last:border-b-0 last:pb-0">
      <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</span>
      <span className="text-right text-text-primary">{value}</span>
    </div>
  );
}

function ProvidedRow({
  label,
  provided,
  t,
}: {
  label: string;
  provided: boolean;
  t: (key: string) => string;
}) {
  return (
    <Row
      label={label}
      value={
        provided ? (
          <Badge variant="success">
            <Check className="h-3 w-3" /> {t('profile.provided')}
          </Badge>
        ) : (
          <Badge variant="danger">
            <X className="h-3 w-3" /> {t('profile.notProvided')}
          </Badge>
        )
      }
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Stripe Connect — Phase 28
// ─────────────────────────────────────────────────────────────────────────

type StripeStatus = StripeConnectState['status'];

/** Map our enum onto a Badge variant + i18n key. */
const STATUS_BADGE: Record<
  StripeStatus,
  { variant: 'info' | 'warning' | 'success' | 'danger'; key: string }
> = {
  not_started: { variant: 'info', key: 'stripe.status.notStarted' },
  pending: { variant: 'warning', key: 'stripe.status.pending' },
  restricted: { variant: 'warning', key: 'stripe.status.restricted' },
  active: { variant: 'success', key: 'stripe.status.active' },
};

function StripeConnectCard({
  stripe,
  t,
  tErr,
  show,
}: {
  stripe: StripeConnectState;
  t: (key: string) => string;
  tErr: (key: string) => string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  show: (toast: any) => void;
}) {
  const [busy, startTransition] = useTransition();
  const badge = STATUS_BADGE[stripe.status];

  function handleStart() {
    startTransition(async () => {
      const result = await startStripeConnect(undefined);
      if (result.ok) {
        // Full-page redirect — Stripe-hosted onboarding doesn't play
        // nice with iframes (X-Frame-Options DENY on their side).
        window.location.href = result.data.url;
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  function handleRefresh() {
    startTransition(async () => {
      const result = await refreshStripeStatus(undefined);
      if (result.ok) {
        show({ variant: 'success', title: t('stripe.toasts.refreshed') });
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  function handleDashboard() {
    startTransition(async () => {
      const result = await openStripeDashboard(undefined);
      if (result.ok) {
        window.open(result.data.url, '_blank', 'noopener,noreferrer');
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  return (
    <Card className="lg:col-span-3">
      <CardHeader>
        <CardTitle>{t('stripe.title')}</CardTitle>
        <Badge variant={badge.variant}>{t(badge.key)}</Badge>
      </CardHeader>
      <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl text-xs text-text-secondary">
          {stripe.status === 'active'
            ? t('stripe.description.active')
            : stripe.status === 'pending' || stripe.status === 'restricted'
              ? t('stripe.description.pending')
              : t('stripe.description.notStarted')}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {stripe.status === 'not_started' && (
            <Button onClick={handleStart} loading={busy} size="sm">
              {t('stripe.actions.connect')}
            </Button>
          )}
          {(stripe.status === 'pending' || stripe.status === 'restricted') && (
            <>
              <Button onClick={handleStart} loading={busy} size="sm">
                {t('stripe.actions.continue')}
              </Button>
              <Button variant="secondary" onClick={handleRefresh} loading={busy} size="sm">
                <RefreshCw className="h-4 w-4" /> {t('stripe.actions.refresh')}
              </Button>
            </>
          )}
          {stripe.status === 'active' && (
            <>
              <Button variant="secondary" onClick={handleRefresh} loading={busy} size="sm">
                <RefreshCw className="h-4 w-4" /> {t('stripe.actions.refresh')}
              </Button>
              <Button onClick={handleDashboard} loading={busy} size="sm">
                <ExternalLink className="h-4 w-4" /> {t('stripe.actions.dashboard')}
              </Button>
            </>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
