/**
 * Widget configuration parser + defaults.
 *
 * `shops.widget_config` is a `jsonb` column with no DB-side shape constraints
 * (so adding new fields is a code-only change). This module is the **single
 * source of truth** for the widget config shape and its default values.
 *
 * Used by:
 *   - `app/[locale]/embed/[shopSlug]/page.tsx` (renders the widget)
 *   - `app/[locale]/(app)/settings/widget/*` (admin UI)
 *   - `middleware.ts` (reads `allowed_origins` to set CSP frame-ancestors)
 *
 * The schema is permissive on parse (`safeParse` + fallback to defaults) so a
 * malformed row in the DB never breaks the public booking flow.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const hexColor = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/u, 'Invalid hex color')
  .optional();

// Exported so the settings UI can validate the `allowed_origins` textarea
// client-side with the EXACT same rule the schema enforces (single source
// of truth — a divergence would let the UI accept an origin the server
// then rejects with a generic error).
// Allow `https://example.com`, `https://*.example.com`, and `*` (wildcard).
// We don't accept paths — CSP frame-ancestors is host-based.
export const originPattern = /^(\*|https?:\/\/(\*\.)?[a-zA-Z0-9.-]+(:[0-9]+)?)$/u;

const originUrl = z.string().regex(originPattern, 'Invalid origin');

// Phase H+11 — accepts http(s) URLs only. Used for `redirect_url` so a
// shop owner can't accidentally redirect customers to `javascript:` or
// other dangerous schemes after booking confirmation.
const httpUrl = z
  .string()
  .trim()
  .refine((v) => v === '' || /^https?:\/\/.+/i.test(v), 'Must be a valid http(s) URL');

export const widgetConfigSchema = z.object({
  // ── Identity ────────────────────────────────────────────────────────────
  // Phase H+11 — per-locale display names. Keep the legacy `display_name`
  // as a fallback so existing rows + V1 callers keep working. New writes
  // use the per-locale variants; the embed picks the right one based on
  // the URL locale, falling back to `display_name`, then `shop.name`.
  display_name: z.string().trim().max(60).optional(),
  display_name_fr: z.string().trim().max(60).optional(),
  display_name_en: z.string().trim().max(60).optional(),
  show_address: z.boolean().default(true),
  show_phone: z.boolean().default(false),

  // Phase H+11 — custom welcome line (shown under the address/phone in
  // the wizard header) + post-booking message (shown on the confirmation
  // screen). Per-locale so a bilingual shop can speak the right language
  // to each customer. 280 chars max ≈ a tweet — enough to say something
  // meaningful, short enough to keep the header from blowing up.
  welcome_message_fr: z.string().trim().max(280).optional(),
  welcome_message_en: z.string().trim().max(280).optional(),
  post_booking_message_fr: z.string().trim().max(280).optional(),
  post_booking_message_en: z.string().trim().max(280).optional(),

  // ── Theme ───────────────────────────────────────────────────────────────
  mode: z.enum(['dark', 'light', 'auto']).default('dark'),
  accent_color: hexColor, // overrides --accent CSS var
  font_family: z.enum(['system', 'geist', 'inter']).default('system'),
  border_radius: z.enum(['sharp', 'rounded', 'pill']).default('rounded'),

  // ── Steps ──────────────────────────────────────────────────────────────
  show_professional_first: z.boolean().default(false), // when true: barber → service (Squire-style)
  allow_multi_service: z.boolean().default(true),
  show_tip_step: z.boolean().default(false),
  show_promo_code: z.boolean().default(false),

  // ── Behavior ───────────────────────────────────────────────────────────
  default_locale: z.enum(['fr', 'en']).default('fr'),
  // CSP frame-ancestors whitelist. Empty → fallback to `*` (permissive in V1,
  // tighten later). Each entry: full origin like `https://salon.com` or
  // wildcard subdomain `https://*.salon.com`. Special token `*` allows all.
  allowed_origins: z.array(originUrl).default([]),

  // ── Phase H+11 — Snippet mode + post-booking redirect ─────────────────
  // `snippet_mode` drives which integration code the widget settings page
  // shows AND which widget.js codepath fires on the salon's site:
  //   - inline (default): widget renders directly where the placeholder
  //     div is dropped. The V1 behavior.
  //   - floating-button: widget.js injects a fixed bottom-right "Book"
  //     button that opens a modal containing the iframe. Calendly-style.
  //   - modal: widget.js exposes a `Kua.open()` API the salon calls from
  //     their own "Book" button (or any link). Iframe lives in a modal
  //     overlay opened on demand.
  snippet_mode: z.enum(['inline', 'floating-button', 'modal']).default('inline'),

  // After a successful booking, redirect the customer to a custom URL
  // (e.g. https://salon.com/merci?ref=kua). Useful for Google Ads
  // conversion tracking + a branded "thank you" page. When disabled,
  // the wizard's built-in confirmation screen is shown instead.
  redirect_enabled: z.boolean().default(false),
  redirect_url: httpUrl.optional(),
});

export type WidgetConfig = z.infer<typeof widgetConfigSchema>;

// ---------------------------------------------------------------------------
// Parse + defaults
// ---------------------------------------------------------------------------

/**
 * Defaults applied when a shop has no `widget_config` set or when individual
 * fields are missing. Centralized so the admin UI can compare current vs.
 * default and show "(default)" badges.
 */
export const defaultWidgetConfig: WidgetConfig = widgetConfigSchema.parse({});

/**
 * Resilient parser: never throws. Garbage in → defaults out.
 * Used everywhere we read the column from the DB.
 */
export function parseWidgetConfig(raw: unknown): WidgetConfig {
  if (!raw || typeof raw !== 'object') return defaultWidgetConfig;
  const result = widgetConfigSchema.safeParse(raw);
  return result.success ? result.data : defaultWidgetConfig;
}

// ---------------------------------------------------------------------------
// Locale-aware getters (Phase H+11)
// ---------------------------------------------------------------------------

/**
 * Resolve the display name for a given locale. Order:
 *   1. The locale-specific field (display_name_fr / display_name_en)
 *   2. The legacy single field (display_name) — kept for backward compat
 *   3. null — caller falls back to the shop's row.name
 */
export function displayNameFor(cfg: WidgetConfig, locale: 'fr' | 'en'): string | null {
  const localized = locale === 'fr' ? cfg.display_name_fr : cfg.display_name_en;
  return (localized?.trim() || cfg.display_name?.trim() || null) ?? null;
}

/**
 * Welcome message for a given locale. Null when the operator hasn't set
 * one — the wizard header renders nothing in that case.
 */
export function welcomeMessageFor(cfg: WidgetConfig, locale: 'fr' | 'en'): string | null {
  const msg = locale === 'fr' ? cfg.welcome_message_fr : cfg.welcome_message_en;
  return msg?.trim() || null;
}

/**
 * Post-booking message for a given locale. Null when unset — wizard
 * shows the default confirmation copy.
 */
export function postBookingMessageFor(cfg: WidgetConfig, locale: 'fr' | 'en'): string | null {
  const msg = locale === 'fr' ? cfg.post_booking_message_fr : cfg.post_booking_message_en;
  return msg?.trim() || null;
}

// ---------------------------------------------------------------------------
// CSP helpers
// ---------------------------------------------------------------------------

/**
 * Build the `frame-ancestors` source list for the widget CSP.
 * Returns a single string ready to drop into the header.
 *
 * Rules:
 *   - Empty `allowed_origins` → `*` (permissive V1; an explicit whitelist
 *     is the only way to actually lock the widget down).
 *   - Wildcard `*` → `*`.
 *   - Otherwise: `'self'` + each whitelisted origin.
 *
 * `'self'` is always included so the admin live-preview iframe (which is
 * same-origin) works without listing the host explicitly.
 */
export function frameAncestorsFor(cfg: WidgetConfig): string {
  if (cfg.allowed_origins.length === 0) return '*';
  if (cfg.allowed_origins.includes('*')) return '*';
  return ["'self'", ...cfg.allowed_origins].join(' ');
}

// ---------------------------------------------------------------------------
// Theme helpers
// ---------------------------------------------------------------------------

/**
 * Loop 65 SR — parse a CSS hex color (`#rgb` or `#rrggbb`) into RGB.
 * Returns null on garbage; callers default to the passthrough behavior.
 *
 * Used by both `darkenHex` (hover/active states) and the rgba derivations
 * in `widgetThemeCss` (subtle/glow/ring tokens). Centralizing the 3-digit
 * expansion + parse here means a future tweak (e.g. accept 4/8-digit
 * RGBA hex) only touches one place.
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return null;
  const raw = m[1]!;
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/**
 * Loop 65 SR — darken a hex color by `amount` (0-1) in linear-RGB space.
 *
 * Used to derive `--accent-hover` (8%) and `--accent-active` (16%) from
 * the owner's chosen `accent_color`. Linear-RGB darkening is a
 * perceptually-close approximation of an HSL lightness shift for short
 * hops (≤16%) without needing an HSL conversion lib. For wider hops a
 * true HSL pass would be better, but hover/active states fall in the
 * sweet spot.
 */
function darkenHex(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const factor = Math.max(0, 1 - amount);
  const toHex = (n: number) =>
    Math.round(n * factor)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

/**
 * Emit inline CSS that overrides theme tokens for the widget shell. Read by
 * the embed page and injected as a `<style>` block. Keeping this pure (no
 * React) means we can also use it in `widget.js` if needed later.
 */
export function widgetThemeCss(cfg: WidgetConfig): string {
  const rules: string[] = [];
  if (cfg.accent_color) {
    rules.push(`--accent: ${cfg.accent_color};`);
    // Loop 65 SR — auto-derive hover + active states so a custom
    // accent doesn't end up with a default-purple hover. 8% darker
    // for hover (matches the perceptual feel of the original
    // purple → purple-hover pair), 16% for active.
    rules.push(`--accent-hover: ${darkenHex(cfg.accent_color, 0.08)};`);
    rules.push(`--accent-active: ${darkenHex(cfg.accent_color, 0.16)};`);
    // Loop 65 SR-of-SR — the OTHER accent-derived tokens (subtle
    // backgrounds, focus glow, focus ring). Without these, a
    // custom red accent gave red buttons but PURPLE focus rings +
    // PURPLE hover tints. Alpha values match the light-theme
    // defaults from globals.css; on `.widget-root` they take
    // precedence over the dark-theme ones via direct-rule
    // application (variables on the wrapper override anything
    // inherited from `:root`).
    const rgb = hexToRgb(cfg.accent_color);
    if (rgb) {
      const rgbStr = `${rgb.r}, ${rgb.g}, ${rgb.b}`;
      rules.push(`--accent-subtle: rgba(${rgbStr}, 0.08);`);
      rules.push(`--accent-subtle-strong: rgba(${rgbStr}, 0.14);`);
      rules.push(`--accent-glow: 0 0 0 4px rgba(${rgbStr}, 0.16);`);
      rules.push(`--accent-ring: rgba(${rgbStr}, 0.45);`);
    }
  }
  if (cfg.font_family === 'geist') {
    rules.push("font-family: 'Geist', system-ui, -apple-system, sans-serif;");
  } else if (cfg.font_family === 'inter') {
    rules.push("font-family: 'Inter', system-ui, -apple-system, sans-serif;");
  }
  if (cfg.border_radius === 'sharp') rules.push('--radius: 0px; --radius-sm: 0px;');
  else if (cfg.border_radius === 'pill') rules.push('--radius: 999px; --radius-sm: 999px;');
  // 'rounded' = use the existing defaults from globals.css.

  if (rules.length === 0) return '';
  return `:root, .widget-root { ${rules.join(' ')} }`;
}
