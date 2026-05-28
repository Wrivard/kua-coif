'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { z } from 'zod';
import { requireKuaAdmin } from '@/lib/auth/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { captureException } from '@/lib/observability';
import { INDUSTRY_KINDS, getCatalogFor, type IndustryKind } from '@/lib/industries';

const createShopSchema = z.object({
  name: z.string().trim().min(1).max(120),
  alias: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/u, 'invalid alias')
    .max(40),
  ownerEmail: z.string().trim().toLowerCase().email(),
  ownerFullName: z.string().trim().min(1).max(120).optional(),
  // Phase 23: required. The form's radio group always submits a value;
  // we still parse strictly so a tampered submission can't slip a bad
  // value past the enum.
  industry: z.enum(INDUSTRY_KINDS),
});

export type CreateShopState =
  | { kind: 'idle' }
  | { kind: 'invalid'; fieldErrors: Record<string, string> }
  | { kind: 'conflict'; reason: 'alias-taken' | 'email-already-owner' }
  | { kind: 'error'; message: string };

/**
 * Phase 22 shop creation flow. Done by a Küa super-admin from `/admin/shops/new`.
 *
 * Steps (all in one Server Action for V1 simplicity — wrap in a Postgres
 * function in V1.2 if we hit transactional consistency issues):
 *   1. INSERT shops (alias unique-checked at the DB level).
 *   2. Find-or-invite the owner by email via Supabase auth admin API.
 *      - If a profile already exists, reuse its user_id (multi-shop scenario).
 *      - Otherwise call `auth.admin.inviteUserByEmail` which creates the
 *        auth.users row + triggers the profile creation trigger + ships the
 *        invitation email.
 *   3. INSERT `shop_members(role='owner', status='staff')`. The status flips
 *      to 'confirmed' when the invitee finishes `/setup-password`.
 *   4. Redirect back to /admin/shops.
 */
export async function createShopAction(
  _prev: CreateShopState | undefined,
  formData: FormData,
): Promise<CreateShopState> {
  await requireKuaAdmin();

  const parsed = createShopSchema.safeParse({
    name: formData.get('name'),
    alias: formData.get('alias'),
    ownerEmail: formData.get('ownerEmail'),
    ownerFullName: formData.get('ownerFullName') || undefined,
    industry: formData.get('industry') || undefined,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path[0];
      if (typeof path === 'string') fieldErrors[path] = issue.message;
    }
    return { kind: 'invalid', fieldErrors };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createSupabaseServiceRoleClient() as any;

  try {
    // 1. Reject duplicate alias up front (table has a UNIQUE constraint, but
    //    catching it here yields a cleaner error to the form).
    const existing = await sb.from('shops').select('id').eq('alias', parsed.data.alias).limit(1);
    if ((existing.data as Array<{ id: string }> | null)?.length ?? 0) {
      return { kind: 'conflict', reason: 'alias-taken' };
    }

    // 2. Create the shop. Defaults from CLAUDE.md spec (Quebec-centric):
    //    timezone America/Toronto, language FR, currency CAD. The industry
    //    drives the catalog seed in step 5 below.
    const industry = parsed.data.industry as IndustryKind;
    const shopRes = await sb
      .from('shops')
      .insert({
        name: parsed.data.name,
        alias: parsed.data.alias,
        timezone: 'America/Toronto',
        date_format: 'USA',
        default_language: 'fr',
        country: 'Canada',
        province: 'QC',
        industry,
      })
      .select('id')
      .single();
    if (shopRes.error || !shopRes.data) {
      return {
        kind: 'error',
        message: shopRes.error?.message ?? 'Shop insert failed',
      };
    }
    const shopId = (shopRes.data as { id: string }).id;

    // 3. Resolve or invite the owner. We first check if a profile already
    //    exists for that email — multi-shop scenario means we should reuse
    //    the existing auth.users row rather than fail.
    let ownerUserId: string | null = null;
    const profileLookup = await sb
      .from('profiles')
      .select('id')
      .eq('email', parsed.data.ownerEmail)
      .limit(1);
    const profile = (profileLookup.data as Array<{ id: string }> | null)?.[0];
    if (profile) {
      // Double-check they aren't already owner of *this* shop (paranoia).
      const dup = await sb
        .from('shop_members')
        .select('id')
        .eq('shop_id', shopId)
        .eq('user_id', profile.id)
        .eq('role', 'owner')
        .limit(1);
      if ((dup.data as Array<{ id: string }> | null)?.length ?? 0) {
        return { kind: 'conflict', reason: 'email-already-owner' };
      }
      ownerUserId = profile.id;
    } else {
      // No profile → send invitation. Supabase creates the auth.users row,
      // the `tg_create_profile_on_signup` trigger then fills in `profiles`.
      const origin = headers().get('origin') ?? process.env.NEXT_PUBLIC_SITE_URL ?? '';
      const inviteRes = await sb.auth.admin.inviteUserByEmail(parsed.data.ownerEmail, {
        redirectTo: `${origin}/fr/setup-password`,
        data: parsed.data.ownerFullName ? { full_name: parsed.data.ownerFullName } : undefined,
      });
      if (inviteRes.error || !inviteRes.data?.user) {
        return {
          kind: 'error',
          message: inviteRes.error?.message ?? 'Invite failed',
        };
      }
      ownerUserId = inviteRes.data.user.id as string;
    }

    // 4. Link the owner to the shop. Status starts as 'staff' (= pending)
    //    when they haven't completed `/setup-password` yet — flips to
    //    'confirmed' on the first successful setup. Existing profiles get
    //    'confirmed' immediately since they already have a working account.
    const isExistingProfile = Boolean(profile);
    const memberRes = await sb.from('shop_members').insert({
      shop_id: shopId,
      user_id: ownerUserId,
      role: 'owner',
      status: isExistingProfile ? 'confirmed' : 'staff',
    });
    if (memberRes.error) {
      return { kind: 'error', message: memberRes.error.message };
    }

    // 5. Seed the industry-specific catalog (Phase 23). Categories first
    //    (we need their generated ids), then services keyed back by the
    //    locale-stable `categoryKey` from the template. Best-effort: a
    //    seed failure does NOT roll back the shop — the owner can still
    //    fill the catalog manually from `/services`. We do surface a
    //    warning via Sentry for visibility.
    const catalog = getCatalogFor(industry, 'fr');
    const categoriesInsert = catalog.categories.map((c, i) => ({
      shop_id: shopId,
      name: c.name,
      sort_order: i + 1,
    }));
    const catRes = await sb.from('service_categories').insert(categoriesInsert).select('id, name');
    if (catRes.error) {
      captureException(catRes.error, {
        tags: { layer: 'admin-create-shop', step: 'seed-categories' },
        extra: { shopId, industry },
      });
    } else {
      // Build a Map from FR-key → category.id. Categories in the DB carry
      // the displayed (FR) name, which equals the template's `key` since
      // we seed in FR. (When V1.1 adds EN seeding, we'll instead carry
      // the key in a separate column or use a temp lookup table.)
      const inserted = (catRes.data as Array<{ id: string; name: string }> | null) ?? [];
      const idByKey = new Map(
        catalog.categories.map((c) => {
          const row = inserted.find((r) => r.name === c.name);
          return [c.key, row?.id ?? null] as const;
        }),
      );
      const servicesInsert = catalog.services
        .map((s, i) => {
          const categoryId = idByKey.get(s.categoryKey);
          if (!categoryId) return null;
          return {
            shop_id: shopId,
            category_id: categoryId,
            name: s.name,
            duration_min: s.duration_min,
            price: s.price,
            sort_order: i + 1,
            status: 'enabled',
          };
        })
        .filter(<T>(v: T | null): v is T => v !== null);
      if (servicesInsert.length > 0) {
        const svcRes = await sb.from('services').insert(servicesInsert);
        if (svcRes.error) {
          captureException(svcRes.error, {
            tags: { layer: 'admin-create-shop', step: 'seed-services' },
            extra: { shopId, industry },
          });
        }
      }
    }

    // 6. Seed the notification_automations rows (Phase 25). Same defaults
    //    as the migration backfill so the /settings/notifications UI shows
    //    a populated list on first open. Best-effort; a failure here just
    //    means the dispatcher's automation gate will fail-open (send by
    //    default until the row exists).
    //
    //    Loop 56 SR — `waitlist_open` rows added for both channels. They
    //    were missing from the original Phase 25 seed; the AutomationKind
    //    union (added in Loop 42) and the UI's AUTOMATION_ORDER expect
    //    them. The schema-side widen + backfill ships in the
    //    20260527030000 migration.
    const automationSeed = [
      { kind: 'booking_confirmation', channel: 'email', enabled: true },
      { kind: 'reminder_24h', channel: 'email', enabled: false },
      { kind: 'reminder_1h', channel: 'email', enabled: false },
      { kind: 'cancellation', channel: 'email', enabled: true },
      { kind: 'waitlist_open', channel: 'email', enabled: false },
      { kind: 'birthday', channel: 'email', enabled: false },
      { kind: 'booking_confirmation', channel: 'sms', enabled: false },
      { kind: 'reminder_24h', channel: 'sms', enabled: false },
      { kind: 'reminder_1h', channel: 'sms', enabled: false },
      { kind: 'cancellation', channel: 'sms', enabled: false },
      { kind: 'waitlist_open', channel: 'sms', enabled: false },
      { kind: 'birthday', channel: 'sms', enabled: false },
    ].map((r) => ({ shop_id: shopId, ...r }));
    const autoRes = await sb.from('notification_automations').insert(automationSeed);
    if (autoRes.error) {
      captureException(autoRes.error, {
        tags: { layer: 'admin-create-shop', step: 'seed-automations' },
        extra: { shopId },
      });
    }
  } catch (err) {
    captureException(err, { tags: { layer: 'admin-create-shop' } });
    return { kind: 'error', message: err instanceof Error ? err.message : 'Unknown error' };
  }

  // Phase H+4 — the super-admin shell moved under the locale prefix.
  // We can't easily read the current locale from a Server Action without
  // threading it through the form, so we redirect to the FR variant
  // (the super-admin UI is monolingual and the operator can flip the
  // locale switcher in the sidebar afterward).
  redirect('/fr/super-admin/shops');
}
