/**
 * Loop 42 (Phase 122 from AUDIT_PHASE70) — Waitlist auto-notify.
 *
 * When an appointment is cancelled, find any `waiting` entries whose
 * preferences match the freed slot and send them an email. The
 * customer-facing UX is "your dream slot just opened up — book now
 * before it's taken again."
 *
 * Match rules (V1):
 *   - same shop_id
 *   - entry.date_window covers the cancelled slot's date (shop-local)
 *   - entry.preferred_barber_id matches the freed barber OR is null
 *     ("any barber" preference)
 *   - service_ids NOT enforced — entries with mismatched services
 *     still get notified because in practice customers are flexible
 *     about secondary services. A future loop can tighten this once
 *     we have telemetry on false-positive rates.
 *
 * Dedup: skip entries that were `notified` within the last 24h. The
 * goal is to avoid spamming the customer on a "bulk cancel day"
 * where 3 of their preferred slots open at once.
 *
 * Best-effort: a Resend / SMTP outage doesn't block the cancel. The
 * helper catches its own errors and routes them through Sentry.
 */

import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { appUrl } from '@/lib/env/app-url';
import { captureException } from '@/lib/observability';
import { sendEmail } from '@/lib/email/send';
import { WaitlistSlotOpen } from '@/lib/email/templates/waitlist-slot-open';
import { shopIsoDate } from '@/lib/business/timezone';

type FreedSlot = {
  shopId: string;
  barberId: string;
  /** UTC instant of the cancelled appointment's start. */
  startAtIso: string;
  /** Shop tz so we can compute the shop-local date for window matching. */
  timezone: string;
};

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function notifyMatchingWaitlistOnCancel(slot: FreedSlot): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createSupabaseServiceRoleClient() as any;

    // Shop-local date of the freed slot — the entry's date_window is
    // stored as DATE (no time component), so we compare against the
    // shop-local YYYY-MM-DD rather than UTC.
    const slotDate = shopIsoDate(new Date(slot.startAtIso), slot.timezone);

    // Resolve shop + barber metadata + locale/contact for the email
    // template AND match-time filtering. One round-trip rather than N
    // per matched entry.
    const [shopRes, barberRes] = await Promise.all([
      admin
        .from('shops')
        .select('id, name, alias, timezone, phone, email_logo_url, email_accent_color')
        .eq('id', slot.shopId)
        .single(),
      admin.from('barbers').select('id, display_name').eq('id', slot.barberId).single(),
    ]);
    const shop = shopRes.data as {
      id: string;
      name: string;
      alias: string | null;
      timezone: string;
      phone: string | null;
      email_logo_url: string | null;
      email_accent_color: string | null;
    } | null;
    const barber = barberRes.data as { id: string; display_name: string } | null;
    if (!shop || !barber) return;

    // Find candidate entries: same shop, status='waiting', date window
    // contains slotDate, preferred_barber_id is null or matches. We
    // run the barber filter in SQL with an OR clause.
    const entriesRes = await admin
      .from('waiting_list_entries')
      .select(
        'id, first_name, email, phone, locale, preferred_barber_id, date_window_start, date_window_end, notified_at',
      )
      .eq('shop_id', slot.shopId)
      .eq('status', 'waiting')
      .lte('date_window_start', slotDate)
      .gte('date_window_end', slotDate)
      .or(`preferred_barber_id.is.null,preferred_barber_id.eq.${slot.barberId}`);
    const entries =
      (entriesRes.data as Array<{
        id: string;
        first_name: string;
        email: string | null;
        phone: string;
        locale: 'fr' | 'en';
        preferred_barber_id: string | null;
        date_window_start: string;
        date_window_end: string;
        notified_at: string | null;
      }> | null) ?? [];

    const now = Date.now();
    for (const entry of entries) {
      // Skip silently if no email — V1 can't SMS so the entry is just
      // a manual-followup record for the owner.
      if (!entry.email) continue;

      // Dedup: a recent `notified_at` means we already pinged them
      // about another slot in the last 24h. Skip to keep the inbox
      // sane.
      if (entry.notified_at) {
        const lastMs = new Date(entry.notified_at).getTime();
        if (now - lastMs < DEDUP_WINDOW_MS) continue;
      }

      const bookingUrl = shop.alias
        ? `${appUrl()}/${entry.locale}/book/${shop.alias}`
        : null;

      // Fire-and-forget per entry — sendEmail catches its own errors
      // via Sentry, and we don't want one bad address to block the
      // rest. Awaiting sequentially is fine because notifyMatching…
      // is itself called via `void` from the cancel action.
      await sendEmail({
        shopId: slot.shopId,
        kind: 'waitlist_open',
        to: entry.email,
        subject:
          entry.locale === 'fr'
            ? `Une place vient d'ouvrir chez ${shop.name}`
            : `A slot just opened up at ${shop.name}`,
        template: WaitlistSlotOpen({
          locale: entry.locale,
          shop: {
            name: shop.name,
            phone: shop.phone,
            timezone: shop.timezone,
            emailLogoUrl: shop.email_logo_url,
            emailAccentColor: shop.email_accent_color,
          },
          entry: {
            firstName: entry.first_name,
          },
          slot: {
            startAtIso: slot.startAtIso,
            barberDisplayName: barber.display_name,
          },
          bookingUrl,
        }),
        tags: [
          { name: 'kind', value: 'waitlist_open' },
          { name: 'shop', value: slot.shopId },
        ],
      });

      // Mark notified — even if the SMTP send fails internally, we
      // don't want to retry forever. The `notified_at` lets the owner
      // see in the UI that a notification attempt was made.
      await admin
        .from('waiting_list_entries')
        .update({ status: 'notified', notified_at: new Date().toISOString() })
        .eq('id', entry.id);
    }
  } catch (e) {
    captureException(e, {
      tags: { layer: 'waitlist', stage: 'notify-on-cancel' },
      extra: { shopId: slot.shopId, barberId: slot.barberId, startAt: slot.startAtIso },
    });
  }
}
