'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { logAuditAction } from '@/lib/audit-log';
import { paymentProfileSchema } from './schema';

const PATH = '/settings/payments';

export const updatePaymentProfile = withAction({
  schema: paymentProfileSchema,
  minRole: 'owner',
  run: async (input, ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createSupabaseServerClient() as any;
    const { error } = await sb
      .from('payment_profiles')
      .upsert({ shop_id: ctx.shopId, ...input }, { onConflict: 'shop_id' });
    if (error) return err('UNEXPECTED');
    // Audit log purposefully omits the input payload — payment profiles can
    // include sensitive data even though our schema only allows safe fields.
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'payment_profiles',
    });
    revalidatePath(PATH);
    return ok({ ok: true });
  },
});
