import { requireKuaAdmin } from '@/lib/auth/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { PlatformConfigClient } from './platform-config-client';

// Phase F — super-admin only. Single-row platform_config table holds
// Küa-wide settings; today it's the application fee BPS that drives
// every Stripe Connect destination charge. Future siblings (signup
// gating, feature flags, etc.) land in this same row.
export const dynamic = 'force-dynamic';

export default async function PlatformConfigPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;
  // requireKuaAdmin redirects non-admins to /no-shop so the existence
  // of /admin/platform-config isn't leaked to logged-in shop members.
  await requireKuaAdmin();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createSupabaseServiceRoleClient() as any;
  const res = await sb
    .from('platform_config')
    .select('app_fee_bps, updated_at, updated_by')
    .eq('id', 1)
    .single();
  const row = res.data as {
    app_fee_bps: number;
    updated_at: string;
    updated_by: string | null;
  } | null;

  // Resolve the updater's email so the audit-trail line shows
  // something meaningful. Best-effort: null when the profile is
  // missing (e.g. updater was deleted).
  let updatedByEmail: string | null = null;
  if (row?.updated_by) {
    const profileRes = await sb.from('profiles').select('email').eq('id', row.updated_by).single();
    updatedByEmail = (profileRes.data as { email: string } | null)?.email ?? null;
  }

  return (
    <PlatformConfigClient
      initialAppFeeBps={row?.app_fee_bps ?? 0}
      updatedAt={row?.updated_at ?? null}
      updatedByEmail={updatedByEmail}
      historyHref={`/${params.locale}/super-admin/platform-config/history`}
    />
  );
}
