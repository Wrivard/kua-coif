import { z } from 'zod';

export const productSchema = z.object({
  name: z.string().trim().min(1, 'NAME_REQUIRED').max(120),
  brand_id: z.string().uuid().nullable(),
  category_id: z.string().uuid().nullable(),
  price: z.number().min(0).max(99999.99),
  supply_price: z.number().min(0).max(99999.99),
  current_inventory: z.number().int().min(0).max(99999),
  low_inventory_threshold: z.number().int().min(0).max(99999),
  sku: z
    .string()
    .trim()
    .max(50)
    .nullable()
    .or(z.literal('').transform(() => null)),
  // Dedup so a doubled tax_id can't reach the M:N writer (the RPC also
  // `select distinct`s, but de-duping at the edge keeps the payload honest).
  tax_ids: z.array(z.string().uuid()).transform((a) => [...new Set(a)]),
});
export type ProductInput = z.infer<typeof productSchema>;

export const updateProductSchema = productSchema.extend({ id: z.string().uuid() });
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const deleteProductSchema = z.object({ id: z.string().uuid() });

// Brands + Categories — single text field, very lightweight.
export const brandSchema = z.object({ name: z.string().trim().min(1, 'NAME_REQUIRED').max(80) });
export const updateBrandSchema = brandSchema.extend({ id: z.string().uuid() });
export const deleteBrandSchema = z.object({ id: z.string().uuid() });

export const categorySchema = z.object({ name: z.string().trim().min(1, 'NAME_REQUIRED').max(80) });
export const updateCategorySchema = categorySchema.extend({ id: z.string().uuid() });
export const deleteCategorySchema = z.object({ id: z.string().uuid() });
