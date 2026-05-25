import Link from 'next/link';
import { Plus, Store } from 'lucide-react';
import { requireKuaAdmin } from '@/lib/auth/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';

export const dynamic = 'force-dynamic';

/**
 * Super-admin shop list. Lists every shop in the platform with a quick
 * snapshot (alias, owner count, member count). Service-role read so we see
 * across tenants — gated by `requireKuaAdmin` which ensures only Küa team
 * members reach the page.
 */
export default async function AdminShopsPage() {
  await requireKuaAdmin();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createSupabaseServiceRoleClient() as any;
  const shopsRes = await sb
    .from('shops')
    .select('id, name, alias, created_at')
    .order('created_at', { ascending: false });
  const shops =
    (shopsRes.data as Array<{
      id: string;
      name: string;
      alias: string | null;
      created_at: string;
    }> | null) ?? [];

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
    const rows = (cRes.data as Array<{ shop_id: string; status: string }> | null) ?? [];
    for (const r of rows) {
      if (r.status !== 'deleted') counts[r.shop_id] = (counts[r.shop_id] ?? 0) + 1;
    }
  }

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Shops</h1>
        <Link
          href="/admin/shops/new"
          className="inline-flex items-center gap-2 rounded bg-accent px-3 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover"
        >
          <Plus className="h-4 w-4" /> Create shop
        </Link>
      </div>

      {shops.length === 0 ? (
        <div className="rounded border border-dashed border-border bg-bg-surface p-10 text-center text-sm text-text-muted">
          <Store className="mx-auto h-8 w-8" aria-hidden />
          <p className="mt-3">No shops yet — create the first one.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded border border-border bg-bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-surface-2 text-[10px] uppercase tracking-wide text-text-muted">
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Alias</th>
                <th className="px-3 py-2 text-left">Members</th>
                <th className="px-3 py-2 text-left">Created</th>
              </tr>
            </thead>
            <tbody>
              {shops.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-b-0">
                  <td className="px-3 py-2 font-medium">{s.name}</td>
                  <td className="px-3 py-2 font-mono text-xs text-text-secondary">
                    {s.alias ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary">{counts[s.id] ?? 0}</td>
                  <td className="px-3 py-2 text-xs text-text-muted">
                    {new Date(s.created_at).toLocaleDateString('en-CA')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
