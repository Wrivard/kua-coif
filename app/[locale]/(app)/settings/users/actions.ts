'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { logAuditAction } from '@/lib/audit-log';
import { defaultLocale } from '@/i18n';
import { inviteUserSchema, removeMemberSchema, updateMemberSchema } from './schema';

const PATH = '/settings/users';

// The invite action returns either 'confirmed' (existing profile linked
// straight away) or 'staff' (invitation email sent, awaiting setup-password).
// Extracted so both branches of `inviteUser` infer the same union type — TS
// otherwise narrows to whichever literal it sees first.
type InviteResult = { status: 'confirmed' | 'staff' };

/**
 * Whitelist invite flow (Phase 22).
 *
 * Two paths depending on whether the email already has a Küa profile:
 *
 *   A) **Profile exists** (multi-shop scenario — they're already a member of
 *      another shop): link them to this shop with `status='confirmed'`
 *      immediately. No email sent — they keep their existing password.
 *
 *   B) **No profile**: call Supabase's `auth.admin.inviteUserByEmail`. Supabase
 *      creates the `auth.users` row (the `tg_create_profile_on_signup`
 *      trigger then fills in `profiles`) and ships an invitation email with
 *      a PKCE link landing on `/<locale>/setup-password`. We pre-create
 *      `shop_members(role, status='staff')` so the invitee shows up as
 *      pending in `/settings/users` right away; status flips to 'confirmed'
 *      when they finish setup.
 *
 * Self-signups are off at the Supabase Auth dashboard level since Phase 22,
 * so `inviteUserByEmail` is the only way an account gets created.
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

    // Common pre-check: refuse if they're already a member of this shop
    // (covers both paths — re-linking an existing profile or re-inviting an
    // already-invited address).
    if (profile) {
      const existing = await sb
        .from('shop_members')
        .select('id, status')
        .eq('shop_id', ctx.shopId)
        .eq('user_id', profile.id)
        .limit(1);
      const existingRow = ((existing.data as Array<{ id: string; status: string }> | null) ??
        [])[0];
      if (existingRow) return err('CONFLICT');
    }

    // ── Path A: existing profile → confirm immediately ───────────────────
    if (profile) {
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
      return ok<InviteResult>({ status: 'confirmed' });
    }

    // ── Path B: invite a brand-new user ──────────────────────────────────
    const origin = headers().get('origin') ?? process.env.NEXT_PUBLIC_SITE_URL ?? '';
    const inviteRes = await sb.auth.admin.inviteUserByEmail(input.email, {
      redirectTo: `${origin}/${defaultLocale}/setup-password`,
    });
    if (inviteRes.error || !inviteRes.data?.user) {
      // Most common case: Supabase rejects because the email is already in
      // `auth.users` but had no matching `profiles` row (rare race). We
      // surface a clean CONFLICT instead of leaking the raw Supabase error.
      return err('CONFLICT');
    }
    const newUserId = inviteRes.data.user.id as string;

    const ins = await sb.from('shop_members').insert({
      shop_id: ctx.shopId,
      user_id: newUserId,
      role: input.role,
      status: 'staff', // pending — flips to 'confirmed' on /setup-password completion
    });
    if (ins.error) return err('UNEXPECTED');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'insert',
      entity: 'shop_members',
      diff: { email: input.email, role: input.role, status: 'staff', invited: true },
    });
    revalidatePath(PATH);
    return ok<InviteResult>({ status: 'staff' });
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
