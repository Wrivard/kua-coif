import { z } from 'zod';
import { DATE_FORMATS, PAYOUT_DISCOUNT_MODES } from '@/db/enums';

const optionalText = z
  .string()
  .trim()
  .max(255)
  .nullable()
  .or(z.literal('').transform(() => null));

// SOP-10 — `email_logo_url` is rendered into transactional-email branding, so
// it must originate from our own Supabase Storage bucket and nowhere else (an
// arbitrary URL would be a tracking-pixel / recipient-IP-leak / phishing
// vector). The only sanctioned writer, `uploadShopAsset`, calls `getPublicUrl`
// which yields `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/shop-assets/…`.
// Derive the prefix from env so it stays correct across local / placeholder
// build / prod without hardcoding a domain.
const STORAGE_PUBLIC_OBJECT_PREFIX = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}/storage/v1/object/public/`;

export const shopDetailsSchema = z.object({
  name: z.string().trim().min(1, 'NAME_REQUIRED').max(120),
  alias: optionalText,
  website: optionalText,
  phone: optionalText,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .nullable()
    .or(z.literal('').transform(() => null)),
  instagram: optionalText,
  yelp_id: optionalText,
  timezone: z.string().trim().min(1),
  date_format: z.enum(DATE_FORMATS),
  default_language: z.enum(['fr', 'en']),
  default_cash_drawer_balance: z.number().min(0).max(99999.99),
  description: optionalText,

  // location
  country: optionalText,
  street: optionalText,
  street2: optionalText,
  municipality: optionalText,
  province: optionalText,
  postal_code: optionalText,

  // options
  age_21_only: z.boolean(),
  allow_booking_any_barber: z.boolean(),
  gross_up_fees: z.boolean(),
  use_prod_price_in_tips: z.boolean(),
  use_taxes_in_tips: z.boolean(),
  client_reviews: z.boolean(),
  payout_discount_mode: z.enum(PAYOUT_DISCOUNT_MODES),

  // Phase 64 — marketing banner on the public booking page.
  marketing_banner_enabled: z.boolean(),
  marketing_banner_text: z
    .string()
    .trim()
    .max(280)
    .nullable()
    .or(z.literal('').transform(() => null)),

  // Phase 62 — per-shop transactional email branding.
  email_logo_url: optionalText.refine(
    // Empty/null = "no logo" (optionalText leaves a cleared field as ''); any
    // other value must live under our Storage public-object prefix.
    (v) => !v || v.startsWith(STORAGE_PUBLIC_OBJECT_PREFIX),
    'INVALID_LOGO_URL',
  ),
  email_accent_color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'INVALID_HEX_COLOR')
    .nullable()
    .or(z.literal('').transform(() => null)),
});
export type ShopDetailsInput = z.infer<typeof shopDetailsSchema>;

export const shopHoursRowSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  enabled: z.boolean(),
  open_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable(),
  close_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable(),
});
export const shopHoursSchema = z.array(shopHoursRowSchema).length(7);
export type ShopHoursInput = z.infer<typeof shopHoursSchema>;
