/**
 * Row type aliases sourced from the generated `db/types.ts` (Database).
 *
 * These used to be hand-maintained shapes; codegen shipped, so each now
 * collapses to a `Pick<>` of the generated Row. Pick (rather than a bare alias)
 * preserves the exact narrow column set each screen actually fetches AND turns a
 * renamed/removed column into a compile error here instead of a runtime
 * surprise. The ~39 importers keep compiling unchanged.
 *
 * typed-exception: pending types regen (migrations 20260610140000 / 150000 are
 * undeployed and there is no local Docker to regenerate from). The only gap that
 * forces a manual field is `ProductRow.status` (migration 150000) — see below.
 */
import type { Database } from './types';

type Row<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];

export type ServiceRow = Pick<
  Row<'services'>,
  | 'id'
  | 'shop_id'
  | 'category_id'
  | 'name'
  | 'duration_min'
  | 'price'
  | 'status'
  | 'sort_order'
  | 'created_at'
  | 'updated_at'
>;

export type ServiceCategoryRow = Pick<
  Row<'service_categories'>,
  'id' | 'shop_id' | 'name' | 'sort_order'
>;

export type TaxRow = Pick<
  Row<'taxes'>,
  'id' | 'shop_id' | 'name' | 'percentage' | 'add_to_price' | 'external_orders_only' | 'enabled'
>;

export type ServiceTaxLinkRow = Pick<Row<'service_taxes'>, 'service_id' | 'tax_id'>;

export type BarberRow = Pick<
  Row<'barbers'>,
  | 'id'
  | 'shop_id'
  | 'user_id'
  | 'display_name'
  | 'email'
  | 'phone'
  | 'avatar_url'
  | 'personnel_id'
  | 'sort_order'
  | 'status'
  | 'bookable'
>;

export type ClientRow = Pick<
  Row<'clients'>,
  | 'id'
  | 'shop_id'
  | 'first_name'
  | 'last_name'
  | 'email'
  | 'phone'
  | 'date_of_birth'
  | 'notes'
  | 'created_at'
>;

export type ProductBrandRow = Pick<Row<'product_brands'>, 'id' | 'shop_id' | 'name'>;

export type ProductCategoryRow = Pick<Row<'product_categories'>, 'id' | 'shop_id' | 'name'>;

// typed-exception: pending types regen — `status` (migration 20260610150000) is
// not in the generated products Row yet; extend manually until db:types regens.
export type ProductRow = Pick<
  Row<'products'>,
  | 'id'
  | 'shop_id'
  | 'brand_id'
  | 'category_id'
  | 'name'
  | 'price'
  | 'supply_price'
  | 'current_inventory'
  | 'low_inventory_threshold'
  | 'sku'
  | 'updated_at'
> & { status: 'enabled' | 'disabled' };

export type AppointmentRow = Pick<
  Row<'appointments'>,
  | 'id'
  | 'shop_id'
  | 'barber_id'
  | 'client_id'
  | 'start_at'
  | 'end_at'
  | 'status'
  | 'notes'
  | 'source'
  | 'total_amount'
>;

export type DiscountRow = Pick<
  Row<'discounts'>,
  'id' | 'shop_id' | 'name' | 'type' | 'value' | 'assignment'
>;

export type CommissionTierRow = Pick<
  Row<'commission_tiers'>,
  | 'id'
  | 'shop_id'
  | 'barber_id'
  | 'scope'
  | 'cumulative'
  | 'tier1_threshold'
  | 'tier1_pct'
  | 'tier2_threshold'
  | 'tier2_pct'
  | 'tier3_threshold'
  | 'tier3_pct'
  | 'tier4_threshold'
  | 'tier4_pct'
  | 'tier5_threshold'
  | 'tier5_pct'
>;

export type LoyaltyProgramRow = Pick<
  Row<'loyalty_program'>,
  | 'id'
  | 'shop_id'
  | 'enabled'
  | 'type'
  | 'goal_count'
  | 'min_transaction_amount'
  | 'reward_amount'
  | 'include_product_sales'
  | 'include_tips'
>;

export type ShopRow = Pick<
  Row<'shops'>,
  'id' | 'name' | 'alias' | 'timezone' | 'default_language' | 'payout_discount_mode'
>;

export type ShopMemberRow = Pick<
  Row<'shop_members'>,
  'id' | 'shop_id' | 'user_id' | 'role' | 'status'
>;
