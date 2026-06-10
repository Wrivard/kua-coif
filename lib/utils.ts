import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrencyCAD(amount: number, locale: 'fr' | 'en' = 'fr') {
  return new Intl.NumberFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 2,
  }).format(amount);
}

/**
 * Canonical phone key for dedup + loyalty matching: the last 10 digits (the
 * NANP national number), stripped of all formatting.
 *
 * Why last-10: numbers arrive both bare ('5145551234') and with the country
 * code ('+1 514 555 1234' → 11 digits). Taking the last 10 maps both to the
 * SAME key, so '+1 514…' and '514…' dedup to one client. The old substring
 * /ilike match manufactured duplicates ('+1 514…' vs bare digits never matched)
 * and could resolve to the WRONG client — a cross-client loyalty/PII leak —
 * which is why every dedup/lookup site uses this exact key. Short inputs
 * (< 10 digits) return as-is after stripping (callers treat '' / too-short as
 * "no match").
 */
export function normalizePhoneKey(value: string): string {
  return value.replace(/\D/g, '').slice(-10);
}

export function formatPhoneNANP(value: string) {
  // Strip non-digits to the last 10, then format as +1 ### ### ####. Keeps
  // already-formatted input idempotent.
  const digits = normalizePhoneKey(value);
  if (digits.length !== 10) return value;
  return `+1 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
}
