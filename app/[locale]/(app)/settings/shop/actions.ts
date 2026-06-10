'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import {
  revalidatePublicShopSurfaces,
  revalidateShopConfig,
  revalidateShopRow,
} from '@/lib/server-actions/revalidate';
import { logAuditAction } from '@/lib/audit-log';
import { shopDetailsSchema, shopHoursSchema } from './schema';

const PATH = '/settings/shop';

export const updateShopDetails = withAction({
  schema: shopDetailsSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createSupabaseServerClient() as any;
    // Return the (possibly just-changed) alias so we can revalidate this shop's
    // public surfaces granularly + bust its alias-keyed slots-route cache.
    const { data, error } = await sb
      .from('shops')
      .update(input)
      .eq('id', ctx.shopId)
      .select('alias')
      .maybeSingle();
    if (error) return err('UNEXPECTED');
    const alias = (data as { alias: string | null } | null)?.alias ?? undefined;
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'shops',
      entityId: ctx.shopId,
      diff: { after: input },
    });
    revalidatePath(PATH);
    // Shop row is cached for 60s in `getCurrentShop` — bust it so the new
    // name/timezone/industry surfaces on the next render, not in a minute.
    revalidateShopRow();
    // Shop name / hours / address surface on /book + /embed — invalidate them.
    // Alias-aware (plan 017): this also busts the slots route's
    // `getCachedShopByAlias` entry (timezone / allow_booking_any_barber edits).
    revalidatePublicShopSurfaces(alias);
    // Calendar reads hours/days-off from the Data Cache — bust it.
    revalidateShopConfig(ctx.shopId);
    return ok({ ok: true });
  },
});

export const updateShopHours = withAction({
  schema: shopHoursSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createSupabaseServerClient() as any;
    // Upsert each weekday row. shop_hours has UNIQUE (shop_id, weekday).
    const rows = input.map((h) => ({ shop_id: ctx.shopId, ...h }));
    const { error } = await sb.from('shop_hours').upsert(rows, { onConflict: 'shop_id,weekday' });
    if (error) return err('UNEXPECTED');
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'shop_hours',
      diff: { after: input },
    });
    revalidatePath(PATH);
    // Shop hours surface on /book + /embed — invalidate them. No-arg global
    // purge (plan 017 fallback): this action upserts shop_hours and never loads
    // the shops row, so the alias isn't in reach. The slots route's hours cache
    // is busted precisely below via revalidateShopConfig (shop-hours tag), so
    // the coarse page purge here is the only thing left at shop-uniform grain.
    revalidatePublicShopSurfaces();
    // Calendar reads hours/days-off from the Data Cache — bust it.
    revalidateShopConfig(ctx.shopId);
    return ok({ ok: true });
  },
});
