'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { logAuditAction } from '@/lib/audit-log';
import { inviteUserSchema, removeMemberSchema, updateMemberSchema } from './schema';

const PATH = '/settings/users';

/**
 * V1 invitation flow:
 *  - If a profile already exists with that email, add a `shop_members` row
 *    immediately with status='confirmed'. The user shows up on next login.
 *  - Otherwise, mark the membership as `status='staff'` (used by the spec as
 *    "pending" — they exist in the shop but haven't accepted yet). When the
 *    user signs up later with that email, the trigger `tg_create_profile_on_signup`
 *    creates the profile and an admin can flip status to 'confirmed'.
 *
 * V1.1 will plug Supabase Auth `inviteUserByEmail` + Resend so a real email
 * invitation gets sent. Hook ready: `auth.admin.inviteUserByEmail(email)`.
 */
export const inviteUser = withAction({
  schema: inviteUserSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createSupabaseServiceRoleClient() as any;

    // 1. Look up profile by email.
    const profileRes = await sb
      .from('profiles')
      .select('id, email')
      .eq('email', input.email)
      .limit(1);
    const profile = ((profileRes.data as Array<{ id: string; email: string }> | null) ?? [])[0];

    if (profile) {
      // Already a registered user — link them straight away.
      // Refuse if they're already a member (any status).
      const existing = await sb
        .from('shop_members')
        .select('id, status')
        .eq('shop_id', ctx.shopId)
        .eq('user_id', profile.id)
        .limit(1);
      const existingRow = ((existing.data as Array<{ id: string; status: string }> | null) ??
        [])[0];
      if (existingRow) return err('CONFLICT');

      const ins = await sb.from('shop_members').insert({
        shop_id: ctx.shopId,
        user_id: profile.id,
        role: input.role,
        status: 'confirmed',
      });
      if (ins.error) return err('UNEXPECTED');

      await logAuditAction({
        shopId: ctx.shopId,
        actorId: ctx.userId,
        action: 'insert',
        entity: 'shop_members',
        diff: { email: input.email, role: input.role, status: 'confirmed' },
      });
      revalidatePath(PATH);
      return ok({ status: 'confirmed' as const });
    }

    // No profile yet — record a pending membership keyed by email. We can't
    // insert a shop_members row (needs user_id FK), so we stash the invite in
    // a lightweight pending table. For V1 we just return INVALID_INPUT and
    // surface a helpful message client-side ("ask them to sign up first").
    // V1.1 will introduce a pending_invitations table + Supabase invite.
    return err('NOT_FOUND');
  },
});

export const updateMember = withAction({
  schema: updateMemberSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createSupabaseServerClient() as any;
    const { error } = await sb
      .from('shop_members')
      .update({ role: input.role, status: input.status })
      .eq('id', input.member_id)
      .eq('shop_id', ctx.shopId);
    if (error) return err('UNEXPECTED');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'shop_members',
      entityId: input.member_id,
      diff: { role: input.role, status: input.status },
    });
    revalidatePath(PATH);
    return ok({ id: input.member_id });
  },
});

export const removeMember = withAction({
  schema: removeMemberSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    // Soft delete: flip status to 'deleted' — preserves audit history.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createSupabaseServerClient() as any;
    const { error } = await sb
      .from('shop_members')
      .update({ status: 'deleted' })
      .eq('id', input.member_id)
      .eq('shop_id', ctx.shopId);
    if (error) return err('UNEXPECTED');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'shop_members',
      entityId: input.member_id,
      diff: { status: 'deleted' },
    });
    revalidatePath(PATH);
    return ok({ id: input.member_id });
  },
});
