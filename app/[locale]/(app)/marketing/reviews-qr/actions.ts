'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { logAuditAction } from '@/lib/audit-log';
import { reviewUrlSchema } from './schema';

/**
 * Loop 58 — save the shop's public review URL. The /marketing/reviews-qr
 * page renders a QR code pointing at whatever URL is on file.
 *
 * Manager+ only — same role gate as the rest of /settings/notifications
 * and /settings/payments. The URL is not a secret, but only managers
 * should be able to redirect shop-wide foot traffic.
 */
export const saveReviewUrl = withAction({
  schema: reviewUrlSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const next = input.public_review_url.trim();
    const sb = createSupabaseServerClient();
    const { error } = await sb
      .from('shops')
      .update({ public_review_url: next === '' ? null : next })
      .eq('id', ctx.shopId);
    if (error) return err('UNEXPECTED');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'shops',
      entityId: ctx.shopId,
      diff: { public_review_url_set: next !== '' },
    });
    revalidatePath('/marketing/reviews-qr');
    return ok({ ok: true });
  },
});
