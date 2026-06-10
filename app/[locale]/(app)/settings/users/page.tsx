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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseServerClient() as any;
  // Pivot members → profile email/name. We join in-code since the
  // codegen types aren't live yet.
  const [membersRes, profilesRes] = await Promise.all([
    supabase
      .from('shop_members')
      .select('id, user_id, role, status, created_at')
      .order('created_at', { ascending: true }),
    supabase.from('profiles').select('id, email, full_name'),
  ]);

  const members =
    (membersRes.data as Array<{
      id: string;
      user_id: string;
      role: UserRole;
      status: ShopMemberStatus;
      created_at: string;
    }> | null) ?? [];
  const profiles =
    (profilesRes.data as Array<{
      id: string;
      email: string;
      full_name: string | null;
    }> | null) ?? [];
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
