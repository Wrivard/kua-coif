import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decrypt, encrypt, encryptionConfigured } from './aes';

/**
 * Vitest sets `NOTIFICATION_ENCRYPTION_KEY` only inside these tests so the
 * rest of the suite (which doesn't need crypto) doesn't accidentally rely
 * on it. We restore the previous value in `afterEach` to keep the global
 * env clean.
 */
const TEST_KEY = Buffer.alloc(32, 7).toString('base64'); // 32 bytes of 0x07

describe('aes-256-gcm helpers', () => {
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env.NOTIFICATION_ENCRYPTION_KEY;
    process.env.NOTIFICATION_ENCRYPTION_KEY = TEST_KEY;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.NOTIFICATION_ENCRYPTION_KEY;
    else process.env.NOTIFICATION_ENCRYPTION_KEY = savedKey;
  });

  it('round-trips ASCII', () => {
    const ciphertext = encrypt('hunter2');
    expect(ciphertext).toMatch(/^v1:/);
    expect(decrypt(ciphertext)).toBe('hunter2');
  });

  it('round-trips unicode + special chars', () => {
    const secret = 'p@ssw0rd! éèà 🔐 中文';
    expect(decrypt(encrypt(secret))).toBe(secret);
  });

  it('produces different ciphertexts for the same input (random IV)', () => {
    const a = encrypt('same-input');
    const b = encrypt('same-input');
    expect(a).not.toEqual(b);
    // Both decrypt to the same plaintext though.
    expect(decrypt(a)).toBe('same-input');
    expect(decrypt(b)).toBe('same-input');
  });

  it('rejects a tampered ciphertext (auth tag mismatch)', () => {
    const ciphertext = encrypt('legit');
    // Flip a bit in the ciphertext component (4th segment).
    const parts = ciphertext.split(':');
    const ctBytes = Buffer.from(parts[3]!, 'base64');
    ctBytes[0] = ctBytes[0]! ^ 0xff;
    const tampered = [parts[0], parts[1], parts[2], ctBytes.toString('base64')].join(':');
    expect(() => decrypt(tampered)).toThrow();
  });

  it('rejects a malformed blob', () => {
    expect(() => decrypt('not-a-valid-blob')).toThrow();
    expect(() => decrypt('v1:::')).toThrow();
  });

  it('throws when the env key is missing', () => {
    delete process.env.NOTIFICATION_ENCRYPTION_KEY;
    expect(encryptionConfigured()).toBe(false);
    expect(() => encrypt('anything')).toThrow(/NOTIFICATION_ENCRYPTION_KEY/);
  });

  it('throws when the env key is the wrong length', () => {
    process.env.NOTIFICATION_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString('base64'); // 16 bytes — too short
    expect(() => encrypt('anything')).toThrow(/32 bytes/);
  });

  it('encryptionConfigured() reflects the env var presence', () => {
    expect(encryptionConfigured()).toBe(true);
    delete process.env.NOTIFICATION_ENCRYPTION_KEY;
    expect(encryptionConfigured()).toBe(false);
  });
});
