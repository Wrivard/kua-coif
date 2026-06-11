import { z } from 'zod';
import { SERVICE_STATUSES } from '@/db/enums';

/**
 * Zod schema for service create/update. Used both client-side (with
 * react-hook-form + @hookform/resolvers/zod) and server-side (in the
 * Server Action via withAction).
 */
export const serviceSchema = z.object({
  name: z.string().trim().min(1, 'NAME_REQUIRED').max(120),
  category_id: z.string().uuid().nullable(),
  duration_min: z
    .number()
    .int()
    .min(5, 'DURATION_MIN')
    .max(8 * 60, 'DURATION_MAX'),
  // multipleOf(0.01): the column is numeric(10,2) — without this, a
  // three-decimal price (19.999) passes validation and Postgres silently
  // ROUNDS it (stored 20.00 ≠ what the manager typed).
  price: z.number().min(0).max(99999.99).multipleOf(0.01),
  status: z.enum(SERVICE_STATUSES),
  // Dedup so a doubled tax_id can't reach the M:N writer (the RPC also
  // `select distinct`s, but de-duping at the edge keeps the payload honest).
  // Max 20 is a generous bound — Québec services carry 2 (TPS+TVQ).
  tax_ids: z
    .array(z.string().uuid())
    .max(20)
    .transform((a) => [...new Set(a)]),
  /**
   * Phase 42 — optional deposit charged at booking (in cents).
   * 0 = no deposit required. Booking flow consumes this via the Phase 38
   * PaymentIntent backend. Always present in the form (defaults to 0 in
   * the modal's defaults); kept non-optional to keep react-hook-form's
   * input/output types aligned.
   */
  deposit_amount_cents: z.number().int().min(0).max(100_000_00).multipleOf(0.01),
});

export type ServiceInput = z.infer<typeof serviceSchema>;

export const updateServiceSchema = serviceSchema.extend({
  id: z.string().uuid(),
  // Optimistic concurrency (W2 — mirror of updateProductSchema). When present,
  // the server only writes if services.updated_at still matches (else
  // CONFLICT { concurrency: 'stale' }). Optional → non-breaking until the
  // form wires it (W2 ships the server half only).
  expected_updated_at: z.string().datetime().optional(),
});
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;

export const deleteServiceSchema = z.object({ id: z.string().uuid() });
// W2 — explicit TARGET status (mirror of toggleProductStatusSchema): the
// client sends the state it wants, so a stale view can't race a blind
// read-then-flip back to where it started.
export const toggleServiceStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(SERVICE_STATUSES),
});

/**
 * Drag-to-reorder (Wave 3). The client sends the full ordered list of
 * service ids; the server writes each row's `sort_order` to its index in
 * that array. `min(1)` because an empty reorder is a no-op the client
 * never issues.
 */
export const reorderServicesSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
});
export type ReorderServicesInput = z.infer<typeof reorderServicesSchema>;

// ---------------------------------------------------------------------------
// Service categories — single text field, lightweight CRUD mirroring the
// product brands/categories taxonomy. Delete is guarded server-side: a
// category still referenced by services returns CONFLICT.
// ---------------------------------------------------------------------------
export const serviceCategorySchema = z.object({
  name: z.string().trim().min(1, 'NAME_REQUIRED').max(80),
});
export type ServiceCategoryInput = z.infer<typeof serviceCategorySchema>;

export const updateServiceCategorySchema = serviceCategorySchema.extend({
  id: z.string().uuid(),
});
export const deleteServiceCategorySchema = z.object({ id: z.string().uuid() });
