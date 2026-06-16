'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  CalendarCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Moon,
  Plus,
  Sun,
  Sunset,
  UserCircle2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FieldHint, Input, Label, Textarea } from '@/components/ui/input';
import { PhoneInput } from '@/components/ui/phone-input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { TurnstileWidget, turnstileSiteKeyConfigured } from '@/components/ui/turnstile';
import { cn, formatCurrencyCAD } from '@/lib/utils';
import { addDays, formatHeaderDate, shopIsoDate } from '@/lib/business/timezone';
import {
  postBookingMessageFor,
  welcomeMessageFor,
  type WidgetConfig,
} from '@/lib/business/widget-config';
import { suggestTips, type TipsConfig } from '@/lib/business/tips';
import type { BarberRow, ServiceCategoryRow, ServiceRow } from '@/db/rows';
import { addToWaitlistPublic, bookPublicAppointment, lookupLoyaltyByPhone } from './actions';
import type { BookingPaymentSectionRef } from './booking-payment-section';

/**
 * Loop 40 (P116) — `BookingPaymentSection` pulls in @stripe/stripe-js
 * + @stripe/react-stripe-js (~150 kB combined). The wizard only
 * mounts it on step 4 (confirmation + optional deposit), so a
 * dynamic import keeps the script tag off the initial step-1
 * page load. ssr:false because Stripe Elements is browser-only;
 * the booking flow is already client-side anyway.
 */
const BookingPaymentSection = dynamic(
  () => import('./booking-payment-section').then((m) => m.BookingPaymentSection),
  { ssr: false },
);

export type BookingShop = {
  id: string;
  name: string;
  alias: string | null;
  description: string | null;
  timezone: string;
  date_format: 'USA' | 'EU';
  allow_booking_any_barber: boolean;
  country: string | null;
  street: string | null;
  municipality: string | null;
  province: string | null;
  postal_code: string | null;
  // Phase H+10 — shop phone shown under the address in the wizard
  // header when `widget_config.show_phone === true`. Always queried
  // for the embed page so the preview wrapper can flip the toggle
  // live. The server-side wizard render in `/book/[shopSlug]` and
  // `/embed/[shopSlug]` null this out when the widget config opts
  // it off — the wizard just checks for truthiness.
  phone?: string | null;
  // Loop 65 — shop logo URL (Supabase Storage). Drives the wizard
  // header brand mark; falls back to the "K" Küa glyph when null.
  logo_url?: string | null;
  // Phase 64 — marketing banner.
  marketing_banner_enabled?: boolean | null;
  marketing_banner_text?: string | null;
};

export type BookingHours = {
  weekday: number;
  enabled: boolean;
  open_time: string | null;
  close_time: string | null;
};

type WizardState = {
  step: 1 | 2 | 3 | 4 | 5;
  serviceIds: string[];
  barberId: string | 'any' | null;
  date: string;
  startTime: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  notes: string;
  hp: string; // honeypot
  turnstileToken: string; // Phase 30 — empty until widget verifies
  promoCode: string; // Phase 41 — optional, server-validated
  loyaltyBalanceCents: number; // Phase 60 — server-confirmed balance for the typed phone
  consentLoi25: boolean; // Loop 24 — Quebec Loi 25 affirmative consent gate
  // Phase E — in-widget tip. `tipAmountCents` is the actual amount sent
  // to the server (PI mint + appointment row). `tipSelection` drives the
  // UI button state: 'none' means the customer explicitly chose "No tip",
  // 'tier:N' means the Nth suggested tier is selected, 'custom' shows
  // the custom input. Default 'none' so customers who don't notice the
  // section don't get charged a phantom tip.
  tipAmountCents: number;
  tipSelection: TipSelection;
};

/**
 * Phase E — tip selection state shared between `WizardState` and the
 * `TipSelector` component. Single source of truth so adding a 5th tier
 * (or removing a tier) only touches one declaration. The format
 * `tier:N` is a tagged-union discriminator — easier to .startsWith()
 * than tracking a separate `kind` + `index` pair.
 */
type TipSelection = 'none' | `tier:${0 | 1 | 2 | 3}` | 'custom';

type Props = {
  locale: string;
  shopSlug: string;
  shop: BookingShop;
  hours: BookingHours[];
  daysOff: string[];
  barbers: BarberRow[];
  services: ServiceRow[];
  categories: ServiceCategoryRow[];
  /**
   * Per-shop widget overrides — passed by the embed route. When omitted, the
   * wizard uses the public-booking defaults (service-first, no add-on banner,
   * etc.). See `lib/business/widget-config.ts`.
   */
  widgetConfig?: WidgetConfig;
  /**
   * Phase E — shop's tip tier config. Drives the suggested-tier buttons
   * shown above the payment section when `widgetConfig.show_tip_step`
   * is on. Undefined when the shop has no tips_config row yet — in
   * that case the wizard hides the tip section regardless of the
   * widget toggle (no tiers to suggest).
   */
  tipsConfig?: TipsConfig;
  /**
   * Phase H+14 — analytics source. The embed page resolves this from
   * `?source=` (set by widget.js when it mounts the iframe). `null`
   * disables analytics entirely — used by the live preview wrapper
   * since operator clicks aren't customer behaviour.
   */
  analyticsSource?: 'inline' | 'floating-button' | 'modal' | 'direct' | null;
};

// Five progress chips, regardless of which of {service, barber} comes first.
const PROGRESS_CHIP_COUNT = 5;

// Plan 036 (step 2) — client-side mirrors of the server zod gates so a
// typo'd phone/email blocks Confirm BEFORE the card is charged (the server
// rejects post-charge, which forces a refund round-trip). The phone regex is
// the EXACT server rule (`actions.ts` phoneRegex); the email check is a
// pragmatic stand-in for zod's `.email()` — the server stays authoritative.
const CLIENT_PHONE_RE = /^[+\d\s().-]{7,20}$/;
const CLIENT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/**
 * Group a flat array of "HH:MM" time strings into morning / afternoon /
 * evening buckets so the slot picker can show ☀ / ☼ / 🌙 sections (spec §3.4).
 * Times are interpreted in the shop's local clock, so the cut-offs are
 * fixed: <11:00 morning, 11:00–17:00 afternoon, ≥17:00 evening.
 */
function groupSlotsByTimeOfDay(slots: string[]): {
  morning: string[];
  afternoon: string[];
  evening: string[];
} {
  const morning: string[] = [];
  const afternoon: string[] = [];
  const evening: string[] = [];
  for (const time of slots) {
    const hour = Number(time.split(':')[0] ?? '0');
    if (hour < 11) morning.push(time);
    else if (hour < 17) afternoon.push(time);
    else evening.push(time);
  }
  return { morning, afternoon, evening };
}

/**
 * BUG-05 — a day is "closed" when its weekday isn't enabled in the shop's
 * hours OR it's an explicit day off. Mirrors the exact logic DateStrip uses
 * per-day (`!h?.enabled || daysOff.includes(iso)`), kept as a shared helper
 * so the initial-date pick and the strip can't drift apart.
 */
function isClosedDay(iso: string, hours: BookingHours[], daysOff: string[]): boolean {
  const weekday = new Date(`${iso}T00:00:00`).getDay();
  const h = hours.find((hh) => hh.weekday === weekday);
  return !h?.enabled || daysOff.includes(iso);
}

/**
 * BUG-05 — first bookable ISO date within the 14-day strip window, so the slot
 * step never opens on a closed day. Québec salons commonly close Sun–Mon, so a
 * large share of visitors would otherwise land on "no slots" + a waitlist CTA
 * for a day the shop isn't even open. Falls back to `today` when all 14 days
 * are closed — the honest empty-state then shows.
 */
function firstBookableIso(
  hours: BookingHours[],
  daysOff: string[],
  today: string,
  timezone: string,
): string {
  const ref = new Date(`${today}T12:00:00Z`);
  for (let i = 0; i < 14; i++) {
    const iso = shopIsoDate(addDays(ref, i), timezone);
    if (!isClosedDay(iso, hours, daysOff)) return iso;
  }
  return today;
}

/**
 * Loop 65 SR — header brand mark.
 *
 * Renders the shop's `logo_url` as a 40x40 thumbnail. When the URL
 * returns 404 / network-errors / fails to decode (CDN purge, deleted
 * Storage object, etc.) the `onError` flips state to render the "K"
 * Küa fallback. Without this, a broken image URL produced the
 * browser's broken-image-icon glyph — the worst-of-both-worlds
 * outcome (looks like the page itself is broken).
 *
 * If `logoUrl` is null from the start, we skip the <img> entirely
 * and render the K straight away — no flash of a loading-img element.
 */
function BrandMark({ logoUrl, shopName }: { logoUrl: string | null; shopName: string }) {
  const [broken, setBroken] = useState(false);
  const showImage = logoUrl && !broken;
  if (showImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={shopName}
        onError={() => setBroken(true)}
        className="h-10 w-10 rounded-xl object-cover shadow-accent-glow"
      />
    );
  }
  return (
    <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-accent-glow">
      <span className="text-base font-semibold">K</span>
    </span>
  );
}

export function BookingWizard({
  locale,
  shopSlug,
  shop,
  hours,
  daysOff,
  barbers,
  services,
  categories,
  widgetConfig,
  tipsConfig,
  analyticsSource = 'direct',
}: Props) {
  const t = useTranslations('pages.booking');
  const tErr = useTranslations('actionErrors');
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();

  // Phase H+11 — URL params for pre-filling the wizard. Useful when a
  // salon links from "Coupe avec Olivier" on their pricing page directly
  // to the wizard with both pre-selected. Recognized params:
  //   ?service=<id>[,<id>...]  one or more service IDs
  //   ?barber=<id>|any         barber ID or the "any" sentinel
  //   ?date=YYYY-MM-DD         pre-selected date (still validated against hours)
  // Invalid IDs are silently ignored — the wizard falls back to defaults.
  const searchParams = useSearchParams();

  const localeBucket: 'fr' | 'en' = locale === 'fr' ? 'fr' : 'en';
  const welcomeMessage = widgetConfig ? welcomeMessageFor(widgetConfig, localeBucket) : null;
  const postBookingMessage = widgetConfig
    ? postBookingMessageFor(widgetConfig, localeBucket)
    : null;
  const redirectEnabled = Boolean(widgetConfig?.redirect_enabled && widgetConfig.redirect_url);
  const redirectUrl = widgetConfig?.redirect_url ?? null;

  // ── Step ordering ──────────────────────────────────────────────────────
  // The widget config can flip the first two steps: when `show_professional_first`
  // is on, step 1 = barber picker and step 2 = service picker (Squire-style).
  // Otherwise (default), step 1 = service picker, step 2 = barber picker.
  const isProFirst = widgetConfig?.show_professional_first ?? false;
  const step1Kind: 'service' | 'barber' = isProFirst ? 'barber' : 'service';
  const step2Kind: 'service' | 'barber' = isProFirst ? 'service' : 'barber';
  function kindForStep(
    step: WizardState['step'],
  ): 'service' | 'barber' | 'slot' | 'contact' | 'done' {
    if (step === 1) return step1Kind;
    if (step === 2) return step2Kind;
    if (step === 3) return 'slot';
    if (step === 4) return 'contact';
    return 'done';
  }

  const today = useMemo(() => shopIsoDate(new Date(), shop.timezone), [shop.timezone]);

  // Phase H+11 — URL pre-fill. Compute initial state synchronously from
  // searchParams so the wizard renders with the right pre-selection on
  // first paint (no flash of empty → filled). Invalid IDs are dropped.
  const initialState = useMemo<WizardState>(() => {
    const serviceParam = searchParams?.get('service');
    const barberParam = searchParams?.get('barber');
    const dateParam = searchParams?.get('date');

    const requestedServiceIds = (serviceParam ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const validServiceIds = requestedServiceIds.filter((id) => services.some((s) => s.id === id));

    let barberId: WizardState['barberId'] = shop.allow_booking_any_barber ? 'any' : null;
    if (barberParam) {
      if (barberParam === 'any' && shop.allow_booking_any_barber) {
        barberId = 'any';
      } else if (barbers.some((b) => b.id === barberParam)) {
        barberId = barberParam;
      }
    }

    const dateParamClean = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : null;
    // BUG-05 — open the slot step on a day the shop is actually open. Honor a
    // valid `?date=` only when it lands on a non-closed day; otherwise jump to
    // the first bookable day in the window so the customer doesn't hit a false
    // "nothing available" on a day the shop isn't even open.
    const initialDate =
      dateParamClean && !isClosedDay(dateParamClean, hours, daysOff)
        ? dateParamClean
        : firstBookableIso(hours, daysOff, today, shop.timezone);

    return {
      step: 1,
      serviceIds: validServiceIds,
      barberId,
      date: initialDate,
      startTime: null,
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      notes: '',
      hp: '',
      turnstileToken: '',
      promoCode: '',
      loyaltyBalanceCents: 0,
      consentLoi25: false,
      tipAmountCents: 0,
      tipSelection: 'none',
    };
    // searchParams is stable per route; we only want to seed state once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [state, setState] = useState<WizardState>(initialState);

  // Phase H+14 — analytics instrumentation. One session_id per
  // wizard mount, fired with each event so the back-end can stitch
  // a single visitor's journey (impression → step_views → complete
  // or abandon). `analyticsSource === null` disables events entirely
  // (preview mode). `sendEvent` uses `navigator.sendBeacon` for the
  // abandon path since the browser may kill `fetch` on unload.
  const sessionIdRef = useRef<string | null>(null);
  const completedRef = useRef(false);
  // Guard so one navigation doesn't double-count: `beforeunload` AND
  // `pagehide` both fire on most real unloads, and we only want a single
  // `abandon` per session.
  const abandonedRef = useRef(false);
  // Mirror of `state.step`. The unload handler is bound once (empty-dep
  // effect) so its closure can't see the live step — this ref gives it the
  // CURRENT value. Assigned during render (cheap, standard mirror pattern).
  const stepRef = useRef<WizardState['step']>(state.step);
  stepRef.current = state.step;

  const sendEvent = useMemo(() => {
    return (
      eventType: 'impression' | 'step_view' | 'booking_complete' | 'abandon',
      stepKind?: 'service' | 'barber' | 'slot' | 'contact' | 'done',
    ) => {
      if (analyticsSource === null) return;
      if (typeof window === 'undefined') return;
      if (!sessionIdRef.current) {
        sessionIdRef.current =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `s-${Math.random().toString(36).slice(2)}-${Date.now()}`;
      }
      const body = JSON.stringify({
        shopSlug,
        eventType,
        stepKind,
        sessionId: sessionIdRef.current,
        source: analyticsSource,
      });
      const url = '/api/widget/event';
      // sendBeacon is fire-and-forget AND survives page unload — the
      // critical bit for the abandon path.
      if (eventType === 'abandon' && navigator.sendBeacon) {
        try {
          navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
          return;
        } catch {
          // fall through to fetch
        }
      }
      void fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {
        // Analytics is best-effort; swallow network errors.
      });
    };
  }, [analyticsSource, shopSlug]);

  // Fire impression once per mount.
  useEffect(() => {
    sendEvent('impression');
    // Abandon on unload if the customer never reached step 5. Guarded by
    // `abandonedRef` (one beacon per session even though beforeunload +
    // pagehide both fire) and reads the live step via `stepRef`.
    const onUnload = () => {
      if (completedRef.current || abandonedRef.current) return;
      if (stepRef.current >= 5) return;
      abandonedRef.current = true;
      sendEvent('abandon');
    };
    window.addEventListener('beforeunload', onUnload);
    window.addEventListener('pagehide', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      window.removeEventListener('pagehide', onUnload);
    };
    // sendEvent is stable; the live step + guards come from refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fire step_view on every step transition.
  useEffect(() => {
    const kind = kindForStep(state.step);
    if (kind === 'done') {
      if (!completedRef.current) {
        completedRef.current = true;
        sendEvent('booking_complete', 'done');
      }
      return;
    }
    sendEvent('step_view', kind as 'service' | 'barber' | 'slot' | 'contact');
    // We don't depend on `kindForStep` (it's defined inside the
    // component) — re-reading it via closure is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.step, sendEvent]);

  // Phase H+11 — post-booking redirect. Fires on step transition to 5
  // (confirmation). 2.5s delay so the customer reads the confirmation
  // copy before the page changes — the redirect feels intentional, not
  // a hostile yank. Top-level navigation (window.location.href) so we
  // BREAK OUT of the embed iframe when applicable, landing the customer
  // on the salon's real site.
  useEffect(() => {
    if (state.step !== 5) return;
    if (!redirectEnabled || !redirectUrl) return;
    const timer = setTimeout(() => {
      try {
        const url = new URL(redirectUrl);
        // Break out of an iframe parent (widget embed) so the customer
        // lands on the salon's site in the top window, not inside the
        // widget. Falls back to same-window nav when not iframed.
        if (window.top && window.top !== window.self) {
          window.top.location.href = url.toString();
        } else {
          window.location.href = url.toString();
        }
      } catch {
        // Malformed URL — swallow so the confirmation page stays.
      }
    }, 2500);
    return () => clearTimeout(timer);
  }, [state.step, redirectEnabled, redirectUrl]);

  // Phase 60 — debounced loyalty lookup on phone change. Fires ~500ms
  // after the user stops typing, only when the digit count looks like a
  // real number (≥7). Aborts in-flight when the phone changes again.
  useEffect(() => {
    const digits = state.phone.replace(/\D/g, '');
    if (digits.length < 7) {
      // Reset so a backspace clears the hint.
      if (state.loyaltyBalanceCents !== 0) {
        setState((s) => ({ ...s, loyaltyBalanceCents: 0 }));
      }
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      lookupLoyaltyByPhone({ shop_slug: shopSlug, phone: state.phone }).then((res) => {
        if (cancelled) return;
        if (res.ok) {
          const balance = res.data?.balanceCents ?? 0;
          setState((s) => ({ ...s, loyaltyBalanceCents: balance }));
        }
      });
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // We deliberately omit `state.loyaltyBalanceCents` from the deps —
    // it's a derived field set INSIDE this effect, including it would
    // cause an infinite loop. shopSlug is stable per session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phone, shopSlug]);

  // Cached check — `turnstileSiteKeyConfigured()` reads `process.env` which
  // Next.js inlines at build time for `NEXT_PUBLIC_*` vars, but caching it
  // here keeps the JSX readable.
  const turnstileEnforced = turnstileSiteKeyConfigured();

  const selectedServices = services.filter((s) => state.serviceIds.includes(s.id));
  const totalDuration = selectedServices.reduce((sum, s) => sum + s.duration_min, 0);
  const totalPrice = selectedServices.reduce((sum, s) => sum + s.price, 0);
  const selectedBarber =
    state.barberId && state.barberId !== 'any'
      ? barbers.find((b) => b.id === state.barberId)
      : null;
  const allowMultiService = widgetConfig?.allow_multi_service ?? true;

  // Phase 60 — client-side mirror of the server-side cap: loyalty credit
  // is at most the running total (in cents to avoid float drift). The
  // server runs the same math on submit; this is purely display so the
  // customer sees what they'll be charged BEFORE clicking confirm.
  const loyaltyCreditCents = (() => {
    if (state.loyaltyBalanceCents <= 0 || totalPrice <= 0) return 0;
    const runningCents = Math.round(totalPrice * 100);
    return Math.min(state.loyaltyBalanceCents, runningCents);
  })();
  const totalAfterLoyalty = Math.max(0, totalPrice - loyaltyCreditCents / 100);

  // Phase E — tip tier suggestions. The base for percentage tiers is
  // the post-loyalty total in dollars (matches what the customer is
  // actually paying for service). The shop's `use_taxes_in_tips` and
  // `use_prod_price_in_tips` toggles control whether taxes/products
  // count toward tipBase — V1 widget only sells services so the latter
  // is moot, and taxes are bundled into the displayed price already
  // (`services.price` is tax-inclusive per the spec). Hide the section
  // entirely when the shop has no tips_config row (undefined) or the
  // widget toggle is off.
  const showTipStep = Boolean(widgetConfig?.show_tip_step && tipsConfig);
  const tipSuggestions = useMemo(() => {
    if (!showTipStep || !tipsConfig) return [];
    return suggestTips(totalAfterLoyalty, tipsConfig);
  }, [showTipStep, tipsConfig, totalAfterLoyalty]);

  // Phase E SR — keep the tier-derived amount in sync when the base
  // changes (e.g. loyalty balance applied after phone input).
  //
  // Without this effect, a customer who clicks "18% of $50 = $9", then
  // types their phone and gets a $5 loyalty credit, would still pay $9
  // even though the tier button now reads "18% of $45 = $8.10". The
  // button label is fresh but the stored amount is stale → silent
  // overcharge.
  //
  // We only re-derive when `tipSelection` is a tier. Custom amounts
  // are deliberately left alone — the customer typed an absolute
  // value and that's what they want. 'none' obviously doesn't need
  // re-derivation either.
  useEffect(() => {
    if (!state.tipSelection.startsWith('tier:')) return;
    const idx = Number(state.tipSelection.slice(5));
    const sug = tipSuggestions[idx];
    if (!sug) return;
    const newCents = Math.round(sug.amount * 100);
    if (newCents !== state.tipAmountCents) {
      setState((s) => ({ ...s, tipAmountCents: newCents }));
    }
  }, [tipSuggestions, state.tipSelection, state.tipAmountCents]);

  // Group services by category for the multi-select.
  const servicesByCategory = useMemo(() => {
    const m = new Map<string, ServiceRow[]>();
    for (const s of services) {
      const k = s.category_id ?? '';
      const list = m.get(k) ?? [];
      list.push(s);
      m.set(k, list);
    }
    return m;
  }, [services]);

  // Slot state — fetched from /api/book/[shopSlug]/slots when entering step 3.
  const [slots, setSlots] = useState<string[] | null>(null);
  const [slotLoading, setSlotLoading] = useState(false);
  // BUG-04 — a genuine fetch failure (429, network blip) is NOT "fully booked".
  // Track it separately so the UI can offer a retry instead of a waitlist CTA.
  const [slotError, setSlotError] = useState(false);
  // Bumped by the retry control to force a re-fetch (it's an effect dep).
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (state.step !== 3) return;
    setSlots(null);
    setSlotError(false);
    setSlotLoading(true);
    const ctl = new AbortController();
    fetch(
      `/api/book/${shopSlug}/slots?date=${state.date}&barber=${state.barberId ?? 'any'}&duration=${totalDuration}`,
      { signal: ctl.signal },
    )
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data: { slots?: string[] }) => {
        const next = data.slots ?? [];
        setSlots(next);
        // BUG-08 — a previously-picked time may have been taken while the
        // customer was away (back-nav, date re-pick). Drop it so `canAdvance`
        // can't funnel them into a guaranteed conflict at submit.
        setState((s) =>
          s.startTime && !next.includes(s.startTime) ? { ...s, startTime: null } : s,
        );
      })
      .catch(() => {
        // Aborts (fast date-switching, unmount) are silent — not a real
        // failure; surfacing them would flash a false error / empty state.
        if (ctl.signal.aborted) return;
        setSlotError(true);
      })
      .finally(() => {
        if (!ctl.signal.aborted) setSlotLoading(false);
      });
    return () => ctl.abort();
  }, [state.step, state.date, state.barberId, shopSlug, totalDuration, retryNonce]);

  function next() {
    setState((s) => ({ ...s, step: Math.min(5, s.step + 1) as WizardState['step'] }));
  }
  function back() {
    setState((s) => ({ ...s, step: Math.max(1, s.step - 1) as WizardState['step'] }));
  }

  // Plan 036 (step 2) — pre-charge validity of the contact fields, mirroring
  // the server zod gates. Computed before `canAdvance` (an IIFE) consumes it.
  const phoneFormatValid = CLIENT_PHONE_RE.test(state.phone.trim());
  const emailFormatValid = state.email.trim() === '' || CLIENT_EMAIL_RE.test(state.email.trim());

  const canAdvance = (() => {
    const kind = kindForStep(state.step);
    if (kind === 'service') return state.serviceIds.length > 0;
    if (kind === 'barber') return state.barberId !== null;
    if (kind === 'slot') return state.startTime !== null;
    if (kind === 'contact') {
      // Plan 036 (step 2) — phone/email must pass the client-side mirror of
      // the server zod rules so a typo can't reach the charge (the server
      // would reject AFTER the card was charged, forcing a refund).
      const hasIdentity = state.firstName.trim().length > 0 && phoneFormatValid;
      // When Turnstile is enforced (env var set), the user must complete the
      // challenge before Confirm enables. When the feature is off, the token
      // is just an empty string and we skip this gate.
      const tokenOk = !turnstileEnforced || state.turnstileToken.length > 0;
      // Loop 24 — Quebec Loi 25 affirmative consent gate. The customer
      // MUST tick the "I agree to the privacy policy" box before we
      // accept their phone/email/name. Server action also enforces this.
      return hasIdentity && emailFormatValid && tokenOk && state.consentLoi25;
    }
    return false;
  })();

  // W11 — surface WHY the Confirm button is disabled on the contact step.
  // `canAdvance` (unchanged above) gates the button, but only phone/email had
  // inline hints — a missing first name, an incomplete Turnstile challenge, or
  // an unticked Loi 25 consent left the conversion-step button dead with no
  // visible reason. List what's still required so the customer can act.
  const contactBlockers: string[] = [];
  if (kindForStep(state.step) === 'contact' && !canAdvance) {
    if (state.firstName.trim().length === 0)
      contactBlockers.push(t('steps.contact.blockers.firstName'));
    if (!phoneFormatValid) contactBlockers.push(t('steps.contact.blockers.phone'));
    if (!emailFormatValid) contactBlockers.push(t('steps.contact.blockers.email'));
    if (turnstileEnforced && state.turnstileToken.length === 0)
      contactBlockers.push(t('steps.contact.blockers.turnstile'));
    if (!state.consentLoi25) contactBlockers.push(t('steps.contact.blockers.consent'));
  }

  // Phase 56 — ref to the payment section so submit can confirm the
  // PaymentIntent before invoking the booking action. The section
  // resolves to `{ kind: 'no_deposit' }` when no deposit applies, so
  // the submit logic stays a single branch.
  const paymentRef = useRef<BookingPaymentSectionRef>(null);

  // ── Plan 036 — money-path recovery state ─────────────────────────────
  // Server field errors rendered inline (promo/phone/email) instead of one
  // generic toast. Cleared per-field on edit and wholesale on each submit.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // CONFLICT recovery banner on the slot step ("that time was just taken").
  const [slotTakenNotice, setSlotTakenNotice] = useState(false);
  // Reactive mirror of the payment section's readiness (BUG-03) — disables
  // Confirm while a PI (re-)mint is in flight. Default true: with no payment
  // section mounted (no online payment) booking must stay possible.
  const [paymentReady, setPaymentReady] = useState(true);
  // Bumped to remount TurnstileWidget after a failed submit: the token is
  // single-use, so a retry needs a fresh challenge (key-remount ≙ reset()).
  const [turnstileNonce, setTurnstileNonce] = useState(0);
  // Per-field "touched" gates so prevalidation doesn't flag mid-typing.
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);

  function clearFieldError(key: string) {
    setFieldErrors((fe) => {
      if (!(key in fe)) return fe;
      const next = { ...fe };
      delete next[key];
      return next;
    });
  }

  function submit() {
    if (!state.startTime) return;
    // Plan 036 (BUG-03) — submit-time readiness gate. The reactive
    // `paymentReady` disable covers the visible button, but a ref consult at
    // click time is the authoritative check: while a PI (re-)mint is in
    // flight the on-screen Elements may hold a stale intent at a stale
    // amount, and confirming it would charge the wrong total.
    if (paymentRef.current && !paymentRef.current.isReady()) {
      show({ variant: 'danger', title: t('payment.notReady') });
      return;
    }
    startTransition(async () => {
      setFieldErrors({});
      // Phase 56 — confirm payment client-side FIRST. If no deposit
      // applies the call short-circuits with `{ kind: 'no_deposit' }`.
      // On payment failure we surface a toast and abort the booking
      // so the user can fix their card and retry.
      let paymentIntentId: string | undefined;
      let depositCents: number | undefined;
      if (paymentRef.current) {
        const paid = await paymentRef.current.confirmPayment();
        if (paid.kind === 'error') {
          // Plan 036 — NOT_READY is an internal sentinel, never customer
          // copy. Localize it (the readiness gates above make it rare).
          if (paid.message === 'NOT_READY') {
            show({ variant: 'danger', title: t('payment.notReady') });
            return;
          }
          // Loop 34 (P93) — surface Stripe's structured error code in
          // the toast description when present, so an "Insufficient
          // funds" decline reads as "Card declined · insufficient_funds"
          // rather than just the bare human message. Helps the customer
          // identify the right card to try and gives support better
          // information when they call. `decline_code` is the more
          // specific bank-side reason when available.
          const subCode = paid.declineCode ?? paid.code;
          show({
            variant: 'danger',
            title: paid.message,
            description: subCode ? `Stripe: ${subCode}` : undefined,
          });
          return;
        }
        if (paid.kind === 'paid') {
          paymentIntentId = paid.paymentIntentId;
          depositCents = paid.depositCents;
        }
      }

      const result = await bookPublicAppointment({
        shop_slug: shopSlug,
        barber_id: state.barberId === 'any' ? null : state.barberId,
        service_ids: state.serviceIds,
        date: state.date,
        start_time: state.startTime,
        first_name: state.firstName,
        last_name: state.lastName,
        email: state.email,
        phone: state.phone,
        notes: state.notes,
        hp: state.hp,
        // Forwarded so the confirmation email (Phase 24) ships in the
        // customer's language rather than always defaulting to French.
        locale: locale === 'en' ? 'en' : 'fr',
        // Turnstile token (Phase 30). Empty string when the feature is
        // disabled at the env-var level — the server-side helper treats it
        // as a no-op in that case.
        cf_turnstile_response: state.turnstileToken,
        // Promo code (Phase 41). Empty string → undefined server-side.
        promo_code: state.promoCode,
        // Phase 56 — only set when the payment section actually charged.
        payment_intent_id: paymentIntentId,
        deposit_amount_cents: depositCents,
        // Phase E — tip picked in the wizard. The action re-verifies
        // it against the PI amount and persists on the row.
        tip_amount_cents: state.tipAmountCents,
        // Loop 24 — Loi 25 affirmative consent. Server enforces too.
        consent_loi25: state.consentLoi25,
      });
      if (result.ok) {
        setState((s) => ({ ...s, step: 5 }));
      } else {
        // ── Plan 036 (BUG-02) — recoverable failure, not a dead-end ──
        // 1. Surface server field errors inline (promo/phone/email).
        setFieldErrors(result.fieldErrors ?? {});
        // 2. A consumed Turnstile token can't be replayed — remount the
        //    widget (fresh challenge) and gate Confirm until re-verified.
        if (turnstileEnforced) {
          setTurnstileNonce((n) => n + 1);
          setState((s) => ({ ...s, turnstileToken: '' }));
        }
        // 3. If a charge happened, the server refunded it (failBooking) and
        //    the PI is consumed — re-arm the payment section with a FRESH
        //    intent so a retry is possible (the consumed PI is never
        //    reused, so this cannot double-charge).
        if (paymentIntentId) {
          paymentRef.current?.refresh();
        }
        // 4. CONFLICT = the slot was taken while the customer typed. Route
        //    back to the slot step with a fresh fetch + inline banner
        //    instead of the old "reload the page" toast.
        if (result.errorCode === 'CONFLICT') {
          setSlotTakenNotice(true);
          setState((s) => ({ ...s, step: 3, startTime: null }));
          return;
        }
        show({ variant: 'danger', title: tErr(result.errorCode) });
      }
    });
  }

  return (
    <div className="space-y-7">
      {/* Brand mark + shop name — premium first impression. When the
          shop has uploaded a `logo_url` (Loop 65), we render it as
          the brand mark; otherwise we fall back to the accent-glow
          "K" Küa glyph that matches the auth shell. The fixed 40px
          square keeps the layout stable regardless of the source
          image's intrinsic dimensions (object-cover handles the
          crop). */}
      <header className="flex flex-col items-center gap-3 text-center">
        <BrandMark logoUrl={shop.logo_url ?? null} shopName={shop.name} />
        <div className="space-y-1">
          <h1 className="text-display-sm font-semibold tracking-tight text-text-primary">
            {shop.name}
          </h1>
          {shop.street && shop.municipality ? (
            <p className="text-xs text-text-muted">
              {shop.street} · {shop.municipality}
              {shop.province ? `, ${shop.province}` : ''}
            </p>
          ) : null}
          {/* Phase H+10 — phone line, shown only when widget_config
              opts it in. Wrapped in a `tel:` link so a customer on
              mobile can tap-to-call. The number is rendered exactly
              as stored (the shop owner formats it; we don't impose
              a NANP regex at display time). */}
          {shop.phone ? (
            <p className="text-xs text-text-muted">
              <a
                href={`tel:${shop.phone.replace(/[^\d+]/g, '')}`}
                className="hover:text-text-primary"
              >
                {shop.phone}
              </a>
            </p>
          ) : null}
          {/* Phase H+11 — operator-provided welcome line. 280 chars max,
              shown under address/phone so the customer reads a "human"
              note before diving into service selection. */}
          {welcomeMessage ? (
            <p className="mx-auto max-w-md text-sm text-text-secondary">{welcomeMessage}</p>
          ) : null}
        </div>
      </header>

      {/* Progress chips — five segments, one per step. The mapping of "step
          number" → semantic kind is computed by `kindForStep` so the chip
          count stays constant regardless of step ordering.
          Phase 47b: active chips widen + gain an accent halo, inactive
          chips stay slim. The width-grow gives directional feedback ("you
          made progress") without an extra label. */}
      <ol className="flex items-center justify-center gap-1.5">
        {Array.from({ length: PROGRESS_CHIP_COUNT }, (_, i) => i + 1).map((id) => {
          const reached = state.step >= id;
          return (
            <li
              key={id}
              className={cn(
                'h-1.5 rounded-full transition-all duration-300 ease-out-quint',
                reached ? 'w-10 bg-accent shadow-accent-glow' : 'w-6 bg-bg-surface-2',
              )}
              aria-hidden
            />
          );
        })}
      </ol>

      <div className="rounded-xl border border-border bg-bg-surface p-5 shadow-warm-md sm:p-6">
        {/* ─── Step 1 & 2 — order depends on `show_professional_first` ── */}
        {state.step <= 2 && kindForStep(state.step) === 'service' && (
          <ServiceStep
            t={t}
            locale={locale}
            services={services}
            servicesByCategory={servicesByCategory}
            categories={categories}
            selectedServices={selectedServices}
            allowMultiService={allowMultiService}
            onToggle={(id) => {
              setState((st) => ({
                ...st,
                serviceIds: st.serviceIds.includes(id)
                  ? st.serviceIds.filter((x) => x !== id)
                  : allowMultiService
                    ? [...st.serviceIds, id]
                    : [id],
              }));
            }}
            onRemove={(id) =>
              setState((st) => ({
                ...st,
                serviceIds: st.serviceIds.filter((x) => x !== id),
              }))
            }
          />
        )}

        {state.step <= 2 && kindForStep(state.step) === 'barber' && (
          <BarberStep
            t={t}
            shop={shop}
            barbers={barbers}
            selectedBarberId={state.barberId}
            onSelect={(id) => setState((s) => ({ ...s, barberId: id }))}
          />
        )}

        {/* ─── Step 3: date + slot ───────────────────────────────────── */}
        {state.step === 3 && (
          <section className="space-y-4">
            {/* §3.3 — "Your order" recap card. Renders once a service is
                picked; gives the customer something concrete to anchor on
                while they pick a date. */}
            {selectedServices.length > 0 ? (
              <OrderRecap
                t={t}
                locale={locale}
                barber={selectedBarber}
                isAnyBarber={state.barberId === 'any'}
                services={selectedServices}
                totalPrice={totalPrice}
                totalDuration={totalDuration}
              />
            ) : null}

            <h2 className="text-xl font-semibold tracking-tight text-text-primary">
              {t('steps.slot.title')}
            </h2>
            {/* Plan 036 (BUG-02) — CONFLICT recovery banner: the customer's
                slot was taken while they typed. They were routed back here
                with fresh slots; cleared on the next date/time pick. */}
            {slotTakenNotice ? (
              <p
                role="status"
                className="rounded-lg border border-warning/30 bg-warning-subtle p-3 text-sm text-warning shadow-warm-sm"
              >
                {t('steps.slot.justTaken')}
              </p>
            ) : null}
            <DateStrip
              value={state.date}
              onChange={(d) => {
                setSlotTakenNotice(false);
                setState((s) => ({ ...s, date: d, startTime: null }));
              }}
              timezone={shop.timezone}
              locale={locale === 'fr' ? 'fr' : 'en'}
              hours={hours}
              daysOff={daysOff}
            />
            <SlotPicker
              t={t}
              loading={slotLoading}
              error={slotError}
              onRetry={() => setRetryNonce((n) => n + 1)}
              slots={slots}
              selected={state.startTime}
              onSelect={(time) => {
                setSlotTakenNotice(false);
                setState((s) => ({ ...s, startTime: time }));
              }}
              waitlistInfo={{
                shopSlug,
                serviceIds: state.serviceIds,
                barberId: state.barberId === 'any' ? null : state.barberId,
                date: state.date,
                locale: locale === 'fr' ? 'fr' : 'en',
              }}
            />
          </section>
        )}

        {/* ─── Step 4: contact info ─────────────────────────────────── */}
        {state.step === 4 && (
          <section className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-xl font-semibold tracking-tight text-text-primary">
                {t('steps.contact.title')}
              </h2>
              <p className="text-sm text-text-secondary">{t('steps.contact.help')}</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="first_name" required>
                  {t('steps.contact.firstName')}
                </Label>
                <Input
                  id="first_name"
                  autoComplete="given-name"
                  value={state.firstName}
                  onChange={(e) => setState((s) => ({ ...s, firstName: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="last_name">{t('steps.contact.lastName')}</Label>
                <Input
                  id="last_name"
                  autoComplete="family-name"
                  value={state.lastName}
                  onChange={(e) => setState((s) => ({ ...s, lastName: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="phone" required>
                  {t('steps.contact.phone')}
                </Label>
                {/* Plan 036 (step 2) — the `invalid` prop is finally wired:
                    a malformed phone reads as an inline error BEFORE any
                    charge, instead of a post-charge server rejection. */}
                <PhoneInput
                  id="phone"
                  value={state.phone}
                  invalid={
                    Boolean(fieldErrors.phone) ||
                    (phoneTouched && state.phone.trim().length > 0 && !phoneFormatValid)
                  }
                  onBlur={() => setPhoneTouched(true)}
                  onChange={(e) => {
                    clearFieldError('phone');
                    setState((s) => ({ ...s, phone: e.target.value }));
                  }}
                />
                {Boolean(fieldErrors.phone) ||
                (phoneTouched && state.phone.trim().length > 0 && !phoneFormatValid) ? (
                  <FieldHint error>{t('steps.contact.phoneInvalid')}</FieldHint>
                ) : null}
              </div>
              <div>
                <Label htmlFor="email">{t('steps.contact.email')}</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={state.email}
                  invalid={Boolean(fieldErrors.email) || (emailTouched && !emailFormatValid)}
                  onBlur={() => setEmailTouched(true)}
                  onChange={(e) => {
                    clearFieldError('email');
                    setState((s) => ({ ...s, email: e.target.value }));
                  }}
                />
                {Boolean(fieldErrors.email) || (emailTouched && !emailFormatValid) ? (
                  <FieldHint error>{t('steps.contact.emailInvalid')}</FieldHint>
                ) : null}
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="notes">{t('steps.contact.notes')}</Label>
                <Textarea
                  id="notes"
                  rows={2}
                  value={state.notes}
                  onChange={(e) => setState((s) => ({ ...s, notes: e.target.value }))}
                />
                <FieldHint>{t('steps.contact.notesHint')}</FieldHint>
              </div>
              {/* Promo code (Phase 41) — visible only when the shop's
                  widget_config opted in (defaults to false). Server-side
                  validation handles the rest; the UI just collects the
                  string and surfaces the field-error if invalid. */}
              {widgetConfig?.show_promo_code ? (
                <div className="sm:col-span-2">
                  <Label htmlFor="promoCode">{t('steps.contact.promoCode')}</Label>
                  <Input
                    id="promoCode"
                    autoComplete="off"
                    placeholder="WELCOME20"
                    value={state.promoCode}
                    invalid={Boolean(fieldErrors.promo_code)}
                    onChange={(e) => {
                      clearFieldError('promo_code');
                      setState((s) => ({
                        ...s,
                        promoCode: e.target.value.toUpperCase().trim(),
                      }));
                    }}
                  />
                  {/* Plan 036 (BUG-02) — surface the server's specific promo
                      rejection (invalid/expired/used/first_only) inline,
                      where the customer can actually fix it. */}
                  {fieldErrors.promo_code ? (
                    <FieldHint error>
                      {t(
                        `steps.contact.promoErrors.${
                          ['invalid', 'expired', 'used', 'first_only'].includes(
                            fieldErrors.promo_code,
                          )
                            ? fieldErrors.promo_code
                            : 'invalid'
                        }`,
                      )}
                    </FieldHint>
                  ) : (
                    <FieldHint>{t('steps.contact.promoCodeHint')}</FieldHint>
                  )}
                </div>
              ) : null}
            </div>
            {/* Honeypot — visually hidden but present in the DOM. */}
            <input
              type="text"
              name="hp"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden
              value={state.hp}
              onChange={(e) => setState((s) => ({ ...s, hp: e.target.value }))}
              className="hidden"
            />

            {/* Turnstile challenge (Phase 30) — renders only when the
                NEXT_PUBLIC_TURNSTILE_SITE_KEY env var is set. When the
                token comes back via callback we store it in state; the
                Confirm button is gated on its presence via `canAdvance`. */}
            {turnstileEnforced ? (
              <div className="flex justify-center">
                {/* Plan 036 — `key` remounts the widget after a failed submit
                    (the verified token is single-use; a retry needs a fresh
                    challenge). Equivalent to turnstile.reset() without
                    extending the widget's API. */}
                <TurnstileWidget
                  key={turnstileNonce}
                  onToken={(token) => setState((s) => ({ ...s, turnstileToken: token }))}
                  action="booking"
                />
              </div>
            ) : null}

            {/* Loop 24 — Quebec Loi 25 affirmative consent. The shop
                is a private-info handler under Bill 25; we need
                explicit opt-in before storing the customer's phone,
                email, and notes. The submit button is gated on this
                via `canAdvance`. Audit log on the server records
                `loi25_consent: true` so the legal paper trail exists. */}
            <label className="flex cursor-pointer items-start gap-2 text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={state.consentLoi25}
                onChange={(e) => setState((s) => ({ ...s, consentLoi25: e.target.checked }))}
                className="mt-0.5 h-4 w-4 cursor-pointer rounded border-border bg-bg-surface-2 text-accent focus:outline-none focus:ring-2 focus:ring-focus focus:ring-offset-1"
                aria-required
              />
              <span>
                {t('steps.contact.consent')}{' '}
                <a
                  href={`/${locale}/privacy`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent underline hover:no-underline"
                >
                  {t('steps.contact.consentLink')}
                </a>
                {t('steps.contact.consentSuffix')}
              </span>
            </label>

            {/* Summary card — Phase 60: loyalty credit line shown only
                when the lookup returned a positive balance. The total
                line collapses to a single value when the customer pays
                full price; splits into "subtotal / credit / total" when
                a balance is auto-applied. */}
            <div className="rounded-lg border border-border bg-bg-base p-4 text-sm shadow-warm-sm">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                {t('summary.title')}
              </p>
              <p className="font-medium text-text-primary">
                {selectedServices.map((s) => s.name).join(' + ')}
              </p>
              <p className="text-xs text-text-muted">{totalDuration} min</p>
              {loyaltyCreditCents > 0 ? (
                <div className="mt-1 space-y-0.5 text-xs">
                  <p className="text-text-secondary">
                    {t('steps.contact.subtotalLabel')}{' '}
                    {formatCurrencyCAD(totalPrice, locale === 'fr' ? 'fr' : 'en')}
                  </p>
                  <p className="text-success">
                    {t('steps.contact.loyaltyApplied')} −
                    {formatCurrencyCAD(loyaltyCreditCents / 100, locale === 'fr' ? 'fr' : 'en')}
                  </p>
                  <p className="font-semibold text-text-primary">
                    {t('steps.contact.totalLabel')}{' '}
                    {formatCurrencyCAD(totalAfterLoyalty, locale === 'fr' ? 'fr' : 'en')}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-text-secondary">
                  {formatCurrencyCAD(totalPrice, locale === 'fr' ? 'fr' : 'en')}
                </p>
              )}
              <p className="text-xs text-text-secondary">
                {formatHeaderDate(
                  new Date(`${state.date}T12:00:00Z`),
                  locale === 'fr' ? 'fr' : 'en',
                  shop.timezone,
                )}{' '}
                · {state.startTime}
              </p>
              {/* Phase E — tip line in the summary card. Shown only when
                  the customer picked a non-zero tip. */}
              {state.tipAmountCents > 0 ? (
                <p className="mt-1 text-xs text-text-secondary">
                  {t('steps.contact.tipLine')}{' '}
                  <span className="text-text-primary">
                    {formatCurrencyCAD(state.tipAmountCents / 100, locale === 'fr' ? 'fr' : 'en')}
                  </span>
                </p>
              ) : null}
            </div>

            {/* Phase E — tip selector. Shown only when the shop has
                `widget_config.show_tip_step` on AND a tips_config row
                exists. The suggestions come from `suggestTips()` which
                picks % vs flat tiers based on `pct_use_above_amount`.
                The customer can pick a tier, type a custom amount, or
                explicitly skip. The selection drives both the summary
                line above and the PaymentSection re-fire below. */}
            {showTipStep ? (
              <TipSelector
                suggestions={tipSuggestions}
                selection={state.tipSelection}
                amountCents={state.tipAmountCents}
                locale={locale === 'fr' ? 'fr' : 'en'}
                onChange={(next) =>
                  setState((s) => ({
                    ...s,
                    tipSelection: next.selection,
                    tipAmountCents: next.amountCents,
                  }))
                }
                t={t}
              />
            ) : null}

            {/* Phase 56 — Stripe Elements deposit collection. The section
                self-determines whether to render based on the shop's
                Stripe Connect status and the selected services'
                deposit_amount_cents. Renders nothing when no deposit
                applies; renders a card form otherwise. The submit
                handler reads the ref to confirm payment before booking. */}
            <BookingPaymentSection
              ref={paymentRef}
              shopSlug={shopSlug}
              serviceIds={state.serviceIds}
              email={state.email}
              locale={locale === 'fr' ? 'fr' : 'en'}
              // Phase D.3 — forward promo + phone so the server
              // can reduce the PI amount by discounts in 'full'
              // mode. The section debounces and forwards them to
              // `createBookingPaymentIntent`.
              promoCode={state.promoCode}
              phone={state.phone}
              // Phase E — forward selected tip so the PI mints
              // for (base + tip). 0 when the customer hasn't
              // picked a tip or the shop hides the step.
              tipAmountCents={state.tipAmountCents}
              // Plan 036 (BUG-03) — reactive readiness: Confirm is
              // disabled while a PI (re-)mint is in flight so a stale
              // intent can never be charged at the wrong amount.
              onReadyChange={setPaymentReady}
            />

            {/* W11 — "why is Confirm disabled" checklist. Renders only when
                the contact step still has unmet requirements, so the
                conversion-step button is never a dead end without a reason.
                Styled as a soft to-do list (not a red error) since most items
                are simply "not done yet" rather than invalid input. */}
            {contactBlockers.length > 0 ? (
              <div
                role="status"
                className="rounded-lg border border-border bg-bg-base p-3 text-xs text-text-secondary shadow-warm-sm"
              >
                <p className="font-medium text-text-primary">{t('steps.contact.blockers.intro')}</p>
                <ul className="mt-1.5 space-y-1">
                  {contactBlockers.map((b) => (
                    <li key={b} className="flex items-start gap-1.5">
                      <span
                        aria-hidden
                        className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-text-muted"
                      />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        )}

        {/* ─── Step 5: confirmation ─────────────────────────────────── */}
        {state.step === 5 && (
          <section className="space-y-4 text-center">
            {/* Larger success mark with a soft glow ring — feels like a
                proper "done" celebration, not just an icon. */}
            <span
              aria-hidden
              className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/15 ring-4 ring-success/10"
            >
              <CheckCircle2 className="h-8 w-8 text-success" />
            </span>
            <h2 className="text-2xl font-semibold tracking-tight text-text-primary">
              {t('done.title')}
            </h2>
            {/* Phase H+11 — operator-customizable post-booking copy.
                Falls back to the default i18n string when the field
                isn't set. */}
            <p className="text-sm text-text-secondary">
              {postBookingMessage ?? t('done.description')}
            </p>
            <div className="rounded-lg border border-border bg-bg-base p-4 text-left text-sm shadow-warm-sm">
              <p className="font-medium text-text-primary">
                {selectedServices.map((s) => s.name).join(' + ')}
              </p>
              <p className="text-xs text-text-secondary">
                {formatHeaderDate(
                  new Date(`${state.date}T12:00:00Z`),
                  locale === 'fr' ? 'fr' : 'en',
                  shop.timezone,
                )}{' '}
                · {state.startTime}
              </p>
              <p className="text-xs text-text-secondary">
                {formatCurrencyCAD(totalPrice, locale === 'fr' ? 'fr' : 'en')}
              </p>
            </div>
            {/* Phase H+14 — redirect fallback. The auto-redirect effect
                fires `window.top.location` on a 2.5s timer, but browsers
                block top-frame navigation from a cross-origin iframe
                (the real embed case) when it isn't tied to a user
                gesture. This visible link IS a user gesture (target=_top
                breaks out of the iframe), so the customer can always
                complete the redirect even when the automatic one is
                silently blocked. */}
            {redirectEnabled && redirectUrl ? (
              <p className="text-xs text-text-muted">
                {t('done.redirecting')}{' '}
                <a
                  href={redirectUrl}
                  target="_top"
                  rel="noopener noreferrer"
                  className="text-accent underline hover:no-underline"
                >
                  {t('done.redirectManual')}
                </a>
              </p>
            ) : null}
          </section>
        )}

        {/* ─── Step nav (desktop) ───────────────────────────────────── */}
        {/* DIR-03 — on phones the nav moves into the sticky bar below so the
            primary action is always reachable without scrolling; the in-card
            nav stays for sm+ (desktop layout unchanged). */}
        {state.step < 5 && (
          <div className="mt-6 hidden items-center justify-between sm:flex">
            <Button
              type="button"
              variant="ghost"
              onClick={back}
              disabled={state.step === 1 || isPending}
            >
              <ChevronLeft className="h-4 w-4" /> {t('back')}
            </Button>
            {state.step < 4 ? (
              <Button type="button" onClick={next} disabled={!canAdvance || isPending}>
                {t('continue')} <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={submit}
                // Plan 036 (BUG-03) — also gated on payment readiness so a
                // stale PaymentIntent can't be confirmed mid re-mint.
                disabled={!canAdvance || !paymentReady}
                loading={isPending}
              >
                <CalendarCheck className="h-4 w-4" /> {t('confirm')}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Running subtotal — sticky bar showing what the customer is committing
          to as they scroll. DESKTOP ONLY (sm+): on phones the mobile action bar
          below carries the same summary plus the nav buttons. */}
      {state.step < 4 && selectedServices.length > 0 ? (
        <div className="sticky bottom-3 z-10 hidden rounded-xl border border-border bg-bg-surface/90 px-4 py-3 text-sm shadow-warm-lg backdrop-blur-xl sm:block">
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">
              {selectedServices.length} {t('summary.servicesLabel')}
            </span>
            <span className="text-base font-semibold tracking-tight text-text-primary">
              {formatCurrencyCAD(totalPrice, locale === 'fr' ? 'fr' : 'en')}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-text-muted">
            {totalDuration} {t('summary.minutes')}
          </p>
        </div>
      ) : null}

      {/* DIR-03 — mobile sticky action bar. Phones (< sm) hide the in-card nav
          and the desktop subtotal bar; this pinned bar carries the running
          summary plus Back + the primary CTA (Continue/Confirm) so the customer
          never has to scroll to advance. Covers steps 1–4 (step 4 had no sticky
          before). Desktop layout is untouched. */}
      {state.step < 5 ? (
        <div className="sticky bottom-3 z-10 rounded-xl border border-border bg-bg-surface/90 px-4 py-3 shadow-warm-lg backdrop-blur-xl sm:hidden">
          {selectedServices.length > 0 ? (
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-text-secondary">
                {selectedServices.length} {t('summary.servicesLabel')} · {totalDuration}{' '}
                {t('summary.minutes')}
              </span>
              <span className="text-base font-semibold tracking-tight text-text-primary">
                {formatCurrencyCAD(totalPrice, locale === 'fr' ? 'fr' : 'en')}
              </span>
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={back}
              disabled={state.step === 1 || isPending}
            >
              <ChevronLeft className="h-4 w-4" /> {t('back')}
            </Button>
            {state.step < 4 ? (
              <Button
                type="button"
                className="flex-1"
                onClick={next}
                disabled={!canAdvance || isPending}
              >
                {t('continue')} <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="button"
                className="flex-1"
                onClick={submit}
                // Plan 036 (BUG-03) — same payment-readiness gate as the
                // desktop Confirm above.
                disabled={!canAdvance || !paymentReady}
                loading={isPending}
              >
                <CalendarCheck className="h-4 w-4" /> {t('confirm')}
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step body sub-components
// ---------------------------------------------------------------------------

type TranslatorFn = ReturnType<typeof useTranslations<'pages.booking'>>;

/**
 * §3.2 — Service picker with a "selected" banner at the top + an "Anything to
 * add?" section below for the remaining services. When the widget config has
 * `allow_multi_service: false`, picking a new service replaces the previous
 * one (the `onToggle` caller handles that semantic).
 */
function ServiceStep({
  t,
  locale,
  services,
  servicesByCategory,
  categories,
  selectedServices,
  allowMultiService,
  onToggle,
  onRemove,
}: {
  t: TranslatorFn;
  locale: string;
  services: ServiceRow[];
  servicesByCategory: Map<string, ServiceRow[]>;
  categories: ServiceCategoryRow[];
  selectedServices: ServiceRow[];
  allowMultiService: boolean;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const hasSelection = selectedServices.length > 0;
  // Filter out already-selected services from the "add-on" list to declutter.
  const remainingByCategory = useMemo(() => {
    const selectedIds = new Set(selectedServices.map((s) => s.id));
    const m = new Map<string, ServiceRow[]>();
    for (const [catId, list] of servicesByCategory) {
      const filtered = list.filter((s) => !selectedIds.has(s.id));
      if (filtered.length > 0) m.set(catId, filtered);
    }
    return m;
  }, [servicesByCategory, selectedServices]);
  void services; // unused but kept in the signature for future extension

  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-text-primary">
          {t('steps.service.title')}
        </h2>
        <p className="text-sm text-text-secondary">{t('steps.service.help')}</p>
      </div>

      {/* "Primary" banner — shows the user's current picks. Each pill has an X
          to remove. We don't single out a "primary" item visually (the data
          model treats services equally); the banner conveys what's locked in.
          Phase 47b: rounded-lg + accent glow ring instead of a hard border,
          and the inner rows lose their flat-rectangle look for proper
          rounded-lg surfaces with a subtle border to separate from the bg. */}
      {hasSelection ? (
        <div className="rounded-lg border border-accent/25 bg-accent-subtle p-3 shadow-warm-sm ring-1 ring-inset ring-accent/10">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-accent-text">
            {allowMultiService ? t('steps.service.selectedPlural') : t('steps.service.selected')}
          </p>
          <ul className="mt-2 space-y-1.5">
            {selectedServices.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-bg-base px-3 py-2.5 text-sm shadow-warm-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-text-primary">{s.name}</p>
                  <p className="text-[11px] text-text-muted">
                    {s.duration_min} min ·{' '}
                    {formatCurrencyCAD(s.price, locale === 'fr' ? 'fr' : 'en')}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={t('steps.service.removeAria', { name: s.name })}
                  onClick={() => onRemove(s.id)}
                  className="shrink-0 rounded-sm p-1.5 text-text-muted transition-colors hover:bg-bg-surface-2 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Add-ons / picker. Header text shifts from "pick a service" to
          "anything to add?" once the first one is locked in.
          Phase 47b: each row is now a card with a hover lift + accent ring
          on hover. The Plus circle gets a colored accent fill on hover for
          a "click me" affordance that's more inviting than a flat border. */}
      {remainingByCategory.size > 0 && (allowMultiService || !hasSelection) ? (
        <div className="space-y-5">
          {hasSelection ? (
            <p className="text-sm font-medium text-text-primary">
              {t('steps.service.anythingToAdd')}
            </p>
          ) : null}
          {[...remainingByCategory.entries()].map(([catId, list]) => {
            const cat = categories.find((c) => c.id === catId);
            return (
              <div key={catId || 'none'}>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  {cat?.name ?? t('steps.service.uncategorized')}
                </p>
                <div className="space-y-2">
                  {list.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onToggle(s.id)}
                      className="group flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-bg-base px-3.5 py-3 text-left shadow-warm-sm transition-all duration-150 ease-out-quint hover:-translate-y-0.5 hover:border-accent/40 hover:bg-accent-subtle hover:shadow-warm-md focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          aria-hidden
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-bg-surface text-text-muted transition-colors duration-150 group-hover:border-accent/30 group-hover:bg-accent group-hover:text-accent-fg"
                        >
                          <Plus className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-text-primary">{s.name}</p>
                          <p className="text-[11px] text-text-muted">{s.duration_min} min</p>
                        </div>
                      </div>
                      <span className="shrink-0 text-sm font-semibold tracking-tight text-text-primary">
                        {formatCurrencyCAD(s.price, locale === 'fr' ? 'fr' : 'en')}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

/**
 * §3.1 — Barber picker, with avatar (or initials fallback) and an availability
 * hint. The "Any" option appears first when `allow_booking_any_barber` is on,
 * matching the Squire layout.
 */
function BarberStep({
  t,
  shop,
  barbers,
  selectedBarberId,
  onSelect,
}: {
  t: TranslatorFn;
  shop: BookingShop;
  barbers: BarberRow[];
  selectedBarberId: string | 'any' | null;
  onSelect: (id: string | 'any') => void;
}) {
  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-text-primary">
          {t('steps.barber.title')}
        </h2>
      </div>
      <div className="space-y-2">
        {shop.allow_booking_any_barber ? (
          <BarberCard
            selected={selectedBarberId === 'any'}
            onSelect={() => onSelect('any')}
            title={t('steps.barber.any')}
            subtitle={t('steps.barber.anyHint')}
            avatarUrl={null}
            initials="?"
          />
        ) : null}
        {barbers.map((b) => (
          <BarberCard
            key={b.id}
            selected={selectedBarberId === b.id}
            onSelect={() => onSelect(b.id)}
            title={b.display_name}
            subtitle={t('steps.barber.pickTimeNext')}
            avatarUrl={b.avatar_url}
            initials={initialsOf(b.display_name)}
          />
        ))}
      </div>
    </section>
  );
}

function BarberCard({
  selected,
  onSelect,
  title,
  subtitle,
  avatarUrl,
  initials,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  subtitle: string;
  avatarUrl: string | null;
  initials: string;
}) {
  // Phase 47b — selected state now reads as a halo'd card with a proper
  // CheckCircle indicator instead of the hacky "●" badge. The hover lifts
  // the card 1px so the affordance carries across mouse + touch.
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left shadow-warm-sm transition-all duration-150 ease-out-quint focus:outline-none focus-visible:ring-2 focus-visible:ring-focus',
        selected
          ? 'border-accent bg-accent-subtle shadow-accent-glow'
          : 'border-border bg-bg-base hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-warm-md',
      )}
      aria-pressed={selected}
    >
      <div className="flex min-w-0 items-center gap-3">
        {/* Avatar — img tag if URL provided, otherwise initials in a circle.
            Falls back to a generic icon for the "Any" option (initials = "?").
            Selected state adds an accent ring around the avatar to reinforce
            the "this one is locked in" read at a glance. */}
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            className={cn(
              'h-11 w-11 shrink-0 rounded-full object-cover transition-shadow',
              selected && 'ring-2 ring-accent ring-offset-2 ring-offset-bg-surface',
            )}
          />
        ) : (
          <span
            aria-hidden
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-all',
              selected
                ? 'bg-accent text-accent-fg ring-2 ring-accent ring-offset-2 ring-offset-bg-surface'
                : 'bg-bg-surface-2 text-text-secondary',
            )}
          >
            {initials === '?' ? <UserCircle2 className="h-6 w-6" /> : initials}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate font-medium text-text-primary">{title}</p>
          {subtitle ? <p className="text-xs text-text-muted">{subtitle}</p> : null}
        </div>
      </div>
      {selected ? <CheckCircle2 className="h-5 w-5 shrink-0 text-accent" aria-hidden /> : null}
    </button>
  );
}

function initialsOf(name: string): string {
  // Match the first letter of up to two words. Strips diacritics first so that
  // "Élodie Côté" → "EC" not "ÉC" (visually clearer in a small circle).
  const stripped = name.normalize('NFD').replace(/[̀-ͯ]/gu, '');
  const parts = stripped.split(/\s+/u).filter(Boolean).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join('') || '?';
}

/**
 * §3.3 — "Your order" recap card. Shown above the slot picker so the customer
 * sees who they'll be with and what they're paying for before locking a time.
 */
function OrderRecap({
  t,
  locale,
  barber,
  isAnyBarber,
  services,
  totalPrice,
  totalDuration,
}: {
  t: TranslatorFn;
  locale: string;
  barber: BarberRow | null | undefined;
  isAnyBarber: boolean;
  services: ServiceRow[];
  totalPrice: number;
  totalDuration: number;
}) {
  const proLabel = isAnyBarber
    ? t('steps.barber.any')
    : (barber?.display_name ?? t('order.unassigned'));
  const avatarUrl = !isAnyBarber ? barber?.avatar_url : null;
  const initials = !isAnyBarber && barber ? initialsOf(barber.display_name) : '?';

  return (
    <div className="rounded-lg border border-border bg-bg-base p-4 shadow-warm-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
        {t('order.title')}
      </p>
      <div className="mt-2 flex items-center gap-3">
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt=""
            width={44}
            height={44}
            className="h-11 w-11 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-bg-surface-2 text-sm font-semibold text-text-secondary"
          >
            {initials === '?' ? <UserCircle2 className="h-6 w-6" /> : initials}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text-primary">{proLabel}</p>
          <p className="text-xs text-text-secondary">{services.map((s) => s.name).join(' + ')}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-sm">
        <span className="text-text-secondary">{t('order.subtotal')}</span>
        <span className="text-base font-semibold tracking-tight text-text-primary">
          {formatCurrencyCAD(totalPrice, locale === 'fr' ? 'fr' : 'en')}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-text-muted">
        {totalDuration} {t('summary.minutes')}
      </p>
    </div>
  );
}

/**
 * §3.4 — Slot picker, grouped by morning / afternoon / evening so the
 * customer can scan quickly. Each group has a contextual icon (sun, sunset,
 * moon) matching the Squire pattern.
 */
function SlotPicker({
  t,
  loading,
  error,
  onRetry,
  slots,
  selected,
  onSelect,
  waitlistInfo,
}: {
  t: TranslatorFn;
  loading: boolean;
  // BUG-04 — true when the slot fetch failed (not "no availability"); drives a
  // retry affordance instead of the waitlist empty-state.
  error: boolean;
  onRetry: () => void;
  slots: string[] | null;
  selected: string | null;
  onSelect: (time: string) => void;
  /**
   * Phase 57 — when present and the slot list is empty, the picker
   * exposes a "Join waitlist" CTA so the customer can leave their
   * contact + preferences for the admin to follow up.
   */
  waitlistInfo?: {
    shopSlug: string;
    serviceIds: string[];
    barberId: string | null;
    date: string;
    locale: 'fr' | 'en';
  };
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          {t('steps.slot.times')}
        </p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-11 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }
  // BUG-04 — a failed fetch is not "fully booked": offer a retry, never the
  // waitlist CTA (which would mislead the customer into thinking the day is
  // full). The waitlist empty-state below is reserved for a confirmed empty 200.
  if (error) {
    return (
      <div className="space-y-3">
        <p className="rounded-lg border border-border bg-bg-base p-6 text-center text-sm text-text-muted shadow-warm-sm">
          {t('steps.slot.loadError')}
        </p>
        <div className="flex justify-center">
          <Button type="button" variant="secondary" onClick={onRetry}>
            {t('steps.slot.retry')}
          </Button>
        </div>
      </div>
    );
  }
  if (!slots || slots.length === 0) {
    return (
      <div className="space-y-3">
        <p className="rounded-lg border border-border bg-bg-base p-6 text-center text-sm text-text-muted shadow-warm-sm">
          {t('steps.slot.empty')}
        </p>
        {waitlistInfo ? <WaitlistInlineForm t={t} info={waitlistInfo} /> : null}
      </div>
    );
  }
  const grouped = groupSlotsByTimeOfDay(slots);
  return (
    <div className="space-y-4">
      <SlotGroup
        icon={<Sun className="h-4 w-4" />}
        label={t('steps.slot.morning')}
        times={grouped.morning}
        selected={selected}
        onSelect={onSelect}
      />
      <SlotGroup
        icon={<Sunset className="h-4 w-4" />}
        label={t('steps.slot.afternoon')}
        times={grouped.afternoon}
        selected={selected}
        onSelect={onSelect}
      />
      <SlotGroup
        icon={<Moon className="h-4 w-4" />}
        label={t('steps.slot.evening')}
        times={grouped.evening}
        selected={selected}
        onSelect={onSelect}
      />
    </div>
  );
}

function SlotGroup({
  icon,
  label,
  times,
  selected,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  times: string[];
  selected: string | null;
  onSelect: (time: string) => void;
}) {
  if (times.length === 0) return null;
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
        <span aria-hidden>{icon}</span>
        {label}
      </p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {times.map((time) => {
          const active = selected === time;
          return (
            <button
              key={time}
              type="button"
              onClick={() => onSelect(time)}
              className={cn(
                'h-11 rounded-lg border text-sm font-medium shadow-warm-sm transition-all duration-150 ease-out-quint focus:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                active
                  ? 'border-accent bg-accent text-accent-fg shadow-accent-glow'
                  : 'border-border bg-bg-base text-text-primary hover:-translate-y-0.5 hover:border-accent/40 hover:bg-bg-surface-2 hover:shadow-warm-md',
              )}
              aria-pressed={active}
            >
              {time}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DateStrip({
  value,
  onChange,
  timezone,
  locale,
  hours,
  daysOff,
}: {
  value: string;
  onChange: (date: string) => void;
  timezone: string;
  locale: 'fr' | 'en';
  hours: BookingHours[];
  daysOff: string[];
}) {
  const today = shopIsoDate(new Date(), timezone);
  const days = useMemo(() => {
    const refDay = new Date(`${today}T12:00:00Z`);
    return Array.from({ length: 14 }, (_, i) => {
      const d = addDays(refDay, i);
      const iso = shopIsoDate(d, timezone);
      const weekday = new Date(`${iso}T00:00:00`).getDay();
      const h = hours.find((hh) => hh.weekday === weekday);
      const closed = !h?.enabled || daysOff.includes(iso);
      // W11 — label the month on the first cell and on each month's 1st so a
      // 14-day window straddling two months (…30, 1, 2) isn't ambiguous about
      // which month a given day belongs to.
      const showMonth = i === 0 || iso.slice(-2) === '01';
      return { iso, weekday, closed, showMonth };
    });
  }, [today, timezone, hours, daysOff]);

  return (
    <div className="-mx-2 flex gap-2 overflow-x-auto px-2 pb-2">
      {days.map((d) => {
        const active = d.iso === value;
        return (
          <button
            key={d.iso}
            type="button"
            disabled={d.closed}
            onClick={() => onChange(d.iso)}
            className={cn(
              'flex h-16 w-14 shrink-0 flex-col items-center justify-center rounded-lg border shadow-warm-sm transition-all duration-150 ease-out-quint focus:outline-none focus-visible:ring-2 focus-visible:ring-focus',
              active
                ? 'border-accent bg-accent text-accent-fg shadow-accent-glow'
                : 'border-border bg-bg-base text-text-primary hover:-translate-y-0.5 hover:border-accent/40 hover:bg-bg-surface-2 hover:shadow-warm-md',
              d.closed &&
                'cursor-not-allowed opacity-40 hover:translate-y-0 hover:border-border hover:bg-bg-base hover:shadow-warm-sm',
            )}
            aria-pressed={active}
          >
            <span
              className={cn(
                'text-[9px] font-semibold uppercase leading-none tracking-wide opacity-70',
                // Always render the month so every cell reserves the line's
                // height (day numbers stay aligned across the strip); hide it
                // on non-boundary cells via `invisible`.
                !d.showMonth && 'invisible',
              )}
            >
              {new Date(`${d.iso}T12:00:00Z`).toLocaleDateString(
                locale === 'fr' ? 'fr-CA' : 'en-CA',
                {
                  month: 'short',
                  timeZone: timezone,
                },
              )}
            </span>
            <span className="text-[10px] font-medium uppercase tracking-wide">
              {new Date(`${d.iso}T12:00:00Z`).toLocaleDateString(
                locale === 'fr' ? 'fr-CA' : 'en-CA',
                {
                  weekday: 'short',
                  timeZone: timezone,
                },
              )}
            </span>
            <span className="text-lg font-semibold tracking-tight">
              {new Date(`${d.iso}T12:00:00Z`).toLocaleDateString(
                locale === 'fr' ? 'fr-CA' : 'en-CA',
                {
                  day: 'numeric',
                  timeZone: timezone,
                },
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * §3.5 — Waitlist inline form (Phase 57). Renders below the empty-slot
 * message when the customer's chosen date has no availability. Collects
 * just enough to reach back out: first name + phone. Optional notes. The
 * already-picked service IDs + barber + date are reused as the entry's
 * window (single-day). Submits via `addToWaitlistPublic`; on success the
 * form replaces itself with a thank-you message so the customer knows
 * we've got them.
 */
function WaitlistInlineForm({
  t,
  info,
}: {
  t: TranslatorFn;
  info: {
    shopSlug: string;
    serviceIds: string[];
    barberId: string | null;
    date: string;
    locale: 'fr' | 'en';
  };
}) {
  const [expanded, setExpanded] = useState(false);
  const [first, setFirst] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <p className="rounded-lg border border-success/30 bg-success/10 p-4 text-center text-sm text-success shadow-warm-sm">
        {t('waitlist.thanks')}
      </p>
    );
  }

  if (!expanded) {
    return (
      <div className="flex justify-center">
        <Button type="button" variant="secondary" size="sm" onClick={() => setExpanded(true)}>
          {t('waitlist.cta')}
        </Button>
      </div>
    );
  }

  const canSubmit = first.trim().length > 0 && phone.trim().length >= 7 && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    const result = await addToWaitlistPublic({
      shop_slug: info.shopSlug,
      first_name: first.trim(),
      phone: phone.trim(),
      email: '',
      preferred_barber_id: info.barberId ?? null,
      service_ids: info.serviceIds,
      date_window_start: info.date,
      date_window_end: info.date,
      notes: notes.trim(),
      hp: '',
      locale: info.locale,
    });
    setSubmitting(false);
    if (result.ok) setDone(true);
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-bg-base p-4 shadow-warm-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
        {t('waitlist.title')}
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor="wl_first">{t('waitlist.firstName')}</Label>
          <Input
            id="wl_first"
            value={first}
            onChange={(e) => setFirst(e.target.value)}
            autoComplete="given-name"
          />
        </div>
        <div>
          <Label htmlFor="wl_phone">{t('waitlist.phone')}</Label>
          <PhoneInput id="wl_phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </div>
      <div>
        <Label htmlFor="wl_notes">{t('waitlist.notes')}</Label>
        <Textarea id="wl_notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded(false)}>
          {t('back')}
        </Button>
        <Button type="button" size="sm" onClick={submit} disabled={!canSubmit} loading={submitting}>
          {t('waitlist.submit')}
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Phase E — TipSelector
//
// Tier-button row + custom amount input + "no tip" opt-out. Lives inside
// the wizard so it has direct access to the wizard's i18n namespace; if
// we ever need it elsewhere we can extract to /components/features. The
// suggestions come from `suggestTips()` which already picks % vs flat
// tiers based on `tips_config.pct_use_above_amount`.
//
// State contract with the parent: the parent owns `selection` + `amountCents`
// and re-renders on change. Tier picks set selection='tier:N' and the
// amount derived from the matching suggestion. Custom picks set
// selection='custom' and the amount typed (parsed via Number, capped
// at $1000). "No tip" sets selection='none' and amount 0.
// ─────────────────────────────────────────────────────────────────────────

// Phase E SR — `TipSelection` is declared once at the top of the file
// (used by `WizardState['tipSelection']`). Reusing it here keeps the
// two declarations from drifting (e.g. adding a 5th tier).

type TipChangePayload = {
  selection: TipSelection;
  amountCents: number;
};

function TipSelector({
  suggestions,
  selection,
  amountCents,
  locale,
  onChange,
  t,
}: {
  suggestions: ReturnType<typeof suggestTips>;
  selection: TipSelection;
  amountCents: number;
  locale: 'fr' | 'en';
  onChange: (next: TipChangePayload) => void;
  t: (key: string) => string;
}) {
  // Custom input is rendered when the customer picks "Custom". The
  // string state shadows `amountCents` so the user can type fractional
  // values (e.g. "5.5") without the controlled input fighting the
  // parsed number.
  const [customInput, setCustomInput] = useState<string>(
    selection === 'custom' && amountCents > 0 ? String(amountCents / 100) : '',
  );

  function pickTier(idx: 0 | 1 | 2 | 3) {
    const sug = suggestions[idx];
    if (!sug) return;
    onChange({ selection: `tier:${idx}` as const, amountCents: Math.round(sug.amount * 100) });
  }

  function pickNone() {
    onChange({ selection: 'none', amountCents: 0 });
  }

  function pickCustom() {
    // Open the custom input; keep the previous amount until user
    // types something fresh. Phase E SR — also seed the custom-input
    // field with the preserved amount so the user sees what they're
    // about to pay. Without this, switching from a tier to Custom
    // showed an empty field while the stored cents stayed the same
    // value — confusing because the user couldn't tell what was
    // selected. We format as a plain decimal (no currency symbol)
    // since the leading "$" lives next to the input.
    if (amountCents > 0) setCustomInput(String(amountCents / 100));
    onChange({ selection: 'custom', amountCents });
  }

  function setCustom(value: string) {
    setCustomInput(value);
    const parsed = Number(value.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed < 0) {
      onChange({ selection: 'custom', amountCents: 0 });
      return;
    }
    const cents = Math.min(100_000, Math.round(parsed * 100));
    onChange({ selection: 'custom', amountCents: cents });
  }

  return (
    <div className="space-y-2 rounded-lg border border-border bg-bg-base p-4 shadow-warm-sm">
      <p className="type-eyebrow">{t('steps.contact.tipTitle')}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {suggestions.map((sug, i) => {
          const isSelected = selection === `tier:${i}`;
          return (
            <button
              key={i}
              type="button"
              onClick={() => pickTier(i as 0 | 1 | 2 | 3)}
              className={cn(
                'flex flex-col items-center gap-0.5 rounded-md border px-3 py-2 text-sm shadow-warm-sm transition-all duration-150 ease-out-quint active:scale-[0.97]',
                isSelected
                  ? 'border-accent bg-accent-subtle font-semibold text-text-primary'
                  : 'border-border bg-bg-surface text-text-secondary hover:border-accent-ring hover:text-text-primary',
              )}
            >
              <span className="text-xs text-text-muted">{sug.label}</span>
              <span className="font-medium">{formatCurrencyCAD(sug.amount, locale)}</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={pickCustom}
          className={cn(
            'rounded-md border px-3 py-1.5 text-xs transition-all duration-150 ease-out-quint active:scale-[0.97]',
            selection === 'custom'
              ? 'border-accent bg-accent-subtle font-semibold text-text-primary'
              : 'border-border bg-bg-surface text-text-secondary hover:border-accent-ring hover:text-text-primary',
          )}
        >
          {t('steps.contact.tipCustom')}
        </button>
        <button
          type="button"
          onClick={pickNone}
          className={cn(
            'rounded-md border px-3 py-1.5 text-xs transition-all duration-150 ease-out-quint active:scale-[0.97]',
            selection === 'none'
              ? 'border-accent bg-accent-subtle font-semibold text-text-primary'
              : 'border-border bg-bg-surface text-text-secondary hover:border-accent-ring hover:text-text-primary',
          )}
        >
          {t('steps.contact.tipSkip')}
        </button>
        {selection === 'custom' ? (
          <div className="ml-auto flex items-center gap-1">
            <span className="text-xs text-text-muted">$</span>
            <Input
              inputMode="decimal"
              autoFocus
              value={customInput}
              onChange={(e) => setCustom(e.target.value)}
              className="w-24 text-right"
              aria-label={t('steps.contact.tipCustom')}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
