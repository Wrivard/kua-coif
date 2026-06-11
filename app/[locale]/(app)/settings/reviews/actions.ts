'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withAction } from '@/lib/server-actions/with-action';
import type { Database } from '@/db/types';
import { err, ok } from '@/lib/server-actions/result';
import { logAuditAction } from '@/lib/audit-log';

/**
 * Phase 63c — Admin moderation actions for reviews.
 *
 * The Phase 63 schema landed `reviews` with status `pending | published
 * | rejected`. Admin moderates by transitioning the status; `published`
 * stamps `published_at` so we can surface "most recent" lists on the
 * future public page.
 */

const moderateSchema = z.object({
  review_id: z.string().uuid(),
  status: z.enum(['pending', 'published', 'rejected']),
});

export const moderateReview = withAction({
  schema: moderateSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const sb = createSupabaseServerClient();
    const patch: Database['public']['Tables']['reviews']['Update'] = { status: input.status };
    if (input.status === 'published') patch.published_at = new Date().toISOString();
    const { error } = await sb
      .from('reviews')
      .update(patch)
      .eq('id', input.review_id)
      .eq('shop_id', ctx.shopId);
    if (error) return err('UNEXPECTED');
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'reviews',
      entityId: input.review_id,
      diff: { status: input.status },
    });
    revalidatePath('/settings/reviews');
    return ok({ ok: true });
  },
});

const deleteSchema = z.object({ review_id: z.string().uuid() });

export const deleteReview = withAction({
  schema: deleteSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const sb = createSupabaseServerClient();
    const { error } = await sb
      .from('reviews')
      .delete()
      .eq('id', input.review_id)
      .eq('shop_id', ctx.shopId);
    if (error) return err('UNEXPECTED');
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'delete',
      entity: 'reviews',
      entityId: input.review_id,
    });
    revalidatePath('/settings/reviews');
    return ok({ ok: true });
  },
});
