import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireRoleInCurrentShop, requireShopMember } from '@/lib/auth/server';
import type { Json } from '@/db/types';
import { AuditLogClient, type AuditLogRow } from './audit-log-client';

export const dynamic = 'force-dynamic';

/**
 * Audit log admin view — added in Phase 17 (Phase 15 review flagged the
 * `audit_log` table as having no admin surface). RLS already gates this to
 * managers + owners; we add a defensive `requireRoleInCurrentShop` check on
 * top so a barber accessing the URL gets a clean redirect instead of an
 * empty result set.
 *
 * Read-only by design — no edit, no delete. The table is the system of
 * record for "who did what" and should be immutable from the UI.
 *
 * V1 hard-codes the limit at 100 entries (most-recent-first). A V1.1 pass
 * can add filters (entity, actor, date range) and cursor pagination.
 */
export default async function AuditLogPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const { locale } = params;

  setRequestLocale(locale);
  await requireShopMember({ locale });
  await requireRoleInCurrentShop('manager');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createSupabaseServerClient() as any;
  // Pull the latest 100 entries. We don't fetch the `diff` JSON here because
  // it can be large — the client renders a "view" expandable that re-queries
  // by id (V1.1). For now we include it inline so the user can copy-paste
  // when debugging; the row count is capped so payload stays manageable.
  const res = await sb
    .from('audit_log')
    .select('id, occurred_at, actor_id, action, entity, entity_id, diff')
    .order('occurred_at', { ascending: false })
    .limit(100);
  const rows =
    (res.data as Array<{
      id: number;
      occurred_at: string;
      actor_id: string | null;
      action: string;
      entity: string;
      entity_id: string | null;
      diff: Json | null;
    }> | null) ?? [];

  // Fetch actor display names in a second pass (one IN query). Cheaper than
  // a join + simpler to type-cast.
  const actorIds = Array.from(new Set(rows.map((r) => r.actor_id).filter(Boolean) as string[]));
  let actors: Record<string, { email: string; fullName: string | null }> = {};
  if (actorIds.length > 0) {
    const aRes = await sb.from('profiles').select('id, email, full_name').in('id', actorIds);
    const aRows =
      (aRes.data as Array<{ id: string; email: string; full_name: string | null }> | null) ?? [];
    actors = Object.fromEntries(
      aRows.map((a) => [a.id, { email: a.email, fullName: a.full_name }]),
    );
  }

  const enriched: AuditLogRow[] = rows.map((r) => ({
    id: r.id,
    occurred_at: r.occurred_at,
    action: r.action,
    entity: r.entity,
    entity_id: r.entity_id,
    diff: r.diff,
    actor: r.actor_id
      ? (actors[r.actor_id] ?? { email: 'unknown', fullName: null })
      : { email: 'system', fullName: null },
  }));

  return <AuditLogClient locale={locale} rows={enriched} />;
}
