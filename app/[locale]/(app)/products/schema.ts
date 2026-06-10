import { z } from 'zod';

export const productSchema = z.object({
  name: z.string().trim().min(1, 'NAME_REQUIRED').max(120),
  brand_id: z.string().uuid().nullable(),
  category_id: z.string().uuid().nullable(),
  // price columns are numeric(10,2): reject sub-cent precision (e.g. 19.999) at
  // the edge so it never silently rounds on insert.
  price: z.number().min(0).max(99999.99).multipleOf(0.01, 'INVALID_PRICE_PRECISION'),
  supply_price: z.number().min(0).max(99999.99).multipleOf(0.01, 'INVALID_PRICE_PRECISION'),
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

export const updateProductSchema = productSchema.extend({
  id: z.string().uuid(),
  // Optimistic-concurrency precondition: the client's last-seen updated_at.
  // When present, the server only writes if products.updated_at still matches
  // (else CONFLICT). Optional → non-breaking until the form wires it (W2 ships
  // the server half only).
  expected_updated_at: z.string().datetime().optional(),
});
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const deleteProductSchema = z.object({ id: z.string().uuid() });

// Soft enable/disable — mirrors services.status (the service_status enum).
export const toggleProductStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['enabled', 'disabled']),
});

// Brands + Categories — single text field, very lightweight.
export const brandSchema = z.object({ name: z.string().trim().min(1, 'NAME_REQUIRED').max(80) });
export const updateBrandSchema = brandSchema.extend({ id: z.string().uuid() });
export const deleteBrandSchema = z.object({ id: z.string().uuid() });

export const categorySchema = z.object({ name: z.string().trim().min(1, 'NAME_REQUIRED').max(80) });
export const updateCategorySchema = categorySchema.extend({ id: z.string().uuid() });
export const deleteCategorySchema = z.object({ id: z.string().uuid() });
