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
 * Phase 63b — Public review submission.
 *
 * Auth is the signed token only — no user session. We re-verify the
 * token server-side (defense in depth; the page-level verify is for
 * UX only, never trusted by the action).
 *
 * Rate limit by IP keeps a leaked token from being exploited for
 * comment-spam, even though the token itself can only point at one
 * appointment.
 */

const schema = z.object({
  token: z.string().trim().min(10).max(4096),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).nullable(),
  client_name: z.string().trim().max(80).nullable(),
});

export type SubmitReviewInput = z.infer<typeof schema>;

export async function submitPublicReview(raw: SubmitReviewInput): Promise<Result<{ id: string }>> {
  try {
    const ip = getClientIp();
    const rl = await checkRateLimit(`review:${ip}`, { max: 20, windowMs: 10 * 60 * 1000 });
    if (!rl.allowed) return err('RATE_LIMITED');

    const parsed = schema.safeParse(raw);
    if (!parsed.success) return err('INVALID_INPUT');
    const input = parsed.data;

    const payload = verifyToken(input.token, 'review');
    if (!payload) return err('INVALID_INPUT');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createSupabaseServiceRoleClient() as any;

    // Resolve the appointment to extract shop_id + barber_id + client_id.
    // The token only carries the appointment_id — the rest comes from DB.
    const apptRes = await supabase
      .from('appointments')
      .select('id, shop_id, barber_id, client_id, public_link_version')
      .eq('id', payload.resourceId)
      .limit(1);
    const appt = ((apptRes.data as Array<{
      id: string;
      shop_id: string;
      barber_id: string;
      client_id: string;
      public_link_version: number | null;
    }> | null) ?? [])[0];
    if (!appt) return err('NOT_FOUND');
    // Revocation (plan 013): stale token version → same NOT_FOUND path as a
    // bad token (never a distinct error that would confirm the appt exists).
    if ((payload.ver ?? 0) !== (appt.public_link_version ?? 0)) return err('NOT_FOUND');

    // Block duplicate submissions — one review per appointment.
    const existingRes = await supabase
      .from('reviews')
      .select('id')
      .eq('appointment_id', appt.id)
      .limit(1);
    const existing = ((existingRes.data as Array<{ id: string }> | null) ?? [])[0];
    if (existing) return err('INVALID_INPUT');

    const insertRes = await supabase
      .from('reviews')
      .insert({
        shop_id: appt.shop_id,
        appointment_id: appt.id,
        client_id: appt.client_id,
        barber_id: appt.barber_id,
        rating: input.rating,
        comment: input.comment,
        client_name: input.client_name,
        status: 'pending', // admin moderates via /settings/reviews (Phase 63c)
      })
      .select('id')
      .single();
    if (insertRes.error || !insertRes.data) return err('UNEXPECTED');

    const reviewId = (insertRes.data as { id: string }).id;
    await logDurableAudit({
      shopId: appt.shop_id,
      actorId: '00000000-0000-0000-0000-000000000000',
      action: 'insert',
      entity: 'reviews',
      entityId: reviewId,
      diff: { rating: input.rating, source: 'public-token' },
    });
    return ok({ id: reviewId });
  } catch (e) {
    captureException(e, { tags: { layer: 'public-review-submit' } });
    return err('UNEXPECTED');
  }
}
