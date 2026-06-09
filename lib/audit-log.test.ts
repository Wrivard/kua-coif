import { describe, expect, it } from 'vitest';
import { redactAuditPii } from './audit-log';

/**
 * redactAuditPii backs the durable audit write (logDurableAudit), which
 * bypasses RLS via the service role — so its diff MUST be PII-scrubbed
 * before it lands in audit_log. The key policy mirrors the DB redaction
 * trigger: mask contact + financial PII, keep names (needed to identify
 * the row), recurse through nested diffs.
 */
describe('redactAuditPii', () => {
  it('redacts every top-level contact + financial PII key', () => {
    const out = redactAuditPii({
      email: 'a@b.com',
      phone: '+15140000000',
      notes: 'secret',
      date_of_birth: '1990-01-01',
      dob: '1990-01-01',
      legal_name: 'Jane Doe Inc.',
      destination_last4: '7277',
      destination_bank_name: 'RBC',
      client_name_snapshot: 'Jane',
      sin: '000000000',
      tax_id: '123',
    }) as Record<string, unknown>;
    for (const key of Object.keys(out)) {
      expect(out[key], key).toBe('[redacted]');
    }
  });

  it('keeps non-PII keys untouched', () => {
    const input = {
      id: 'abc',
      first_name: 'Jane',
      last_name: 'Doe',
      loi25_export: true,
      appointments_count: 3,
    };
    expect(redactAuditPii(input)).toEqual(input);
  });

  it('recurses into nested objects and arrays', () => {
    const out = redactAuditPii({
      after: { email: 'a@b.com', first_name: 'Jane' },
      rows: [{ phone: '514' }, { phone: '438' }],
    }) as { after: Record<string, unknown>; rows: Array<Record<string, unknown>> };
    expect(out.after.email).toBe('[redacted]');
    expect(out.after.first_name).toBe('Jane');
    expect(out.rows[0]?.phone).toBe('[redacted]');
    expect(out.rows[1]?.phone).toBe('[redacted]');
  });

  it('leaves a null/undefined PII value as-is (not the sentinel)', () => {
    const out = redactAuditPii({ email: null, phone: undefined }) as Record<string, unknown>;
    expect(out.email).toBeNull();
    expect(out.phone).toBeUndefined();
  });

  it('passes primitives through unchanged', () => {
    expect(redactAuditPii('hello')).toBe('hello');
    expect(redactAuditPii(42)).toBe(42);
    expect(redactAuditPii(null)).toBeNull();
  });
});
