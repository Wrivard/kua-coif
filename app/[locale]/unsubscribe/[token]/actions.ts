'use server';

import { getClientIp } from '@/lib/security/client-ip';
import { z } from 'zod';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import { err, ok, type Result } from '@/lib/server-actions/result';
import { captureException } from '@/lib/observability';
import { logDurableAudit } from '@/lib/audit-log';
import { verifyToken } from '@/lib/security/signed-tokens';

/**
 * Clients audit W6b — public marketing unsubscribe (CASL).
 *
 * Auth is the signed `unsub` token only — no user session. We re-verify
 * the token server-side (the page-level verify is UX only, never
 * trusted by the action). Idempotent: unsubscribing an already-opted-
 * out client is a no-op success.
 *
 * Rate-limited by IP so a leaked token can't be hammered — though the
 * worst a leaked token can do is opt ONE client OUT of marketing (the
 * privacy-preserving direction), reversible by an admin from the fiche.
 */

const schema = z.object({
  token: z.string().trim().min(10).max(4096),
});

export type UnsubscribeInput = z.infer<typeof schema>;

export async function unsubscribeFromMarketing(
  raw: UnsubscribeInput,
): Promise<Result<{ done: true }>> {
  try {
    const ip = getClientIp();
    const rl = await checkRateLimit(`unsub:${ip}`, { max: 30, windowMs: 10 * 60 * 1000 });
    if (!rl.allowed) return err('RATE_LIMITED');

    const parsed = schema.safeParse(raw);
    if (!parsed.success) return err('INVALID_INPUT');

    const payload = verifyToken(parsed.data.token, 'unsub');
    if (!payload) return err('INVALID_INPUT');

    const supabase = createSupabaseServiceRoleClient();

    // Token carries only the client_id — resolve the rest from the DB.
    // Skip anonymized rows (Loi 25 erasure): nothing left to manage.
    const clientRes = await supabase
      .from('clients')
      .select('id, shop_id, anonymized_at, marketing_opted_out')
      .eq('id', payload.resourceId)
      .limit(1);
    const client = (clientRes.data ?? [])[0];
    if (!client || client.anonymized_at) return err('NOT_FOUND');

    // Already opted out → idempotent success, no write, no audit noise.
    if (client.marketing_opted_out) return ok({ done: true });

    const { error } = await supabase
      .from('clients')
      .update({ marketing_opted_out: true })
      .eq('id', client.id);
    if (error) return err('UNEXPECTED');

    // Durable, PII-redacted audit trail (service-role write bypasses RLS).
    // Actor = all-zeros sentinel (no user session — the client acted on
    // themselves via the signed token), matching submitPublicReview.
    await logDurableAudit({
      shopId: client.shop_id,
      actorId: '00000000-0000-0000-0000-000000000000',
      action: 'custom',
      entity: 'clients',
      entityId: client.id,
      diff: { marketing_opted_out: true, source: 'unsubscribe-token' },
    });

    return ok({ done: true });
  } catch (e) {
    captureException(e, { tags: { layer: 'unsubscribe', stage: 'opt-out' } });
    return err('UNEXPECTED');
  }
}
