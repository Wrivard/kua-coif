/**
 * Fixture-driven Supabase mock — the test harness for action/route suites
 * (plan 015, the roadmap's declared KEYSTONE).
 *
 * The production code talks to Supabase through a chainable PostgrestBuilder
 * (`from(t).select(...).eq(...).single()` etc.). This module returns an
 * in-memory stand-in with the SAME chainable surface, backed by plain
 * fixture rows, so a Server Action or API route can run end-to-end in a unit
 * test with zero network.
 *
 * Design rules (why this isn't just a permissive stub):
 *   - The classic failure of a hand-rolled DB mock is that it's so loose it
 *     tests the mock, not the code. Two countermeasures:
 *       1. EVERY call is recorded in `calls` with its captured filters +
 *          payload, so suites assert on the actual `.eq(...)` a query issued
 *          (a dropped filter then fails a test instead of shipping green).
 *       2. Any operator the three target files don't use THROWS LOUDLY
 *          (`supabase-mock: unsupported op …`) instead of silently no-oping,
 *          so a future query reaching for an unimplemented operator surfaces
 *          immediately rather than returning a misleading empty result.
 *   - Only the operators the targets actually chain are implemented
 *     (select/insert/update/delete/upsert; eq/neq/gt/gte/lt/lte/in/is;
 *     order/limit; single/maybeSingle). Embedded-select joins
 *     (`shop:shops(...)`) are returned as the raw stored rows — the harness
 *     does NOT emulate join resolution; suites that touch that path use
 *     fixtures where the embedded read returns no rows (the orphan path).
 */

export type Row = Record<string, unknown>;
export type Fixtures = Record<string, Row[]>;

type WriteOp = 'select' | 'insert' | 'update' | 'delete' | 'upsert';

export type CapturedCall = {
  table: string;
  op: WriteOp;
  /** Captured filter args, e.g. [['shop_id','A'], ['status','confirmed']]. */
  filters: Array<[string, unknown]>;
  payload?: unknown;
  /** Monotonic order across all calls on this mock (for ordering assertions). */
  order: number;
};

type InjectedError = { code?: string; message?: string };
export type ErrorMap = Record<string, Partial<Record<WriteOp, InjectedError>>>;

export type SupabaseMock = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any;
  calls: CapturedCall[];
  /** Live view of the in-memory tables (post-mutation), for white-box asserts. */
  tables: Fixtures;
};

const SUPPORTED_FILTERS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is'] as const;
type FilterOp = (typeof SUPPORTED_FILTERS)[number];

// Operators the targets never use. Defined as loud throwers so a future query
// reaching for one fails the test instead of silently mis-resolving.
const UNSUPPORTED_METHODS = [
  'or',
  'and',
  'not',
  'filter',
  'match',
  'ilike',
  'like',
  'contains',
  'containedBy',
  'overlaps',
  'textSearch',
  'range',
  'rangeGt',
  'rangeLt',
  'csv',
  'explain',
] as const;

function matchesFilter(op: FilterOp, rowVal: unknown, val: unknown): boolean {
  switch (op) {
    case 'eq':
      return rowVal === val;
    case 'neq':
      return rowVal !== val;
    case 'gt':
      return (rowVal as number | string) > (val as number | string);
    case 'gte':
      return (rowVal as number | string) >= (val as number | string);
    case 'lt':
      return (rowVal as number | string) < (val as number | string);
    case 'lte':
      return (rowVal as number | string) <= (val as number | string);
    case 'in':
      return Array.isArray(val) && val.includes(rowVal);
    case 'is':
      return rowVal === val;
    default:
      throw new Error(`supabase-mock: unsupported op ${op as string}`);
  }
}

export function createSupabaseMock(
  fixtures: Fixtures = {},
  opts?: { errors?: ErrorMap },
): SupabaseMock {
  // Deep-ish copy so a suite's mutations don't bleed into the fixture literal.
  const tables: Fixtures = {};
  for (const [t, rows] of Object.entries(fixtures)) tables[t] = rows.map((r) => ({ ...r }));
  const calls: CapturedCall[] = [];
  const errors = opts?.errors ?? {};
  let idCounter = 0;
  let orderCounter = 0;

  function builder(table: string) {
    let op: WriteOp = 'select';
    let opSet = false;
    let payload: unknown;
    let wantSelect = false;
    let single: 'single' | 'maybeSingle' | null = null;
    let onConflict: string | undefined;
    const filters: Array<[FilterOp, string, unknown]> = [];
    const orderBys: Array<[string, boolean]> = [];
    let limitN: number | undefined;
    let cached: { data: unknown; error: InjectedError | null } | undefined;

    function ensure(t: string): Row[] {
      return (tables[t] ??= []);
    }

    function applyFilters(rows: Row[]): Row[] {
      return rows.filter((row) =>
        filters.every(([fop, col, val]) => matchesFilter(fop, row[col], val)),
      );
    }

    function finalize(rows: Row[]) {
      if (single === 'single') {
        return rows.length
          ? { data: rows[0], error: null }
          : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
      }
      if (single === 'maybeSingle') {
        return { data: rows[0] ?? null, error: null };
      }
      if (op !== 'select' && !wantSelect) return { data: null, error: null };
      return { data: rows, error: null };
    }

    function resolve() {
      if (cached) return cached;
      calls.push({
        table,
        op,
        filters: filters.map(([, col, val]) => [col, val]),
        payload,
        order: ++orderCounter,
      });
      const injected = errors[table]?.[op];
      if (injected) {
        cached = { data: null, error: injected };
        return cached;
      }
      const rows = ensure(table);
      if (op === 'select') {
        let out = applyFilters(rows);
        for (const [col, asc] of orderBys) {
          out = [...out].sort((a, b) => {
            const av = a[col] as number | string;
            const bv = b[col] as number | string;
            const cmp = av > bv ? 1 : av < bv ? -1 : 0;
            return asc ? cmp : -cmp;
          });
        }
        if (typeof limitN === 'number') out = out.slice(0, limitN);
        cached = finalize(out);
      } else if (op === 'insert') {
        const arr = Array.isArray(payload) ? (payload as Row[]) : [payload as Row];
        const inserted = arr.map((r) => ({ ...r, id: r.id ?? `id-${++idCounter}` }));
        rows.push(...inserted);
        cached = finalize(inserted);
      } else if (op === 'update') {
        const matched = applyFilters(rows);
        for (const row of matched) Object.assign(row, payload as Row);
        cached = finalize(matched);
      } else if (op === 'delete') {
        const matched = applyFilters(rows);
        tables[table] = rows.filter((r) => !matched.includes(r));
        cached = finalize(matched);
      } else if (op === 'upsert') {
        const arr = Array.isArray(payload) ? (payload as Row[]) : [payload as Row];
        const result: Row[] = [];
        for (const r of arr) {
          const existing = onConflict
            ? rows.find((row) => row[onConflict!] === r[onConflict!])
            : undefined;
          if (existing) {
            Object.assign(existing, r);
            result.push(existing);
          } else {
            const row = { ...r, id: r.id ?? `id-${++idCounter}` };
            rows.push(row);
            result.push(row);
          }
        }
        cached = finalize(result);
      } else {
        throw new Error(`supabase-mock: unsupported op ${op as string}`);
      }
      return cached;
    }

    const chain: Record<string, unknown> = {
      select(_cols?: string) {
        if (!opSet) op = 'select';
        wantSelect = true;
        return chain;
      },
      insert(p: unknown) {
        op = 'insert';
        opSet = true;
        payload = p;
        return chain;
      },
      update(p: unknown) {
        op = 'update';
        opSet = true;
        payload = p;
        return chain;
      },
      delete() {
        op = 'delete';
        opSet = true;
        return chain;
      },
      upsert(p: unknown, options?: { onConflict?: string }) {
        op = 'upsert';
        opSet = true;
        payload = p;
        onConflict = options?.onConflict;
        return chain;
      },
      order(col: string, options?: { ascending?: boolean }) {
        orderBys.push([col, options?.ascending !== false]);
        return chain;
      },
      limit(n: number) {
        limitN = n;
        return chain;
      },
      single() {
        single = 'single';
        return chain;
      },
      maybeSingle() {
        single = 'maybeSingle';
        return chain;
      },
      // Thenable: `await builder` resolves the query.
      then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
        return Promise.resolve()
          .then(() => resolve())
          .then(onFulfilled, onRejected);
      },
    };

    for (const fop of SUPPORTED_FILTERS) {
      chain[fop] = (col: string, val: unknown) => {
        filters.push([fop, col, val]);
        return chain;
      };
    }
    for (const m of UNSUPPORTED_METHODS) {
      chain[m] = () => {
        throw new Error(`supabase-mock: unsupported op ${m}`);
      };
    }

    return chain;
  }

  const client = {
    from(table: string) {
      return builder(table);
    },
    rpc() {
      throw new Error('supabase-mock: unsupported op rpc');
    },
  };

  return { client, calls, tables };
}
