import { NextResponse, type NextRequest } from 'next/server';
import Papa from 'papaparse';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentShopId, getCurrentUser, getShopMemberships } from '@/lib/auth/server';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import { sanitizeCsvRows } from '@/lib/security/csv';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Generic CSV export route. Whitelists which entities the API can dump and
 * which columns are safe to include (never SIN, tax_id values, etc.).
 *
 * GET /api/export/services
 * GET /api/export/clients
 * GET /api/export/products
 * GET /api/export/barbers?status=confirmed
 * GET /api/export/brands
 * GET /api/export/categories
 *
 * Returns text/csv with Content-Disposition: attachment.
 */

type Entity = 'services' | 'clients' | 'products' | 'barbers' | 'brands' | 'categories';

const ENTITY_CONFIG: Record<
  Entity,
  { table: string; columns: string; orderBy: string; ascending: boolean }
> = {
  services: {
    table: 'services',
    columns: 'name, duration_min, price, status, sort_order',
    orderBy: 'sort_order',
    ascending: true,
  },
  clients: {
    table: 'clients',
    columns: 'first_name, last_name, email, phone, created_at',
    orderBy: 'created_at',
    ascending: false,
  },
  products: {
    table: 'products',
    columns: 'name, price, supply_price, current_inventory, low_inventory_threshold, sku',
    orderBy: 'name',
    ascending: true,
  },
  barbers: {
    table: 'barbers',
    columns: 'display_name, email, phone, personnel_id, status, sort_order',
    orderBy: 'sort_order',
    ascending: true,
  },
  brands: {
    table: 'product_brands',
    columns: 'name',
    orderBy: 'name',
    ascending: true,
  },
  categories: {
    table: 'product_categories',
    columns: 'name',
    orderBy: 'name',
    ascending: true,
  },
};

export async function GET(req: NextRequest, { params }: { params: { entity: string } }) {
  // Auth + shop gate. Without an active session, return 401.
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });
  const memberships = await getShopMemberships();
  if (memberships.length === 0) return new NextResponse('No shop', { status: 403 });

  const entity = params.entity as Entity;
  const cfg = ENTITY_CONFIG[entity];
  if (!cfg) return new NextResponse(`Unknown entity: ${entity}`, { status: 404 });

  // Security audit #12 — scope by active shop. Pre-fix the route
  // relied entirely on RLS to filter rows; for a multi-shop user
  // (owner in A, manager in B) this returned rows from BOTH shops
  // silently merged into one CSV with no shop_id discriminator.
  // Worse, with finding #2 unfixed, "active shop" wasn't propagated
  // here at all. Now we explicitly filter by getCurrentShopId() so
  // a manager exporting from shop B never gets shop A's data even
  // though they have read access to both.
  const activeShopId = await getCurrentShopId();
  if (!activeShopId) return new NextResponse('No shop', { status: 403 });

  // Role gate for PII entities. The Clients UI scopes a strict barber to only
  // the clients they've served; without this gate a barber could GET
  // /api/export/clients and bulk-dump the ENTIRE shop roster (incl. emails +
  // phones), bypassing that scope. Same for the barber roster. Non-PII
  // entities (services, products, brands, categories) stay open to any member.
  const activeRole = memberships.find((m) => m.shop_id === activeShopId)?.role ?? 'barber';
  const PII_ENTITIES: Entity[] = ['clients', 'barbers'];
  if (PII_ENTITIES.includes(entity) && activeRole === 'barber') {
    return new NextResponse('Forbidden', { status: 403 });
  }
  // Throttle the PII-bulk export so a manager session can't be used to scrape
  // the roster in a loop.
  if (PII_ENTITIES.includes(entity)) {
    const rl = await checkRateLimit(`export-csv:${user.id}`, { max: 30, windowMs: 60 * 60 * 1000 });
    if (!rl.allowed) return new NextResponse('Too many requests', { status: 429 });
  }

  const supabase = createSupabaseServerClient();
  type QueryResult = { data: unknown; error: unknown };
  const filterBuilder = (
    supabase as unknown as {
      from: (t: string) => {
        select: (cols: string) => {
          eq: (
            k: string,
            v: string,
          ) => {
            order: (
              k: string,
              opts?: { ascending?: boolean },
            ) => Promise<QueryResult> & {
              eq: (k: string, v: string) => Promise<QueryResult>;
            };
          };
        };
      };
    }
  )
    .from(cfg.table)
    .select(cfg.columns)
    .eq('shop_id', activeShopId)
    .order(cfg.orderBy, { ascending: cfg.ascending });

  // Optional ?status=… filter for barbers etc.
  let result: QueryResult;
  const statusFilter = req.nextUrl.searchParams.get('status');
  if (statusFilter && entity === 'barbers') {
    result = await filterBuilder.eq('status', statusFilter);
  } else {
    result = await filterBuilder;
  }

  if (result.error) {
    return new NextResponse('Export failed', { status: 500 });
  }

  const rows = (result.data as Array<Record<string, unknown>> | null) ?? [];
  // Security: neutralize spreadsheet formula injection (OWASP). Cells such as
  // client names/emails come from the public booking flow and could carry
  // =cmd / +HYPERLINK / @SUM payloads that execute when the owner opens the CSV.
  const csv = Papa.unparse(sanitizeCsvRows(rows), { quotes: true });
  const filename = `${entity}-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}
