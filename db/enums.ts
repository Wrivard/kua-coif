/**
 * Manual mirror of every Postgres enum declared in `supabase/migrations/`.
 * Each constant array is exported `as const` so we get both:
 *   - a runtime value (for selects, validation, etc.)
 *   - a derived TypeScript union type
 *
 * The DB is the source of truth — if you add/rename an enum value in a
 * migration, also update the matching array here (Phase 9 adds a check).
 */

export const USER_ROLES = ['owner', 'manager', 'barber'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const SHOP_MEMBER_STATUSES = ['confirmed', 'staff', 'deleted'] as const;
export type ShopMemberStatus = (typeof SHOP_MEMBER_STATUSES)[number];

export const DATE_FORMATS = ['USA', 'EU'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export const PAYOUT_DISCOUNT_MODES = ['split', 'shop', 'barber'] as const;
export type PayoutDiscountMode = (typeof PAYOUT_DISCOUNT_MODES)[number];

export const SERVICE_STATUSES = ['enabled', 'disabled'] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

export const APPOINTMENT_STATUSES = [
  'booked',
  'confirmed',
  'arrived',
  'completed',
  'cancelled',
  'no_show',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_SOURCES = ['admin', 'online'] as const;
export type AppointmentSource = (typeof APPOINTMENT_SOURCES)[number];

export const DISCOUNT_TYPES = ['percent', 'fixed'] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export const DISCOUNT_ASSIGNMENTS = ['services_only', 'products_only', 'both'] as const;
export type DiscountAssignment = (typeof DISCOUNT_ASSIGNMENTS)[number];

export const LOYALTY_TYPES = ['transaction', 'value'] as const;
export type LoyaltyType = (typeof LOYALTY_TYPES)[number];

export const COMMISSION_SCOPES = ['services', 'products'] as const;
export type CommissionScope = (typeof COMMISSION_SCOPES)[number];

export const BUSINESS_TYPES = ['individual', 'company'] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const NOTIFICATION_EVENTS = [
  'confirm',
  'reschedule',
  'cancel',
  'arrived',
  'reminder',
  'client_reminder_1',
  'client_reminder_2',
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const BARBER_SETTINGS_SCOPES = ['shop', 'barber'] as const;
export type BarberSettingsScope = (typeof BARBER_SETTINGS_SCOPES)[number];

// Locales we support in the UI — kept here so it's colocated with other
// shop-scoped enums and easy to find.
export const APP_LOCALES = ['fr', 'en'] as const;
export type AppLocale = (typeof APP_LOCALES)[number];
