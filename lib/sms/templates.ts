/**
 * Loop 54 (P100 slice 2) — SMS body templates.
 *
 * SMS is plain text; no HTML, no images, no markup. We aim for
 * <140 chars so a single message ($0.0079 in Canada) covers it.
 * The 7-bit GSM alphabet doesn't include é, à, ç etc., so a French
 * message with accents auto-promotes to UCS-2 which caps at 70
 * chars per segment. We accept the multi-segment cost rather than
 * stripping diacritics — looks unprofessional to send "Rappel:
 * rendez-vous a 14h" to a Quebec customer.
 *
 * Templates are pure (locale + shop info + appointment time → string).
 * Easy to unit-test, easy to A/B in the future.
 */

import { formatShopTime } from '@/lib/business/timezone';

type ReminderInput = {
  locale: 'fr' | 'en';
  shopName: string;
  /** UTC instant of the appointment start. */
  startAtIso: string;
  /** Shop timezone for formatting the time. */
  timezone: string;
  /** Optional shop phone number — included so the customer can
   *  reply via voice if the SMS reply-to channel isn't viable. */
  shopPhone: string | null;
};

export function reminder24hSms(input: ReminderInput): string {
  const time = formatShopTime(input.startAtIso, input.timezone, 'HH:mm');
  if (input.locale === 'fr') {
    const tail = input.shopPhone ? ` Annuler? ${input.shopPhone}` : '';
    return `Rappel: rendez-vous demain à ${time} chez ${input.shopName}.${tail}`;
  }
  const tail = input.shopPhone ? ` Cancel? ${input.shopPhone}` : '';
  return `Reminder: appointment tomorrow at ${time} at ${input.shopName}.${tail}`;
}

export function reminder1hSms(input: ReminderInput): string {
  if (input.locale === 'fr') {
    return `Ton rendez-vous chez ${input.shopName} commence dans 1 heure. À tout de suite!`;
  }
  return `Your appointment at ${input.shopName} starts in 1 hour. See you soon!`;
}

/**
 * Loop 62 — birthday greeting SMS. Fires once per year per client via
 * the daily birthday cron. Body length ~60-80 chars; with the cake
 * emoji + French accents the message goes UCS-2 (70 chars/segment cap)
 * so common first names usually fit a single segment. Longer names
 * spill to a 2-segment SMS — accepted cost (still ~$0.016 in CA).
 */
export function birthdayGreetingSms(input: {
  locale: 'fr' | 'en';
  shopName: string;
  firstName: string;
}): string {
  if (input.locale === 'fr') {
    return `Joyeux anniversaire ${input.firstName} ! Bonne journée de la part de ${input.shopName} 🎂`;
  }
  return `Happy birthday ${input.firstName}! Have a great day from ${input.shopName} 🎂`;
}
