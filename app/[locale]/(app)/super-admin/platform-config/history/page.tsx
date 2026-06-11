import Link from 'next/link';
import { ArrowLeft, TrendingDown, TrendingUp } from 'lucide-react';
import { requireKuaAdmin } from '@/lib/auth/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { SuperAdminNav } from '@/components/ui/super-admin-nav';

/**
 * Phase H+6 — append-only log of every `platform_config.app_fee_bps`
 * change. Each row records old value, new value, who, when, and an
 * optional note. Inserted by the `updatePlatformAppFee` server action
 * before mutating the live config.
 *
 * Useful for: auditing "when did we bump the fee?", noticing accidental
 * changes, and walking through fee history with a new Küa team member.
 */
export const dynamic = 'force-dynamic';

export default async function PlatformConfigHistoryPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const params = await props.params;
  await requireKuaAdmin();
  const sb = createSupabaseServiceRoleClient();

  const historyRes = await sb
    .from('platform_config_history')
    .select('id, changed_at, changed_by, old_app_fee_bps, new_app_fee_bps, note')
    .order('changed_at', { ascending: false })
    .limit(100);
  const history = historyRes.data ?? [];

  // Resolve who in one batch.
  const userIds = Array.from(new Set(history.map((h) => h.changed_by).filter(Boolean) as string[]));
  const profilesRes =
    userIds.length > 0
      ? await sb.from('profiles').select('id, email, full_name').in('id', userIds)
      : { data: [] };
  const profilesById = new Map<string, { email: string; full_name: string | null }>(
    (profilesRes.data ?? []).map((p) => [p.id, { email: p.email, full_name: p.full_name }]),
  );

  return (
    <>
      <PageHeader
        title="Platform config — history"
        subtitle="Append-only log des changements de l'application fee"
        actions={
          <Link
            href={`/${params.locale}/super-admin/platform-config`}
            className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
          >
            <ArrowLeft className="h-3 w-3" /> Back to config
          </Link>
        }
      />
      <SuperAdminNav />
      <div className="max-w-4xl space-y-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle>Historique des changements</CardTitle>
          </CardHeader>
          <CardBody>
            {history.length === 0 ? (
              <p className="text-sm text-text-secondary">
                Aucun changement enregistré pour l&apos;instant.
              </p>
            ) : (
              <div className="space-y-3">
                {history.map((h) => {
                  const profile = h.changed_by ? profilesById.get(h.changed_by) : null;
                  const direction = h.new_app_fee_bps >= h.old_app_fee_bps ? 'up' : 'down';
                  const delta = h.new_app_fee_bps - h.old_app_fee_bps;
                  return (
                    <div key={h.id} className="rounded-lg border border-border bg-bg-surface-2 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            {direction === 'up' ? (
                              <TrendingUp className="h-4 w-4 text-success" />
                            ) : (
                              <TrendingDown className="h-4 w-4 text-warning" />
                            )}
                            <span className="text-sm font-medium tabular-nums text-text-primary">
                              {(h.old_app_fee_bps / 100).toFixed(2)}% →{' '}
                              {(h.new_app_fee_bps / 100).toFixed(2)}%
                            </span>
                            <Badge variant={direction === 'up' ? 'info' : 'warning'}>
                              {delta > 0 ? '+' : ''}
                              {(delta / 100).toFixed(2)}%
                            </Badge>
                          </div>
                          <p className="text-xs text-text-muted">
                            {new Date(h.changed_at).toLocaleString('fr-CA', {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })}
                            {' · '}
                            {profile?.email ? (
                              <span className="font-mono">{profile.email}</span>
                            ) : (
                              <span className="italic text-text-muted">(user removed)</span>
                            )}
                          </p>
                          {h.note ? (
                            <p className="mt-2 text-xs italic text-text-secondary">{h.note}</p>
                          ) : null}
                        </div>
                        <div className="text-right text-[10px] text-text-muted">
                          {h.old_app_fee_bps} → {h.new_app_fee_bps} BPS
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
