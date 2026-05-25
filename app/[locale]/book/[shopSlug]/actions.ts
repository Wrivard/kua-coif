'use server';

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
      .select('id, name, timezone, allow_booking_any_barber, street, municipality, province, phone')
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
    const totalAmount = subtotal - discountAmount;

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
    const phoneKey = input.phone.replace(/\D/g, '');
    let clientId: string | null = null;
    let clientIsNew = false;
    if (phoneKey.length >= 7) {
      const clientLookup = await supabase
        .from('clients')
        .select('id')
        .eq('shop_id', shop.id)
        .ilike('phone', `%${phoneKey}%`)
        .limit(1);
      clientId = ((clientLookup.data as Array<{ id: string }> | null) ?? [])[0]?.id ?? null;
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
    const insertAppt = await supabase
      .from('appointments')
      .insert({
        shop_id: shop.id,
        barber_id: barberId,
        client_id: clientId,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        status: 'booked',
        source: 'online',
        notes: input.notes || null,
        total_amount: totalAmount,
      })
      .select('id')
      .single();
    if (insertAppt.error || !insertAppt.data) return err('UNEXPECTED');
    const apptId = (insertAppt.data as { id: string }).id;

    // Link services.
    await supabase.from('appointment_services').insert(
      services.map((s) => ({
        appointment_id: apptId,
        service_id: s.id,
        price_snapshot: s.price,
      })),
    );

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
