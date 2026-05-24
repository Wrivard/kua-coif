import { ZodError, type ZodSchema } from 'zod';
import { getCurrentUser, getShopMemberships, type ShopMembership } from '@/lib/auth/server';
import { captureException } from '@/lib/observability';
import type { UserRole } from '@/db/enums';
import { err, ok, type ActionErrorCode, type Result } from './result';

type ActionContext = {
  userId: string;
  shopId: string;
  role: UserRole;
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
    const m: ShopMembership = memberships[0]!;

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

    const ctx: ActionContext = {
      userId: user.id,
      shopId: m.shop_id,
      role: m.role,
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
