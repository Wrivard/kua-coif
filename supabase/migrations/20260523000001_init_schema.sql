-- =============================================================================
-- 20260523000001_init_schema.sql
-- Initial schema for kua-coiffure (Phase 2).
-- Creates enums, tables, foreign keys, check constraints, and helper functions.
-- RLS policies, indexes, and triggers live in subsequent migrations.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------
create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "citext";     -- case-insensitive text (emails)
create extension if not exists "pg_trgm";    -- trigram search for clients dedup

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type user_role as enum ('owner', 'manager', 'barber');
create type shop_member_status as enum ('confirmed', 'staff', 'deleted');
create type date_format_enum as enum ('USA', 'EU');
create type payout_discount_mode as enum ('split', 'shop', 'barber');
create type service_status as enum ('enabled', 'disabled');
create type appointment_status as enum (
  'booked', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show'
);
create type appointment_source as enum ('admin', 'online');
create type discount_type as enum ('percent', 'fixed');
create type discount_assignment as enum ('services_only', 'products_only', 'both');
create type loyalty_type as enum ('transaction', 'value');
create type commission_scope as enum ('services', 'products');
create type business_type as enum ('individual', 'company');
create type notification_event as enum (
  'confirm', 'reschedule', 'cancel', 'arrived',
  'reminder', 'client_reminder_1', 'client_reminder_2'
);
create type barber_settings_scope as enum ('shop', 'barber');

-- =============================================================================
-- IDENTITY
-- =============================================================================

-- public.profiles — app-level user record, FK to Supabase auth.users.
-- Decouples app concerns from auth (and lets us soft-archive a profile while
-- keeping the auth record).
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email citext not null unique,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =============================================================================
-- SHOPS (tenant root)
-- =============================================================================
create table public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  alias text unique,                         -- slug for public booking URL
  website text,
  phone text,
  email citext,
  instagram text,
  yelp_id text,
  timezone text not null default 'America/Toronto',
  date_format date_format_enum not null default 'USA',
  logo_url text,
  description text,
  inventory_alert_email citext,
  inventory_alert_phone text,
  default_cash_drawer_balance numeric(10,2) not null default 0,
  default_language text not null default 'fr' check (default_language in ('fr', 'en')),
  supported_languages text[] not null default '{fr,en}'::text[],

  -- Options (toggles from Shop details screen)
  age_21_only boolean not null default false,
  allow_booking_any_barber boolean not null default true,
  gross_up_fees boolean not null default true,
  use_prod_price_in_tips boolean not null default true,
  use_taxes_in_tips boolean not null default true,
  client_reviews boolean not null default true,
  payout_discount_mode payout_discount_mode not null default 'split',

  -- Business location
  country text,
  street text,
  street2 text,
  municipality text,
  province text,
  postal_code text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.shop_hours (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),  -- 0=Sun … 6=Sat
  enabled boolean not null default false,
  open_time time,
  close_time time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, weekday),
  check ((enabled = false) or (open_time is not null and close_time is not null and open_time < close_time))
);

create table public.shop_days_off (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  date date not null,
  reason text,
  created_at timestamptz not null default now(),
  unique (shop_id, date)
);

create table public.shop_members (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role user_role not null default 'barber',
  status shop_member_status not null default 'confirmed',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, user_id)
);

-- =============================================================================
-- BARBERS
-- =============================================================================
create table public.barbers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  display_name text not null,
  email citext,
  phone text,
  avatar_url text,
  personnel_id text,
  sort_order int not null default 0,
  status shop_member_status not null default 'confirmed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- barber_settings — one row per shop (defaults) + one per barber (overrides).
-- The scope column makes the intent explicit and lets us enforce that the
-- "shop" row has barber_id = null and vice versa.
create table public.barber_settings (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  scope barber_settings_scope not null,
  barber_id uuid references public.barbers(id) on delete cascade,
  allow_booking_wo_payment boolean not null default true,
  booking_tip boolean not null default true,
  confirmation_tip boolean not null default false,
  allow_multiple_services boolean not null default true,
  client_booking_interval_min smallint not null default 30,
  barber_booking_interval_min smallint not null default 15,
  days_book_in_advance smallint not null default 30,
  mins_book_before_appt smallint not null default 5,
  customer_cancellations boolean not null default true,
  mins_cancel_before_appt smallint not null default 300,  -- 5h
  reminder1_h smallint not null default 24,
  reminder1_m smallint not null default 0,
  reminder2_h smallint not null default 1,
  reminder2_m smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope = 'shop' and barber_id is null) or
    (scope = 'barber' and barber_id is not null)
  )
);

-- Exactly one "shop" row + one row per barber:
create unique index barber_settings_shop_unique
  on public.barber_settings (shop_id)
  where scope = 'shop';
create unique index barber_settings_barber_unique
  on public.barber_settings (barber_id)
  where scope = 'barber';

-- =============================================================================
-- TAXES (shop-scoped)
-- =============================================================================
create table public.taxes (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  name text not null,
  percentage numeric(6,3) not null check (percentage >= 0 and percentage <= 100),
  add_to_price boolean not null default true,
  external_orders_only boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =============================================================================
-- SERVICES
-- =============================================================================
create table public.service_categories (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  category_id uuid references public.service_categories(id) on delete set null,
  name text not null,
  duration_min smallint not null check (duration_min > 0),
  price numeric(10,2) not null check (price >= 0),
  status service_status not null default 'enabled',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- M:N services ↔ taxes (a service can have TPS + TVQ).
create table public.service_taxes (
  service_id uuid not null references public.services(id) on delete cascade,
  tax_id uuid not null references public.taxes(id) on delete cascade,
  primary key (service_id, tax_id)
);

-- =============================================================================
-- PRODUCTS
-- =============================================================================
create table public.product_brands (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, name)
);

create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, name)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  brand_id uuid references public.product_brands(id) on delete set null,
  category_id uuid references public.product_categories(id) on delete set null,
  name text not null,
  price numeric(10,2) not null check (price >= 0),
  supply_price numeric(10,2) not null default 0 check (supply_price >= 0),
  current_inventory int not null default 0 check (current_inventory >= 0),
  low_inventory_threshold int not null default 0 check (low_inventory_threshold >= 0),
  sku text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_taxes (
  product_id uuid not null references public.products(id) on delete cascade,
  tax_id uuid not null references public.taxes(id) on delete cascade,
  primary key (product_id, tax_id)
);

-- =============================================================================
-- CLIENTS
-- =============================================================================
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  first_name text not null,
  last_name text,
  email citext,
  phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =============================================================================
-- APPOINTMENTS
-- =============================================================================
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  barber_id uuid not null references public.barbers(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status appointment_status not null default 'booked',
  notes text,
  source appointment_source not null default 'admin',
  total_amount numeric(10,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at)
);

create table public.appointment_services (
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete restrict,
  price_snapshot numeric(10,2) not null check (price_snapshot >= 0),
  primary key (appointment_id, service_id)
);

create table public.blocked_time (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  barber_id uuid references public.barbers(id) on delete cascade,  -- null = whole shop
  start_at timestamptz not null,
  end_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  check (end_at > start_at)
);

-- =============================================================================
-- DISCOUNTS, PROMO CODES, LOYALTY
-- =============================================================================
create table public.discounts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  name text not null,
  type discount_type not null,
  value numeric(10,3) not null check (value >= 0),  -- percent (0-100) or $ amount
  assignment discount_assignment not null default 'services_only',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (type <> 'percent' or value <= 100)
);

create table public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  code text not null,
  type discount_type not null,
  value numeric(10,3) not null check (value >= 0),
  first_appointment_only boolean not null default false,
  one_time boolean not null default false,
  expiration_date date,
  redemptions int not null default 0 check (redemptions >= 0),
  total_redemption_value numeric(10,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, code),
  check (type <> 'percent' or value <= 100)
);

create table public.loyalty_program (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null unique references public.shops(id) on delete cascade,
  enabled boolean not null default false,
  type loyalty_type not null default 'transaction',
  goal_count int not null default 0 check (goal_count >= 0),
  min_transaction_amount numeric(10,2) not null default 0,
  reward_amount numeric(10,2) not null default 0,
  include_product_sales boolean not null default false,
  include_tips boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =============================================================================
-- COMMISSIONS, TIPS, PAYMENTS
-- =============================================================================
create table public.commission_tiers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  barber_id uuid not null references public.barbers(id) on delete cascade,
  scope commission_scope not null,
  cumulative boolean not null default false,
  tier1_threshold numeric(10,2) not null default 0,
  tier1_pct numeric(5,2) not null default 0,
  tier2_threshold numeric(10,2) not null default 0,
  tier2_pct numeric(5,2) not null default 0,
  tier3_threshold numeric(10,2) not null default 0,
  tier3_pct numeric(5,2) not null default 0,
  tier4_threshold numeric(10,2) not null default 0,
  tier4_pct numeric(5,2) not null default 0,
  tier5_threshold numeric(10,2) not null default 0,
  tier5_pct numeric(5,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, barber_id, scope)
);

create table public.tips_config (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null unique references public.shops(id) on delete cascade,
  round_up boolean not null default true,
  pct_tier1 smallint not null default 15,
  pct_tier2 smallint not null default 18,
  pct_tier3 smallint not null default 20,
  pct_tier4 smallint not null default 25,
  pct_use_above_amount numeric(10,2) not null default 10,
  flat_tier1 numeric(10,2) not null default 2,
  flat_tier2 numeric(10,2) not null default 3,
  flat_tier3 numeric(10,2) not null default 4,
  flat_tier4 numeric(10,2) not null default 5,
  booking_tip boolean not null default true,
  confirmation_tip boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payment_profiles (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null unique references public.shops(id) on delete cascade,
  legal_name text,
  business_type business_type,
  tax_id_provided boolean not null default false,
  sin_provided boolean not null default false,
  dob date,
  verified boolean not null default false,
  destination_bank_name text,
  destination_last4 text check (destination_last4 is null or destination_last4 ~ '^\d{4}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =============================================================================
-- NOTIFICATIONS, WAITING LIST
-- =============================================================================
create table public.notification_prefs (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  event notification_event not null,
  email boolean not null default false,
  push boolean not null default false,
  delay_h smallint not null default 0,
  delay_m smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, event)
);

create table public.waiting_list_config (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null unique references public.shops(id) on delete cascade,
  enabled boolean not null default false,
  threshold_hours smallint not null default 3,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =============================================================================
-- AUDIT LOG (write-once history of sensitive mutations)
-- =============================================================================
create table public.audit_log (
  id bigserial primary key,
  occurred_at timestamptz not null default now(),
  shop_id uuid,
  actor_id uuid,                           -- profiles.id of the actor, nullable for system
  action text not null,                    -- 'insert' | 'update' | 'delete'
  entity text not null,                    -- table name
  entity_id text,                          -- usually uuid as text
  diff jsonb                               -- {before, after} or {row}
);

-- =============================================================================
-- HELPER FUNCTIONS (security definer where appropriate)
-- =============================================================================

-- current_shop_ids() — UUIDs of every shop the current auth user is a member of.
-- Used by RLS policies to keep them compact and consistent.
create or replace function public.current_shop_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    array_agg(shop_id),
    array[]::uuid[]
  )
  from public.shop_members
  where user_id = auth.uid()
    and status = 'confirmed';
$$;

-- is_shop_member(shop_id) — boolean shortcut for policies.
create or replace function public.is_shop_member(target_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.shop_members
    where user_id = auth.uid()
      and shop_id = target_shop_id
      and status = 'confirmed'
  );
$$;

-- has_role_in_shop(shop_id, role) — used by code paths needing role-based gates.
create or replace function public.has_role_in_shop(target_shop_id uuid, target_role user_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.shop_members
    where user_id = auth.uid()
      and shop_id = target_shop_id
      and status = 'confirmed'
      and (
        role = target_role
        or (target_role = 'barber' and role in ('owner','manager','barber'))
        or (target_role = 'manager' and role in ('owner','manager'))
      )
  );
$$;
