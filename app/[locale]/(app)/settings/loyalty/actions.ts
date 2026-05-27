'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { logAuditAction } from '@/lib/audit-log';
// Schema lives in `./schema` because `'use server'` files can only
// export async functions — Zod schemas are object values. Without
// this split the client crashes at `zodResolver(undefined)`. The
// client imports `LoyaltyInput` + `loyaltySchema` directly from
// `./schema` — actions.ts no longer re-exports them.
import { loyaltySchema } from './schema';

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
