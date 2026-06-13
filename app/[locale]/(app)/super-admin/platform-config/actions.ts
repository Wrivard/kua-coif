'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireKuaAdmin, getCurrentUser } from '@/lib/auth/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { captureException } from '@/lib/observability';
import { logDurableAudit } from '@/lib/audit-log';
import { invalidatePlatformConfigCache } from '@/lib/stripe/platform-config';

// Phase F — super-admin only.
//
// Validates the input as a basis-point integer (0..10000 = 0..100%).
// The form submits as a string ("1.5" for 1.5%) so we parse + multiply
// here. Rejecting > 100% protects against an admin typo emptying the
// shops' revenue.

const updateAppFeeSchema = z.object({
  // Accept the percentage as either a number (form serialization) or
  // a decimal string. We multiply by 100 to convert to BPS so 1.5%
  // becomes 150 BPS. Cap at 10% to prevent obvious foot-guns; the
  // BPS column itself allows up to 100% but a 10% cap on this UI is
  // a reasonable guard rail.
  app_fee_pct: z.coerce.number().min(0, 'pct_min').max(10, 'pct_max'),
});

export type UpdateAppFeeState =
  | { kind: 'idle' }
  | { kind: 'invalid'; fieldErrors: Record<string, string> }
  | { kind: 'error'; message: string }
  | { kind: 'saved'; appFeeBps: number };

export async function updatePlatformAppFee(
  _prev: UpdateAppFeeState | undefined,
  formData: FormData,
): Promise<UpdateAppFeeState> {
  await requireKuaAdmin();
  const user = await getCurrentUser();
  if (!user) {
    // requireKuaAdmin would have redirected, but the type narrowing
    // wants the guard.
    return { kind: 'error', message: 'No user' };
  }

  const parsed = updateAppFeeSchema.safeParse({
    app_fee_pct: formData.get('app_fee_pct'),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path[0];
      if (typeof path === 'string') fieldErrors[path] = issue.message;
    }
    return { kind: 'invalid', fieldErrors };
  }

  // Convert percentage → basis points. Round to avoid float drift
  // (1.5 * 100 in JS = 150.00000000000003 ; Math.round catches it).
  const bps = Math.round(parsed.data.app_fee_pct * 100);

  try {
    const sb = createSupabaseServiceRoleClient();

    // Phase H+6 — read the OLD value first so we can log a history
    // row with both old and new. If the read fails we still proceed
    // with the update (the audit log + Sentry catch any oddity).
    const priorRes = await sb
      .from('platform_config')
      .select('app_fee_bps')
      .eq('id', 1)
      .maybeSingle();
    const oldBps = priorRes.data?.app_fee_bps ?? 0;

    const res = await sb
      .from('platform_config')
      .update({
        app_fee_bps: bps,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      })
      .eq('id', 1);
    if (res.error) {
      return { kind: 'error', message: res.error.message };
    }

    // Phase H+6 — append the history log row. Best-effort: a failed
    // log shouldn't block the actual config change (which already
    // succeeded above). Sentry catches if it goes wrong.
    if (oldBps !== bps) {
      try {
        await sb.from('platform_config_history').insert({
          changed_by: user.id,
          old_app_fee_bps: oldBps,
          new_app_fee_bps: bps,
        });
      } catch (e) {
        captureException(e, {
          tags: { layer: 'platform-config', stage: 'history-log' },
        });
      }

      // AUDIT-02 — durable, attributed trail of the app-fee change, independent
      // of the best-effort history insert above (swallowed on error). The app-
      // fee applies to EVERY shop's every transaction, so "who changed it, from
      // what, to what" must survive even if the history row fails. platform_config
      // is platform-level (no shop): the nil-uuid sentinel mirrors the public-anon
      // actorId convention already used in audit_log.
      await logDurableAudit({
        shopId: '00000000-0000-0000-0000-000000000000',
        actorId: user.id,
        action: 'update',
        entity: 'platform_config',
        entityId: '1',
        diff: { old_app_fee_bps: oldBps, new_app_fee_bps: bps },
      });
    }

    // Flip the in-memory cache so the next PI mint reads the new
    // value immediately instead of waiting up to 30s.
    invalidatePlatformConfigCache();
    // Phase H+4 — page moved under the locale-prefixed shell.
    revalidatePath('/[locale]/(app)/super-admin/platform-config', 'page');
    revalidatePath('/[locale]/(app)/super-admin/platform-config/history', 'page');
    revalidatePath('/[locale]/(app)/super-admin', 'page');
    revalidatePath('/[locale]/(app)/settings/payments', 'page');
    return { kind: 'saved', appFeeBps: bps };
  } catch (e) {
    captureException(e, { tags: { layer: 'platform-config', action: 'updateAppFee' } });
    return { kind: 'error', message: e instanceof Error ? e.message : 'Unknown error' };
  }
}
