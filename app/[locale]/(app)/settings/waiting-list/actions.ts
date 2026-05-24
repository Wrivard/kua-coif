'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { logAuditAction } from '@/lib/audit-log';

export const waitingListSchema = z.object({
  enabled: z.boolean(),
  threshold_hours: z.number().int().min(0).max(72),
});
export type WaitingListInput = z.infer<typeof waitingListSchema>;

export const upsertWaitingList = withAction({
  schema: waitingListSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createSupabaseServerClient() as any;
    const { error } = await sb
      .from('waiting_list_config')
      .upsert({ shop_id: ctx.shopId, ...input }, { onConflict: 'shop_id' });
    if (error) return err('UNEXPECTED');
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'waiting_list_config',
      diff: { after: input },
    });
    revalidatePath('/settings/waiting-list');
    return ok({ ok: true });
  },
});
