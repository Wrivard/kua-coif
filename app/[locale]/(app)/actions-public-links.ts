'use server';

import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { signToken } from '@/lib/security/signed-tokens';

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
      .select('id, client_id, shop_id')
      .eq('id', input.appointment_id)
      .eq('shop_id', ctx.shopId)
      .limit(1);
    const appt = ((apptRes.data as Array<{
      id: string;
      client_id: string;
      shop_id: string;
    }> | null) ?? [])[0];
    if (!appt) return err('NOT_FOUND');

    // 90-day review link, 365-day /me link. Review needs a tighter
    // window so old appointments don't pile up unhandled requests; the
    // /me link is the customer's permanent self-service handle.
    const reviewToken = signToken({
      kind: 'review',
      resourceId: appt.id,
      expiresInSeconds: 60 * 60 * 24 * 90,
    });
    const meToken = signToken({
      kind: 'me',
      resourceId: appt.client_id,
      expiresInSeconds: 60 * 60 * 24 * 365,
    });

    // Use NEXT_PUBLIC_APP_URL when set (Vercel prod / preview), else
    // a relative path the caller will prefix with window.location.origin.
    const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? '';
    return ok({
      reviewUrl: `${base}/fr/review/${reviewToken}`,
      meUrl: `${base}/fr/me/${meToken}`,
    });
  },
});
