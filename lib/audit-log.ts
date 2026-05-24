import { createSupabaseServerClient } from '@/lib/supabase/server';
import { captureException } from '@/lib/observability';

type LogArgs = {
  shopId: string;
  actorId: string;
  action: 'insert' | 'update' | 'delete' | 'custom';
  entity: string;
  entityId?: string;
  /** Free-form payload. Keep small — DB column is jsonb. Never log SIN/Tax ID. */
  diff?: Record<string, unknown>;
};

/**
 * Server-side helper to append a row to public.audit_log. Use it from Server
 * Actions for any **non-trivial** mutation (delete, refund, role change, etc.).
 * Regular insert/update on data tables already gets logged by the SQL triggers
 * we set up in Phase 2 — this helper is for additional context the triggers
 * can't capture (which Server Action ran, which sub-step failed, …).
 *
 * Failures are swallowed (observability hook only). Audit log MUST NOT block
 * the user's mutation if it can't be written.
 */
export async function logAuditAction(args: LogArgs) {
  try {
    const supabase = createSupabaseServerClient();
    // Until db/types.ts is regenerated post-migration, cast through unknown.
    await (
      supabase as unknown as {
        from: (t: string) => {
          insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
        };
      }
    )
      .from('audit_log')
      .insert({
        shop_id: args.shopId,
        actor_id: args.actorId,
        action: args.action,
        entity: args.entity,
        entity_id: args.entityId ?? null,
        diff: args.diff ?? null,
      });
  } catch (e) {
    captureException(e, { tags: { layer: 'audit-log' } });
  }
}
