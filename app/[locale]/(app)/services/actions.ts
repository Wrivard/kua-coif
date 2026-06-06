'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withAction } from '@/lib/server-actions/with-action';
import { err, ok } from '@/lib/server-actions/result';
import { revalidatePublicShopSurfaces } from '@/lib/server-actions/revalidate';
import { logAuditAction } from '@/lib/audit-log';
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

/**
 * Helper: Supabase typed-access stub until codegen ships in db/types.ts.
 */
function db() {
  return createSupabaseServerClient() as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (
          k: string,
          v: string,
        ) => {
          order: (
            k: string,
            opts?: { ascending?: boolean },
          ) => Promise<{ data: unknown; error: unknown }>;
        };
      };
      insert: (row: Record<string, unknown>) => {
        select: (cols: string) => {
          single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }>;
        };
      };
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
// Create
// ---------------------------------------------------------------------------
export const createService = withAction({
  schema: serviceSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const supabase = db();

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

    if (error || !data) {
      return err('UNEXPECTED');
    }

    // Attach taxes (M:N) — best-effort, failure here doesn't roll back the
    // service insert (RLS already protected us from cross-shop tax IDs).
    if (input.tax_ids.length > 0) {
      await (
        supabase as unknown as {
          from: (t: string) => {
            insert: (
              rows: Array<{ service_id: string; tax_id: string }>,
            ) => Promise<{ error: unknown }>;
          };
        }
      )
        .from('service_taxes')
        .insert(input.tax_ids.map((tax_id) => ({ service_id: data.id, tax_id })));
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
    const { id, tax_ids: _tax_ids, ...rest } = input;
    void _tax_ids;

    const { error } = await supabase.from('services').update(rest).eq('id', id);
    if (error) return err('UNEXPECTED');

    // Replace tax links: delete then re-insert. Atomic enough for V1 (audit
    // log captures the action). A Phase 5+ improvement would wrap this in a
    // Postgres function for transactional safety.
    const sb = supabase as unknown as {
      from: (t: string) => {
        delete: () => { eq: (k: string, v: string) => Promise<{ error: unknown }> };
        insert: (
          rows: Array<{ service_id: string; tax_id: string }>,
        ) => Promise<{ error: unknown }>;
      };
    };
    await sb.from('service_taxes').delete().eq('service_id', id);
    if (input.tax_ids.length > 0) {
      await sb
        .from('service_taxes')
        .insert(input.tax_ids.map((tax_id) => ({ service_id: id, tax_id })));
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
    const { error } = await supabase.from('services').delete().eq('id', input.id);
    if (error) return err('UNEXPECTED');

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
    return ok({ id: input.id });
  },
});

// ---------------------------------------------------------------------------
// Toggle status (enabled ↔ disabled)
// ---------------------------------------------------------------------------
export const toggleServiceStatus = withAction({
  schema: toggleServiceStatusSchema,
  minRole: 'manager',
  run: async (input, ctx) => {
    const supabase = createSupabaseServerClient();
    // Read current status, flip it. Two-step (no atomic toggle in Supabase
    // client) is acceptable here — the worst case (race condition under
    // simultaneous edits) is reverting a flip the user will notice.
    const { data, error: readError } = await (
      supabase as unknown as {
        from: (t: string) => {
          select: (cols: string) => {
            eq: (
              k: string,
              v: string,
            ) => {
              single: () => Promise<{
                data: { status: 'enabled' | 'disabled' } | null;
                error: unknown;
              }>;
            };
          };
        };
      }
    )
      .from('services')
      .select('status')
      .eq('id', input.id)
      .single();

    if (readError || !data) return err('NOT_FOUND');

    const next = data.status === 'enabled' ? 'disabled' : 'enabled';

    const { error: updateError } = await (
      supabase as unknown as {
        from: (t: string) => {
          update: (row: Record<string, unknown>) => {
            eq: (k: string, v: string) => Promise<{ error: unknown }>;
          };
        };
      }
    )
      .from('services')
      .update({ status: next })
      .eq('id', input.id);
    if (updateError) return err('UNEXPECTED');

    await logAuditAction({
      shopId: ctx.shopId,
      actorId: ctx.userId,
      action: 'update',
      entity: 'services',
      entityId: input.id,
      diff: { status: { before: data.status, after: next } },
    });

    revalidatePath(SERVICES_PATH);
    // Services are surfaced in the public booking + embed widget — bust their
    // caches too so admins see edits propagate immediately.
    revalidatePublicShopSurfaces();
    return ok({ id: input.id, status: next });
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
    const sb = supabase as unknown as {
      from: (t: string) => {
        update: (row: Record<string, unknown>) => {
          eq: (k: string, v: string) => Promise<{ error: { message: string } | null }>;
        };
      };
    };

    // One UPDATE per row: write each id's index in the submitted list as
    // its new sort_order. RLS scopes every write to the active shop, so a
    // foreign id silently affects zero rows (no cross-shop leak). The set
    // is tiny (services per shop), so the round-trip count is a non-issue.
    for (let i = 0; i < input.ids.length; i++) {
      const { error } = await sb.from('services').update({ sort_order: i }).eq('id', input.ids[i]!);
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
    const { data, error } = await supabase
      .from('service_categories')
      .insert({ shop_id: ctx.shopId, name: input.name })
      .select('id')
      .single();
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
    const { count, error: countError } = await (
      supabase as unknown as {
        from: (t: string) => {
          select: (
            cols: string,
            opts: { count: 'exact'; head: true },
          ) => {
            eq: (k: string, v: string) => Promise<{ count: number | null; error: unknown }>;
          };
        };
      }
    )
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
    return ok({ id: input.id });
  },
});
