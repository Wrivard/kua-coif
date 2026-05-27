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

const originUrl = z
  .string()
  // Allow `https://example.com`, `https://*.example.com`, and `*` (wildcard).
  // We don't accept paths — CSP frame-ancestors is host-based.
  .regex(/^(\*|https?:\/\/(\*\.)?[a-zA-Z0-9.-]+(:[0-9]+)?)$/u, 'Invalid origin');

export const widgetConfigSchema = z.object({
  // ── Identity ────────────────────────────────────────────────────────────
  display_name: z.string().trim().max(60).optional(),
  show_address: z.boolean().default(true),
  show_phone: z.boolean().default(false),

  // ── Theme ───────────────────────────────────────────────────────────────
  mode: z.enum(['dark', 'light', 'auto']).default('dark'),
  accent_color: hexColor, // overrides --accent CSS var
  font_family: z.enum(['system', 'geist', 'inter']).default('system'),
  border_radius: z.enum(['sharp', 'rounded', 'pill']).default('rounded'),

  // ── Steps ──────────────────────────────────────────────────────────────
  show_professional_first: z.boolean().default(false), // when true: barber → service (Squire-style)
  allow_multi_service: z.boolean().default(true),
  show_tip_step: z.boolean().default(false), // tip step inside widget — V1.1
  show_promo_code: z.boolean().default(false), // promo code field — V1.1

  // ── Behavior ───────────────────────────────────────────────────────────
  default_locale: z.enum(['fr', 'en']).default('fr'),
  // CSP frame-ancestors whitelist. Empty → fallback to `*` (permissive in V1,
  // tighten later). Each entry: full origin like `https://salon.com` or
  // wildcard subdomain `https://*.salon.com`. Special token `*` allows all.
  allowed_origins: z.array(originUrl).default([]),
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
