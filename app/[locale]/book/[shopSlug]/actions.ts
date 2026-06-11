'use server';

import { randomUUID } from 'node:crypto';
import { getClientIp } from '@/lib/security/client-ip';
import { waitUntil } from '@vercel/functions';
import { z } from 'zod';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { err, ok, type Result } from '@/lib/server-actions/result';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import { captureException } from '@/lib/observability';
import { logDurableAudit } from '@/lib/audit-log';
import { combineShopDateTime, shopDayStart, shopDayEnd } from '@/lib/business/timezone';
import { checkAvailability, type ExistingAppointment } from '@/lib/business/availability';
import { resolveEffectiveBarberSettings } from '@/lib/business/barber-settings';
import { sendEmail } from '@/lib/email/send';
import { AppointmentConfirmation } from '@/lib/email/templates/appointment-confirmation';
import { verifyTurnstile } from '@/lib/security/turnstile';
import { signToken } from '@/lib/security/signed-tokens';
import { appUrl } from '@/lib/env/app-url';
import { stripeConfigured } from '@/lib/stripe/server';
import {
  createDepositPaymentIntent,
  getReusableDepositPaymentIntent,
  verifyDepositPaymentIntent,
  refundOwnedIntentBestEffort,
} from '@/lib/stripe/payments';
import { sendSlackBookingNotification } from '@/lib/notifications/slack';
import { effectiveLoyaltyBalanceCents } from '@/lib/business/loyalty';
import { computeBookingPricing } from '@/lib/business/booking-pricing';
import { normalizePhoneKey } from '@/lib/utils';

const phoneRegex = /^[+\d\s().-]{7,20}$/;

// Next 15 — a 'use server' module may export ONLY async functions. This schema
// is internal to the action (no external importer), so it stays unexported; the
// inferred type below is a compile-time-only `export type`, which is allowed.
const publicBookingSchema = z.object({
  shop_slug: z.string().trim().min(1),
  barber_id: z.string().uuid().nullable(),
  service_ids: z.array(z.string().uuid()).min(1, 'SERVICE_REQUIRED'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'INVALID_DATE'),
  start_time: z.string().regex(/^\d{2}:\d{2}$/, 'INVALID_TIME'),
  first_name: z.string().trim().min(1, 'NAME_REQUIRED').max(120),
  last_name: z
    .string()
    .trim()
    .max(120)
    .optional()
    .or(z.literal('').transform(() => '')),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .optional()
    .or(z.literal('').transform(() => '')),
  phone: z.string().trim().regex(phoneRegex, 'PHONE_INVALID'),
  notes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .or(z.literal('').transform(() => '')),
  /** Honeypot field — must remain empty for a bot to be detected. */
  hp: z.string().max(0).optional(),
  /** Locale of the customer (Phase 24) — drives the confirmation email's
   *  language. Defaults to FR if the wizard doesn't forward it (older
   *  builds, or non-browser POSTs). */
  locale: z.enum(['fr', 'en']).default('fr'),
  /**
   * Cloudflare Turnstile response token (Phase 30). Server-side verified
   * against /siteverify. Optional in the schema so the action keeps
   * working when Turnstile is disabled (env vars absent); the action
   * itself enforces presence when `turnstileConfigured()` returns true.
   */
  cf_turnstile_response: z
    .string()
    .max(4096)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /**
   * Promo code (Phase 41). Optional — validated server-side against the
   * shop's `promo_codes` table. Invalid codes return INVALID_INPUT with
   * `{promo_code: 'invalid'|'expired'|'used'|'first_only'}` so the UI
   * can render a specific message. Discount is applied to total_amount
   * before insert; redemptions counter is bumped after success.
   */
  promo_code: z
    .string()
    .trim()
    .toUpperCase()
    .max(40)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /**
   * Stripe PaymentIntent ID (Phase 56) — set when the booking flow
   * collected a deposit via Stripe Elements before submitting the
   * appointment. The wizard creates the PI first via
   * `createBookingPaymentIntent`, confirms it client-side, then passes
   * the ID here so we can persist the link. The webhook keeps
   * `payment_status` in sync (pending → paid).
   */
  // Phase A SR-of-SR — tightened from `^pi_/` to require the actual
  // Stripe ID shape. The verify call would catch any garbage anyway
  // (Stripe 404s on `pi_; DROP TABLE`-style payloads) but Zod-side
  // rejection short-circuits before we round-trip to Stripe.
  payment_intent_id: z
    .string()
    .trim()
    .regex(/^pi_[A-Za-z0-9_]{8,255}$/, 'INVALID_PAYMENT_INTENT')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /** Deposit amount in cents that the PI was created for (Phase 56). */
  deposit_amount_cents: z.number().int().min(0).optional(),
  /**
   * Phase E — in-widget tip amount in cents. Persisted on
   * `appointments.tip_amount_cents` so receipts + finances can break
   * out the tip line. When > 0 it's added to the PI amount the
   * customer pays upfront (regardless of payment_mode, deposit or
   * full — the customer who tipped means to). The verify recomputes
   * with the same tip so the math reconciles. Capped at $1000 to
   * prevent obvious abuse (any legit tip is well under that).
   */
  tip_amount_cents: z.number().int().min(0).max(100_000).optional().default(0),
  /**
   * Loop 24 — Quebec Loi 25 affirmative consent flag. Must be true.
   * The wizard gates Confirm on the checkbox; the action re-enforces
   * server-side so a hand-crafted POST can't bypass.
   */
  consent_loi25: z.boolean().refine((v) => v === true, { message: 'CONSENT_REQUIRED' }),
});
export type PublicBookingInput = z.infer<typeof publicBookingSchema>;

/**
 * Public booking — accepts an anonymous request, performs every safety check
 * server-side, then writes the appointment with source='online'.
 *
 *  1. Rate limit by IP (10 attempts / 10 minutes — looser than auth flows
 *     because legitimate clients may retry slot selection a few times).
 *  2. Honeypot field check — silently fail if filled by a bot.
 *  3. Zod input parse.
 *  4. Resolve shop by slug; verify shop exists & is bookable.
 *  5. Load services (must belong to shop), compute total duration / amount.
 *  6. If barber_id is null, pick the first confirmed barber (shop must allow
 *     `allow_booking_any_barber`).
 *  7. Reuse checkAvailability() with the full day's schedule + existing
 *     appointments + blocked_time + barber_settings (booking-flow constraints
 *     apply: mins_book_before_appt, days_book_in_advance).
 *  8. Find-or-create the client by lower(phone).
 *  9. Insert appointment row + appointment_services links.
 * 10. Log audit (actor_id null = public booking).
 */
export async function bookPublicAppointment(raw: unknown): Promise<Result<{ id: string }>> {
  // Rate limit BEFORE parsing to keep abuse cheap.
  const ip = getClientIp();
  const rl = await checkRateLimit(`book:${ip}`, { max: 10, windowMs: 10 * 60 * 1000 });
  if (!rl.allowed) return err('RATE_LIMITED');

  const parsed = publicBookingSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      if (path) fieldErrors[path] = issue.message;
    }
    return err('INVALID_INPUT', fieldErrors);
  }
  const input = parsed.data;

  // Honeypot: a real human leaves it empty. If it's filled, pretend success
  // to avoid telegraphing that we detected the bot.
  if (input.hp && input.hp.length > 0) {
    return ok({ id: 'honeypot-discard' });
  }

  // Turnstile verification (Phase 30). No-op when env vars are absent.
  // We verify BEFORE expensive DB work so an invalid token costs nothing.
  // Returning INVALID_INPUT (not RATE_LIMITED) so a user with an expired
  // challenge can refresh and retry without triggering a cooldown.
  const turnstileResult = await verifyTurnstile(input.cf_turnstile_response, ip);
  if (!turnstileResult.ok) {
    return err('INVALID_INPUT', { cf_turnstile_response: turnstileResult.reason });
  }

  // ── 036b — refund net for the final catch ─────────────────────────
  // Plan 036 routed every post-charge `return err(...)` through
  // `failBooking` (best-effort refund), but an uncaught EXCEPTION bypassed
  // them all and hit the final catch, which returned UNEXPECTED with the
  // customer still charged. This context is hoisted OUTSIDE the try (the
  // catch can't see `shop`/`failBooking`, both block-scoped inside it):
  // armed once the shop is resolved, DISARMED the moment the booking is
  // durable (appointment + service links written) so a throw in the
  // notification tail can never refund a real booking.
  let refundOnThrow: {
    paymentIntentId: string;
    connectedAccountId: string;
    shopId: string;
  } | null = null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createSupabaseServiceRoleClient() as any;

    // ── Resolve shop ──────────────────────────────────────────────────
    // We also pull the contact fields here so the Phase 24 confirmation
    // email at the bottom can show address + phone without a second
    // round-trip.
    const shopRes = await supabase
      .from('shops')
      // Loop 33 — `slack_webhook_url` pulled here so the booking
      // confirmation can fire a Slack notification to the owner
      // without a second round-trip. Service-role client bypasses
      // the column-level REVOKE we put on authenticated/anon.
      //
      // Phase A (Stripe hardening) — `stripe_account_id` added so we
      // can verify the client-supplied `payment_intent_id` belongs to
      // THIS shop before persisting it on the appointment row.
      //
      // Phase D — `payment_mode` drives whether the PI we verify was
      // minted at the deposit total or the full-price total. The
      // recomputed amount below MUST match the formula
      // `createBookingPaymentIntent` used or the verify rejects a
      // legitimate PI.
      .select(
        'id, name, timezone, allow_booking_any_barber, street, municipality, province, phone, email_logo_url, email_accent_color, slack_webhook_url, stripe_account_id, payment_mode',
      )
      .eq('alias', input.shop_slug)
      .limit(1);
    const shop = ((shopRes.data as Array<{
      id: string;
      name: string;
      timezone: string;
      allow_booking_any_barber: boolean;
      street: string | null;
      municipality: string | null;
      province: string | null;
      phone: string | null;
      email_logo_url: string | null;
      email_accent_color: string | null;
      stripe_account_id: string | null;
      slack_webhook_url: string | null;
      payment_mode: 'full' | 'deposit' | 'none';
    }> | null) ?? [])[0];
    if (!shop) return err('NOT_FOUND');

    // ── Refund-on-failure safety net (plan 001) ──────────────────────
    // The wizard charges the card client-side BEFORE this action runs, so
    // any rejection AFTER this point leaves the customer paid with no
    // appointment. Every post-charge failure return below routes through
    // `failBooking` to give the money back. Best-effort: a refund failure
    // must NOT mask the original error — capture it and still return.
    // `refundOwnedIntentBestEffort` only refunds a PI that provably belongs
    // to THIS shop and actually captured money, so it's safe even on the
    // PI-verify-failed path (wrong_shop → no refund).
    const failBooking = async (
      ...args: Parameters<typeof err>
    ): Promise<Result<{ id: string }>> => {
      if (input.payment_intent_id && shop.stripe_account_id) {
        try {
          const r = await refundOwnedIntentBestEffort({
            paymentIntentId: input.payment_intent_id,
            expectedConnectedAccountId: shop.stripe_account_id,
          });
          if (!r.refunded && r.reason !== 'wrong_shop' && r.reason !== 'not_charged') {
            captureException(new Error(`[booking] refund-on-failure skipped: ${r.reason}`), {
              tags: { layer: 'public-booking', step: 'refund-on-failure' },
              extra: { shopId: shop.id, paymentIntentId: input.payment_intent_id },
            });
          }
        } catch (e) {
          captureException(e, {
            tags: { layer: 'public-booking', step: 'refund-on-failure' },
            extra: { shopId: shop.id, paymentIntentId: input.payment_intent_id },
          });
        }
      }
      return err(...args);
    };

    // Arm the final-catch refund net over the same span failBooking covers:
    // from here on, a charged customer with no durable booking gets their
    // money back even when the failure is a THROW, not a `return`.
    if (input.payment_intent_id && shop.stripe_account_id) {
      refundOnThrow = {
        paymentIntentId: input.payment_intent_id,
        connectedAccountId: shop.stripe_account_id,
        shopId: shop.id,
      };
    }

    // ── Resolve services + promo + barber in ONE batch (plan 018) ─────
    // All three reads depend ONLY on shop.id, so they run in parallel instead
    // of three sequential round-trips. The VALIDATIONS below run in the SAME
    // order as before (services → promo → barber), so error precedence is
    // byte-identical — e.g. an invalid promo still wins over an invalid
    // barber. `name` (Phase 24) lists services in the confirmation email;
    // `deposit_amount_cents` (Loop 29) feeds the deposit recompute without a
    // second round-trip; barber `display_name` is widened in here so the
    // email/Slack tail can reuse it instead of re-querying the row.
    type PromoCodeRow = {
      id: string;
      type: 'percent' | 'fixed';
      value: number;
      first_appointment_only: boolean;
      one_time: boolean;
      expiration_date: string | null;
      redemptions: number;
    };
    const barberQuery = input.barber_id
      ? // SECURITY (Barbers audit B6) — validate an explicit barber_id belongs
        // to THIS shop and is bookable (confirmed); never trust it verbatim
        // (could otherwise book a soft-deleted / 'staff' / cross-shop barber).
        supabase
          .from('barbers')
          .select('id, display_name')
          .eq('id', input.barber_id)
          .eq('shop_id', shop.id)
          .eq('status', 'confirmed')
          .eq('bookable', true)
          .maybeSingle()
      : supabase
          .from('barbers')
          .select('id, display_name')
          .eq('shop_id', shop.id)
          .eq('status', 'confirmed')
          .eq('bookable', true)
          .order('sort_order', { ascending: true })
          .limit(1);
    const [servicesRes, promoRes, barberRes] = await Promise.all([
      supabase
        .from('services')
        .select('id, name, duration_min, price, status, deposit_amount_cents')
        .eq('shop_id', shop.id)
        .in('id', input.service_ids),
      input.promo_code
        ? supabase
            .from('promo_codes')
            .select(
              'id, type, value, first_appointment_only, one_time, expiration_date, redemptions',
            )
            .eq('shop_id', shop.id)
            .eq('code', input.promo_code)
            .limit(1)
        : Promise.resolve(null),
      barberQuery,
    ]);

    // Validate services (order-preserved: first).
    const services =
      (servicesRes.data as Array<{
        id: string;
        name: string;
        duration_min: number;
        price: number;
        status: 'enabled' | 'disabled';
        deposit_amount_cents: number | null;
      }> | null) ?? [];
    if (
      services.length !== input.service_ids.length ||
      services.some((s) => s.status !== 'enabled')
    ) {
      // Plan 036 — these validation rejections run AFTER the client-side
      // charge, so they must refund like every other post-charge failure
      // (failBooking no-ops when no payment_intent_id was sent).
      return await failBooking('NOT_FOUND');
    }
    const totalMinutes = services.reduce((sum, s) => sum + s.duration_min, 0);

    // Validate promo (order-preserved: after services, before barber). The
    // discount ARITHMETIC moved to the shared pricing engine (plan 014); only
    // the promo POLICY (invalid / expired / one-time) stays here. The
    // first_appointment_only check is deferred until the client is resolved.
    let promoCodeRow: PromoCodeRow | null = null;
    if (input.promo_code) {
      promoCodeRow = ((promoRes?.data as PromoCodeRow[] | null) ?? [])[0] ?? null;
      if (!promoCodeRow) {
        // Plan 036 — a typo'd promo used to charge-then-reject WITHOUT a
        // refund (the wizard only validates promo at submit). Route through
        // the refund net like every other post-charge rejection.
        return await failBooking('INVALID_INPUT', { promo_code: 'invalid' });
      }
      if (
        promoCodeRow.expiration_date &&
        new Date(promoCodeRow.expiration_date).getTime() < Date.now()
      ) {
        return await failBooking('INVALID_INPUT', { promo_code: 'expired' });
      }
      if (promoCodeRow.one_time && promoCodeRow.redemptions > 0) {
        return await failBooking('INVALID_INPUT', { promo_code: 'used' });
      }
    }

    // Validate barber (order-preserved: last) + capture display_name for the
    // email/Slack tail (plan 018 — no late re-query).
    let barberId = input.barber_id;
    let barberDisplayName: string | null = null;
    if (!barberId) {
      // Plan 036 — post-charge barber rejections refund too (no-op without a PI).
      if (!shop.allow_booking_any_barber) return await failBooking('INVALID_INPUT');
      const row =
        ((barberRes.data as Array<{ id: string; display_name: string | null }> | null) ?? [])[0] ??
        null;
      barberId = row?.id ?? null;
      barberDisplayName = row?.display_name ?? null;
      if (!barberId) return await failBooking('NOT_FOUND');
    } else {
      const row = barberRes.data as { id: string; display_name: string | null } | null;
      if (!row) return await failBooking('INVALID_INPUT');
      barberDisplayName = row.display_name ?? null;
    }

    // ── Compose UTC instants ─────────────────────────────────────────
    const startAt = combineShopDateTime(input.date, input.start_time, shop.timezone);
    const endAt = new Date(startAt.getTime() + totalMinutes * 60_000);

    // ── Load day's schedule for availability check ───────────────────
    const dayStart = shopDayStart(startAt, shop.timezone);
    const dayEnd = shopDayEnd(startAt, shop.timezone);
    const [hoursRes, daysOffRes, apptsRes, blockedRes, settingsRes] = await Promise.all([
      supabase
        .from('shop_hours')
        .select('weekday, enabled, open_time, close_time')
        .eq('shop_id', shop.id),
      supabase.from('shop_days_off').select('date').eq('shop_id', shop.id),
      supabase
        .from('appointments')
        .select('id, barber_id, start_at, end_at, status')
        .eq('shop_id', shop.id)
        .gte('start_at', dayStart.toISOString())
        .lt('start_at', dayEnd.toISOString()),
      supabase
        .from('blocked_time')
        .select('barber_id, start_at, end_at')
        .eq('shop_id', shop.id)
        .gte('start_at', dayStart.toISOString())
        .lt('start_at', dayEnd.toISOString()),
      supabase
        .from('barber_settings')
        .select(
          'scope, barber_id, allow_multiple_services, client_booking_interval_min, days_book_in_advance, mins_book_before_appt',
        )
        .eq('shop_id', shop.id),
    ]);

    const hours =
      (hoursRes.data as Array<{
        weekday: number;
        enabled: boolean;
        open_time: string | null;
        close_time: string | null;
      }> | null) ?? [];
    const daysOff = ((daysOffRes.data as Array<{ date: string }> | null) ?? []).map((d) => d.date);
    const existing: ExistingAppointment[] = (
      (apptsRes.data as Array<{
        id: string;
        barber_id: string;
        start_at: string;
        end_at: string;
        status: ExistingAppointment['status'];
      }> | null) ?? []
    ).map((a) => ({
      ...a,
      start_at: new Date(a.start_at),
      end_at: new Date(a.end_at),
    }));
    const blocked = (
      (blockedRes.data as Array<{
        barber_id: string | null;
        start_at: string;
        end_at: string;
      }> | null) ?? []
    ).map((b) => ({
      barber_id: b.barber_id,
      start_at: new Date(b.start_at),
      end_at: new Date(b.end_at),
    }));
    const settingsRows =
      (settingsRes.data as Array<{
        scope: 'shop' | 'barber';
        barber_id: string | null;
        allow_multiple_services: boolean;
        client_booking_interval_min: number;
        days_book_in_advance: number;
        mins_book_before_appt: number;
      }> | null) ?? [];
    // B20 — one shared resolver (override row → shop row → documented DEFAULTS).
    // `settings` is now never null: a shop with no settings rows gets the
    // defaults instead of skipping the interval / days / mins constraints.
    const settings = resolveEffectiveBarberSettings(settingsRows, barberId);

    // B5 — enforce allow_multiple_services (the setting was persisted but never
    // consumed). When the barber/shop disallows multi-service bookings, reject
    // a public booking that selected more than one service.
    if (!settings.allow_multiple_services && input.service_ids.length > 1) {
      return await failBooking('INVALID_INPUT');
    }

    const shopWeekday = new Date(`${input.date}T00:00:00`).getDay();

    // B5 — enforce client_booking_interval_min as a server-side GRID check.
    // Previously the interval only stepped the slots UI, so a crafted POST
    // could book any off-grid minute (e.g. 10:07 when the interval is 30). A
    // public booking must land on open_time + k*interval for the day; admin
    // bookings (via the calendar, not this action) are unaffected.
    if (settings.client_booking_interval_min > 0) {
      const dayHours = hours.find((h) => h.weekday === shopWeekday && h.enabled && h.open_time);
      if (dayHours?.open_time) {
        const openMin = toMinutes(dayHours.open_time.slice(0, 5));
        const startMin = toMinutes(input.start_time);
        if ((startMin - openMin) % settings.client_booking_interval_min !== 0) {
          return await failBooking('INVALID_INPUT');
        }
      }
    }

    // formatMinutes wraps at 1440 ('24:30' → '00:30'), which would defeat the
    // closing-hours check below. A booking may not cross shop-local midnight.
    if (toMinutes(input.start_time) + totalMinutes > 1440) {
      return await failBooking('INVALID_INPUT');
    }

    const verdict = checkAvailability({
      start_at: startAt,
      end_at: endAt,
      barber_id: barberId,
      shop_date: input.date,
      shop_weekday: shopWeekday,
      shop_start_time: input.start_time,
      shop_end_time: formatMinutes(toMinutes(input.start_time) + totalMinutes),
      hours,
      daysOff: daysOff.map((d) => ({ date: d })),
      existing,
      blocked,
      settings: {
        client_booking_interval_min: settings.client_booking_interval_min,
        days_book_in_advance: settings.days_book_in_advance,
        mins_book_before_appt: settings.mins_book_before_appt,
      },
    });
    if (!verdict.ok) {
      return await failBooking(
        verdict.reason === 'CONFLICT_APPOINTMENT' || verdict.reason === 'CONFLICT_BLOCK'
          ? 'CONFLICT'
          : 'INVALID_INPUT',
      );
    }

    // ── Find-or-create client by normalized phone ────────────────────
    // Phase 50 — we now also fetch `loyalty_balance_cents` so we can
    // auto-apply any accumulated reward credit as a deduction on the
    // appointment total. New clients always have 0; existing clients
    // get their balance applied (up to the post-promo running total).
    // Canonical NANP key = last 10 digits, matched EXACTLY against the
    // generated phone_normalized column. The old ilike '%digits%' substring
    // match manufactured duplicates ('+1 514…' vs bare digits never matched)
    // and could resolve to the WRONG client (cross-client loyalty/PII leak).
    const phoneKey = normalizePhoneKey(input.phone);
    let clientId: string | null = null;
    let clientLoyaltyBalanceCents = 0;
    let clientIsNew = false;
    // Plan 018 — `me_token_version` widened into the lookup/insert selects so
    // the confirmation email's /me link can be minted without a third client
    // round-trip in the tail.
    let clientMeTokenVersion = 0;
    if (phoneKey.length >= 7) {
      const clientLookup = await supabase
        .from('clients')
        // Loop 35 — `loyalty_balance_expires_at` pulled too so the
        // effective-balance helper can zero out expired credits before
        // we apply them.
        .select('id, loyalty_balance_cents, loyalty_balance_expires_at, me_token_version')
        .eq('shop_id', shop.id)
        .eq('phone_normalized', phoneKey)
        .limit(1);
      const existingClient =
        ((clientLookup.data as Array<{
          id: string;
          loyalty_balance_cents: number | null;
          loyalty_balance_expires_at: string | null;
          me_token_version: number | null;
        }> | null) ?? [])[0] ?? null;
      clientId = existingClient?.id ?? null;
      clientMeTokenVersion = existingClient?.me_token_version ?? 0;
      // Loop 35 — `effectiveLoyaltyBalanceCents` returns 0 + zeroes the
      // row in the DB when the expiry has passed, so subsequent reads
      // agree and the customer can't redeem an expired credit.
      clientLoyaltyBalanceCents = existingClient
        ? await effectiveLoyaltyBalanceCents({
            clientId: existingClient.id,
            balanceCents: existingClient.loyalty_balance_cents ?? 0,
            expiresAt: existingClient.loyalty_balance_expires_at,
          })
        : 0;
    }
    if (!clientId) {
      clientIsNew = true;
      const insertClient = await supabase
        .from('clients')
        .insert({
          shop_id: shop.id,
          first_name: input.first_name,
          last_name: input.last_name || null,
          email: input.email || null,
          phone: input.phone,
        })
        .select('id, me_token_version')
        .single();
      if (insertClient.error || !insertClient.data) return await failBooking('UNEXPECTED');
      const inserted = insertClient.data as { id: string; me_token_version: number | null };
      clientId = inserted.id;
      clientMeTokenVersion = inserted.me_token_version ?? 0;
    }

    // ── Loyalty credit auto-apply (Phase 50) ─────────────────────────
    // Applied AFTER promo so the customer gets full mileage out of both
    // incentives, capped at the running total (in cents) so a generous
    // balance can zero the bill but never go negative. Plan 014 — this
    // arithmetic now lives in the shared pricing engine (called once below);
    // `clientLoyaltyBalanceCents` was fetched during find-or-create above
    // and feeds the engine. The DB column's CHECK (>= 0) is the backstop.

    // ── Promo first_appointment_only check (Phase 41) ────────────────
    // Deferred until we know the client's identity. "First appointment"
    // = no PRIOR appointments. We just created the client row above
    // when clientIsNew=true so they trivially qualify; for an existing
    // client we count their past bookings.
    if (promoCodeRow?.first_appointment_only && !clientIsNew) {
      const existingApptRes = await supabase
        .from('appointments')
        .select('id')
        .eq('client_id', clientId)
        .limit(1);
      const hasPrior = ((existingApptRes.data as Array<{ id: string }> | null) ?? []).length > 0;
      if (hasPrior) {
        return await failBooking('INVALID_INPUT', { promo_code: 'first_only' });
      }
    }

    // ── Verify the client-supplied PaymentIntent (Phase A) ───────────
    //
    // Loop 29 (P2.103) made the deposit amount server-derived, but the
    // `payment_intent_id` itself was still trusted from the client.
    // A hand-crafted POST could attach ANY `pi_*` (someone else's,
    // fabricated, $0-amount, etc.) and the row would happily claim
    // the appointment was paid.
    //
    // We now retrieve the PI from Stripe and assert:
    //   1. it exists,
    //   2. its destination matches THIS shop's connected account,
    //   3. its amount matches the deposit we expect from the selected
    //      services,
    //   4. its status is succeeded or processing.
    //
    // The same retrieve also tells us the canonical status, which lets
    // us write `payment_status='paid'` directly when Stripe already
    // says succeeded — closing the webhook race where
    // `payment_intent.succeeded` could fire BEFORE this row exists
    // (the webhook would no-op and the row would stay 'pending'
    // forever).
    // Phase D — branch on `payment_mode` to match what
    // `createBookingPaymentIntent` minted the PI for.
    //
    //   - 'full'    : charge the post-discount total. Because the promo +
    //                 loyalty have already been applied to `totalAmount`
    //                 above, `Math.round(totalAmount * 100)` IS the
    //                 discount-aware amount the widget asked Stripe to
    //                 charge (Phase D.3).
    //   - 'deposit' : charge per-service `deposit_amount_cents` — the
    //                 historical V1 behavior; discounts apply to the
    //                 in-shop BALANCE, not the deposit.
    //   - 'none'    : no PI on this path, leave the value at 0.
    //
    // Plan 014 — recompute the charge via the SAME shared pricing engine
    // the mint side (`createBookingPaymentIntent`) uses, so the verify
    // can never reject a legitimate PI over a one-cent formula drift (that
    // would be a full public-booking outage). Promo POLICY (invalid /
    // expired / used / first-appointment) was enforced above; the engine only
    // does arithmetic on the resolved promo + the already-fetched loyalty
    // balance. The tip is clamped (0..$1,000) and stacked inside the engine,
    // and persisted separately on `appointments.tip_amount_cents` so the
    // receipt + finances can break it out from the service total.
    const pricing = computeBookingPricing({
      paymentMode: shop.payment_mode,
      services,
      promo: promoCodeRow ? { type: promoCodeRow.type, value: promoCodeRow.value } : null,
      loyaltyBalanceCents: clientLoyaltyBalanceCents,
      tipAmountCents: input.tip_amount_cents,
    });
    const totalAmount = pricing.totalDollars;
    const discountAmount = pricing.discountDollars;
    const loyaltyCreditCents = pricing.loyaltyCreditCents;
    const recomputedDepositCents = input.payment_intent_id ? pricing.chargeCents : 0;

    let verifiedPaymentStatus: 'paid' | 'pending' = 'pending';
    if (input.payment_intent_id) {
      // A PI with no shop Connect account is impossible — the
      // `createBookingPaymentIntent` action requires it. Defensive
      // guard: if somehow the shop lost Connect between intent
      // creation and booking submit, refuse the PI rather than
      // trusting it.
      if (!shop.stripe_account_id) return await failBooking('UNEXPECTED');

      const verify = await verifyDepositPaymentIntent({
        paymentIntentId: input.payment_intent_id,
        expectedConnectedAccountId: shop.stripe_account_id,
        expectedAmountCents: recomputedDepositCents,
      });
      if (!verify.valid) {
        // Don't leak which leg failed — same UX as any other
        // unexpected error from the client's perspective.
        captureException(new Error(`[booking] PI verify failed: ${verify.reason}`), {
          tags: { layer: 'booking', reason: verify.reason },
          extra: { shopId: shop.id, paymentIntentId: input.payment_intent_id },
        });
        return await failBooking('UNEXPECTED');
      }
      // Phase A — set 'paid' at insert when Stripe already says
      // succeeded. The webhook handler is still authoritative for
      // async transitions (refunds, disputes) but we don't depend
      // on it for the initial state.
      verifiedPaymentStatus = verify.status === 'succeeded' ? 'paid' : 'pending';
    }

    const paymentFields = input.payment_intent_id
      ? {
          payment_intent_id: input.payment_intent_id,
          payment_status: verifiedPaymentStatus,
          deposit_amount_cents: recomputedDepositCents,
        }
      : {};
    // Phase 72 — client_name_snapshot captured at insert time so the
    // historical record survives a future Loi 25 anonymization.
    const clientNameSnapshot = `${input.first_name}${input.last_name ? ` ${input.last_name}` : ''}`;
    const insertAppt = await supabase
      .from('appointments')
      .insert({
        shop_id: shop.id,
        barber_id: barberId,
        client_id: clientId,
        client_name_snapshot: clientNameSnapshot,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        status: 'booked',
        source: 'online',
        notes: input.notes || null,
        total_amount: totalAmount,
        // Phase E — persist the in-widget tip so the receipt + finances
        // can break it out from the service total. Stored in cents per
        // the schema (column NOT NULL DEFAULT 0).
        //
        // Phase E SR — only persist when a PI was actually charged.
        // In 'none' mode or when the shop isn't Connect-onboarded the
        // wizard might still forward a tip intent (e.g. the customer
        // picked a tier before realizing the shop has no online
        // payment). Persisting it anyway would make the receipt show
        // a "tip paid" line for money that was never charged. Owner
        // collects in-shop and reconciles via the regular charge
        // flow.
        tip_amount_cents: input.payment_intent_id ? pricing.tipCents : 0,
        ...paymentFields,
      })
      .select('id')
      .single();
    if (insertAppt.error || !insertAppt.data) {
      // Phase 70 audit P2.16 — unique_violation on the partial index
      // `appointments_active_barber_slot_idx` means another insert won
      // the race for this barber+slot. Surface as CONFLICT so the
      // wizard tells the customer the slot is taken, same UX as a
      // synchronous availability fail. Postgres error code 23505 =
      // unique_violation; Supabase exposes it via `error.code`.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = insertAppt.error as any;
      if (e?.code === '23505') return await failBooking('CONFLICT');
      return await failBooking('UNEXPECTED');
    }
    const apptId = (insertAppt.data as { id: string }).id;

    // Link services. Mirror the admin createAppointment recovery: the
    // appointment row already exists, so if this (atomic, single-statement)
    // insert fails we'd leave an orphaned $-bearing appointment with ZERO
    // services — corrupting finances/commission/loyalty and showing the
    // barber a serviceless slot. Roll it back by deleting the appointment we
    // just created. (Folding both writes into a Postgres transaction RPC is
    // the proper V2 fix — same note as the admin path.)
    const linkServices = await supabase.from('appointment_services').insert(
      services.map((s) => ({
        appointment_id: apptId,
        service_id: s.id,
        price_snapshot: s.price,
      })),
    );
    if (linkServices.error) {
      const rollback = await supabase.from('appointments').delete().eq('id', apptId);
      // If the compensating DELETE itself fails, the orphan persists — don't
      // lose it behind the generic error. Capture the appointment id AND any
      // payment-intent id so a charged-but-rolled-back booking can be
      // reconciled/refunded (mirrors the orphan-PaymentIntent recovery on the
      // charge path).
      if (rollback?.error) {
        captureException(new Error('bookPublicAppointment: orphan rollback DELETE failed'), {
          tags: { layer: 'public-booking', step: 'link-services.rollback' },
          extra: {
            appointmentId: apptId,
            shopId: shop.id,
            paymentIntentId: input.payment_intent_id ?? null,
            linkError: String(
              (linkServices.error as { message?: string })?.message ?? linkServices.error,
            ),
            deleteError: String(
              (rollback.error as { message?: string })?.message ?? rollback.error,
            ),
          },
        });
      }
      return await failBooking('UNEXPECTED');
    }

    // 036b — the booking is durable from here (appointment + links). A
    // failure in the tail (loyalty/audit/email/Slack) must NOT refund a
    // customer who holds a real appointment.
    refundOnThrow = null;

    // ── Decrement loyalty balance (Phase 50) ─────────────────────────
    // Best-effort: a balance-update failure shouldn't kill the booking
    // (the user got their appointment, that's what matters). We computed
    // `loyaltyCreditCents` from a fresh read above and subtract it from
    // the same value to avoid race conditions with a concurrent reward
    // grant by `awardLoyaltyOnCompletion` (which only ADDS to the
    // balance, never subtracts). Sentry breadcrumb on failure.
    if (loyaltyCreditCents > 0 && !clientIsNew) {
      try {
        const newBalance = Math.max(0, clientLoyaltyBalanceCents - loyaltyCreditCents);
        await supabase
          .from('clients')
          .update({ loyalty_balance_cents: newBalance })
          .eq('id', clientId);
      } catch (e) {
        captureException(e, { tags: { layer: 'public-booking', step: 'loyalty-debit' } });
      }
    }

    // ── Bump promo code redemption counter (Phase 41) ────────────────
    // Best-effort — a counter update failure shouldn't kill the booking
    // (the user got their appointment, that's what matters). We read
    // the current total_redemption_value once at validation time
    // (promoCodeRow above) and increment locally. Concurrent bookings
    // could undercount under heavy load — acceptable for a promo stat.
    if (promoCodeRow) {
      try {
        // Re-read the current total to avoid stomping a concurrent bump.
        const currentRes = await supabase
          .from('promo_codes')
          .select('redemptions, total_redemption_value')
          .eq('id', promoCodeRow.id)
          .single();
        const current = currentRes.data as {
          redemptions: number;
          total_redemption_value: number;
        } | null;
        if (current) {
          await supabase
            .from('promo_codes')
            .update({
              redemptions: current.redemptions + 1,
              total_redemption_value: Number(current.total_redemption_value ?? 0) + discountAmount,
            })
            .eq('id', promoCodeRow.id);
        }
      } catch {
        // Swallow — see comment above.
      }
    }

    await logDurableAudit({
      shopId: shop.id,
      actorId: '00000000-0000-0000-0000-000000000000', // public anon
      action: 'insert',
      entity: 'appointments',
      entityId: apptId,
      diff: {
        source: 'online',
        service_count: services.length,
        totalAmount,
        promoCode: promoCodeRow ? input.promo_code : undefined,
        discountAmount: discountAmount > 0 ? discountAmount : undefined,
        loyaltyCreditCents: loyaltyCreditCents > 0 ? loyaltyCreditCents : undefined,
        // Loop 24 — Loi 25 paper trail. Always true when the action
        // runs (the schema's `.refine` rejects false).
        loi25_consent: true,
      },
    });

    // Plan 018 — the barber's display_name was already fetched in the parallel
    // preamble above (widened select), so there's no late re-query here. For
    // the "any barber" path it's the picked barber's name; a null value falls
    // back to the email template / Slack helper's localized "first available"
    // string.
    const willSlack = Boolean(shop.slack_webhook_url);
    const professionalName: string | null = barberDisplayName;

    // ── Send branded confirmation email (Phase 24) ────────────────────
    // No-op when Resend env vars aren't set (lib/email/send.ts handles
    // that) or when the customer didn't leave an email. We deliberately
    // do NOT block on the send — a Resend outage shouldn't surface as a
    // booking error to the user. `sendEmail` catches its own errors and
    // routes them through Sentry.
    //
    // Type narrowing note: we check `input.email` directly (rather than
    // the `willEmail` boolean above) so TS narrows away the `undefined`
    // case for the `to:` field below.
    if (input.email) {
      const addressLine = [shop.street, shop.municipality, shop.province]
        .filter(Boolean)
        .join(', ');

      // Phase G SR — mint a /me self-service link so the customer can
      // cancel/reschedule directly instead of having to call the salon.
      // The token signs the client_id (kind='me'). Clients audit W5c — expiry
      // tightened from 365d to 90d: it's a bearer credential on a forwardable
      // email link granting PII read + self-cancel, so the window must be
      // bounded. When `clientId` is somehow missing we fall back to the
      // original "contact the salon" outro — the template handles meUrl=null.
      let meUrl: string | null = null;
      if (clientId) {
        // Plan 018 — `me_token_version` was captured in the client
        // lookup/insert above, so no extra read here.
        const meToken = signToken({
          kind: 'me',
          resourceId: clientId,
          expiresInSeconds: 60 * 60 * 24 * 90,
          ver: clientMeTokenVersion,
        });
        // Phase H — `appUrl()` centralizes the NEXT_PUBLIC_APP_URL read
        // and warns once to Sentry in production when missing (broken
        // /me links in customer emails).
        meUrl = `${appUrl()}/${input.locale}/me/${meToken}`;
      }

      // The dispatcher (Phase 25) handles three gates internally:
      //   - `notification_automations.enabled === false` → silent skip
      //   - shop has SMTP configured → ship from the salon's own domain
      //   - else Resend Küa-branded fallback (Phase 24 behavior)
      // Plan 018 — DEFER the send off the critical path via `waitUntil`: the
      // confirmation email (especially an SMTP transport at 0.5–2s) must not
      // delay the booking response. All template inputs are built above,
      // before the response, so there is no lazy closure over mutable state.
      // On Vercel's nodejs runtime `waitUntil` keeps the function alive until
      // the promise settles; off-Vercel (local/tests) it's a safe no-op and
      // the promise still runs. Its own rejection is caught → Sentry so a send
      // failure never surfaces as a booking error nor an unhandled rejection.
      waitUntil(
        sendEmail({
          shopId: shop.id,
          kind: 'booking_confirmation',
          to: input.email,
          subject:
            input.locale === 'fr'
              ? `Ton rendez-vous chez ${shop.name} est confirmé`
              : `Your appointment at ${shop.name} is confirmed`,
          template: AppointmentConfirmation({
            locale: input.locale,
            shop: {
              name: shop.name,
              addressLine: addressLine || null,
              phone: shop.phone,
              timezone: shop.timezone,
              // Phase 62b — per-shop email branding.
              emailLogoUrl: shop.email_logo_url,
              emailAccentColor: shop.email_accent_color,
            },
            client: { firstName: input.first_name },
            appointment: {
              startAt: startAt.toISOString(),
              services: services.map((s) => ({ name: s.name, durationMin: s.duration_min })),
              totalAmount,
              professionalName,
              // Phase G SR — surface the self-service link so the email's
              // outro becomes a "Manage my appointment" CTA. Null when
              // we couldn't mint a token (no client_id).
              meUrl,
            },
          }),
          tags: [
            { name: 'kind', value: 'booking_confirmation' },
            { name: 'shop', value: input.shop_slug },
          ],
        }).catch((e) =>
          captureException(e, {
            tags: { layer: 'public-booking', step: 'confirmation-email-deferred' },
          }),
        ),
      );
    }

    // ── Loop 33 (Phase 90) — owner Slack notification ──────────────
    // Fire-and-forget: a Slack outage MUST NOT block the customer's
    // booking response. The helper catches its own errors and routes
    // them through Sentry, so we don't even need a try/catch here —
    // but `void` makes the intent explicit. Skipped when no URL is
    // configured (shop opted out). `professionalName` was resolved
    // once above to avoid a duplicate barbers lookup.
    if (willSlack && shop.slack_webhook_url) {
      void sendSlackBookingNotification(shop.slack_webhook_url, {
        shopName: shop.name,
        clientName: `${input.first_name}${input.last_name ? ` ${input.last_name}` : ''}`,
        barberName: professionalName ?? 'First available',
        startAtIso: startAt.toISOString(),
        serviceNames: services.map((s) => s.name),
        totalAmount,
        source: 'online',
      });
    }

    return ok({ id: apptId });
  } catch (e) {
    captureException(e, { tags: { layer: 'public-booking' } });
    // 036b — same best-effort refund semantics as failBooking, for the
    // exception path failBooking can't reach. `refundOwnedIntentBestEffort`
    // only refunds a PI that provably belongs to THIS shop and actually
    // captured money, and a refund failure must not mask the UNEXPECTED
    // response (captured, then we still return).
    if (refundOnThrow) {
      try {
        const r = await refundOwnedIntentBestEffort({
          paymentIntentId: refundOnThrow.paymentIntentId,
          expectedConnectedAccountId: refundOnThrow.connectedAccountId,
        });
        if (!r.refunded && r.reason !== 'wrong_shop' && r.reason !== 'not_charged') {
          captureException(new Error(`[booking] refund-on-throw skipped: ${r.reason}`), {
            tags: { layer: 'public-booking', step: 'refund-on-throw' },
            extra: {
              shopId: refundOnThrow.shopId,
              paymentIntentId: refundOnThrow.paymentIntentId,
            },
          });
        }
      } catch (refundError) {
        captureException(refundError, {
          tags: { layer: 'public-booking', step: 'refund-on-throw' },
          extra: {
            shopId: refundOnThrow.shopId,
            paymentIntentId: refundOnThrow.paymentIntentId,
          },
        });
      }
    }
    return err('UNEXPECTED');
  }
}

function toMinutes(t: string): number {
  const [hh, mm] = t.split(':').map(Number);
  return (hh ?? 0) * 60 + (mm ?? 0);
}
function formatMinutes(m: number): string {
  const h = Math.floor((m % 1440) / 60);
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

// ── Phase 53 — public waitlist signup ──────────────────────────────────
// Anonymous visitors hit this when the booking wizard surfaces "no slots
// available in your window — join the waitlist?" Stored in
// `waiting_list_entries` for the admin to work manually. No notification
// flow yet (that's V1.1); admin sees the entries on
// /settings/waiting-list.

const waitlistEntrySchema = z.object({
  shop_slug: z.string().trim().min(1),
  first_name: z.string().trim().min(1).max(120),
  last_name: z
    .string()
    .trim()
    .max(120)
    .optional()
    .or(z.literal('').transform(() => '')),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .optional()
    .or(z.literal('').transform(() => '')),
  phone: z.string().trim().regex(phoneRegex),
  preferred_barber_id: z.string().uuid().nullable().optional(),
  service_ids: z.array(z.string().uuid()).optional().default([]),
  date_window_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  date_window_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .or(z.literal('').transform(() => '')),
  hp: z.string().max(0).optional(),
  locale: z.enum(['fr', 'en']).default('fr'),
});

export type WaitlistEntryInput = z.infer<typeof waitlistEntrySchema>;

export async function addToWaitlistPublic(
  raw: WaitlistEntryInput,
): Promise<Result<{ id: string }>> {
  try {
    // Rate limit by IP — waitlist abuse risk is low, but spam still
    // possible. Looser than booking (20 / 10 min vs 10).
    const ip = getClientIp();
    const rl = await checkRateLimit(`waitlist:${ip}`, {
      max: 20,
      windowMs: 10 * 60 * 1000,
    });
    if (!rl.allowed) return err('RATE_LIMITED');

    // Honeypot — silent fail on bot fill.
    if (raw.hp) return ok({ id: '00000000-0000-0000-0000-000000000000' });

    const parsed = waitlistEntrySchema.safeParse(raw);
    if (!parsed.success) return err('INVALID_INPUT');
    const input = parsed.data;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createSupabaseServiceRoleClient() as any;

    // Resolve shop by slug.
    const shopRes = await supabase.from('shops').select('id').eq('alias', input.shop_slug).limit(1);
    const shopId = ((shopRes.data as Array<{ id: string }> | null) ?? [])[0]?.id ?? null;
    if (!shopId) return err('NOT_FOUND');

    const insertRes = await supabase
      .from('waiting_list_entries')
      .insert({
        shop_id: shopId,
        first_name: input.first_name,
        last_name: input.last_name || null,
        email: input.email || null,
        phone: input.phone,
        preferred_barber_id: input.preferred_barber_id ?? null,
        service_ids: input.service_ids ?? [],
        date_window_start: input.date_window_start,
        date_window_end: input.date_window_end,
        notes: input.notes || null,
        locale: input.locale,
        status: 'waiting',
      })
      .select('id')
      .single();
    if (insertRes.error || !insertRes.data) return err('UNEXPECTED');

    const entryId = (insertRes.data as { id: string }).id;
    await logDurableAudit({
      shopId,
      actorId: '00000000-0000-0000-0000-000000000000',
      action: 'insert',
      entity: 'waiting_list_entries',
      entityId: entryId,
      diff: {
        source: 'online',
        service_count: input.service_ids?.length ?? 0,
        window: `${input.date_window_start}/${input.date_window_end}`,
      },
    });
    return ok({ id: entryId });
  } catch (e) {
    captureException(e, { tags: { layer: 'public-waitlist' } });
    return err('UNEXPECTED');
  }
}

// ── Phase 60 — Loyalty balance lookup ─────────────────────────────────
// Customer-facing surfacing of the auto-apply credit the server has
// computed since Phase 50. The wizard fires this on phone-input blur;
// if the response includes a non-zero balance the summary card shows
// "Loyalty credit applied: -$X.XX" so the customer knows the lower
// total isn't a mistake.
//
// Anti-enumeration: rate-limited (60/10min/IP — covers a typing user
// who pauses on each digit), no honeypot (the wizard fires this only
// when phone passes a minimal length gate). The action never returns
// whether a match was found — only the balance if it's > 0, otherwise 0.
// A scraper that POSTs random phone numbers can't tell "no match" from
// "match with zero balance".

const loyaltyLookupSchema = z.object({
  shop_slug: z.string().trim().min(1),
  phone: z.string().trim().regex(phoneRegex),
});

export type LoyaltyLookupInput = z.infer<typeof loyaltyLookupSchema>;

export async function lookupLoyaltyByPhone(
  raw: LoyaltyLookupInput,
): Promise<Result<{ balanceCents: number }>> {
  try {
    const ip = getClientIp();
    const rl = await checkRateLimit(`loyalty:${ip}`, {
      max: 60,
      windowMs: 10 * 60 * 1000,
    });
    if (!rl.allowed) return err('RATE_LIMITED');

    const parsed = loyaltyLookupSchema.safeParse(raw);
    if (!parsed.success) return err('INVALID_INPUT');
    const input = parsed.data;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createSupabaseServiceRoleClient() as any;

    const shopRes = await supabase.from('shops').select('id').eq('alias', input.shop_slug).limit(1);
    const shopId = ((shopRes.data as Array<{ id: string }> | null) ?? [])[0]?.id ?? null;
    if (!shopId) return err('NOT_FOUND');

    const phoneKey = normalizePhoneKey(input.phone);
    if (phoneKey.length < 7) return ok({ balanceCents: 0 });

    const clientRes = await supabase
      .from('clients')
      // Loop 35 — include `id` + `loyalty_balance_expires_at` so the
      // effective-balance helper can zero out expired credits in the
      // same call. The customer sees their fresh-zeroed balance the
      // next time they revisit the booking page.
      .select('id, loyalty_balance_cents, loyalty_balance_expires_at')
      .eq('shop_id', shopId)
      .eq('phone_normalized', phoneKey)
      .limit(1);
    const row =
      ((clientRes.data as Array<{
        id: string;
        loyalty_balance_cents: number | null;
        loyalty_balance_expires_at: string | null;
      }> | null) ?? [])[0] ?? null;
    if (!row) return ok({ balanceCents: 0 });
    const effective = await effectiveLoyaltyBalanceCents({
      clientId: row.id,
      balanceCents: row.loyalty_balance_cents ?? 0,
      expiresAt: row.loyalty_balance_expires_at,
    });
    return ok({ balanceCents: Math.max(0, effective) });
  } catch (e) {
    captureException(e, { tags: { layer: 'loyalty-lookup' } });
    return err('UNEXPECTED');
  }
}

// ── Phase 56 — Stripe Elements deposit collection ──────────────────────
// Called by the booking wizard when step 4 mounts AND the selected
// services aggregate a non-zero deposit AND the shop has Stripe Connect
// active. Creates a PaymentIntent (no appointment yet) and returns the
// client_secret so PaymentElement can render. The appointment is created
// later by `bookPublicAppointment` with `payment_intent_id` set.
//
// Why not create the appointment first: if the user abandons after the
// PI is created but before confirming payment, no ghost appointment is
// left behind. Stripe PaymentIntents in `requires_payment_method` state
// expire on their own (24h default) and don't charge anything.

const bookingPaymentIntentSchema = z.object({
  shop_slug: z.string().trim().min(1),
  service_ids: z.array(z.string().uuid()).min(1),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .optional()
    .or(z.literal('').transform(() => '')),
  /**
   * Phase A SR — the wizard can pass an existing PaymentIntent ID
   * from a previous call in the same session. If amount + fee are
   * unchanged and the PI is still pre-confirmation, we reuse it
   * (saves an API call on cosmetic re-renders). Any other case
   * creates a fresh PI — see `getReusableDepositPaymentIntent`
   * for why mutating amount was unsafe.
   */
  existing_payment_intent_id: z
    .string()
    .regex(/^pi_[A-Za-z0-9_]{8,255}$/)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /**
   * Phase D.3 — promo code in flight on the booking step. Only used
   * when `shop.payment_mode === 'full'`: the PI amount is reduced
   * by the validated discount so the customer doesn't overpay. In
   * 'deposit' mode the deposit is independent of the promo (the
   * promo applies to the in-shop balance). Invalid codes silently
   * fall back to no-discount here — the user gets the field-error
   * surfaced at booking submit by `bookPublicAppointment`.
   */
  promo_code: z
    .string()
    .trim()
    .toUpperCase()
    .max(40)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /**
   * Phase D.3 — phone for server-side loyalty balance lookup. Same
   * normalized digits as the wizard's lookup action. Only consumed
   * in 'full' mode for the same reason as `promo_code` above.
   */
  phone: z
    .string()
    .trim()
    .regex(phoneRegex)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /**
   * Phase E — in-widget tip in cents. Added to the PI amount on top
   * of whatever the payment_mode charges (full price or deposit).
   * Re-fires the intent on change (debounced) so the customer sees
   * the new total in Stripe Elements before confirming. The booking
   * action recomputes the same tip in the verify step.
   */
  tip_amount_cents: z.number().int().min(0).max(100_000).optional().default(0),
});

export type CreateBookingPaymentIntentInput = z.infer<typeof bookingPaymentIntentSchema>;

export type BookingPaymentIntentResult =
  | { kind: 'no_deposit' }
  | {
      kind: 'intent';
      clientSecret: string;
      paymentIntentId: string;
      depositCents: number;
      // Phase D — `paymentMode` tells the wizard whether the amount
      // shown is the full service price ('full') or a partial deposit
      // with the rest collected in-shop ('deposit'). The wizard
      // uses this to pick the right label/hint copy. 'none' never
      // reaches this branch (returns 'no_deposit' above).
      paymentMode: 'full' | 'deposit';
    }
  | { kind: 'shop_not_connected' };

export async function createBookingPaymentIntent(
  raw: CreateBookingPaymentIntentInput,
): Promise<Result<BookingPaymentIntentResult>> {
  try {
    // Rate limit — the wizard creates ONE intent per session step-4
    // mount, so a strict cap is fine. 30/10min is loose enough for
    // legitimate retries (back+forward navigation) and tight enough
    // to throttle abuse (Stripe charges us per intent).
    const ip = getClientIp();
    const rl = await checkRateLimit(`bookpay:${ip}`, {
      max: 30,
      windowMs: 10 * 60 * 1000,
    });
    if (!rl.allowed) return err('RATE_LIMITED');

    const parsed = bookingPaymentIntentSchema.safeParse(raw);
    if (!parsed.success) return err('INVALID_INPUT');
    const input = parsed.data;

    if (!stripeConfigured()) {
      // Server-side Stripe isn't set up — wizard treats this as
      // pay-at-shop. Same UX as a shop with no Connect onboarding.
      return ok({ kind: 'no_deposit' as const });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createSupabaseServiceRoleClient() as any;

    // Resolve shop + Stripe Connect status + Phase D payment_mode.
    const shopRes = await supabase
      .from('shops')
      .select('id, stripe_account_id, stripe_connect_status, payment_mode')
      .eq('alias', input.shop_slug)
      .limit(1);
    const shop =
      ((shopRes.data as Array<{
        id: string;
        stripe_account_id: string | null;
        stripe_connect_status: string;
        payment_mode: 'full' | 'deposit' | 'none';
      }> | null) ?? [])[0] ?? null;
    if (!shop) return err('NOT_FOUND');

    // Phase D — shop chose to collect everything in-shop. Skip the
    // PaymentElement step entirely regardless of per-service deposit
    // amounts. Same UX as a shop with 0 deposits on every service.
    if (shop.payment_mode === 'none') {
      return ok({ kind: 'no_deposit' as const });
    }

    // Shop must be fully onboarded — Stripe rejects charges to non-active
    // accounts with a 400, so we'd rather catch it here with a clear
    // signal the UI can branch on.
    if (!shop.stripe_account_id || shop.stripe_connect_status !== 'active') {
      return ok({ kind: 'shop_not_connected' as const });
    }

    // Resolve services + compute the charge amount based on payment_mode.
    //
    // Phase D — `price` is now in the SELECT alongside the deposit so we
    // can compute the right amount for `mode='full'`. Both columns are
    // already cents-based per the migration history (no decimal math).
    const svcsRes = await supabase
      .from('services')
      .select('id, price, deposit_amount_cents, status')
      .eq('shop_id', shop.id)
      .in('id', input.service_ids);
    const svcs =
      (svcsRes.data as Array<{
        id: string;
        // `services.price` is stored in DOLLARS (numeric column). We
        // multiply by 100 to compare against deposit_amount_cents
        // (which is integer cents). Confirmed by the rest of the
        // codebase (`price_snapshot` columns also store dollars).
        price: number;
        deposit_amount_cents: number | null;
        status: 'enabled' | 'disabled';
      }> | null) ?? [];
    if (svcs.length !== input.service_ids.length || svcs.some((s) => s.status !== 'enabled')) {
      return err('NOT_FOUND');
    }
    // Phase D — split paths per `payment_mode`:
    //   - 'full'    : charge the entire service price upfront (minus
    //                 discounts).
    //   - 'deposit' : charge per-service `deposit_amount_cents` — the
    //                 historical V1 behavior; discounts apply to the
    //                 in-shop BALANCE, not the deposit.
    //
    // Plan 014 — the charge ARITHMETIC (subtotal → promo → loyalty cap →
    // tip → round) now lives in the shared pricing engine so
    // this MINT side and the VERIFY side in `bookPublicAppointment` can't
    // drift: a one-cent divergence rejects a legitimate PI with
    // `wrong_amount`, i.e. a full public-booking outage. We keep the POLICY
    // here: promo eligibility (expiry / one-time, silent-degrade of an
    // invalid promo to no-discount) and the loyalty fetch — including its
    // `effectiveLoyaltyBalanceCents` expiry-zeroing side effect, gated on a
    // positive post-promo total exactly as before.
    let resolvedPromo: { type: 'percent' | 'fixed'; value: number } | null = null;
    let loyaltyBalanceCents = 0;
    if (shop.payment_mode === 'full') {
      // We validate promo READ-ONLY (no redemption bump — that happens in
      // `bookPublicAppointment` after a successful insert). Invalid /
      // expired / one-time-used promos degrade silently to no-discount here;
      // the booking action surfaces a field-error at submit so the wizard
      // can flag the input.
      if (input.promo_code) {
        const promoRes = await supabase
          .from('promo_codes')
          .select('type, value, expiration_date, one_time, redemptions')
          .eq('shop_id', shop.id)
          .eq('code', input.promo_code)
          .limit(1);
        const promo = ((promoRes.data as Array<{
          type: 'percent' | 'fixed';
          value: number;
          expiration_date: string | null;
          one_time: boolean;
          redemptions: number;
        }> | null) ?? [])[0];
        if (
          promo &&
          (!promo.expiration_date || new Date(promo.expiration_date).getTime() >= Date.now()) &&
          !(promo.one_time && promo.redemptions > 0)
        ) {
          resolvedPromo = { type: promo.type, value: promo.value };
        }
      }
      // Loyalty fetch — gated on a positive POST-PROMO total exactly as
      // before, so the `effectiveLoyaltyBalanceCents` expiry-zeroing side
      // effect fires under the same condition. This subtotal/discount is the
      // FETCH GUARD only; the engine recomputes the authoritative charge
      // (and re-applies the cents-based loyalty cap) below.
      const subtotalDollars = svcs.reduce((sum, s) => sum + Number(s.price ?? 0), 0);
      const discountForGuard = resolvedPromo
        ? Math.min(
            resolvedPromo.type === 'percent'
              ? (subtotalDollars * resolvedPromo.value) / 100
              : resolvedPromo.value,
            subtotalDollars,
          )
        : 0;
      const postPromoTotal = subtotalDollars - discountForGuard;
      if (input.phone && postPromoTotal > 0) {
        // Match phone_normalized (last-10 NANP via normalizePhoneKey), the same
        // canonicalization the booking write uses — an 11-digit number with
        // country code must map to the same key or its loyalty credit goes
        // missing from the pre-charge preview while the real charge applies it.
        const phoneKey = normalizePhoneKey(input.phone);
        if (phoneKey.length >= 7) {
          const clientRes = await supabase
            .from('clients')
            .select('id, loyalty_balance_cents, loyalty_balance_expires_at')
            .eq('shop_id', shop.id)
            .eq('phone_normalized', phoneKey)
            .limit(1);
          const row =
            ((clientRes.data as Array<{
              id: string;
              loyalty_balance_cents: number | null;
              loyalty_balance_expires_at: string | null;
            }> | null) ?? [])[0] ?? null;
          if (row) {
            loyaltyBalanceCents = await effectiveLoyaltyBalanceCents({
              clientId: row.id,
              balanceCents: row.loyalty_balance_cents ?? 0,
              expiresAt: row.loyalty_balance_expires_at,
            });
          }
        }
      }
    }

    // Single source of truth for the charge — mirrors the verify side. Tip
    // stacks on top of the per-mode base inside the engine (clamped 0..$1,000).
    const pricing = computeBookingPricing({
      paymentMode: shop.payment_mode,
      services: svcs,
      promo: resolvedPromo,
      loyaltyBalanceCents,
      tipAmountCents: input.tip_amount_cents,
    });
    const depositCents = pricing.chargeCents;

    if (depositCents <= 0) {
      // 'full' mode: every service was free OR discounts covered the
      // entire price AND no tip. 'deposit' mode: no service has a
      // deposit set AND no tip. Either way the widget skips
      // PaymentElement.
      return ok({ kind: 'no_deposit' as const });
    }

    // Phase A SR-of-SR — if the wizard passed an existing PI from a
    // previous call in the same session, try to REUSE it (no API
    // mutation). Reuse is allowed only when amount + fee are exactly
    // unchanged AND the PI is still pre-confirmation; any other case
    // falls back to creating a new PI.
    //
    // The amount-change case is intentionally a CREATE-not-update:
    // mutating an existing PI's amount client-side led to a race
    // where Stripe Elements still showed the old amount while the
    // server had the new one — customer could click Confirm
    // believing they were paying $50 and get charged $40 (or vice
    // versa). Forcing a fresh PI on amount change re-mounts
    // Elements with the authoritative value.
    let intent: Awaited<ReturnType<typeof createDepositPaymentIntent>> | null = null;
    if (input.existing_payment_intent_id) {
      intent = await getReusableDepositPaymentIntent({
        paymentIntentId: input.existing_payment_intent_id,
        connectedAccountId: shop.stripe_account_id,
        amountCents: depositCents,
      });
    }

    if (!intent) {
      // No existing PI to reuse, or the existing one is no longer
      // updatable → mint a fresh one. A session UUID stands in as
      // the "appointment_id" for the PaymentIntent metadata +
      // idempotency key. The actual appointment gets created later
      // by `bookPublicAppointment` with this PI ID attached — the
      // webhook still finds the row via
      // `appointments.payment_intent_id`, regardless of what's in
      // metadata.
      const sessionId = randomUUID();
      intent = await createDepositPaymentIntent({
        connectedAccountId: shop.stripe_account_id,
        appointmentId: sessionId,
        amountCents: depositCents,
        customerEmail: input.email || undefined,
      });
    }

    if (!intent.client_secret) {
      // Should never happen on a fresh intent, but the type allows null.
      return err('UNEXPECTED');
    }

    return ok({
      kind: 'intent' as const,
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
      depositCents,
      // Phase D — surface the mode so the wizard can pick the right
      // label ("Acompte" vs "Total à régler") and hint copy. Cast
      // narrows 'none' away — the early return above handles that
      // case before we ever reach here.
      paymentMode: shop.payment_mode as 'full' | 'deposit',
    });
  } catch (e) {
    captureException(e, { tags: { layer: 'booking-payment-intent' } });
    return err('UNEXPECTED');
  }
}
