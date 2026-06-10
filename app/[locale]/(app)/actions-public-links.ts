'use server';

import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { signToken } from '@/lib/security/signed-tokens';
import { logDurableAudit } from '@/lib/audit-log';
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
      .select('id, client_id, shop_id, barber_id, public_link_version')
      .eq('id', input.appointment_id)
      .eq('shop_id', ctx.shopId)
      .limit(1);
    const appt = ((apptRes.data as Array<{
      id: string;
      client_id: string;
      shop_id: string;
      barber_id: string;
      public_link_version: number | null;
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
      ver: appt.public_link_version ?? 0,
    });
    // /me requires a client row — walk-ins (client_id null) skip it.
    // Clients audit W5c — 90d (was 365d) bearer window + an embedded
    // revocation version so the shop can invalidate a leaked link.
    let meToken: string | null = null;
    if (appt.client_id) {
      const verRes = await sb
        .from('clients')
        .select('me_token_version')
        .eq('id', appt.client_id)
        .limit(1);
      const meVer =
        ((verRes.data as Array<{ me_token_version: number | null }> | null) ?? [])[0]
          ?.me_token_version ?? 0;
      meToken = signToken({
        kind: 'me',
        resourceId: appt.client_id,
        expiresInSeconds: 60 * 60 * 24 * 90,
        ver: meVer,
      });
    }
    const receiptToken = signToken({
      kind: 'receipt',
      resourceId: appt.id,
      expiresInSeconds: 60 * 60 * 24 * 365,
      ver: appt.public_link_version ?? 0,
    });
    const rescheduleToken = signToken({
      kind: 'reschedule',
      resourceId: appt.id,
      expiresInSeconds: 60 * 60 * 24 * 7,
      ver: appt.public_link_version ?? 0,
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
    await logDurableAudit({
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

const revokeSchema = z.object({
  appointment_id: z.string().uuid(),
});

/**
 * Plan 013 — revoke every outstanding receipt/review/reschedule link for an
 * appointment by bumping its `public_link_version`. Each token embeds the
 * version at mint time; the verify sites reject any token whose `ver` no
 * longer matches (absent ⇒ 0, so legacy links die on the first bump too).
 *
 * Manager+ only: killing a leaked bearer credential is a security action, not
 * a routine staff one. The `me` link is client-scoped (`me_token_version`) and
 * is intentionally NOT touched here.
 */
export const revokePublicLinks = withAction({
  schema: revokeSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createSupabaseServerClient() as any;
    // Ownership: read the row scoped to the caller's shop (same shape as
    // generatePublicLinks) so a manager can't revoke another shop's links.
    const apptRes = await sb
      .from('appointments')
      .select('id, public_link_version')
      .eq('id', input.appointment_id)
      .eq('shop_id', ctx.shopId)
      .limit(1);
    const appt = ((apptRes.data as Array<{
      id: string;
      public_link_version: number | null;
    }> | null) ?? [])[0];
    if (!appt) return err('NOT_FOUND');

    const nextVersion = (appt.public_link_version ?? 0) + 1;
    const updRes = await sb
      .from('appointments')
      .update({ public_link_version: nextVersion })
      .eq('id', appt.id)
      .eq('shop_id', ctx.shopId);
    if (updRes.error) return err('UNEXPECTED');

    await logDurableAudit({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'appointments',
      entityId: appt.id,
      diff: { public_links_revoked: true, version: nextVersion },
    });

    return ok({ version: nextVersion });
  },
});
