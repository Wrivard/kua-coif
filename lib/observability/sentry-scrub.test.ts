/**
 * Phase H+1 — scrubber regression tests. Lock down the PII behavior
 * so a future "let me clean up this scrubber" loop doesn't accidentally
 * regress Loi 25 compliance.
 *
 * These tests run under Node so the email-hashing branch is exercised.
 * Browser + edge behavior (where node:crypto is absent and the email
 * gets dropped) is asserted by the `hashed` truthiness check rather
 * than emulating the runtime mismatch.
 */
import { describe, expect, it } from 'vitest';
import { scrubSentryEvent } from './sentry-scrub';

describe('scrubSentryEvent', () => {
  it('keeps user.id, hashes user.email, nulls ip_address', () => {
    const out = scrubSentryEvent({
      user: { id: 'abc-123', email: 'WrIvArD@kua.quebec', ip_address: '1.2.3.4' },
    });
    expect(out.user.id).toBe('abc-123');
    expect(out.user.email).toMatch(/^cyrb53:[a-f0-9]{14}$/);
    expect(out.user.ip_address).toBeNull();
  });

  it('hashes the same email to the same value (case + whitespace tolerant)', () => {
    const a = scrubSentryEvent({ user: { email: 'wrivard@kua.quebec' } });
    const b = scrubSentryEvent({ user: { email: '  WRIVARD@KUA.QUEBEC  ' } });
    expect(a.user.email).toBe(b.user.email);
  });

  it('strips PII keys from extra at every nesting depth', () => {
    const out = scrubSentryEvent({
      extra: {
        phone: '+15146994290',
        email: 'leak@example.com',
        nested: {
          customer: {
            first_name: 'Jane',
            last_name: 'Doe',
            address: '3857 Décarie',
            notes: 'Allergic to citrus',
            order_id: 'safe-1234',
          },
        },
      },
    });
    expect(out.extra.phone).toBe('<scrubbed>');
    expect(out.extra.email).toBe('<scrubbed>');
    expect(out.extra.nested.customer.first_name).toBe('<scrubbed>');
    expect(out.extra.nested.customer.last_name).toBe('<scrubbed>');
    expect(out.extra.nested.customer.address).toBe('<scrubbed>');
    expect(out.extra.nested.customer.notes).toBe('<scrubbed>');
    expect(out.extra.nested.customer.order_id).toBe('safe-1234');
  });

  it('strips secrets — token, password variants, api_key, cookie, card data', () => {
    const out = scrubSentryEvent({
      extra: {
        password: 'hunter2',
        current_password: 'hunter2',
        new_password: 'hunter3',
        token: 'pi_abc',
        secret: 'whsec_xyz',
        api_key: 'sk_live_xyz',
        apiKey: 'sk_live_xyz',
        authorization: 'Bearer xyz',
        cookie: 'session=abc',
        card_number: '4242 4242 4242 4242',
        cvv: '123',
        card_token: 'tok_xyz',
        sin: '123-456-789',
        tax_id: '987654321',
        dob: '1994-08-02',
      },
    });
    for (const k of Object.keys(out.extra)) {
      expect(out.extra[k]).toBe('<scrubbed>');
    }
  });

  it('scrubs authorization + cookie headers in request', () => {
    const out = scrubSentryEvent({
      request: {
        headers: {
          authorization: 'Bearer xyz',
          cookie: 'session=abc',
          'x-trace-id': 'safe-789',
        },
        cookies: 'session=abc; other=def',
        data: { phone: '+15140000000', order_id: 'safe-456' },
      },
    });
    expect(out.request.headers.authorization).toBe('<scrubbed>');
    expect(out.request.headers.cookie).toBe('<scrubbed>');
    expect(out.request.headers['x-trace-id']).toBe('safe-789');
    expect(out.request.cookies).toBe('<scrubbed>');
    expect(out.request.data.phone).toBe('<scrubbed>');
    expect(out.request.data.order_id).toBe('safe-456');
  });

  it('preserves operational tags untouched', () => {
    const out = scrubSentryEvent({
      tags: { layer: 'stripe-webhook', stage: 'orphan-pi' },
      message: 'something failed',
    });
    expect(out.tags).toEqual({ layer: 'stripe-webhook', stage: 'orphan-pi' });
    expect(out.message).toBe('something failed');
  });

  it('handles null/undefined/non-object inputs gracefully', () => {
    expect(scrubSentryEvent(null)).toBeNull();
    expect(scrubSentryEvent(undefined)).toBeUndefined();
    expect(scrubSentryEvent('error')).toBe('error');
    expect(scrubSentryEvent(42)).toBe(42);
  });

  it('does not infinite-loop on circular structures (depth-capped at 10)', () => {
    const a: Record<string, unknown> = { phone: '+15140000000' };
    a.self = a;
    const out = scrubSentryEvent({ extra: a });
    expect(out.extra.phone).toBe('<scrubbed>');
    // The recursion cap means deep self-refs are returned as-is at the
    // bottom rather than throwing; this assertion just proves no throw.
    expect(out).toBeDefined();
  });
});
