'use server';

import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { signToken } from '@/lib/security/signed-tokens';
import { logAuditAction } from '@/lib/audit-log';
import { appUrl } from '@/lib/env/app-url';

/**
 * Phase 12 (post-loop-11) — Admin-side generators for the signed public
 * URLs that drive Phase 63b (review submission) and Phase 68 (/me).
 *
 * The shop owner clicks "Send review link" or "Send self-service link"
 * on the appointment detail drawer; we mint a fresh token, paste the
 * full URL into the response, and the UI copies it to the clipboard
 * (or hands it to the email/SMS share flow in V1.1).
 *
 * Why server-side only: the signing secret is server-only. We never
 * want to ship the HMAC key to the browser even though token verify
 * happens server-side too.
 */

const schema = z.object({
  appointment_id: z.string().uuid(),
});

export const generatePublicLinks = withAction({
  schema,
  // 'barber' is the lowest non-anonymous role — any confirmed staff
  // member can mint links for an appointment in their shop.
  minRole: 'barber',
  run: async (input, ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createSupabaseServerClient() as any;
    const apptRes = await sb
      .from('appointments')
      .select('id, client_id, shop_id, barber_id')
      .eq('id', input.appointment_id)
      .eq('shop_id', ctx.shopId)
      .limit(1);
    const appt = ((apptRes.data as Array<{
      id: string;
      client_id: string;
      shop_id: string;
      barber_id: string;
    }> | null) ?? [])[0];
    if (!appt) return err('NOT_FOUND');

    // Strict-barber ownership: a barber can only mint long-lived signed
    // receipt/me/review/reschedule links for THEIR OWN appointment, not a
    // colleague's. Managers + owners can mint for any appointment in the shop.
    if (ctx.role === 'barber' && appt.barber_id !== ctx.barberId) {
      return err('FORBIDDEN', { reason: 'not_your_appointment' });
    }

    // 90-day review link, 365-day /me link, 365-day receipt link
    // (customer might pull it up months later for tax records),
    // 7-day reschedule link (must be acted on quickly — long expiries
    // invite "I'm gonna reschedule next month" forgetting).
    const reviewToken = signToken({
      kind: 'review',
      resourceId: appt.id,
      expiresInSeconds: 60 * 60 * 24 * 90,
    });
    // /me requires a client row — walk-ins (client_id null) skip it.
    const meToken = appt.client_id
      ? signToken({
          kind: 'me',
          resourceId: appt.client_id,
          expiresInSeconds: 60 * 60 * 24 * 365,
        })
      : null;
    const receiptToken = signToken({
      kind: 'receipt',
      resourceId: appt.id,
      expiresInSeconds: 60 * 60 * 24 * 365,
    });
    const rescheduleToken = signToken({
      kind: 'reschedule',
      resourceId: appt.id,
      expiresInSeconds: 60 * 60 * 24 * 7,
    });

    // Phase H — `appUrl()` centralizes the NEXT_PUBLIC_APP_URL read +
    // warns once to Sentry in production when missing. When unset, the
    // helper returns '' which produces relative paths the caller will
    // prefix with window.location.origin (existing admin drawer
    // behavior); in production the Sentry warning surfaces the gap.
    const base = appUrl();

    // Loop 30 (P2.104) — minting a signed public URL grants someone
    // unauth'd access to receipt + reschedule + review surfaces, so
    // we log it. The diff records WHICH kinds were generated (the /me
    // link is conditional on the appointment having a client_id) but
    // never the token itself — tokens are bearer credentials.
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'appointments',
      entityId: appt.id,
      diff: {
        public_links_generated: ['review', 'receipt', 'reschedule', ...(meToken ? ['me'] : [])],
      },
    });

    return ok({
      reviewUrl: `${base}/fr/review/${reviewToken}`,
      meUrl: meToken ? `${base}/fr/me/${meToken}` : null,
      receiptUrl: `${base}/fr/receipt/${receiptToken}`,
      rescheduleUrl: `${base}/fr/reschedule/${rescheduleToken}`,
    });
  },
});
