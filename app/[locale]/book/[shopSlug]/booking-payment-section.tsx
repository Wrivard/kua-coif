'use client';

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import type { StripeElementsOptions } from '@stripe/stripe-js';
import { useTranslations } from 'next-intl';
import { getStripeClient, stripeClientConfigured } from '@/lib/stripe/client';
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
   */
  confirmPayment: () => Promise<
    | { kind: 'no_deposit' }
    | { kind: 'paid'; paymentIntentId: string; depositCents: number }
    | { kind: 'error'; message: string }
  >;
  /** Returns true when the PaymentElement is mounted and ready. */
  isReady: () => boolean;
};

type Props = {
  shopSlug: string;
  serviceIds: string[];
  /** Customer email — used as `receipt_email` on the PaymentIntent. */
  email: string;
  locale: 'fr' | 'en';
};

export const BookingPaymentSection = forwardRef<BookingPaymentSectionRef, Props>(
  function BookingPaymentSection({ shopSlug, serviceIds, email, locale }, ref) {
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
        }
    >({ kind: 'loading' });

    // Inner ref handed down to the PaymentConfirmer so the wizard's ref
    // ends up wired all the way through Elements.
    const confirmerRef = useRef<ConfirmerHandle | null>(null);

    // Stable key over the service set so we don't re-fire the intent
    // creation on every wizard re-render. Pulled out of the effect deps
    // to keep the eslint exhaustive-deps rule happy.
    const serviceKey = useMemo(() => serviceIds.slice().sort().join(','), [serviceIds]);

    // Fire the server action once on mount (and whenever the set of
    // services changes — a step-4 → step-2 → step-4 round-trip might
    // change the selection). Bare `stripeClientConfigured` short-circuits
    // when no publishable key is set so we don't even hit the server.
    useEffect(() => {
      if (!stripeClientConfigured()) {
        setState({ kind: 'no_deposit' });
        return;
      }
      let cancelled = false;
      setState({ kind: 'loading' });
      createBookingPaymentIntent({
        shop_slug: shopSlug,
        service_ids: serviceKey.split(',').filter(Boolean),
        email,
      }).then((res) => {
        if (cancelled) return;
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
          setState({
            kind: 'ready',
            clientSecret: payload.clientSecret,
            paymentIntentId: payload.paymentIntentId,
            depositCents: payload.depositCents,
          });
        }
      });
      return () => {
        cancelled = true;
      };
    }, [shopSlug, serviceKey, email]);

    useImperativeHandle(
      ref,
      () => ({
        confirmPayment: async () => {
          if (state.kind === 'no_deposit' || state.kind === 'shop_not_connected') {
            return { kind: 'no_deposit' as const };
          }
          if (state.kind !== 'ready') {
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
            };
          }
          return result;
        },
        isReady: () => state.kind === 'ready' || state.kind === 'no_deposit',
      }),
      [state],
    );

    if (state.kind === 'no_deposit') {
      // Render nothing when no deposit applies — the wizard's existing
      // submit path covers booking-without-payment, same as before
      // Phase 56.
      return null;
    }

    if (state.kind === 'shop_not_connected') {
      return (
        <div className="border-warning/30 rounded-lg border bg-warning-subtle p-3 text-xs text-warning shadow-sm">
          {t('shopNotConnected')}
        </div>
      );
    }

    if (state.kind === 'error') {
      return (
        <div
          role="alert"
          className="border-danger/30 bg-danger/10 rounded-lg border p-3 text-xs text-danger shadow-sm"
        >
          {t('intentFailed')}
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
    const options: StripeElementsOptions = {
      clientSecret: state.clientSecret,
      appearance: {
        // Phase 75 — pivoted to Stripe's `stripe` (day) theme since the
        // app moved from dark to light. The principal tokens match the
        // Vercel-aligned Küa palette: white-ish input bg, Vercel black
        // text, Küa purple accent, Vercel saturated blue focus ring
        // implicit via Stripe's defaults.
        theme: 'stripe',
        variables: {
          colorPrimary: '#8b5cf6',
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

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-text-primary">{t('depositLabel')}</p>
          <p className="text-sm font-semibold tracking-tight text-text-primary">
            {formatCurrencyCAD(state.depositCents / 100, locale)}
          </p>
        </div>
        <p className="text-xs text-text-secondary">{t('depositHelp')}</p>
        <Elements stripe={getStripeClient()} options={options}>
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
  confirm: () => Promise<{ kind: 'paid' } | { kind: 'error'; message: string }>;
};

const PaymentConfirmer = forwardRef<ConfirmerHandle>(function PaymentConfirmer(_props, ref) {
  const stripe = useStripe();
  const elements = useElements();

  useImperativeHandle(
    ref,
    () => ({
      confirm: async () => {
        if (!stripe || !elements) return { kind: 'error', message: 'NOT_READY' };
        const { error, paymentIntent } = await stripe.confirmPayment({
          elements,
          // Stay on the page unless 3DS forces a redirect. Successful
          // confirmation returns `paymentIntent` here; the booking-wizard
          // submit handler then calls `bookPublicAppointment`.
          redirect: 'if_required',
        });
        if (error) {
          return { kind: 'error', message: error.message ?? 'PAYMENT_FAILED' };
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
