/**
 * Tests for the Twilio status-callback signature verification.
 *
 * Twilio's signing algorithm: concat(URL, k1+v1+...+kN+vN) with keys
 * sorted, HMAC-SHA1 keyed by auth token, base64 encode. We pin a
 * known-good signature for a fixed set of inputs — if the test
 * stops passing, the implementation no longer matches the algorithm
 * Twilio uses to sign callbacks against our endpoint.
 *
 *   https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
import { describe, expect, it } from 'vitest';
import { verifyTwilioSignature, twilioWebhookUrl } from './webhook';

describe('verifyTwilioSignature', () => {
  // Inputs + signature pinned to the output of the documented
  // algorithm (HMAC-SHA1 over URL + sorted-params concat, base64).
  // Hand-computed via Node's `crypto.createHmac('sha1', token)`.
  const FIXTURE = {
    authToken: '12345',
    url: 'https://mycompany.com/myapp.php?foo=1&bar=2',
    params: {
      CallSid: 'CA1234567890ABCDE',
      Caller: '+14155551212',
      Digits: '1234',
      From: '+14155551212',
      To: '+18005551212',
    },
    expectedSignature: 'n8Vl5MwCsxCraPPKyyACMGvcT6w=',
  };

  it('accepts a correctly signed payload', () => {
    expect(
      verifyTwilioSignature({
        authToken: FIXTURE.authToken,
        url: FIXTURE.url,
        params: FIXTURE.params,
        signature: FIXTURE.expectedSignature,
      }),
    ).toBe(true);
  });

  it('rejects a tampered body parameter', () => {
    expect(
      verifyTwilioSignature({
        authToken: FIXTURE.authToken,
        url: FIXTURE.url,
        params: { ...FIXTURE.params, Digits: '9999' }, // tampered
        signature: FIXTURE.expectedSignature,
      }),
    ).toBe(false);
  });

  it('rejects a tampered URL', () => {
    expect(
      verifyTwilioSignature({
        authToken: FIXTURE.authToken,
        url: 'https://attacker.example.com/myapp.php?foo=1&bar=2',
        params: FIXTURE.params,
        signature: FIXTURE.expectedSignature,
      }),
    ).toBe(false);
  });

  it('rejects an empty signature', () => {
    expect(
      verifyTwilioSignature({
        authToken: FIXTURE.authToken,
        url: FIXTURE.url,
        params: FIXTURE.params,
        signature: '',
      }),
    ).toBe(false);
  });

  it('rejects a signature signed by a different auth token', () => {
    // Recompute against the "right" inputs but with the wrong token
    // implicit in the fixed expectedSignature (which was generated
    // with token `12345`).
    expect(
      verifyTwilioSignature({
        authToken: 'not-the-real-token',
        url: FIXTURE.url,
        params: FIXTURE.params,
        signature: FIXTURE.expectedSignature,
      }),
    ).toBe(false);
  });

  it('handles unsorted param input — signature does not depend on insertion order', () => {
    // The function sorts keys internally, so two callers passing the
    // same logical params in different orders should both verify.
    const reordered = {
      To: FIXTURE.params.To,
      From: FIXTURE.params.From,
      Digits: FIXTURE.params.Digits,
      Caller: FIXTURE.params.Caller,
      CallSid: FIXTURE.params.CallSid,
    };
    expect(
      verifyTwilioSignature({
        authToken: FIXTURE.authToken,
        url: FIXTURE.url,
        params: reordered,
        signature: FIXTURE.expectedSignature,
      }),
    ).toBe(true);
  });
});

describe('twilioWebhookUrl', () => {
  const ORIGINAL_URL = process.env.NEXT_PUBLIC_APP_URL;

  it('returns null when NEXT_PUBLIC_APP_URL is unset', () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(twilioWebhookUrl('shop-123')).toBeNull();
    process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_URL;
  });

  it('returns null for http (Twilio refuses non-https callbacks)', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    expect(twilioWebhookUrl('shop-123')).toBeNull();
    process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_URL;
  });

  it('builds a clean shop-scoped URL when given an https host', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.kua.quebec';
    expect(twilioWebhookUrl('shop-123')).toBe(
      'https://app.kua.quebec/api/sms/twilio-webhook/shop-123',
    );
    process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_URL;
  });

  it('strips a trailing slash on the base URL', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.kua.quebec/';
    expect(twilioWebhookUrl('shop-123')).toBe(
      'https://app.kua.quebec/api/sms/twilio-webhook/shop-123',
    );
    process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_URL;
  });
});
