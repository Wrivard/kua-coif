'use client';

import { useEffect, useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Check, ExternalLink, RefreshCw, Unlink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { RadioGroup } from '@/components/ui/radio-group';
import { SectionMasthead } from '@/components/ui/section-masthead';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import type { QuickbooksConnectState, StripeConnectState } from './page';
import {
  disconnectQuickbooks,
  openStripeDashboard,
  refreshStripeStatus,
  startStripeConnect,
  updatePaymentMode,
} from './actions';
import { type PaymentMode } from './schema';

type Props = {
  stripe: StripeConnectState;
  quickbooks: QuickbooksConnectState;
  /** Phase D — current value of `shops.payment_mode`. */
  paymentMode: PaymentMode;
  /**
   * Phase F — Küa-wide application fee BPS (100 = 1%). Surfaced on
   * the Stripe Connect card so the owner sees what comes off the top
   * of every destination charge. 0 = no platform fee (V1 default).
   */
  platformAppFeeBps: number;
};

export function PaymentsClient({ stripe, quickbooks, paymentMode, platformAppFeeBps }: Props) {
  const t = useTranslations('pages.settings.payments');
  const tNav = useTranslations('pages.settings.nav');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();

  // Surface toast after QuickBooks OAuth roundtrip (Phase 35).
  const params = useSearchParams();
  useEffect(() => {
    const status = params.get('qb');
    if (!status) return;
    if (status === 'connected') {
      show({ variant: 'success', title: t('quickbooks.toasts.connected') });
    } else {
      show({ variant: 'danger', title: t('quickbooks.toasts.error') });
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('qb');
    url.searchParams.delete('reason');
    window.history.replaceState(null, '', url.toString());
  }, [params, show, t]);

  return (
    <>
      <PageHeader
        eyebrow={tNav('title')}
        title={t('title')}
        subtitle={
          stripe.configured
            ? `${t('stripe.title')} · ${t(STATUS_BADGE[stripe.status].key)}`
            : undefined
        }
      />
      <div className="max-w-4xl space-y-8 p-6">
        {/* ─── Stripe Connect (Phase 28) ──────────────────────────────────
            Only renders when STRIPE_SECRET_KEY is set server-side. The
            page-level helper passes `stripe.configured` through props. */}
        {stripe.configured ? (
          <StripeConnectCard
            stripe={stripe}
            platformAppFeeBps={platformAppFeeBps}
            t={t}
            tErr={tErr}
            show={show}
          />
        ) : null}

        {/* ─── Payment mode (Phase D) ─────────────────────────────────────
            Sits right under Stripe Connect because the two states are
            tightly coupled: 'full' and 'deposit' require Connect to be
            `active`; 'none' bypasses Stripe entirely. The card itself
            stays visible regardless of Connect status so the owner can
            see the current setting; the action's server-side guard
            rejects an invalid switch with a localized message. */}
        {stripe.configured ? (
          <PaymentModeCard
            currentMode={paymentMode}
            stripeActive={stripe.status === 'active'}
            t={t}
            tErr={tErr}
            show={show}
          />
        ) : null}

        {/* ─── QuickBooks Connect (Phase 35) ──────────────────────────────
            Same env-gate pattern. Shops can connect EITHER Stripe OR
            QuickBooks (or neither). When both are connected the UI shows
            both cards — V1.5 picks the active processor per-charge. */}
        {quickbooks.configured ? (
          <QuickbooksConnectCard quickbooks={quickbooks} t={t} tErr={tErr} show={show} />
        ) : null}
      </div>
    </>
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
  platformAppFeeBps,
  t,
  tErr,
  show,
}: {
  stripe: StripeConnectState;
  /** Phase F — app fee BPS, surfaced as "Küa takes X%" transparency. */
  platformAppFeeBps: number;
  t: (key: string, values?: Record<string, string | number>) => string;
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
    <section
      className={cn('surface-hero p-6', stripe.status === 'active' && 'ring-1 ring-accent/40')}
    >
      <SectionMasthead
        title={t('stripe.title')}
        actions={<Badge variant={badge.variant}>{t(badge.key)}</Badge>}
      />
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-xl space-y-1">
          <p className="text-xs text-text-secondary">
            {stripe.status === 'active'
              ? t('stripe.description.active')
              : stripe.status === 'pending' || stripe.status === 'restricted'
                ? t('stripe.description.pending')
                : t('stripe.description.notStarted')}
          </p>
          {/* Phase F — Küa-side platform fee transparency. Renders the
              percentage so the owner knows what comes off the top of
              each card charge. Hidden when the fee is 0 (the V1 default)
              to avoid showing "Platform fee: 0%" noise. */}
          {platformAppFeeBps > 0 ? (
            <p className="text-[11px] text-text-muted">
              {t('stripe.platformFee', { pct: (platformAppFeeBps / 100).toFixed(2) })}
            </p>
          ) : null}
        </div>
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
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// QuickBooks Connect — Phase 35
// ─────────────────────────────────────────────────────────────────────────

const QB_STATUS_BADGE: Record<
  QuickbooksConnectState['status'],
  { variant: 'info' | 'warning' | 'success' | 'danger'; key: string }
> = {
  not_started: { variant: 'info', key: 'quickbooks.status.notStarted' },
  active: { variant: 'success', key: 'quickbooks.status.active' },
  expired: { variant: 'warning', key: 'quickbooks.status.expired' },
  disconnected: { variant: 'info', key: 'quickbooks.status.disconnected' },
};

function QuickbooksConnectCard({
  quickbooks,
  t,
  tErr,
  show,
}: {
  quickbooks: QuickbooksConnectState;
  // Loop 46 — `t` accepts an optional values map so we can pass
  // ICU-formatted countdown strings (`{days}`, `{hours}`).
  // next-intl's hook returns this exact signature; the prop type
  // narrows it down for QuickbooksConnectCard.
  t: (key: string, values?: Record<string, string | number | Date>) => string;
  tErr: (key: string) => string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  show: (toast: any) => void;
}) {
  const [busy, startTransition] = useTransition();
  const badge = QB_STATUS_BADGE[quickbooks.status];

  function handleConnect() {
    // QuickBooks OAuth requires a top-frame redirect (consent screen is
    // not iframe-friendly). Plain navigation.
    window.location.href = '/api/quickbooks/oauth/start';
  }

  function handleDisconnect() {
    startTransition(async () => {
      const result = await disconnectQuickbooks(undefined);
      if (result.ok) {
        show({ variant: 'info', title: t('quickbooks.toasts.disconnected') });
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  // Loop 46 (P98) — token-expiry countdown for the connected state.
  // We show a one-liner that surfaces both "last refreshed" + days
  // until expiry so the owner can spot a stuck connection (e.g., the
  // cron stopped firing) before it goes hard-expired. Days are
  // computed client-side from the ISO timestamp — exact-to-the-day
  // is enough; minute-precision would force the page to be dynamic.
  const expiryInfo =
    quickbooks.status === 'active' && quickbooks.refreshExpiresAt
      ? (() => {
          const ms = new Date(quickbooks.refreshExpiresAt).getTime() - Date.now();
          const days = Math.max(0, Math.round(ms / (24 * 60 * 60 * 1000)));
          return {
            daysToExpiry: days,
            // Warn-class when the cron should already have refreshed
            // but hasn't (≤14 days = inside the refresh window). At
            // that point either the cron is broken or the shop's
            // refresh token was server-side revoked.
            warn: days <= 14,
          };
        })()
      : null;

  const lastRefreshedLabel =
    quickbooks.lastRefreshedAt != null
      ? (() => {
          const ms = Date.now() - new Date(quickbooks.lastRefreshedAt).getTime();
          const hours = Math.round(ms / (60 * 60 * 1000));
          if (hours < 1) return t('quickbooks.lastRefreshed.lessThanHour');
          if (hours < 24) return t('quickbooks.lastRefreshed.hoursAgo', { hours });
          const days = Math.round(hours / 24);
          return t('quickbooks.lastRefreshed.daysAgo', { days });
        })()
      : null;

  return (
    <section className="border-t border-border pt-8">
      <SectionMasthead
        title={t('quickbooks.title')}
        actions={<Badge variant={badge.variant}>{t(badge.key)}</Badge>}
      />
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-xl space-y-1">
          <p className="text-xs text-text-secondary">
            {quickbooks.status === 'active'
              ? t('quickbooks.description.active')
              : quickbooks.status === 'expired'
                ? t('quickbooks.description.expired')
                : t('quickbooks.description.notStarted')}
          </p>
          {expiryInfo ? (
            <p
              className={
                expiryInfo.warn ? 'text-[11px] text-warning' : 'text-[11px] text-text-muted'
              }
            >
              {t('quickbooks.tokenExpires', { days: expiryInfo.daysToExpiry })}
              {lastRefreshedLabel ? ` · ${lastRefreshedLabel}` : null}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(quickbooks.status === 'not_started' ||
            quickbooks.status === 'disconnected' ||
            quickbooks.status === 'expired') && (
            <Button onClick={handleConnect} loading={busy} size="sm">
              {quickbooks.status === 'expired'
                ? t('quickbooks.actions.reconnect')
                : t('quickbooks.actions.connect')}
            </Button>
          )}
          {quickbooks.status === 'active' && (
            <Button variant="secondary" onClick={handleDisconnect} loading={busy} size="sm">
              <Unlink className="h-4 w-4" /> {t('quickbooks.actions.disconnect')}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Payment mode — Phase D
//
// Owner-facing toggle for what the booking widget collects upfront.
//
//   - 'full'    : entire service price charged at booking; nothing left
//                 to pay at the shop.
//   - 'deposit' : per-service deposit charged at booking; balance paid
//                 in person. This is the historical V1 behavior and the
//                 default for shops that existed before this column.
//   - 'none'    : widget skips PaymentElement entirely; owner collects
//                 in-shop. Useful for cash-only or "trust-based" shops.
//
// The "Save" button stays disabled when the radio still matches the
// committed state, and switches "Save" → "Saving" while the action is
// in flight. Stripe-required modes show a disabled message when Connect
// isn't active yet; the server-side guard re-enforces this so a stale UI
// can't bypass.
// ─────────────────────────────────────────────────────────────────────────

function PaymentModeCard({
  currentMode,
  stripeActive,
  t,
  tErr,
  show,
}: {
  currentMode: PaymentMode;
  stripeActive: boolean;
  t: (key: string) => string;
  tErr: (key: string) => string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  show: (toast: any) => void;
}) {
  const [selected, setSelected] = useState<PaymentMode>(currentMode);
  const [busy, startTransition] = useTransition();
  const dirty = selected !== currentMode;
  // 'full' and 'deposit' need an active Connect account. The radio for
  // those options shows a hint when Connect isn't ready; the action
  // itself rejects the request server-side so a hand-crafted POST
  // can't bypass the UI guard.
  const needsConnect = !stripeActive;

  function handleSave() {
    if (!dirty) return;
    startTransition(async () => {
      const result = await updatePaymentMode({ payment_mode: selected });
      if (result.ok) {
        show({ variant: 'success', title: t('paymentMode.toasts.saved') });
      } else if (
        result.errorCode === 'INVALID_INPUT' &&
        result.fieldErrors?.payment_mode === 'stripe_required'
      ) {
        show({ variant: 'danger', title: t('paymentMode.errors.stripeRequired') });
      } else {
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  return (
    <section className="border-t border-border pt-8">
      <SectionMasthead title={t('paymentMode.title')} />
      <div className="mt-6 space-y-4">
        <p className="max-w-2xl text-xs text-text-secondary">{t('paymentMode.description')}</p>
        <RadioGroup
          name="payment_mode"
          value={selected}
          onChange={(v) => setSelected(v)}
          options={[
            {
              value: 'full',
              label: t('paymentMode.options.full.label'),
              description: needsConnect
                ? t('paymentMode.stripeRequiredHint')
                : t('paymentMode.options.full.description'),
              disabled: needsConnect,
            },
            {
              value: 'deposit',
              label: t('paymentMode.options.deposit.label'),
              description: needsConnect
                ? t('paymentMode.stripeRequiredHint')
                : t('paymentMode.options.deposit.description'),
              disabled: needsConnect,
            },
            {
              value: 'none',
              label: t('paymentMode.options.none.label'),
              description: t('paymentMode.options.none.description'),
            },
          ]}
        />
        <div className="flex justify-end">
          <Button onClick={handleSave} loading={busy} disabled={!dirty} size="sm">
            <Check className="h-4 w-4" /> {t('paymentMode.save')}
          </Button>
        </div>
      </div>
    </section>
  );
}
