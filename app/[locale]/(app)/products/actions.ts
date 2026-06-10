'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { logAuditAction } from '@/lib/audit-log';
import { captureException } from '@/lib/observability';
import {
  brandSchema,
  categorySchema,
  deleteBrandSchema,
  deleteCategorySchema,
  deleteProductSchema,
  productSchema,
  toggleProductStatusSchema,
  updateBrandSchema,
  updateCategorySchema,
  updateProductSchema,
} from './schema';

const PRODUCTS_PATH = '/products';

type DbError = { message?: string; code?: string } | null;

// Fluent update builder: `.eq()` is chainable (variable count — id + shop_id,
// plus an optional updated_at precondition), the chain is awaitable (`{ error }`),
// and a terminal `.select('id')` returns the affected rows so a 0-row write
// (stale precondition / foreign shop) is detectable.
type UpdateChain = Promise<{ error: DbError }> & {
  eq: (k: string, v: string) => UpdateChain;
  select: (cols: string) => Promise<{ data: Array<{ id: string }> | null; error: DbError }>;
};

// All catalog mutations run on the USER-SESSION client (RLS-bound). The
// `.eq('shop_id', ctx.shopId)` filters below are defense-in-depth on top of the
// per-command RLS (catalog_rls_per_command): behaviour is unchanged today, but
// they remove the silent cross-tenant footgun if this ever moves to
// service-role. `set_product_taxes` is the SECURITY INVOKER RPC from
// 20260610140000 — atomic + same-shop-validated tax linking.
function db() {
  return createSupabaseServerClient() as unknown as {
    from: (table: string) => {
      insert: (row: Record<string, unknown>) => {
        select: (cols: string) => {
          single: () => Promise<{ data: { id: string } | null; error: DbError }>;
        };
      };
      update: (row: Record<string, unknown>) => { eq: (k: string, v: string) => UpdateChain };
      delete: () => {
        eq: (k: string, v: string) => { eq: (k: string, v: string) => Promise<{ error: DbError }> };
      };
      select: (cols: string) => {
        eq: (
          k: string,
          v: string,
        ) => {
          eq: (
            k: string,
            v: string,
          ) => { maybeSingle: () => Promise<{ data: { id: string } | null; error: DbError }> };
        };
      };
    };
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: DbError }>;
  };
}

/**
 * Confirm a referenced row belongs to the active shop. RLS already hides other
 * shops' rows, so a foreign id simply resolves to no row — but we assert it
 * explicitly so a crafted `brand_id` / `category_id` from another shop is
 * rejected with a precise error rather than silently stored.
 */
async function belongsToShop(
  sb: ReturnType<typeof db>,
  table: 'product_brands' | 'product_categories',
  id: string,
  shopId: string,
): Promise<boolean> {
  const { data } = await sb
    .from(table)
    .select('id')
    .eq('id', id)
    .eq('shop_id', shopId)
    .maybeSingle();
  return Boolean(data);
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
export const createProduct = withAction({
  schema: productSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const { tax_ids, ...rest } = input;
    const sb = db();

    if (rest.brand_id && !(await belongsToShop(sb, 'product_brands', rest.brand_id, ctx.shopId))) {
      return err('INVALID_INPUT');
    }
    if (
      rest.category_id &&
      !(await belongsToShop(sb, 'product_categories', rest.category_id, ctx.shopId))
    ) {
      return err('INVALID_INPUT');
    }

    const { data, error } = await sb
      .from('products')
      .insert({ shop_id: ctx.shopId, ...rest })
      .select('id')
      .single();
    // 23505 = unique violation on products_shop_name_unique (a duplicate name
    // in this shop). A normal user case → CONFLICT, not UNEXPECTED, no Sentry.
    // The `{ name: 'duplicate' }` payload lets the form surface it INLINE on the
    // name field rather than as a generic toast.
    if (error?.code === '23505') return err('CONFLICT', { name: 'duplicate' });
    if (error || !data) {
      captureException(error ?? new Error('createProduct: no row returned'), {
        tags: { layer: 'products' },
      });
      return err('UNEXPECTED');
    }

    // Atomic, same-shop-validated tax linking. On failure, best-effort delete
    // the orphan product so we never persist a product without the taxes the
    // manager intended.
    const { error: taxError } = await sb.rpc('set_product_taxes', {
      p_product_id: data.id,
      p_tax_ids: tax_ids,
    });
    if (taxError) {
      captureException(taxError, { tags: { layer: 'products' } });
      await db().from('products').delete().eq('id', data.id).eq('shop_id', ctx.shopId);
      return err('UNEXPECTED');
    }

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'insert',
      entity: 'products',
      entityId: data.id,
      diff: { after: input },
    });
    revalidatePath(PRODUCTS_PATH);
    return ok({ id: data.id });
  },
});

export const updateProduct = withAction({
  schema: updateProductSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const { id, tax_ids, expected_updated_at, ...rest } = input;
    const sb = db();

    if (rest.brand_id && !(await belongsToShop(sb, 'product_brands', rest.brand_id, ctx.shopId))) {
      return err('INVALID_INPUT');
    }
    if (
      rest.category_id &&
      !(await belongsToShop(sb, 'product_categories', rest.category_id, ctx.shopId))
    ) {
      return err('INVALID_INPUT');
    }

    // Optimistic concurrency: when the client sends its last-seen updated_at, pin
    // the write to it. `.select('id')` returns the affected rows so a 0-row result
    // (a concurrent edit bumped updated_at via the set_updated_at trigger) is
    // distinguishable from a successful write.
    let upd = sb.from('products').update(rest).eq('id', id).eq('shop_id', ctx.shopId);
    if (expected_updated_at) {
      upd = upd.eq('updated_at', expected_updated_at);
    }
    const { data: updatedRows, error } = await upd.select('id');
    // 23505 = duplicate name in this shop (a rename collision) → CONFLICT, not Sentry.
    if (error?.code === '23505') return err('CONFLICT', { name: 'duplicate' });
    if (error) {
      captureException(error, { tags: { layer: 'products' } });
      return err('UNEXPECTED');
    }
    if (expected_updated_at && (updatedRows?.length ?? 0) === 0) {
      // Stale precondition → a concurrent edit moved updated_at. The
      // `{ concurrency: 'stale' }` payload distinguishes this from a duplicate
      // name so the form shows a "reload" toast instead of a name-field error.
      return err('CONFLICT', { concurrency: 'stale' });
    }

    const { error: taxError } = await sb.rpc('set_product_taxes', {
      p_product_id: id,
      p_tax_ids: tax_ids,
    });
    if (taxError) {
      captureException(taxError, { tags: { layer: 'products' } });
      return err('UNEXPECTED');
    }

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'products',
      entityId: id,
      diff: { after: rest },
    });
    revalidatePath(PRODUCTS_PATH);
    return ok({ id });
  },
});

export const deleteProduct = withAction({
  schema: deleteProductSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const { error } = await db()
      .from('products')
      .delete()
      .eq('id', input.id)
      .eq('shop_id', ctx.shopId);
    if (error) {
      captureException(error, { tags: { layer: 'products' } });
      return err('UNEXPECTED');
    }

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'delete',
      entity: 'products',
      entityId: input.id,
    });
    revalidatePath(PRODUCTS_PATH);
    return ok({ id: input.id });
  },
});

// Soft enable/disable — the gentle alternative to deleteProduct's hard delete.
// Mirrors toggleServiceStatus (manager+, shop-scoped, revalidate) but takes an
// explicit status (vs services' read-then-flip) so a stale client view can't
// race a blind flip. `.select('id')` distinguishes a same-shop hit from a 0-row
// no-match (foreign shop / already deleted) without a second round-trip.
export const toggleProductStatus = withAction({
  schema: toggleProductStatusSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const { data: rows, error } = await db()
      .from('products')
      .update({ status: input.status })
      .eq('id', input.id)
      .eq('shop_id', ctx.shopId)
      .select('id');
    if (error) {
      captureException(error, { tags: { layer: 'products' } });
      return err('UNEXPECTED');
    }
    if ((rows?.length ?? 0) === 0) return err('NOT_FOUND');
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'products',
      entityId: input.id,
      diff: { status: input.status },
    });
    revalidatePath(PRODUCTS_PATH);
    return ok({ id: input.id });
  },
});

// ---------------------------------------------------------------------------
// Brands
// ---------------------------------------------------------------------------
// Loop 30 (P2.104) — every brand/category mutation gets an audit log
// entry. Brands and categories shape the product catalog, so changes
// here matter as much as service-list edits. (W1 — the audit_log TRIGGER
// added in 20260610140000 is what actually persists the trail; the
// logAuditAction calls remain inline documentation of intent.)
export const createBrand = withAction({
  schema: brandSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const { data, error } = await db()
      .from('product_brands')
      .insert({ shop_id: ctx.shopId, name: input.name })
      .select('id')
      .single();
    // 23505 = duplicate brand name in this shop (unique(shop_id,name) since
    // init). CONFLICT lets the W3 taxonomy form surface "brand already exists".
    if (error?.code === '23505') return err('CONFLICT');
    if (error || !data) {
      captureException(error ?? new Error('createBrand: no row returned'), {
        tags: { layer: 'products' },
      });
      return err('UNEXPECTED');
    }
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'insert',
      entity: 'product_brands',
      entityId: data.id,
      diff: { after: input },
    });
    revalidatePath(PRODUCTS_PATH);
    return ok({ id: data.id });
  },
});

export const updateBrand = withAction({
  schema: updateBrandSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const { error } = await db()
      .from('product_brands')
      .update({ name: input.name })
      .eq('id', input.id)
      .eq('shop_id', ctx.shopId);
    if (error?.code === '23505') return err('CONFLICT');
    if (error) {
      captureException(error, { tags: { layer: 'products' } });
      return err('UNEXPECTED');
    }
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'product_brands',
      entityId: input.id,
      diff: { after: { name: input.name } },
    });
    revalidatePath(PRODUCTS_PATH);
    return ok({ id: input.id });
  },
});

export const deleteBrand = withAction({
  schema: deleteBrandSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const { error } = await db()
      .from('product_brands')
      .delete()
      .eq('id', input.id)
      .eq('shop_id', ctx.shopId);
    if (error) {
      // 23503 = FK violation (brand still referenced). Today products.brand_id
      // is ON DELETE SET NULL so this won't fire for brands, but keep the
      // mapping defensive + truthful for the front (W3 maps the message).
      if (error.code === '23503') return err('CONFLICT');
      captureException(error, { tags: { layer: 'products' } });
      return err('UNEXPECTED');
    }
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'delete',
      entity: 'product_brands',
      entityId: input.id,
      diff: { deleted: true },
    });
    revalidatePath(PRODUCTS_PATH);
    return ok({ id: input.id });
  },
});

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
export const createCategory = withAction({
  schema: categorySchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const { data, error } = await db()
      .from('product_categories')
      .insert({ shop_id: ctx.shopId, name: input.name })
      .select('id')
      .single();
    // 23505 = duplicate category name in this shop (unique(shop_id,name)).
    if (error?.code === '23505') return err('CONFLICT');
    if (error || !data) {
      captureException(error ?? new Error('createCategory: no row returned'), {
        tags: { layer: 'products' },
      });
      return err('UNEXPECTED');
    }
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'insert',
      entity: 'product_categories',
      entityId: data.id,
      diff: { after: input },
    });
    revalidatePath(PRODUCTS_PATH);
    return ok({ id: data.id });
  },
});

export const updateCategory = withAction({
  schema: updateCategorySchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const { error } = await db()
      .from('product_categories')
      .update({ name: input.name })
      .eq('id', input.id)
      .eq('shop_id', ctx.shopId);
    if (error?.code === '23505') return err('CONFLICT');
    if (error) {
      captureException(error, { tags: { layer: 'products' } });
      return err('UNEXPECTED');
    }
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'product_categories',
      entityId: input.id,
      diff: { after: { name: input.name } },
    });
    revalidatePath(PRODUCTS_PATH);
    return ok({ id: input.id });
  },
});

export const deleteCategory = withAction({
  schema: deleteCategorySchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const { error } = await db()
      .from('product_categories')
      .delete()
      .eq('id', input.id)
      .eq('shop_id', ctx.shopId);
    if (error) {
      // 23503 = FK violation. products.category_id is ON DELETE SET NULL today,
      // so this won't fire for categories; mapping kept defensive (W3 maps it).
      if (error.code === '23503') return err('CONFLICT');
      captureException(error, { tags: { layer: 'products' } });
      return err('UNEXPECTED');
    }
    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'delete',
      entity: 'product_categories',
      entityId: input.id,
      diff: { deleted: true },
    });
    revalidatePath(PRODUCTS_PATH);
    return ok({ id: input.id });
  },
});
