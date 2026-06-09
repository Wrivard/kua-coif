import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
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

// Same key policy as the audit-log redaction trigger (20260608130000): mask
// contact + financial PII, keep names (needed to identify the row). Recursive
// so nested diffs like { after: { email } } are covered.
const AUDIT_PII_KEYS = new Set([
  'email',
  'phone',
  'notes',
  'date_of_birth',
  'dob',
  'legal_name',
  'destination_last4',
  'destination_bank_name',
  'client_name_snapshot',
  'sin',
  'tax_id',
]);

export function redactAuditPii(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redactAuditPii);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = AUDIT_PII_KEYS.has(k) && val != null ? '[redacted]' : redactAuditPii(val);
    }
    return out;
  }
  return v;
}

/**
 * Durable audit write via the SERVICE-ROLE client. `logAuditAction` above uses
 * the user-session client, whose insert is silently DROPPED by audit_log RLS
 * (the table has no user INSERT policy — only the SECURITY DEFINER table
 * triggers write to it). Use THIS for sensitive ops the triggers can't capture
 * on their own: a Loi 25 export does no DB write (no trigger fires at all), and
 * the export/anonymize/merge SEMANTICS would otherwise be lost. The diff is
 * PII-redacted with the same policy as the trigger so the service-role bypass
 * can't leak raw contact/financial data into audit_log.
 */
export async function logDurableAudit(args: LogArgs) {
  try {
    const admin = createSupabaseServiceRoleClient() as unknown as {
      from: (t: string) => {
        insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
      };
    };
    await admin.from('audit_log').insert({
      shop_id: args.shopId,
      actor_id: args.actorId,
      action: args.action,
      entity: args.entity,
      entity_id: args.entityId ?? null,
      diff: args.diff ? redactAuditPii(args.diff) : null,
    });
  } catch (e) {
    captureException(e, { tags: { layer: 'audit-log-durable' } });
  }
}
