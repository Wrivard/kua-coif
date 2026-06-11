import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireShopMember } from '@/lib/auth/server';
import type { UserRole, ShopMemberStatus } from '@/db/enums';
import { UsersClient, type MemberView } from './users-client';

export const dynamic = 'force-dynamic';

export default async function UsersPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);
  await requireShopMember({ locale });

  const supabase = createSupabaseServerClient();
  // Pivot members → profile email/name, joined in-code.
  const [membersRes, profilesRes] = await Promise.all([
    supabase
      .from('shop_members')
      .select('id, user_id, role, status, created_at')
      .order('created_at', { ascending: true }),
    supabase.from('profiles').select('id, email, full_name'),
  ]);

  const members = membersRes.data ?? [];
  const profiles = profilesRes.data ?? [];
  const profilesById = new Map(profiles.map((p) => [p.id, p]));

  const view: MemberView[] = members.map((m) => {
    const p = profilesById.get(m.user_id);
    return {
      id: m.id,
      user_id: m.user_id,
      email: p?.email ?? '?',
      full_name: p?.full_name ?? null,
      role: m.role,
      status: m.status,
      created_at: m.created_at,
    };
  });

  return <UsersClient members={view} />;
}
