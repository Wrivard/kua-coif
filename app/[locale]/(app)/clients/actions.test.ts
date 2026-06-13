import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type Fixtures } from '@/lib/test/supabase-mock';

/**
 * clients actions — MED-3 (Loi 25) + residuals.
 *
 * Covers: `updateClient` dedup-on-update (CONFLICT on a same-shop phone/email
 * collision with ANOTHER active client) and `anonymizeClient` (bumps
 * me_token_version to revoke /me + scrubs the client name out of the historical
 * audit_log diff for both the clients rows and this client's appointments).
 * Harness = lib/test/supabase-mock; structure mirrors settings/users/actions.test.ts.
 * Tests run as `manager` so updateClient skips the barber-served scope gate and
 * the dedup branch is exercised in isolation.
 */

const h = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getShopMemberships: vi.fn(),
  getCurrentShopId: vi.fn(),
  getCurrentBarberId: vi.fn(),
  captureException: vi.fn(),
  logAuditAction: vi.fn(),
  logDurableAudit: vi.fn(),
  revalidatePath: vi.fn(),
  checkRateLimit: vi.fn(),
  sbClient: { current: null as unknown },
}));

vi.mock('@/lib/auth/server', () => ({
  getCurrentUser: () => h.getCurrentUser(),
  getShopMemberships: () => h.getShopMemberships(),
  getCurrentShopId: () => h.getCurrentShopId(),
  getCurrentBarberId: () => h.getCurrentBarberId(),
}));
vi.mock('@/lib/observability', () => ({
  captureException: (...a: unknown[]) => h.captureException(...a),
}));
vi.mock('@/lib/supabase/service-role', () => ({
  createSupabaseServiceRoleClient: () => h.sbClient.current,
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: () => h.sbClient.current }));
vi.mock('@/lib/audit-log', () => ({
  logAuditAction: (...a: unknown[]) => h.logAuditAction(...a),
  logDurableAudit: (...a: unknown[]) => h.logDurableAudit(...a),
}));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => h.revalidatePath(...a) }));
vi.mock('@/lib/auth/rate-limit', () => ({
  checkRateLimit: (...a: unknown[]) => h.checkRateLimit(...a),
}));

import { anonymizeClient, updateClient } from './actions';

const SHOP_A = 'shop-a';
// Valid v4-shaped UUIDs (zod's uuid() requires version + variant nibbles).
const CLIENT_EDIT = '11111111-1111-4111-8111-111111111111';
const CLIENT_KEEP = '22222222-2222-4222-8222-222222222222';
const CLIENT_ANON = '33333333-3333-4333-8333-333333333333';

type DiffSnap = { before?: Record<string, unknown>; after?: Record<string, unknown> };

function setup(fixtures: Fixtures) {
  const mock = createSupabaseMock(fixtures);
  h.sbClient.current = mock.client;
  return { mock };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.getCurrentUser.mockResolvedValue({ id: 'user-actor' });
  h.getCurrentShopId.mockResolvedValue(SHOP_A);
  h.getCurrentBarberId.mockResolvedValue(null);
  h.getShopMemberships.mockResolvedValue([
    { shop_id: SHOP_A, role: 'manager', status: 'confirmed' },
  ]);
  h.logAuditAction.mockResolvedValue(undefined);
  h.logDurableAudit.mockResolvedValue(undefined);
  h.checkRateLimit.mockResolvedValue({ allowed: true });
  h.sbClient.current = null;
});

describe('updateClient — dedup-on-update (MED-3 LOW)', () => {
  const baseInput = {
    first_name: 'Edit',
    last_name: null,
    email: null,
    phone: null,
    date_of_birth: null,
    notes: null,
  };

  it('phone collides with another active client in the shop → CONFLICT', async () => {
    setup({
      clients: [
        { id: CLIENT_KEEP, shop_id: SHOP_A, phone_normalized: '5145551234', anonymized_at: null },
        { id: CLIENT_EDIT, shop_id: SHOP_A, phone_normalized: '5140000000', anonymized_at: null },
      ],
    });
    const res = await updateClient({ ...baseInput, id: CLIENT_EDIT, phone: '514-555-1234' });
    expect(res).toMatchObject({ ok: false, errorCode: 'CONFLICT' });
  });

  it('email collides with another active client in the shop → CONFLICT', async () => {
    setup({
      clients: [
        { id: CLIENT_KEEP, shop_id: SHOP_A, email: 'dup@example.com', anonymized_at: null },
        { id: CLIENT_EDIT, shop_id: SHOP_A, email: 'edit@example.com', anonymized_at: null },
      ],
    });
    const res = await updateClient({ ...baseInput, id: CLIENT_EDIT, email: 'dup@example.com' });
    expect(res).toMatchObject({ ok: false, errorCode: 'CONFLICT' });
  });

  it('no collision (the only match is the row being edited) → ok', async () => {
    setup({
      clients: [
        { id: CLIENT_EDIT, shop_id: SHOP_A, phone_normalized: '5145551234', anonymized_at: null },
      ],
    });
    const res = await updateClient({ ...baseInput, id: CLIENT_EDIT, phone: '514-555-1234' });
    expect(res.ok).toBe(true);
  });
});

describe('anonymizeClient — Loi 25 erasure (MED-3)', () => {
  it('bumps me_token_version + scrubs the client name from historical audit rows', async () => {
    const { mock } = setup({
      clients: [
        {
          id: CLIENT_ANON,
          shop_id: SHOP_A,
          anonymized_at: null,
          first_name: 'John',
          last_name: 'Doe',
          phone: '5145551234',
          email: 'john@example.com',
          quickbooks_customer_id: null,
          me_token_version: 2,
        },
      ],
      appointments: [
        { id: 'appt-1', shop_id: SHOP_A, client_id: CLIENT_ANON, client_name_snapshot: 'John Doe' },
      ],
      reviews: [],
      waiting_list_entries: [],
      audit_log: [
        {
          id: 1,
          shop_id: SHOP_A,
          entity: 'clients',
          entity_id: CLIENT_ANON,
          diff: { before: { first_name: 'John', last_name: 'Doe' }, after: { first_name: 'Jon' } },
        },
        {
          id: 2,
          shop_id: SHOP_A,
          entity: 'appointments',
          entity_id: 'appt-1',
          diff: { after: { client_name_snapshot: 'John Doe' } },
        },
      ],
    });

    const res = await anonymizeClient({ id: CLIENT_ANON });
    expect(res.ok).toBe(true);

    // revoke /me — token version bumped so outstanding links stop verifying.
    const client = (mock.tables.clients ?? [])[0]!;
    expect(client.me_token_version).toBe(3);
    expect(client.first_name).toBe('[Anonymized]');
    expect(client.anonymized_at).toBeTruthy();

    const auditRows = mock.tables.audit_log ?? [];
    // Historical audit scrub — clients rows (first_name + last_name).
    const clientDiff = auditRows.find((r) => r.entity === 'clients')!.diff as DiffSnap;
    expect(clientDiff.before?.first_name).toBe('[anonymized]');
    expect(clientDiff.before?.last_name).toBe('[anonymized]');
    expect(clientDiff.after?.first_name).toBe('[anonymized]');

    // Historical audit scrub — this client's appointments (client_name_snapshot).
    const apptDiff = auditRows.find((r) => r.entity === 'appointments')!.diff as DiffSnap;
    expect(apptDiff.after?.client_name_snapshot).toBe('[anonymized]');
  });
});
