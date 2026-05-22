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

export function formatPhoneNANP(value: string) {
  // Strip non-digits, then format as +1 ### ### ####. Keeps already-formatted input idempotent.
  const digits = value.replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) return value;
  return `+1 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
}
