import { describe, expect, it } from 'vitest';
import { normalizePhoneKey } from './utils';

describe('normalizePhoneKey', () => {
  it('takes the last 10 digits of an 11-digit (+1 country code) number', () => {
    // The crux: '+1 514 555 1234' and the bare 10-digit form must collapse to
    // the SAME key so they dedup to one client.
    expect(normalizePhoneKey('+1 514 555 1234')).toBe('5145551234');
    expect(normalizePhoneKey('5145551234')).toBe('5145551234');
    expect(normalizePhoneKey('+1 514 555 1234')).toBe(normalizePhoneKey('15145551234'));
  });

  it('strips all non-digit formatting (spaces, dashes, parens, dots)', () => {
    expect(normalizePhoneKey('(514) 555-1234')).toBe('5145551234');
    expect(normalizePhoneKey('514.555.1234')).toBe('5145551234');
  });

  it('returns short input as-is after stripping (callers treat too-short as no-match)', () => {
    expect(normalizePhoneKey('5551234')).toBe('5551234');
    expect(normalizePhoneKey('')).toBe('');
    expect(normalizePhoneKey('abc')).toBe('');
  });
});
