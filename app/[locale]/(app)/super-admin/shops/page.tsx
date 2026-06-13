import Link from 'next/link';
import { Plus, Store } from 'lucide-react';
import { requireKuaAdmin } from '@/lib/auth/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { SuperAdminNav } from '@/components/ui/super-admin-nav';
import { EmptyCell } from '@/components/ui/empty-cell';

export const dynamic = 'force-dynamic';

/**
 * Super-admin shop list. Lists every shop in the platform with a quick
 * snapshot (alias, owner count, member count). Service-role read so we see
 * across tenants — gated by `requireKuaAdmin` which ensures only Küa team
 * members reach the page.
 */
export default async function AdminShopsPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;
  await requireKuaAdmin();

  const sb = createSupabaseServiceRoleClient();
  const shopsRes = await sb
    .from('shops')
    .select('id, name, alias, created_at')
    .order('created_at', { ascending: false });
  const shops = shopsRes.data ?? [];

  // Member counts in one go — second query to keep types simple.
  const counts: Record<string, number> = {};
  if (shops.length > 0) {
    const cRes = await sb
      .from('shop_members')
      .select('shop_id, status')
      .in(
        'shop_id',
        shops.map((s) => s.id),
      );
    const rows = cRes.data ?? [];
    for (const r of rows) {
      if (r.status !== 'deleted') counts[r.shop_id] = (counts[r.shop_id] ?? 0) + 1;
    }
  }

  return (
    <>
      <PageHeader
        title="Shops"
        subtitle="Tous les salons connectés à Küa"
        actions={
          <Link href={`/${params.locale}/super-admin/shops/new`}>
            <Button size="sm">
              <Plus className="h-4 w-4" /> Create shop
            </Button>
          </Link>
        }
      />
      <SuperAdminNav />
      <div className="space-y-6 p-6">
        {shops.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-bg-surface p-12 text-center text-sm text-text-muted">
            <Store className="mx-auto h-8 w-8" aria-hidden />
            <p className="mt-4">No shops yet — create the first one.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-bg-surface">
            <table className="w-full text-sm" aria-label="Platform shops">
              <thead>
                <tr className="border-b border-border bg-bg-surface-2 text-[10px] uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-left">Alias</th>
                  <th className="px-4 py-3 text-left">Members</th>
                  <th className="px-4 py-3 text-left">Created</th>
                </tr>
              </thead>
              <tbody>
                {shops.map((s) => (
                  <tr
                    key={s.id}
                    className="border-b border-border transition-colors last:border-b-0 hover:bg-bg-surface-2"
                  >
                    {/* A11Y-01 — one clickable target per row (was 4 identical
                        links). The shop name is the row's link; the remaining
                        cells are plain text so a screen reader announces a
                        single link per row. */}
                    <td className="px-4 py-3 font-medium">
                      <Link
                        href={`/${params.locale}/super-admin/shops/${s.id}`}
                        className="hover:text-accent"
                      >
                        {s.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-text-secondary">
                      {s.alias ?? <EmptyCell />}
                    </td>
                    <td className="px-4 py-3 text-xs text-text-secondary">{counts[s.id] ?? 0}</td>
                    <td className="px-4 py-3 text-xs text-text-muted">
                      {new Date(s.created_at).toLocaleDateString('en-CA')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
