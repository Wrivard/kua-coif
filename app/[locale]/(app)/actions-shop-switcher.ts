'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getShopMemberships, SHOP_COOKIE } from '@/lib/auth/server';
import { err, ok, type Result } from '@/lib/server-actions/result';

/**
 * Phase 65 — Multi-shop switcher action.
 *
 * Sets the `kua_active_shop` cookie to a shop the user is a confirmed
 * member of, then revalidates the app shell so the next render reads
 * the new value via `getCurrentShopId()`.
 *
 * Why a separate file (not co-located with the booking actions in
 * `app/[locale]/(app)/actions.ts`): this is a low-level auth helper
 * that we want callable from anywhere in the app shell, not part of
 * the appointments domain.
 */

const selectShopSchema = z.object({
  shop_id: z.string().uuid(),
});

export type SelectShopInput = z.infer<typeof selectShopSchema>;

export async function selectShop(raw: SelectShopInput): Promise<Result<{ ok: true }>> {
  const parsed = selectShopSchema.safeParse(raw);
  if (!parsed.success) return err('INVALID_INPUT');
  const memberships = await getShopMemberships();
  // Verify membership BEFORE setting the cookie — otherwise a hostile
  // client could craft any shop_id and read another tenant's data on
  // the next render (the `getCurrentShopId` validator catches this
  // anyway, but we'd rather refuse the request explicitly).
  if (!memberships.some((m) => m.shop_id === parsed.data.shop_id)) {
    return err('NOT_FOUND');
  }
  (await cookies()).set({
    name: SHOP_COOKIE,
    value: parsed.data.shop_id,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    // 1 year — the cookie is purely a UI preference; security is enforced
    // by re-validating against memberships on every read.
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
  });
  // Revalidate the entire app shell so `getCurrentShop`'s downstream
  // consumers (sidebar, calendar, settings) all re-fetch with the new
  // shop ID.
  revalidatePath('/', 'layout');
  return ok({ ok: true });
}
