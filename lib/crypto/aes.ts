/**
 * AES-256-GCM helpers — Phase 25.
 *
 * Used to encrypt the per-shop SMTP password at rest in
 * `shops.notification_smtp_password_enc`. Anything we'd rather not see in
 * plaintext if the DB ever leaks (without bringing in a KMS).
 *
 * Why GCM rather than CBC: authenticated encryption — a tampered ciphertext
 * fails to decrypt instead of silently producing garbage we'd then try to
 * use as an SMTP password. Less rope.
 *
 * Key handling: the 256-bit master key lives in `NOTIFICATION_ENCRYPTION_KEY`
 * (base64 of 32 bytes). Generate one with:
 *
 *   openssl rand -base64 32
 *
 * Put it in Vercel and `.env.local`. If the env var is missing, every
 * `encrypt`/`decrypt` call throws so callers can't accidentally store
 * plaintext or read garbage.
 *
 * Versioned blob format so we can rotate to a different scheme later
 * without breaking existing rows:
 *
 *   "v1:<iv-base64>:<tag-base64>:<ciphertext-base64>"
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const SCHEME = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // GCM standard
const TAG_BYTES = 16; // GCM auth tag length

function loadKey(): Buffer {
  const raw = process.env.NOTIFICATION_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      '[crypto] NOTIFICATION_ENCRYPTION_KEY env var is missing. Generate with: openssl rand -base64 32',
    );
  }
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error(
      `[crypto] NOTIFICATION_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${buf.length}).`,
    );
  }
  return buf;
}

export function encrypt(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    SCHEME,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

export function decrypt(blob: string): string {
  const [scheme, ivB64, tagB64, ctB64] = blob.split(':');
  if (scheme !== SCHEME || !ivB64 || !tagB64 || !ctB64) {
    throw new Error('[crypto] Malformed ciphertext blob');
  }
  const key = loadKey();
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('[crypto] IV or tag length is wrong');
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

/**
 * Lightweight feature-check so callers can skip the SMTP path entirely when
 * encryption isn't configured (rather than throwing on read). The
 * /settings/notifications page uses this to disable the SMTP form with a
 * helpful "ask Küa to set up encryption first" hint instead of crashing.
 */
export function encryptionConfigured(): boolean {
  return Boolean(process.env.NOTIFICATION_ENCRYPTION_KEY);
}
