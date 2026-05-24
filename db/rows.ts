/**
 * Manual row types for tables we use today.
 *
 * Source of truth = the migrations in `supabase/migrations/`. Once `npm run
 * db:types:remote` runs against a live DB, `db/types.ts` becomes authoritative
 * and these types collapse to `Database['public']['Tables']['X']['Row']`
 * aliases. Until then, every CRUD screen imports row shapes from here.
 */
import type {
  AppointmentSource,
  AppointmentStatus,
  CommissionScope,
  DiscountAssignment,
  DiscountType,
  LoyaltyType,
  PayoutDiscountMode,
  ServiceStatus,
  ShopMemberStatus,
  UserRole,
} from './enums';

export type ServiceRow = {
  id: string;
  shop_id: string;
  category_id: string | null;
  name: string;
  duration_min: number;
  price: number;
  status: ServiceStatus;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type ServiceCategoryRow = {
  id: string;
  shop_id: string;
  name: string;
  sort_order: number;
};

export type TaxRow = {
  id: string;
  shop_id: string;
  name: string;
  percentage: number;
  add_to_price: boolean;
  external_orders_only: boolean;
  enabled: boolean;
};

export type ServiceTaxLinkRow = {
  service_id: string;
  tax_id: string;
};

export type BarberRow = {
  id: string;
  shop_id: string;
  user_id: string | null;
  display_name: string;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  personnel_id: string | null;
  sort_order: number;
  status: ShopMemberStatus;
};

export type ClientRow = {
  id: string;
  shop_id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_at: string;
};

export type ProductBrandRow = {
  id: string;
  shop_id: string;
  name: string;
};

export type ProductCategoryRow = {
  id: string;
  shop_id: string;
  name: string;
};

export type ProductRow = {
  id: string;
  shop_id: string;
  brand_id: string | null;
  category_id: string | null;
  name: string;
  price: number;
  supply_price: number;
  current_inventory: number;
  low_inventory_threshold: number;
  sku: string | null;
};

export type AppointmentRow = {
  id: string;
  shop_id: string;
  barber_id: string;
  client_id: string;
  start_at: string;
  end_at: string;
  status: AppointmentStatus;
  notes: string | null;
  source: AppointmentSource;
  total_amount: number;
};

export type DiscountRow = {
  id: string;
  shop_id: string;
  name: string;
  type: DiscountType;
  value: number;
  assignment: DiscountAssignment;
};

export type CommissionTierRow = {
  id: string;
  shop_id: string;
  barber_id: string;
  scope: CommissionScope;
  cumulative: boolean;
  tier1_threshold: number;
  tier1_pct: number;
  tier2_threshold: number;
  tier2_pct: number;
  tier3_threshold: number;
  tier3_pct: number;
  tier4_threshold: number;
  tier4_pct: number;
  tier5_threshold: number;
  tier5_pct: number;
};

export type LoyaltyProgramRow = {
  id: string;
  shop_id: string;
  enabled: boolean;
  type: LoyaltyType;
  goal_count: number;
  min_transaction_amount: number;
  reward_amount: number;
  include_product_sales: boolean;
  include_tips: boolean;
};

export type ShopRow = {
  id: string;
  name: string;
  alias: string | null;
  timezone: string;
  default_language: string;
  payout_discount_mode: PayoutDiscountMode;
  // omit large fields we rarely fetch — add as needed
};

export type ShopMemberRow = {
  id: string;
  shop_id: string;
  user_id: string;
  role: UserRole;
  status: ShopMemberStatus;
};
