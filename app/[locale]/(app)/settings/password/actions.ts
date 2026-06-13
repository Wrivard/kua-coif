'use server';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { mapSupabaseAuthError } from '@/lib/auth/errors';
import { logDurableAudit } from '@/lib/audit-log';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import { changePasswordSchema } from './schema';

export const changePassword = withAction({
  schema: changePasswordSchema,
  minRole: 'barber',
  run: async (input, ctx) => {
    const supabase = createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) return err('UNAUTHENTICATED');

    // Security audit #11 — rate-limit the verify step. A compromised
    // session could brute-force the current password via this
    // endpoint (it doubles as a "verify password" oracle). Supabase
    // Auth has its own server-side limits on signInWithPassword but
    // they're per-IP and looser than what's appropriate here. 10 per
    // hour per user accommodates a forgetful operator + retry, and
    // throttles automated brute-force.
    const rl = await checkRateLimit(`changepw:${user.id}`, {
      max: 10,
      windowMs: 60 * 60 * 1000,
    });
    if (!rl.allowed) return err('RATE_LIMITED');

    // Re-auth with the current password (Supabase doesn't expose a direct
    // "verify password" call, so we sign in with it as a verification step).
    const verify = await supabase.auth.signInWithPassword({
      email: user.email,
      password: input.current_password,
    });
    if (verify.error) {
      // Map the Supabase error code through our safe translator. If it's an
      // invalid_credentials, that means the current password is wrong.
      const code = mapSupabaseAuthError(verify.error);
      return err(code === 'INVALID_CREDENTIALS' ? 'INVALID_INPUT' : 'UNEXPECTED');
    }

    const { error } = await supabase.auth.updateUser({ password: input.new_password });
    if (error) return err('UNEXPECTED');

    // Loop 30 (P2.104) — password change is a security-relevant event; log it
    // so a compromised account leaves a trail. SOP-07: `auth.users` has no
    // audit trigger and logAuditAction would be silently dropped by audit_log
    // RLS, so a durable (service-role) write is the only path that actually
    // lands. The diff carries NO password material — just the fact of change.
    await logDurableAudit({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'users',
      entityId: user.id,
      diff: { password_changed: true },
    });

    return ok({ ok: true });
  },
});
