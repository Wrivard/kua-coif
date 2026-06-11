'use client';

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import type { StripeElementsOptions } from '@stripe/stripe-js';
import { useTranslations } from 'next-intl';
import { getStripeClient, stripeClientConfigured } from '@/lib/stripe/client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrencyCAD } from '@/lib/utils';
import { createBookingPaymentIntent, type BookingPaymentIntentResult } from './actions';

/**
 * BookingPaymentSection — Phase 56.
 *
 * Lazy companion to the booking wizard's step 4. The wizard mounts this
 * component when it knows the customer's email (for the receipt) and the
 * services they picked. We POST to `createBookingPaymentIntent` once on
 * mount; depending on the result we either:
 *
 *   - render a Stripe Elements `PaymentElement` + an exposed
 *     `confirmPayment` method that the wizard's submit handler calls
 *     before invoking `bookPublicAppointment`; or
 *   - render nothing (no deposit applies for these services); or
 *   - render a small "shop hasn't connected Stripe yet, you'll pay
 *     at the shop" notice.
 *
 * The parent wizard wires a `ref` so its existing "Confirm" button can
 * fire the payment + then submit the appointment in one flow.
 *
 * Why we don't create the appointment until AFTER payment confirms:
 * abandoned card-entry sessions would otherwise leave ghost rows. The
 * PI metadata.appointment_id carries a session UUID so Stripe's
 * dashboard isn't littered with `null`s — the actual row gets created
 * by the booking action with the same `payment_intent_id`.
 */

export type BookingPaymentSectionRef = {
  /**
   * Confirm the deposit payment. Returns the PaymentIntent ID on
   * success so the caller can pass it to `bookPublicAppointment`.
   * Rejects with an error message on failure (declined card, 3DS
   * cancel, etc.). Resolves with `{ kind: 'no_deposit' }` when there's
   * no payment to make — caller can proceed to booking immediately.
   *
   * Loop 34 (P93) — error result now carries Stripe's structured
   * `code` (e.g. `card_declined`, `expired_card`) and the more
   * specific `declineCode` (e.g. `insufficient_funds`,
   * `fraudulent`). The wizard surfaces the human `message` in the
   * toast title and the code in a `description` for clarity.
   */
  confirmPayment: () => Promise<
    | { kind: 'no_deposit' }
    | {
        kind: 'paid';
        paymentIntentId: string;
        depositCents: number;
        // Phase D — surface the mode so the parent wizard can render
        // the right confirmation copy (e.g. "paid in full" vs
        // "deposit collected, balance due in salon"). Unused today
        // but cheap to forward.
        paymentMode: 'full' | 'deposit';
      }
    | { kind: 'error'; message: string; code?: string; declineCode?: string }
  >;
  /**
   * Plan 036 (BUG-03) — true when confirming is currently safe: the section
   * settled into a confirmable state (ready / no-payment-applies) AND no
   * re-mint is in flight. While a debounced re-mint runs (tip tapped, promo
   * typed), the visible Elements still hold the OLD PaymentIntent at the OLD
   * amount — confirming then would charge a stale total. The wizard consults
   * this at submit time and gates the Confirm button on `onReadyChange`.
   */
  isReady: () => boolean;
  /**
   * Plan 036 — re-arm after a post-charge booking failure. The server has
   * refunded the consumed PI (failBooking); it can never be reused for a
   * retry (`getReusableDepositPaymentIntent` refuses any post-confirmation
   * status), so we drop it and mint a FRESH intent. Clearing `lastPiRef`
   * skips even the reuse attempt — structurally no path re-confirms the old
   * PI, so a retry cannot double-charge.
   */
  refresh: () => void;
};

type Props = {
  shopSlug: string;
  serviceIds: string[];
  /** Customer email — used as `receipt_email` on the PaymentIntent. */
  email: string;
  locale: 'fr' | 'en';
  /**
   * Phase D.3 — promo code currently typed in the wizard. In 'full'
   * mode the server reduces the PI amount by the validated promo
   * discount so the customer isn't overcharged. Re-fires the intent
   * creation (debounced) when the value changes. In 'deposit' mode
   * this is a no-op — the deposit is independent of promo codes.
   */
  promoCode: string;
  /**
   * Phase D.3 — phone for server-side loyalty balance lookup. Same
   * semantics as `promoCode`: only consumed in 'full' mode, re-fires
   * the intent on change.
   */
  phone: string;
  /**
   * Phase E — tip amount in cents picked by the customer in the
   * wizard's tip selector. Added to the PI amount on top of whatever
   * payment_mode charges. Re-fires the intent on change (debounced).
   * 0 when the shop hides the tip step or the customer skipped it.
   */
  tipAmountCents: number;
  /**
   * Plan 036 (BUG-03) — reactive readiness signal for the parent wizard.
   * Fired whenever the confirmable state flips (mint settled / re-mint in
   * flight) so the wizard can disable Confirm instead of charging a stale
   * PI. The imperative `isReady()` stays as the submit-time belt check.
   */
  onReadyChange?: (ready: boolean) => void;
};

export const BookingPaymentSection = forwardRef<BookingPaymentSectionRef, Props>(
  function BookingPaymentSection(
    { shopSlug, serviceIds, email, locale, promoCode, phone, tipAmountCents, onReadyChange },
    ref,
  ) {
    const t = useTranslations('pages.booking.payment');
    const [state, setState] = useState<
      | { kind: 'loading' }
      | { kind: 'no_deposit' }
      | { kind: 'shop_not_connected' }
      | { kind: 'error'; message: string }
      | {
          kind: 'ready';
          clientSecret: string;
          paymentIntentId: string;
          depositCents: number;
          // Phase D — drives label/hint copy below.
          paymentMode: 'full' | 'deposit';
        }
    >({ kind: 'loading' });

    // Inner ref handed down to the PaymentConfirmer so the wizard's ref
    // ends up wired all the way through Elements.
    const confirmerRef = useRef<ConfirmerHandle | null>(null);

    // Plan 036 (BUG-03) — true from the moment a (re-)mint is scheduled
    // (debounce included) until its response lands. While true, the visible
    // Elements may hold a STALE PaymentIntent — confirming must be blocked.
    const [minting, setMinting] = useState(false);
    // Plan 036 (BUG-09) — bumped by the error-state Retry button and by
    // `refresh()` to force the mint effect to re-fire.
    const [retryNonce, setRetryNonce] = useState(0);

    // Loop 60 SR — read the current theme on mount so Stripe Elements
    // can render with the matching palette. The init script in
    // app/[locale]/layout.tsx has already set `data-theme` by the time
    // this effect runs, so we just read the attribute. Re-reading on
    // theme toggle isn't worth the complexity — Stripe Elements'
    // iframe doesn't gracefully re-apply appearance config after mount.
    const [currentTheme, setCurrentTheme] = useState<'light' | 'dark'>('light');
    useEffect(() => {
      // Local `themeAttr` rather than `t` because the outer scope
      // already has `const t = useTranslations(...)` — shadowing
      // with a string would silently break anyone who later tries
      // to call `t(...)` inside this effect.
      const themeAttr = document.documentElement.getAttribute('data-theme');
      setCurrentTheme(themeAttr === 'dark' ? 'dark' : 'light');
    }, []);

    // Stable key over the service set so we don't re-fire the intent
    // creation on every wizard re-render. Pulled out of the effect deps
    // to keep the eslint exhaustive-deps rule happy.
    const serviceKey = useMemo(() => serviceIds.slice().sort().join(','), [serviceIds]);

    // Phase A SR — remember the PI created on the first call so we can
    // ask the server to UPDATE it instead of creating a new one when
    // the customer changes their service selection. The server-side
    // helper falls back to create if the PI is no longer updatable
    // (post-confirmation), so we don't need to check the status here.
    // Ref instead of state because we don't render anything based on
    // it; only the next effect run reads it.
    const lastPiRef = useRef<string | null>(null);

    // Fire the server action on mount and whenever any input that
    // affects the PI amount changes:
    //   - serviceKey: selected services
    //   - email: receipt_email
    //   - promoCode / phone (Phase D.3): drive discount-aware amount
    //     in 'full' mode. In 'deposit' mode the server ignores them
    //     so the extra re-fires are harmless beyond a Stripe API call.
    //
    // Debounced via a 350ms timer so typing into the promo input
    // doesn't fire one PI per keystroke. The cleanup cancels both
    // the in-flight response handling AND the pending timer.
    useEffect(() => {
      if (!stripeClientConfigured()) {
        setState({ kind: 'no_deposit' });
        setMinting(false);
        return;
      }
      let cancelled = false;
      // Don't blank to loading immediately on every keystroke — that
      // would make the form flicker. We only show the loading
      // skeleton on the very first mount; subsequent re-fires keep
      // the previous Elements visible until the new clientSecret
      // arrives. The Elements iframe itself doesn't gracefully
      // re-mount with a new clientSecret post-confirmation, so we
      // rely on the server's reuse path to keep the same PI when the
      // amount didn't actually change.
      setState((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }));
      // Plan 036 (BUG-03) — flag the whole debounce+request window so the
      // wizard can't confirm against the stale PI still on screen.
      setMinting(true);
      const timer = setTimeout(() => {
        if (cancelled) return;
        createBookingPaymentIntent({
          shop_slug: shopSlug,
          service_ids: serviceKey.split(',').filter(Boolean),
          email,
          existing_payment_intent_id: lastPiRef.current ?? undefined,
          promo_code: promoCode || undefined,
          phone: phone || undefined,
          tip_amount_cents: tipAmountCents,
        }).then((res) => {
          if (cancelled) return;
          setMinting(false);
          if (!res.ok) {
            setState({ kind: 'error', message: 'INTENT_FAILED' });
            return;
          }
          const payload = res.data as BookingPaymentIntentResult;
          if (payload.kind === 'no_deposit') {
            setState({ kind: 'no_deposit' });
          } else if (payload.kind === 'shop_not_connected') {
            setState({ kind: 'shop_not_connected' });
          } else {
            lastPiRef.current = payload.paymentIntentId;
            setState({
              kind: 'ready',
              clientSecret: payload.clientSecret,
              paymentIntentId: payload.paymentIntentId,
              depositCents: payload.depositCents,
              paymentMode: payload.paymentMode,
            });
          }
        });
      }, 350);
      return () => {
        // A cancelled run hands `minting` off to the effect run replacing it
        // (deps changed → the next run sets it true again synchronously).
        cancelled = true;
        clearTimeout(timer);
      };
    }, [shopSlug, serviceKey, email, promoCode, phone, tipAmountCents, retryNonce]);

    // Plan 036 — one readiness truth shared by isReady() and onReadyChange.
    // `shop_not_connected` and `no_deposit` ARE confirmable: confirmPayment
    // short-circuits to `{ kind: 'no_deposit' }` (book, pay at the shop), so
    // gating them off would dead-end shops without online payment.
    const confirmable =
      (state.kind === 'ready' ||
        state.kind === 'no_deposit' ||
        state.kind === 'shop_not_connected') &&
      !minting;
    useEffect(() => {
      onReadyChange?.(confirmable);
    }, [confirmable, onReadyChange]);

    useImperativeHandle(
      ref,
      () => ({
        confirmPayment: async () => {
          if (state.kind === 'no_deposit' || state.kind === 'shop_not_connected') {
            return { kind: 'no_deposit' as const };
          }
          // Plan 036 (BUG-03) — a re-mint in flight means the on-screen
          // Elements may hold a stale PI at a stale amount. Refuse to
          // confirm; the wizard surfaces a localized "payment is getting
          // ready" message instead of charging the wrong total.
          if (state.kind !== 'ready' || minting) {
            return { kind: 'error' as const, message: 'NOT_READY' };
          }
          const handle = confirmerRef.current;
          if (!handle) return { kind: 'error' as const, message: 'NOT_READY' };
          const result = await handle.confirm();
          if (result.kind === 'paid') {
            return {
              kind: 'paid' as const,
              paymentIntentId: state.paymentIntentId,
              depositCents: state.depositCents,
              paymentMode: state.paymentMode,
            };
          }
          return result;
        },
        isReady: () => confirmable,
        refresh: () => {
          // Drop the consumed PI entirely (see the handle's doc comment —
          // never reused, so a retry can't double-charge) and blank back to
          // the skeleton: keeping the old Elements visible would invite a
          // confirm against the refunded intent.
          lastPiRef.current = null;
          setState({ kind: 'loading' });
          setRetryNonce((n) => n + 1);
        },
      }),
      [state, minting, confirmable],
    );

    if (state.kind === 'no_deposit') {
      // Render nothing when no deposit applies — the wizard's existing
      // submit path covers booking-without-payment, same as before
      // Phase 56.
      return null;
    }

    if (state.kind === 'shop_not_connected') {
      return (
        <div className="rounded-lg border border-warning/30 bg-warning-subtle p-3 text-xs text-warning shadow-warm-sm">
          {t('shopNotConnected')}
        </div>
      );
    }

    if (state.kind === 'error') {
      // Plan 036 (BUG-09) — "try again" now HAS a retry: a transient
      // Stripe/network failure re-mints in place instead of dead-ending
      // the customer (the mint effect only re-fired on input changes).
      return (
        <div
          role="alert"
          className="space-y-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger shadow-warm-sm"
        >
          <p>{t('intentFailed')}</p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setState({ kind: 'loading' });
              setRetryNonce((n) => n + 1);
            }}
          >
            {t('retry')}
          </Button>
        </div>
      );
    }

    if (state.kind === 'loading') {
      return (
        <div className="space-y-2">
          <Skeleton className="h-4 w-32 rounded-md" />
          <Skeleton className="h-32 rounded-lg" />
        </div>
      );
    }

    // state.kind === 'ready' — render Elements with the clientSecret.
    //
    // Loop 60 SR — Stripe Elements is an iframe with its own theming,
    // so it doesn't inherit `:root[data-theme="dark"]` from the parent
    // page. We read the current theme on mount and pass Stripe's
    // `night` theme + dark-palette variables when applicable. If the
    // user toggles theme mid-flow the iframe doesn't re-render, but
    // that's an acceptable V1 trade-off — they'd see the previous
    // theme for the rest of the booking and the next visit picks up
    // the change correctly.
    const isDark = currentTheme === 'dark';
    const options: StripeElementsOptions = {
      clientSecret: state.clientSecret,
      appearance: {
        theme: isDark ? 'night' : 'stripe',
        variables: isDark
          ? {
              // Dark variables — keep tokens in lockstep with
              // globals.css `:root[data-theme='dark']`. The accent
              // shifts lighter (#8fb89a vs #4f7d5e) for legibility
              // against the near-black backgrounds.
              colorPrimary: '#8fb89a',
              colorBackground: '#1a1a1a',
              colorText: '#f5f5f5',
              colorTextSecondary: '#a3a3a3',
              colorDanger: '#ef4444',
              fontFamily: 'Geist, system-ui, sans-serif',
              borderRadius: '8px',
            }
          : {
              colorPrimary: '#4f7d5e',
              colorBackground: '#ffffff',
              colorText: '#171717',
              colorTextSecondary: '#4d4d4d',
              colorDanger: '#dc2626',
              fontFamily: 'Geist, system-ui, sans-serif',
              borderRadius: '8px',
            },
      },
      locale: locale === 'fr' ? 'fr-CA' : 'en-CA',
    };

    // Phase D — pick label + hint copy based on payment_mode. 'full'
    // collects the entire service price upfront (no balance to settle
    // in salon); 'deposit' collects the deposit portion only and the
    // customer pays the rest in person. Both keys exist in both
    // locales — see messages/{fr,en}.json `pages.booking.payment`.
    const labelKey = state.paymentMode === 'full' ? 'fullLabel' : 'depositLabel';
    const helpKey = state.paymentMode === 'full' ? 'fullHelp' : 'depositHelp';
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-text-primary">{t(labelKey)}</p>
          <p className="text-sm font-semibold tracking-tight text-text-primary">
            {formatCurrencyCAD(state.depositCents / 100, locale)}
          </p>
        </div>
        {/* Plan 036 (BUG-03) — while a re-mint is in flight the amount above
            may be stale; say so instead of letting the customer trust it. */}
        {minting ? (
          <p role="status" className="text-xs text-text-muted">
            {t('updatingTotal')}
          </p>
        ) : null}
        <p className="text-xs text-text-secondary">{t(helpKey)}</p>
        {/* Plan 036 — `key` forces a full Elements remount when the
            clientSecret changes: react-stripe-js ignores clientSecret
            updates on a mounted provider, so a refresh()'d fresh PI would
            otherwise leave the iframe bound to the consumed one. */}
        <Elements key={state.clientSecret} stripe={getStripeClient()} options={options}>
          <PaymentElement
            options={{
              layout: 'tabs',
            }}
          />
          <PaymentConfirmer ref={confirmerRef} />
        </Elements>
      </div>
    );
  },
);

// ---------------------------------------------------------------------------
// PaymentConfirmer — uses useStripe / useElements inside the Elements provider
// to call confirmPayment. Exposes a `confirm` method via useImperativeHandle
// that the outer BookingPaymentSection forwards to the wizard ref.
// ---------------------------------------------------------------------------

type ConfirmerHandle = {
  confirm: () => Promise<
    { kind: 'paid' } | { kind: 'error'; message: string; code?: string; declineCode?: string }
  >;
};

const PaymentConfirmer = forwardRef<ConfirmerHandle>(function PaymentConfirmer(_props, ref) {
  const stripe = useStripe();
  const elements = useElements();

  useImperativeHandle(
    ref,
    () => ({
      confirm: async () => {
        if (!stripe || !elements) return { kind: 'error', message: 'NOT_READY' };
        // Loop 34 (P93) — `redirect: 'if_required'` lets Stripe handle
        // most 3DS challenges inline via a modal. The minority of cards
        // (typically some EU issuers, certain bank-redirect methods)
        // still force a full-page redirect — for those flows Stripe
        // requires `return_url` to be set, otherwise `confirmPayment`
        // throws before the redirect even starts. We point at the
        // current URL so the customer lands back on the booking
        // wizard. State restoration after the round-trip is a known
        // gap: today the wizard would reset to step 1 because we don't
        // persist state to localStorage. That's tolerable for now —
        // redirect-3DS is rare for the NA card mix we serve — but
        // a future loop should add `?step=4&prefill=...` round-tripping
        // if redirect-3DS becomes common in production telemetry.
        const returnUrl = typeof window !== 'undefined' ? window.location.href : undefined;
        const { error, paymentIntent } = await stripe.confirmPayment({
          elements,
          confirmParams: returnUrl ? { return_url: returnUrl } : undefined,
          redirect: 'if_required',
        });
        if (error) {
          // Loop 34 — surface the Stripe error CODE alongside the
          // human message. Codes like `card_declined`,
          // `insufficient_funds`, `expired_card`, `incorrect_cvc`,
          // `processing_error` let the caller render a localized
          // explanation if the bare message isn't friendly enough.
          // `error.message` is already localized by Stripe via the
          // `locale: 'fr-CA'` option on Elements above.
          return {
            kind: 'error',
            message: error.message ?? 'PAYMENT_FAILED',
            code: error.code,
            declineCode: error.decline_code,
          };
        }
        if (!paymentIntent) {
          return { kind: 'error', message: 'NO_PAYMENT_INTENT' };
        }
        // Stripe returns succeeded / processing for async methods; both
        // count as "moved beyond requires_*" so we let booking proceed.
        // The webhook will reconcile payment_status.
        if (
          paymentIntent.status === 'succeeded' ||
          paymentIntent.status === 'processing' ||
          paymentIntent.status === 'requires_capture'
        ) {
          return { kind: 'paid' };
        }
        return { kind: 'error', message: `STATUS_${paymentIntent.status}` };
      },
    }),
    [stripe, elements],
  );

  // Empty render — the PaymentElement above provides all the UI.
  return null;
});
