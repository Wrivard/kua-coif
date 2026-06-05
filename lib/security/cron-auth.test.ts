import { afterEach, describe, expect, it, vi } from 'vitest';
import { isCronAuthorized } from './cron-auth';

function reqWith(auth: string | null): Request {
  return { headers: { get: () => auth } } as unknown as Request;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isCronAuthorized', () => {
  it('accepts the correct bearer token', () => {
    vi.stubEnv('CRON_SECRET', 's3cret');
    expect(isCronAuthorized(reqWith('Bearer s3cret'))).toBe(true);
  });

  it('rejects wrong, missing, or unprefixed tokens', () => {
    vi.stubEnv('CRON_SECRET', 's3cret');
    expect(isCronAuthorized(reqWith('Bearer wrong'))).toBe(false);
    expect(isCronAuthorized(reqWith(null))).toBe(false);
    expect(isCronAuthorized(reqWith('s3cret'))).toBe(false);
  });

  it('fail-CLOSED in production when CRON_SECRET is unset', () => {
    vi.stubEnv('CRON_SECRET', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(isCronAuthorized(reqWith(null))).toBe(false);
  });

  it('runs unprotected outside production when CRON_SECRET is unset', () => {
    vi.stubEnv('CRON_SECRET', '');
    vi.stubEnv('NODE_ENV', 'development');
    expect(isCronAuthorized(reqWith(null))).toBe(true);
  });
});
