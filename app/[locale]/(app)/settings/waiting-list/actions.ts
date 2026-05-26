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

// ── Phase 53 — entry lifecycle ────────────────────────────────────────
// Admin-side updates: mark notified, mark cancelled, mark booked. Public
// inserts are handled by `addToWaitlistPublic` in
// `app/[locale]/book/[shopSlug]/actions.ts` (it bypasses RLS via the
// service-role client so anonymous visitors can self-serve).

const updateEntryStatusSchema = z.object({
  entry_id: z.string().uuid(),
  status: z.enum(['waiting', 'notified', 'booked', 'cancelled']),
});

export const updateWaitlistEntryStatus = withAction({
  schema: updateEntryStatusSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createSupabaseServerClient() as any;
    const patch: Record<string, unknown> = { status: input.status };
    if (input.status === 'notified') patch.notified_at = new Date().toISOString();
    const { error } = await sb
      .from('waiting_list_entries')
      .update(patch)
      .eq('id', input.entry_id)
      .eq('shop_id', ctx.shopId);
    if (error) return err('UNEXPECTED');
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'waiting_list_entries',
      entityId: input.entry_id,
      diff: { status: input.status },
    });
    revalidatePath('/settings/waiting-list');
    return ok({ ok: true });
  },
});

const deleteEntrySchema = z.object({
  entry_id: z.string().uuid(),
});

export const deleteWaitlistEntry = withAction({
  schema: deleteEntrySchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createSupabaseServerClient() as any;
    const { error } = await sb
      .from('waiting_list_entries')
      .delete()
      .eq('id', input.entry_id)
      .eq('shop_id', ctx.shopId);
    if (error) return err('UNEXPECTED');
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'delete',
      entity: 'waiting_list_entries',
      entityId: input.entry_id,
    });
    revalidatePath('/settings/waiting-list');
    return ok({ ok: true });
  },
});
