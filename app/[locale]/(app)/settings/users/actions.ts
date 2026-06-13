'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { headers } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { MEMBERSHIPS_CACHE_TAG } from '@/lib/auth/server';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { logAuditAction, logDurableAudit } from '@/lib/audit-log';
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
    // W1a — mirror updateMember's owner-guard (see `updateMember` below /
    // migration 20260528070000): a manager must not be able to invite or
    // link a member as `owner`. Placed at the top of `run` so it covers BOTH
    // the existing-profile (Path A) and brand-new-invite (Path B) branches.
    if (input.role === 'owner' && ctx.role !== 'owner') {
      return err('FORBIDDEN', { reason: 'owner_invite_requires_owner' });
    }

    const sb = createSupabaseServiceRoleClient();

    // 1. Look up profile by email.
    const profileRes = await sb
      .from('profiles')
      .select('id, email')
      .eq('email', input.email)
      .limit(1);
    const profile = (profileRes.data ?? [])[0];

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
      const existingRow = (existing.data ?? [])[0];
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

      // SOP-06 — the insert above runs through the service-role client, so the
      // shop_members audit trigger records actor_id = NULL ("system"). Add a
      // durable, attributed record so the trail shows WHO granted this
      // membership. No raw PII in the diff — the invited user_id suffices
      // (email would only be redacted by logDurableAudit anyway).
      await logDurableAudit({
        shopId: ctx.shopId,
        actorId: ctx.userId,
        action: 'insert',
        entity: 'shop_members',
        diff: { invited_user_id: profile.id, role: input.role, status: 'confirmed' },
      });
      revalidatePath(PATH);
      // AUTHZ-R1 — a new confirmed membership changes the invitee's role set;
      // bust the 60s memberships cache so role/membership gates see it now.
      revalidateTag(MEMBERSHIPS_CACHE_TAG);
      return ok<InviteResult>({ status: 'confirmed' });
    }

    // ── Path B: invite a brand-new user ──────────────────────────────────
    const origin = (await headers()).get('origin') ?? process.env.NEXT_PUBLIC_SITE_URL ?? '';
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

    // SOP-06 — service-role insert ⇒ trigger logs actor_id = NULL; add a
    // durable attributed record (see Path A). No raw PII in the diff.
    await logDurableAudit({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'insert',
      entity: 'shop_members',
      diff: { invited_user_id: newUserId, role: input.role, status: 'staff', invited: true },
    });
    revalidatePath(PATH);
    // AUTHZ-R1 — bust the memberships cache (mirror Path A).
    revalidateTag(MEMBERSHIPS_CACHE_TAG);
    return ok<InviteResult>({ status: 'staff' });
  },
});

/**
 * Security audit #1 (CRITICAL) — privilege-escalation hardening.
 *
 * Pre-fix, `updateMember` accepted any `role` from a `minRole: 'manager'`
 * caller. A manager could send `{member_id: <their own row>, role: 'owner'}`
 * and the RLS rule (which only requires `has_role_in_shop(shop_id, 'manager')`)
 * happily applied it. Result: silent self-promotion to owner.
 *
 * Two business rules added here that the schema can't express:
 *   - Only an owner can grant or revoke the `owner` role.
 *   - No one can edit their own membership row's role/status. Even an
 *     owner must demote themselves through a different member's action
 *     (prevents single-owner accidentally locking themselves out).
 *
 * `removeMember` gets the same guards: no self-removal, and a non-owner
 * caller can't remove an owner.
 */
export const updateMember = withAction({
  schema: updateMemberSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const sb = createSupabaseServerClient();

    // Look up the target row so we can compare prior role to requested
    // role + verify shop scope server-side (RLS would catch it too but
    // we want the explicit refusal, not a silent 0-row update).
    const targetRes = await sb
      .from('shop_members')
      .select('user_id, role')
      .eq('id', input.member_id)
      .eq('shop_id', ctx.shopId)
      .single();
    const target = targetRes.data;
    if (!target) return err('NOT_FOUND');

    // Block self-edit: a member can't touch their own role/status. The
    // UI hides these affordances on the self row but a hand-crafted
    // POST would otherwise bypass.
    if (target.user_id === ctx.userId) {
      return err('FORBIDDEN', { reason: 'self_edit' });
    }
    // Only owners can grant OR revoke the owner role. A manager
    // promoting themselves OR demoting another owner is blocked.
    const grantingOrRevokingOwner = input.role === 'owner' || target.role === 'owner';
    if (grantingOrRevokingOwner && ctx.role !== 'owner') {
      return err('FORBIDDEN', { reason: 'owner_role_change_requires_owner' });
    }

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
      diff: {
        // Include BEFORE+AFTER so compliance trail can reconstruct
        // any privilege change.
        from_role: target.role,
        to_role: input.role,
        status: input.status,
      },
    });
    revalidatePath(PATH);
    // AUTHZ-R1 — role/status change invalidates the target's cached role.
    revalidateTag(MEMBERSHIPS_CACHE_TAG);
    return ok({ id: input.member_id });
  },
});

export const removeMember = withAction({
  schema: removeMemberSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const sb = createSupabaseServerClient();

    // Same defensive lookup as updateMember — explicit ownership check
    // beats relying on RLS for the friendly error path.
    const targetRes = await sb
      .from('shop_members')
      .select('user_id, role')
      .eq('id', input.member_id)
      .eq('shop_id', ctx.shopId)
      .single();
    const target = targetRes.data;
    if (!target) return err('NOT_FOUND');

    // No self-removal — a member resigning must be removed by someone
    // else, preventing accidental lock-out.
    if (target.user_id === ctx.userId) {
      return err('FORBIDDEN', { reason: 'self_remove' });
    }
    // Only owners can remove owners.
    if (target.role === 'owner' && ctx.role !== 'owner') {
      return err('FORBIDDEN', { reason: 'owner_remove_requires_owner' });
    }

    // Soft delete: flip status to 'deleted' — preserves audit history.
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
      diff: { status: 'deleted', from_role: target.role },
    });
    revalidatePath(PATH);
    // AUTHZ-R1 — removal (status → deleted) drops the member from the
    // confirmed set; bust so the cache stops returning them.
    revalidateTag(MEMBERSHIPS_CACHE_TAG);
    return ok({ id: input.member_id });
  },
});
