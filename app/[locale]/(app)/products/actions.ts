'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { logAuditAction } from '@/lib/audit-log';
import {
  brandSchema,
  categorySchema,
  deleteBrandSchema,
  deleteCategorySchema,
  deleteProductSchema,
  productSchema,
  updateBrandSchema,
  updateCategorySchema,
  updateProductSchema,
} from './schema';

const PRODUCTS_PATH = '/products';

function db() {
  return createSupabaseServerClient() as unknown as {
    from: (table: string) => {
      insert: (row: Record<string, unknown>) => {
        select: (cols: string) => {
          single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }>;
        };
      } & Promise<{ error: { message: string } | null }>;
      update: (row: Record<string, unknown>) => {
        eq: (k: string, v: string) => Promise<{ error: { message: string } | null }>;
      };
      delete: () => {
        eq: (k: string, v: string) => Promise<{ error: { message: string } | null }>;
      };
    };
  };
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
export const createProduct = withAction({
  schema: productSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const { tax_ids, ...rest } = input;
    const { data, error } = await db()
      .from('products')
      .insert({ shop_id: ctx.shopId, ...rest })
      .select('id')
      .single();
    if (error || !data) return err('UNEXPECTED');

    if (tax_ids.length > 0) {
      await (
        createSupabaseServerClient() as unknown as {
          from: (t: string) => {
            insert: (
              rows: Array<{ product_id: string; tax_id: string }>,
            ) => Promise<{ error: unknown }>;
          };
        }
      )
        .from('product_taxes')
        .insert(tax_ids.map((tax_id) => ({ product_id: data.id, tax_id })));
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
    const { id, tax_ids, ...rest } = input;
    const { error } = await db().from('products').update(rest).eq('id', id);
    if (error) return err('UNEXPECTED');

    const sb = createSupabaseServerClient() as unknown as {
      from: (t: string) => {
        delete: () => { eq: (k: string, v: string) => Promise<{ error: unknown }> };
        insert: (
          rows: Array<{ product_id: string; tax_id: string }>,
        ) => Promise<{ error: unknown }>;
      };
    };
    await sb.from('product_taxes').delete().eq('product_id', id);
    if (tax_ids.length > 0) {
      await sb.from('product_taxes').insert(tax_ids.map((tax_id) => ({ product_id: id, tax_id })));
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
    const { error } = await db().from('products').delete().eq('id', input.id);
    if (error) return err('UNEXPECTED');

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

// ---------------------------------------------------------------------------
// Brands
// ---------------------------------------------------------------------------
export const createBrand = withAction({
  schema: brandSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const { data, error } = await db()
      .from('product_brands')
      .insert({ shop_id: ctx.shopId, name: input.name })
      .select('id')
      .single();
    if (error || !data) return err('UNEXPECTED');
    revalidatePath(PRODUCTS_PATH);
    return ok({ id: data.id });
  },
});

export const updateBrand = withAction({
  schema: updateBrandSchema,
  minRole: 'manager',
  run: async (input) => {
    const { error } = await db()
      .from('product_brands')
      .update({ name: input.name })
      .eq('id', input.id);
    if (error) return err('UNEXPECTED');
    revalidatePath(PRODUCTS_PATH);
    return ok({ id: input.id });
  },
});

export const deleteBrand = withAction({
  schema: deleteBrandSchema,
  minRole: 'manager',
  run: async (input) => {
    const { error } = await db().from('product_brands').delete().eq('id', input.id);
    if (error) return err('UNEXPECTED');
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
    if (error || !data) return err('UNEXPECTED');
    revalidatePath(PRODUCTS_PATH);
    return ok({ id: data.id });
  },
});

export const updateCategory = withAction({
  schema: updateCategorySchema,
  minRole: 'manager',
  run: async (input) => {
    const { error } = await db()
      .from('product_categories')
      .update({ name: input.name })
      .eq('id', input.id);
    if (error) return err('UNEXPECTED');
    revalidatePath(PRODUCTS_PATH);
    return ok({ id: input.id });
  },
});

export const deleteCategory = withAction({
  schema: deleteCategorySchema,
  minRole: 'manager',
  run: async (input) => {
    const { error } = await db().from('product_categories').delete().eq('id', input.id);
    if (error) return err('UNEXPECTED');
    revalidatePath(PRODUCTS_PATH);
    return ok({ id: input.id });
  },
});
