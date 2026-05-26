'use server';

import { randomUUID } from 'node:crypto';
import { headers } from 'next/headers';
import { z } from 'zod';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { err, ok, type Result } from '@/lib/server-actions/result';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import { captureException } from '@/lib/observability';
import { logAuditAction } from '@/lib/audit-log';
import { combineShopDateTime, shopDayStart, shopDayEnd } from '@/lib/business/timezone';
import { checkAvailability, type ExistingAppointment } from '@/lib/business/availability';
import { sendEmail } from '@/lib/email/send';
import { AppointmentConfirmation } from '@/lib/email/templates/appointment-confirmation';
import { verifyTurnstile } from '@/lib/security/turnstile';
import { stripeConfigured } from '@/lib/stripe/server';
import { createDepositPaymentIntent } from '@/lib/stripe/payments';

const phoneRegex = /^[+\d\s().-]{7,20}$/;

export const publicBookingSchema = z.object({
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
  payment_intent_id: z
    .string()
    .trim()
    .max(120)
    .regex(/^pi_/, 'INVALID_PAYMENT_INTENT')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /** Deposit amount in cents that the PI was created for (Phase 56). */
  deposit_amount_cents: z.number().int().min(0).optional(),
  /**
   * Loop 24 — Quebec Loi 25 affirmative consent flag. Must be true.
   * The wizard gates Confirm on the checkbox; the action re-enforces
   * server-side so a hand-crafted POST can't bypass.
   */
  consent_loi25: z.boolean().refine((v) => v === true, { message: 'CONSENT_REQUIRED' }),
});
export type PublicBookingInput = z.infer<typeof publicBookingSchema>;

function clientIp(): string {
  const h = headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? 'unknown';
}

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
  const ip = clientIp();
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

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createSupabaseServiceRoleClient() as any;

    // ── Resolve shop ──────────────────────────────────────────────────
    // We also pull the contact fields here so the Phase 24 confirmation
    // email at the bottom can show address + phone without a second
    // round-trip.
    const shopRes = await supabase
      .from('shops')
      .select(
        'id, name, timezone, allow_booking_any_barber, street, municipality, province, phone, email_logo_url, email_accent_color',
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
    }> | null) ?? [])[0];
    if (!shop) return err('NOT_FOUND');

    // ── Resolve services ──────────────────────────────────────────────
    // `name` added in Phase 24 so the confirmation email can list services
    // by name. Cheap — same query, one extra column.
    const servicesRes = await supabase
      .from('services')
      .select('id, name, duration_min, price, status')
      .eq('shop_id', shop.id)
      .in('id', input.service_ids);
    const services =
      (servicesRes.data as Array<{
        id: string;
        name: string;
        duration_min: number;
        price: number;
        status: 'enabled' | 'disabled';
      }> | null) ?? [];
    if (
      services.length !== input.service_ids.length ||
      services.some((s) => s.status !== 'enabled')
    ) {
      return err('NOT_FOUND');
    }
    const totalMinutes = services.reduce((sum, s) => sum + s.duration_min, 0);
    const subtotal = services.reduce((sum, s) => sum + s.price, 0);

    // ── Promo code validation (Phase 41) ──────────────────────────────
    // Validate first; if invalid, refuse the booking with a specific
    // error code so the UI can highlight the field. Then apply the
    // discount to compute the final total. Redemption bump happens
    // AFTER appointment insert succeeds — keep DB writes ordered to
    // avoid a refund-style cleanup if the booking fails downstream.
    type PromoCodeRow = {
      id: string;
      type: 'percent' | 'fixed';
      value: number;
      first_appointment_only: boolean;
      one_time: boolean;
      expiration_date: string | null;
      redemptions: number;
    };
    let promoCodeRow: PromoCodeRow | null = null;
    let discountAmount = 0;
    if (input.promo_code) {
      const promoRes = await supabase
        .from('promo_codes')
        .select('id, type, value, first_appointment_only, one_time, expiration_date, redemptions')
        .eq('shop_id', shop.id)
        .eq('code', input.promo_code)
        .limit(1);
      promoCodeRow = ((promoRes.data as PromoCodeRow[] | null) ?? [])[0] ?? null;
      if (!promoCodeRow) {
        return err('INVALID_INPUT', { promo_code: 'invalid' });
      }
      // Expired?
      if (
        promoCodeRow.expiration_date &&
        new Date(promoCodeRow.expiration_date).getTime() < Date.now()
      ) {
        return err('INVALID_INPUT', { promo_code: 'expired' });
      }
      // One-time and already used?
      if (promoCodeRow.one_time && promoCodeRow.redemptions > 0) {
        return err('INVALID_INPUT', { promo_code: 'used' });
      }
      // First-appointment only: this requires looking up the client's
      // history, but for a public booking we don't have a stable client
      // identity until find-or-create runs below. We defer this check
      // until after the client is resolved — see below.

      // Compute discount.
      if (promoCodeRow.type === 'percent') {
        discountAmount = (subtotal * promoCodeRow.value) / 100;
      } else {
        discountAmount = promoCodeRow.value;
      }
      // Cap at subtotal — promo codes can't drive an appointment negative.
      if (discountAmount > subtotal) discountAmount = subtotal;
    }
    // `totalAmount` is mutable because the loyalty deduction (Phase 50)
    // happens AFTER the find-or-create client lookup below. The promo
    // discount is computed here; loyalty stacks on top of it. Both are
    // capped at the running total — neither can drive a booking negative.
    let totalAmount = subtotal - discountAmount;
    let loyaltyCreditCents = 0;

    // ── Resolve barber ────────────────────────────────────────────────
    let barberId = input.barber_id;
    if (!barberId) {
      if (!shop.allow_booking_any_barber) return err('INVALID_INPUT');
      const anyBarberRes = await supabase
        .from('barbers')
        .select('id, sort_order')
        .eq('shop_id', shop.id)
        .eq('status', 'confirmed')
        .order('sort_order', { ascending: true })
        .limit(1);
      barberId = (anyBarberRes.data as Array<{ id: string }> | null)?.[0]?.id ?? null;
      if (!barberId) return err('NOT_FOUND');
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
          'scope, barber_id, client_booking_interval_min, days_book_in_advance, mins_book_before_appt',
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
        client_booking_interval_min: number;
        days_book_in_advance: number;
        mins_book_before_appt: number;
      }> | null) ?? [];
    const barberOverride = settingsRows.find(
      (r) => r.scope === 'barber' && r.barber_id === barberId,
    );
    const shopDefault = settingsRows.find((r) => r.scope === 'shop');
    const settings = barberOverride ?? shopDefault ?? null;

    const shopWeekday = new Date(`${input.date}T00:00:00`).getDay();
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
      settings: settings
        ? {
            client_booking_interval_min: settings.client_booking_interval_min,
            days_book_in_advance: settings.days_book_in_advance,
            mins_book_before_appt: settings.mins_book_before_appt,
          }
        : null,
    });
    if (!verdict.ok) {
      return err(
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
    const phoneKey = input.phone.replace(/\D/g, '');
    let clientId: string | null = null;
    let clientLoyaltyBalanceCents = 0;
    let clientIsNew = false;
    if (phoneKey.length >= 7) {
      const clientLookup = await supabase
        .from('clients')
        .select('id, loyalty_balance_cents')
        .eq('shop_id', shop.id)
        .ilike('phone', `%${phoneKey}%`)
        .limit(1);
      const existingClient =
        ((clientLookup.data as Array<{
          id: string;
          loyalty_balance_cents: number | null;
        }> | null) ?? [])[0] ?? null;
      clientId = existingClient?.id ?? null;
      clientLoyaltyBalanceCents = existingClient?.loyalty_balance_cents ?? 0;
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
        .select('id')
        .single();
      if (insertClient.error || !insertClient.data) return err('UNEXPECTED');
      clientId = (insertClient.data as { id: string }).id;
    }

    // ── Loyalty credit auto-apply (Phase 50) ─────────────────────────
    // Applied AFTER promo so the customer gets full mileage out of both
    // incentives. Capped at the running totalAmount (in cents to avoid
    // float drift) so a generous balance can zero the bill but never
    // go negative. The DB column has a CHECK (>= 0) so this is doubly
    // protected.
    if (clientLoyaltyBalanceCents > 0 && totalAmount > 0) {
      const runningCents = Math.round(totalAmount * 100);
      loyaltyCreditCents = Math.min(clientLoyaltyBalanceCents, runningCents);
      totalAmount = Math.max(0, totalAmount - loyaltyCreditCents / 100);
    }

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
        return err('INVALID_INPUT', { promo_code: 'first_only' });
      }
    }

    // ── Insert appointment ───────────────────────────────────────────
    // Phase 56 — if a PaymentIntent was collected client-side, persist
    // its ID + the deposit amount. payment_status starts as 'pending'
    // and gets moved to 'paid' by the webhook handler on
    // payment_intent.succeeded.
    const paymentFields = input.payment_intent_id
      ? {
          payment_intent_id: input.payment_intent_id,
          payment_status: 'pending' as const,
          deposit_amount_cents: input.deposit_amount_cents ?? 0,
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
      if (e?.code === '23505') return err('CONFLICT');
      return err('UNEXPECTED');
    }
    const apptId = (insertAppt.data as { id: string }).id;

    // Link services.
    await supabase.from('appointment_services').insert(
      services.map((s) => ({
        appointment_id: apptId,
        service_id: s.id,
        price_snapshot: s.price,
      })),
    );

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

    await logAuditAction({
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

    // ── Send branded confirmation email (Phase 24) ────────────────────
    // No-op when Resend env vars aren't set (lib/email/send.ts handles
    // that) or when the customer didn't leave an email. We deliberately
    // do NOT block on the send — a Resend outage shouldn't surface as a
    // booking error to the user. `sendEmail` catches its own errors and
    // routes them through Sentry.
    if (input.email) {
      // Look up the barber's display name only when a specific one was
      // picked. For the "any barber" path we leave the field null and the
      // template falls back to its localized "first available" string.
      let professionalName: string | null = null;
      if (barberId) {
        const barberRes = await supabase
          .from('barbers')
          .select('display_name')
          .eq('id', barberId)
          .limit(1);
        professionalName =
          ((barberRes.data as Array<{ display_name: string }> | null) ?? [])[0]?.display_name ??
          null;
      }

      const addressLine = [shop.street, shop.municipality, shop.province]
        .filter(Boolean)
        .join(', ');

      // The dispatcher (Phase 25) handles three gates internally:
      //   - `notification_automations.enabled === false` → silent skip
      //   - shop has SMTP configured → ship from the salon's own domain
      //   - else Resend Küa-branded fallback (Phase 24 behavior)
      // We await so the action's tail latency reflects the send (Sentry
      // tracing) but never block the booking on it.
      await sendEmail({
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
          },
        }),
        tags: [
          { name: 'kind', value: 'booking_confirmation' },
          { name: 'shop', value: input.shop_slug },
        ],
      });
    }

    return ok({ id: apptId });
  } catch (e) {
    captureException(e, { tags: { layer: 'public-booking' } });
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
    const ip = clientIp();
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
    await logAuditAction({
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
    const ip = clientIp();
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

    const phoneKey = input.phone.replace(/\D/g, '');
    if (phoneKey.length < 7) return ok({ balanceCents: 0 });

    const clientRes = await supabase
      .from('clients')
      .select('loyalty_balance_cents')
      .eq('shop_id', shopId)
      .ilike('phone', `%${phoneKey}%`)
      .limit(1);
    const row =
      ((clientRes.data as Array<{ loyalty_balance_cents: number | null }> | null) ?? [])[0] ?? null;
    return ok({ balanceCents: Math.max(0, row?.loyalty_balance_cents ?? 0) });
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
});

export type CreateBookingPaymentIntentInput = z.infer<typeof bookingPaymentIntentSchema>;

export type BookingPaymentIntentResult =
  | { kind: 'no_deposit' }
  | {
      kind: 'intent';
      clientSecret: string;
      paymentIntentId: string;
      depositCents: number;
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
    const ip = clientIp();
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

    // Resolve shop + Stripe Connect status.
    const shopRes = await supabase
      .from('shops')
      .select('id, stripe_account_id, stripe_connect_status')
      .eq('alias', input.shop_slug)
      .limit(1);
    const shop =
      ((shopRes.data as Array<{
        id: string;
        stripe_account_id: string | null;
        stripe_connect_status: string;
      }> | null) ?? [])[0] ?? null;
    if (!shop) return err('NOT_FOUND');

    // Shop must be fully onboarded — Stripe rejects charges to non-active
    // accounts with a 400, so we'd rather catch it here with a clear
    // signal the UI can branch on.
    if (!shop.stripe_account_id || shop.stripe_connect_status !== 'active') {
      return ok({ kind: 'shop_not_connected' as const });
    }

    // Resolve services + sum the deposit cents. Services with a 0
    // deposit_amount_cents (the default) contribute nothing; if every
    // service is 0 we tell the wizard there's no deposit and it skips
    // PaymentElement entirely.
    const svcsRes = await supabase
      .from('services')
      .select('id, deposit_amount_cents, status')
      .eq('shop_id', shop.id)
      .in('id', input.service_ids);
    const svcs =
      (svcsRes.data as Array<{
        id: string;
        deposit_amount_cents: number | null;
        status: 'enabled' | 'disabled';
      }> | null) ?? [];
    if (svcs.length !== input.service_ids.length || svcs.some((s) => s.status !== 'enabled')) {
      return err('NOT_FOUND');
    }
    const depositCents = svcs.reduce((sum, s) => sum + Number(s.deposit_amount_cents ?? 0), 0);
    if (depositCents <= 0) {
      return ok({ kind: 'no_deposit' as const });
    }

    // A session UUID stands in as the "appointment_id" for the
    // PaymentIntent metadata + idempotency key. The actual appointment
    // gets created later by `bookPublicAppointment` with this PI ID
    // attached — the webhook still finds the row via
    // `appointments.payment_intent_id`, regardless of what's in metadata.
    const sessionId = randomUUID();

    const intent = await createDepositPaymentIntent({
      connectedAccountId: shop.stripe_account_id,
      appointmentId: sessionId,
      amountCents: depositCents,
      customerEmail: input.email || undefined,
    });

    if (!intent.client_secret) {
      // Should never happen on a fresh intent, but the type allows null.
      return err('UNEXPECTED');
    }

    return ok({
      kind: 'intent' as const,
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
      depositCents,
    });
  } catch (e) {
    captureException(e, { tags: { layer: 'booking-payment-intent' } });
    return err('UNEXPECTED');
  }
}
