import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';

/**
 * i18n parity guard.
 *
 * Every user-visible string in the app goes through next-intl `t()` with a
 * dot-path key. The contract is that `messages/en.json` and `messages/fr.json`
 * carry the EXACT SAME set of leaf keys — a key present in one locale but not
 * the other is a translation drift that surfaces at runtime as a
 * `MISSING_MESSAGE` error (or a silently English/French-only label).
 *
 * This test walks both trees, collects the recursive set of leaf dot-paths,
 * and asserts the two sets are identical. When it fails it prints the exact
 * keys that are missing on each side so the drift is trivial to fix.
 */

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/** Recursively collect the dot-path of every leaf (non-object) value. */
function leafKeys(value: Json, prefix = ''): string[] {
  // Arrays and primitives are leaves — they hold a translated value, not a
  // namespace, so we don't descend into them.
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix];
  }
  const out: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${k}` : k;
    out.push(...leafKeys(v as Json, path));
  }
  return out;
}

describe('i18n parity (en.json ⇄ fr.json)', () => {
  const enKeys = new Set(leafKeys(en as Json));
  const frKeys = new Set(leafKeys(fr as Json));

  it('has the auth.login keys that previously drifted', () => {
    // Regression guard: fr carried `auth.login.noAccount` /
    // `auth.login.signupLink` while en lacked them. Both locales must have
    // both keys now.
    for (const key of ['auth.login.noAccount', 'auth.login.signupLink']) {
      expect(enKeys.has(key), `en is missing ${key}`).toBe(true);
      expect(frKeys.has(key), `fr is missing ${key}`).toBe(true);
    }
  });

  it('en and fr expose an identical set of leaf keys', () => {
    const missingInEn = [...frKeys].filter((k) => !enKeys.has(k)).sort();
    const missingInFr = [...enKeys].filter((k) => !frKeys.has(k)).sort();

    expect(missingInEn, `keys in fr.json but missing from en.json: ${missingInEn.join(', ')}`).toEqual(
      [],
    );
    expect(missingInFr, `keys in en.json but missing from fr.json: ${missingInFr.join(', ')}`).toEqual(
      [],
    );
  });
});
