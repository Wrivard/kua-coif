'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { revalidatePublicShopSurfaces } from '@/lib/server-actions/revalidate';
import { logAuditAction } from '@/lib/audit-log';
import { widgetConfigSchema, type WidgetConfig } from '@/lib/business/widget-config';

const PATH = '/settings/widget';

/**
 * Update a shop's widget_config. Scoped to the current shop (RLS + ctx.shopId).
 * The Zod schema in `lib/business/widget-config.ts` is the source of truth for
 * field shape; this action just validates + persists.
 */
export const upsertWidgetConfig = withAction({
  schema: widgetConfigSchema,
  minRole: 'manager',
  run: async (input: WidgetConfig, ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createSupabaseServerClient() as any;
    const { error } = await sb.from('shops').update({ widget_config: input }).eq('id', ctx.shopId);
    if (error) return err('UNEXPECTED');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'shops',
      entityId: ctx.shopId,
      diff: { after: { widget_config: input } },
    });
    revalidatePath(PATH);
    // Widget config drives the rendered embed page — bust its cache too.
    revalidatePublicShopSurfaces();
    return ok({ ok: true });
  },
});
