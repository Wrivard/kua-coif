'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import {
  revalidatePublicShopSurfaces,
  revalidateShopConfig,
} from '@/lib/server-actions/revalidate';
import { logAuditAction } from '@/lib/audit-log';
import { captureException } from '@/lib/observability';
import {
  deleteServiceCategorySchema,
  deleteServiceSchema,
  reorderServicesSchema,
  serviceCategorySchema,
  serviceSchema,
  toggleServiceStatusSchema,
  updateServiceCategorySchema,
  updateServiceSchema,
} from './schema';

const SERVICES_PATH = '/services';

// Catalog mutations run on the USER-SESSION client (RLS-bound). The
// `.eq('shop_id', ctx.shopId)` filters below are defense-in-depth on top of
// the per-command RLS (catalog_rls_per_command): behaviour is unchanged
// today, but they remove the silent cross-tenant footgun if this ever moves
// to service-role. `set_service_taxes` is the SECURITY INVOKER RPC from
// 20260611120000 — atomic + same-shop-validated tax linking (mirror of
// products' set_product_taxes).
function db() {
  return createSupabaseServerClient();
}

/**
 * Confirm the referenced category belongs to the active shop. RLS already
 * hides other shops' rows, so a foreign id simply resolves to no row — but we
 * assert it explicitly so a crafted `category_id` from another shop is
 * rejected with a precise error rather than silently stored (mirror of
 * products' belongsToShop).
 */
async function categoryBelongsToShop(
  sb: ReturnType<typeof db>,
  id: string,
  shopId: string,
): Promise<boolean> {
  const { data } = await sb
    .from('service_categories')
    .select('id')
    .eq('id', id)
    .eq('shop_id', shopId)
    .maybeSingle();
  return Boolean(data);
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------
export const createService = withAction({
  schema: serviceSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const supabase = db();

    if (
      input.category_id &&
      !(await categoryBelongsToShop(supabase, input.category_id, ctx.shopId))
    ) {
      return err('INVALID_INPUT');
    }

    const { data, error } = await supabase
      .from('services')
      .insert({
        shop_id: ctx.shopId,
        category_id: input.category_id,
        name: input.name,
        duration_min: input.duration_min,
        price: input.price,
        status: input.status,
        // Phase 42 — optional deposit charged at booking.
        deposit_amount_cents: input.deposit_amount_cents ?? 0,
      })
      .select('id')
      .single();

    // 23505 = unique violation on services_shop_name_unique (a duplicate name
    // in this shop). A normal user case → CONFLICT, not UNEXPECTED, no Sentry.
    // The `{ name: 'duplicate' }` payload lets the form surface it INLINE on
    // the name field rather than as a generic toast (products W2b shape).
    if (error?.code === '23505') return err('CONFLICT', { name: 'duplicate' });
    if (error || !data) {
      captureException(error ?? new Error('createService: no row returned'), {
        tags: { layer: 'services' },
      });
      return err('UNEXPECTED');
    }

    // Atomic, same-shop-validated tax linking (set_service_taxes RPC,
    // 20260611120000). On failure, best-effort delete the orphan service so
    // we never persist a service without the taxes the manager intended —
    // the old delete-then-insert could silently lose them.
    const { error: taxError } = await supabase.rpc('set_service_taxes', {
      p_service_id: data.id,
      p_tax_ids: input.tax_ids,
    });
    if (taxError) {
      captureException(taxError, { tags: { layer: 'services' } });
      await supabase.from('services').delete().eq('id', data.id).eq('shop_id', ctx.shopId);
      return err('UNEXPECTED');
    }

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'insert',
      entity: 'services',
      entityId: data.id,
      diff: { after: { ...input } },
    });

    revalidatePath(SERVICES_PATH);
    // Services are surfaced in the public booking + embed widget — bust their
    // caches too so admins see edits propagate immediately.
    revalidatePublicShopSurfaces();
    // Calendar + booking read services/categories from the Data Cache — bust it.
    revalidateShopConfig(ctx.shopId);
    return ok({ id: data.id });
  },
});

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------
export const updateService = withAction({
  schema: updateServiceSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const supabase = db();
    const { id, tax_ids, expected_updated_at, ...rest } = input;

    if (
      rest.category_id &&
      !(await categoryBelongsToShop(supabase, rest.category_id, ctx.shopId))
    ) {
      return err('INVALID_INPUT');
    }

    // Optimistic concurrency (W2 — products pattern): when the client sends
    // its last-seen updated_at, pin the write to it. `.select('id')` returns
    // the affected rows so a 0-row write (stale precondition, or an id that
    // doesn't exist in this shop) is detectable instead of a lying ok.
    let upd = supabase.from('services').update(rest).eq('id', id).eq('shop_id', ctx.shopId);
    if (expected_updated_at) {
      upd = upd.eq('updated_at', expected_updated_at);
    }
    const { data: updatedRows, error } = await upd.select('id');
    // 23505 = duplicate name in this shop (a rename collision) → CONFLICT, not Sentry.
    if (error?.code === '23505') return err('CONFLICT', { name: 'duplicate' });
    if (error) {
      captureException(error, { tags: { layer: 'services' } });
      return err('UNEXPECTED');
    }
    if ((updatedRows?.length ?? 0) === 0) {
      // With a precondition we can't tell "stale" from "gone" without a second
      // read — surface the reload toast (products W2b shape). Without one, the
      // id simply doesn't exist in this shop: err, don't lie with ok.
      return expected_updated_at
        ? err('CONFLICT', { concurrency: 'stale' })
        : err('NOT_FOUND');
    }

    // Atomic, same-shop-validated tax linking (set_service_taxes RPC,
    // 20260611120000) — replaces the old unchecked delete-then-insert that
    // could silently lose the service's taxes mid-flight.
    const { error: taxError } = await supabase.rpc('set_service_taxes', {
      p_service_id: id,
      p_tax_ids: tax_ids,
    });
    if (taxError) {
      captureException(taxError, { tags: { layer: 'services' } });
      return err('UNEXPECTED');
    }

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'services',
      entityId: id,
      diff: { after: { ...rest } },
    });

    revalidatePath(SERVICES_PATH);
    // Services are surfaced in the public booking + embed widget — bust their
    // caches too so admins see edits propagate immediately.
    revalidatePublicShopSurfaces();
    // Calendar + booking read services/categories from the Data Cache — bust it.
    revalidateShopConfig(ctx.shopId);
    return ok({ id });
  },
});

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------
export const deleteService = withAction({
  schema: deleteServiceSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const supabase = db();
    // `.select('id')` returns the deleted rows so a 0-row delete (id not in
    // this shop / already gone) errs as NOT_FOUND instead of a lying ok.
    const { data: deletedRows, error } = await supabase
      .from('services')
      .delete()
      .eq('id', input.id)
      .eq('shop_id', ctx.shopId)
      .select('id');
    if (error) {
      // 23503 = FK violation: appointment_services.service_id is ON DELETE
      // RESTRICT (init_schema.sql:312), so a service with booking history
      // can't be hard-deleted. A normal user case → CONFLICT (same shape as
      // deleteServiceCategory's referenced-guard), not UNEXPECTED/Sentry —
      // the owner's path is to disable the service instead.
      if (error.code === '23503') return err('CONFLICT');
      captureException(error, { tags: { layer: 'services' } });
      return err('UNEXPECTED');
    }
    if ((deletedRows?.length ?? 0) === 0) return err('NOT_FOUND');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'delete',
      entity: 'services',
      entityId: input.id,
    });

    revalidatePath(SERVICES_PATH);
    // Services are surfaced in the public booking + embed widget — bust their
    // caches too so admins see edits propagate immediately.
    revalidatePublicShopSurfaces();
    // Calendar + booking read services/categories from the Data Cache — bust it.
    revalidateShopConfig(ctx.shopId);
    return ok({ id: input.id });
  },
});

// ---------------------------------------------------------------------------
// Toggle status (enabled ↔ disabled)
// ---------------------------------------------------------------------------
// W2 — hardened on the toggleProductStatus model: the client sends an explicit
// TARGET status (vs the old read-then-flip, which two concurrent clicks could
// race back to the starting state), the write is shop-scoped, and
// `.select('id')` distinguishes a same-shop hit from a 0-row no-match
// (foreign shop / already deleted) without a second round-trip.
export const toggleServiceStatus = withAction({
  schema: toggleServiceStatusSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const { data: rows, error } = await db()
      .from('services')
      .update({ status: input.status })
      .eq('id', input.id)
      .eq('shop_id', ctx.shopId)
      .select('id');
    if (error) {
      captureException(error, { tags: { layer: 'services' } });
      return err('UNEXPECTED');
    }
    if ((rows?.length ?? 0) === 0) return err('NOT_FOUND');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'services',
      entityId: input.id,
      diff: { status: input.status },
    });

    revalidatePath(SERVICES_PATH);
    // Services are surfaced in the public booking + embed widget — bust their
    // caches too so admins see edits propagate immediately.
    revalidatePublicShopSurfaces();
    // Calendar + booking read services/categories from the Data Cache — bust it.
    revalidateShopConfig(ctx.shopId);
    return ok({ id: input.id, status: input.status });
  },
});

// ---------------------------------------------------------------------------
// Reorder (drag-to-reorder, Wave 3) — persist the new `sort_order`
// ---------------------------------------------------------------------------
export const reorderServices = withAction({
  schema: reorderServicesSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const supabase = createSupabaseServerClient();

    // One UPDATE per row: write each id's index in the submitted list as
    // its new sort_order. RLS scopes every write to the active shop, so a
    // foreign id silently affects zero rows (no cross-shop leak). The set
    // is tiny (services per shop), so the round-trip count is a non-issue.
    for (let i = 0; i < input.ids.length; i++) {
      const { error } = await supabase
        .from('services')
        .update({ sort_order: i })
        .eq('id', input.ids[i]!);
      if (error) return err('UNEXPECTED');
    }

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'services',
      diff: { reordered: input.ids },
    });

    revalidatePath(SERVICES_PATH);
    // Booking + embed surfaces render services in sort_order, so bust them.
    revalidatePublicShopSurfaces();
    // Calendar + booking read services/categories from the Data Cache — bust it.
    revalidateShopConfig(ctx.shopId);
    return ok({ ids: input.ids });
  },
});

// ---------------------------------------------------------------------------
// Service categories — lightweight name CRUD, mirroring the product
// brands/categories taxonomy. RLS scopes every read/write to the active
// shop, so we never pass shop_id to update/delete (only to insert).
// ---------------------------------------------------------------------------
export const createServiceCategory = withAction({
  schema: serviceCategorySchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const supabase = db();

    // Deterministic ordering (W2): append at the end (max+1) instead of the
    // column default 0, which made every new category tie at 0 and the list
    // order non-deterministic. The W2 migration backfilled existing ranks.
    const { data: maxRow } = await supabase
      .from('service_categories')
      .select('sort_order')
      .eq('shop_id', ctx.shopId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSortOrder = (maxRow?.sort_order ?? -1) + 1;

    const { data, error } = await supabase
      .from('service_categories')
      .insert({ shop_id: ctx.shopId, name: input.name, sort_order: nextSortOrder })
      .select('id')
      .single();
    // 23505 = duplicate category name in this shop
    // (service_categories_shop_name_unique) → inline-field CONFLICT.
    if (error?.code === '23505') return err('CONFLICT', { name: 'duplicate' });
    if (error || !data) return err('UNEXPECTED');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'insert',
      entity: 'service_categories',
      entityId: data.id,
      diff: { after: input },
    });

    revalidatePath(SERVICES_PATH);
    revalidatePublicShopSurfaces();
    // Calendar + booking read services/categories from the Data Cache — bust it.
    revalidateShopConfig(ctx.shopId);
    return ok({ id: data.id });
  },
});

export const renameServiceCategory = withAction({
  schema: updateServiceCategorySchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const { error } = await db()
      .from('service_categories')
      .update({ name: input.name })
      .eq('id', input.id);
    // 23505 = rename collision with another category in this shop → inline-field CONFLICT.
    if (error?.code === '23505') return err('CONFLICT', { name: 'duplicate' });
    if (error) return err('UNEXPECTED');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'service_categories',
      entityId: input.id,
      diff: { after: { name: input.name } },
    });

    revalidatePath(SERVICES_PATH);
    revalidatePublicShopSurfaces();
    // Calendar + booking read services/categories from the Data Cache — bust it.
    revalidateShopConfig(ctx.shopId);
    return ok({ id: input.id });
  },
});

export const deleteServiceCategory = withAction({
  schema: deleteServiceCategorySchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const supabase = createSupabaseServerClient();

    // Guard: block the delete while any service still references this
    // category. Without this, the FK would either error opaquely or
    // (depending on the constraint) orphan services. Surface a clean
    // CONFLICT the client renders as a toast. `head: true` + `count`
    // skips row payload — we only need the tally.
    const { count, error: countError } = await supabase
      .from('services')
      .select('id', { count: 'exact', head: true })
      .eq('category_id', input.id);

    if (countError) return err('UNEXPECTED');
    if ((count ?? 0) > 0) return err('CONFLICT');

    const { error } = await db().from('service_categories').delete().eq('id', input.id);
    if (error) return err('UNEXPECTED');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'delete',
      entity: 'service_categories',
      entityId: input.id,
      diff: { deleted: true },
    });

    revalidatePath(SERVICES_PATH);
    revalidatePublicShopSurfaces();
    // Calendar + booking read services/categories from the Data Cache — bust it.
    revalidateShopConfig(ctx.shopId);
    return ok({ id: input.id });
  },
});
