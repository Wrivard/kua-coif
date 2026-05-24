'use server';

import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { mapSupabaseAuthError } from '@/lib/auth/errors';

export const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, 'CURRENT_PASSWORD_REQUIRED'),
    new_password: z.string().min(8, 'PASSWORD_TOO_SHORT').max(72),
    confirm_password: z.string(),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    message: 'PASSWORDS_DONT_MATCH',
    path: ['confirm_password'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const changePassword = withAction({
  schema: changePasswordSchema,
  minRole: 'barber',
  run: async (input) => {
    const supabase = createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) return err('UNAUTHENTICATED');

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

    return ok({ ok: true });
  },
});
