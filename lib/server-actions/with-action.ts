import { ZodError, type ZodSchema } from 'zod';
import {
  getCurrentBarberId,
  getCurrentShopId,
  getCurrentUser,
  getShopMemberships,
  type ShopMembership,
} from '@/lib/auth/server';
import { captureException } from '@/lib/observability';
import type { UserRole } from '@/db/enums';
import { err, ok, type ActionErrorCode, type Result } from './result';

type ActionContext = {
  userId: string;
  shopId: string;
  role: UserRole;
  /**
   * Phase H+5 — the `barbers.id` row that ties this user to a chair in
   * the active shop. Null for owners / managers who don't carry
   * appointments themselves. Set so barber-scoped ownership checks
   * (e.g. "this appt belongs to ctx.barberId") work without each
   * action having to re-query.
   */
  barberId: string | null;
};

type ActionOptions<Schema extends ZodSchema, T> = {
  /** Optional Zod schema. The validated input is passed to `run`. */
  schema?: Schema;
  /** Minimum role required to execute. Defaults to 'barber' (any member). */
  minRole?: UserRole;
  /** The actual mutation. Throw to fall through to UNEXPECTED. */
  run: (
    input: Schema extends ZodSchema ? Schema['_output'] : undefined,
    ctx: ActionContext,
  ) => Promise<Result<T, ActionErrorCode> | T>;
};

const ROLE_RANK: Record<UserRole, number> = { owner: 3, manager: 2, barber: 1 };

/**
 * Standardized Server Action wrapper. Every CRUD action in the app goes
 * through this helper so we have a single place for:
 *  - auth gate (returns UNAUTHENTICATED if no session)
 *  - shop resolution (returns NO_SHOP if user has no confirmed membership)
 *  - role gate (returns FORBIDDEN if user lacks minRole in their first shop)
 *  - Zod input validation (returns INVALID_INPUT with fieldErrors)
 *  - exception capture → UNEXPECTED (with observability hook fired)
 *
 * Callers stay tiny:
 *
 *   export const createService = withAction({
 *     schema: ServiceSchema,
 *     minRole: 'manager',
 *     run: async (input, { shopId }) => {
 *       const supabase = createSupabaseServerClient();
 *       const { data, error } = await supabase.from('services').insert({ shop_id: shopId, ...input }).select('id').single();
 *       if (error) throw error;
 *       return ok({ id: data.id });
 *     },
 *   });
 */
export function withAction<Schema extends ZodSchema, T>(opts: ActionOptions<Schema, T>) {
  return async (rawInput: unknown): Promise<Result<T>> => {
    const user = await getCurrentUser();
    if (!user) return err('UNAUTHENTICATED');

    const memberships = await getShopMemberships();
    if (memberships.length === 0) return err('NO_SHOP');

    // Security audit #2 (CRITICAL) — cookie-aware shop resolution.
    //
    // Pre-fix, this pinned `memberships[0]` regardless of the active
    // shop cookie. A multi-shop user (owner in A, barber in B) who
    // switched the UI to shop B would have their `barber` role
    // SILENTLY UPGRADED to `owner` (shop A's role) when running any
    // `minRole: 'manager'` action — because `memberships[0]` resolved
    // to shop A. RLS still scoped the data write to the cookie's
    // shop, but the role gate accepted the call. Result: a barber
    // in shop B could perform owner-only actions on shop B.
    //
    // Fix: read the cookie via `getCurrentShopId`, then look up the
    // membership row for THAT shop_id. Falls back to memberships[0]
    // for the single-shop user (cookie absent OR resolves to same).
    const activeShopId = await getCurrentShopId();
    const m: ShopMembership =
      memberships.find((row) => row.shop_id === activeShopId) ?? memberships[0]!;

    const minRole = opts.minRole ?? 'barber';
    if (ROLE_RANK[m.role] < ROLE_RANK[minRole]) return err('FORBIDDEN');

    let parsed: Schema['_output'] | undefined;
    if (opts.schema) {
      try {
        parsed = opts.schema.parse(rawInput);
      } catch (e) {
        if (e instanceof ZodError) {
          const fieldErrors: Record<string, string> = {};
          for (const issue of e.issues) {
            const path = issue.path.join('.');
            if (path) fieldErrors[path] = issue.message;
          }
          return err('INVALID_INPUT', fieldErrors);
        }
        throw e;
      }
    }

    // Phase H+5 — resolve the user's barber-row id (if any) for the
    // active shop, so barber-scoped ownership checks can run without
    // a per-action query. Cached in React-request scope.
    const barberId = m.role === 'barber' ? await getCurrentBarberId() : null;

    const ctx: ActionContext = {
      userId: user.id,
      shopId: m.shop_id,
      role: m.role,
      barberId,
    };

    try {
      const result = await opts.run(
        parsed as Schema extends ZodSchema ? Schema['_output'] : undefined,
        ctx,
      );
      // Allow `run` to return either a bare value or a Result.
      if (result && typeof result === 'object' && 'ok' in result) {
        return result as Result<T>;
      }
      return ok(result as T);
    } catch (e) {
      captureException(e, {
        tags: { layer: 'server-action' },
        extra: { userId: ctx.userId, shopId: ctx.shopId },
      });
      return err('UNEXPECTED');
    }
  };
}
