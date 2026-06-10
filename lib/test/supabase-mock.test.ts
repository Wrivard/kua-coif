import { describe, expect, it } from 'vitest';
import { createSupabaseMock } from './supabase-mock';

describe('createSupabaseMock — query resolution', () => {
  it('narrows rows by chained eq filters and records the captured filters', async () => {
    const { client, calls } = createSupabaseMock({
      appointments: [
        { id: 'a1', shop_id: 'A', status: 'booked' },
        { id: 'a2', shop_id: 'A', status: 'cancelled' },
        { id: 'a3', shop_id: 'B', status: 'booked' },
      ],
    });

    const res = await client
      .from('appointments')
      .select('id')
      .eq('shop_id', 'A')
      .eq('status', 'booked');

    expect(res.error).toBeNull();
    expect((res.data as Array<{ id: string }>).map((r) => r.id)).toEqual(['a1']);
    // Anti-test-the-mock: the captured filters are inspectable.
    const call = calls.find((c) => c.table === 'appointments' && c.op === 'select');
    expect(call?.filters).toEqual([
      ['shop_id', 'A'],
      ['status', 'booked'],
    ]);
  });

  it('supports in / gte / lt filters and order + limit', async () => {
    const { client } = createSupabaseMock({
      t: [
        { id: '1', start_at: '2026-01-01', n: 3 },
        { id: '2', start_at: '2026-06-01', n: 1 },
        { id: '3', start_at: '2026-12-01', n: 2 },
      ],
    });

    const res = await client
      .from('t')
      .select('*')
      .in('id', ['1', '2'])
      .gte('start_at', '2026-01-01')
      .lt('start_at', '2026-07-01')
      .order('n', { ascending: true });

    expect((res.data as Array<{ id: string }>).map((r) => r.id)).toEqual(['2', '1']);
  });

  it('single() returns PGRST116 when no row matches, the row when one does', async () => {
    const { client } = createSupabaseMock({ shops: [{ id: 's1', name: 'Axum' }] });

    const hit = await client.from('shops').select('*').eq('id', 's1').single();
    expect(hit.data).toEqual({ id: 's1', name: 'Axum' });
    expect(hit.error).toBeNull();

    const miss = await client.from('shops').select('*').eq('id', 'nope').single();
    expect(miss.data).toBeNull();
    expect(miss.error?.code).toBe('PGRST116');

    // maybeSingle never errors on empty.
    const maybe = await client.from('shops').select('*').eq('id', 'nope').maybeSingle();
    expect(maybe).toEqual({ data: null, error: null });
  });

  it('insert appends, generates an id, and select() returns the inserted row', async () => {
    const mock = createSupabaseMock({ clients: [] });
    const res = await mock.client
      .from('clients')
      .insert({ shop_id: 'A', first_name: 'Ada' })
      .select('id')
      .single();

    expect(res.error).toBeNull();
    expect((res.data as { id: string }).id).toMatch(/^id-/);
    expect(mock.tables.clients).toHaveLength(1);
    const call = mock.calls.find((c) => c.op === 'insert');
    expect(call?.payload).toMatchObject({ first_name: 'Ada' });
  });

  it('update mutates matching rows and update().select() returns the matched rows', async () => {
    const mock = createSupabaseMock({
      appointments: [
        { id: 'a1', payment_intent_id: 'pi_1', payment_status: 'pending' },
        { id: 'a2', payment_intent_id: 'pi_2', payment_status: 'pending' },
      ],
    });

    const res = await mock.client
      .from('appointments')
      .update({ payment_status: 'paid' })
      .eq('payment_intent_id', 'pi_1')
      .select('id');

    expect((res.data as Array<{ id: string }>).map((r) => r.id)).toEqual(['a1']);
    expect(mock.tables.appointments![0]!.payment_status).toBe('paid');
    expect(mock.tables.appointments![1]!.payment_status).toBe('pending');
  });

  it('delete removes matching rows', async () => {
    const mock = createSupabaseMock({ appointments: [{ id: 'a1' }, { id: 'a2' }] });
    await mock.client.from('appointments').delete().eq('id', 'a1');
    expect(mock.tables.appointments!.map((r) => r.id)).toEqual(['a2']);
  });

  it('upsert with onConflict updates an existing row instead of duplicating', async () => {
    const mock = createSupabaseMock({
      disputes: [{ id: 'd1', stripe_dispute_id: 'dp_1', status: 'warning_needs_response' }],
    });
    await mock.client
      .from('disputes')
      .upsert({ stripe_dispute_id: 'dp_1', status: 'lost' }, { onConflict: 'stripe_dispute_id' })
      .select('id');
    expect(mock.tables.disputes).toHaveLength(1);
    expect(mock.tables.disputes![0]!.status).toBe('lost');
  });

  it('injects a per-table/op error (e.g. 23505 on insert) and short-circuits', async () => {
    const mock = createSupabaseMock(
      { stripe_events: [] },
      { errors: { stripe_events: { insert: { code: '23505', message: 'duplicate' } } } },
    );
    const res = await mock.client
      .from('stripe_events')
      .insert({ id: 'evt_1', event_type: 'x' })
      .select('id');
    expect(res.data).toBeNull();
    expect(res.error?.code).toBe('23505');
    // The injected insert short-circuits — nothing was appended.
    expect(mock.tables.stripe_events).toHaveLength(0);
  });

  it('throws LOUDLY for an unsupported operator instead of silently no-oping', async () => {
    const { client } = createSupabaseMock({ t: [{ id: '1', name: 'x' }] });
    expect(() => client.from('t').select('*').ilike('name', '%x%')).toThrow(
      /supabase-mock: unsupported op ilike/,
    );
    expect(() => client.rpc('whatever')).toThrow(/supabase-mock: unsupported op rpc/);
  });
});
