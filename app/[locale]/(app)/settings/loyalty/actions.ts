'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { logAuditAction } from '@/lib/audit-log';
import { LOYALTY_TYPES } from '@/db/enums';

export const loyaltySchema = z.object({
  enabled: z.boolean(),
  type: z.enum(LOYALTY_TYPES),
  goal_count: z.number().int().min(0).max(99999),
  min_transaction_amount: z.number().min(0).max(99999.99),
  reward_amount: z.number().min(0).max(99999.99),
  include_product_sales: z.boolean(),
  include_tips: z.boolean(),
});
export type LoyaltyInput = z.infer<typeof loyaltySchema>;

export const upsertLoyalty = withAction({
  schema: loyaltySchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createSupabaseServerClient() as any;
    const { error } = await sb
      .from('loyalty_program')
      .upsert({ shop_id: ctx.shopId, ...input }, { onConflict: 'shop_id' });
    if (error) return err('UNEXPECTED');
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'loyalty_program',
      diff: { after: input },
    });
    revalidatePath('/settings/loyalty');
    return ok({ ok: true });
  },
});
