import { describe, expect, it } from 'vitest';
import {
  defaultWidgetConfig,
  frameAncestorsFor,
  parseWidgetConfig,
  widgetThemeCss,
} from './widget-config';

describe('parseWidgetConfig', () => {
  it('returns defaults for null/undefined/garbage input', () => {
    expect(parseWidgetConfig(undefined)).toEqual(defaultWidgetConfig);
    expect(parseWidgetConfig(null)).toEqual(defaultWidgetConfig);
    expect(parseWidgetConfig('not an object')).toEqual(defaultWidgetConfig);
    expect(parseWidgetConfig(42)).toEqual(defaultWidgetConfig);
  });

  it('returns defaults for an empty object', () => {
    expect(parseWidgetConfig({})).toEqual(defaultWidgetConfig);
  });

  it('merges valid overrides on top of defaults', () => {
    const cfg = parseWidgetConfig({
      display_name: 'Axum',
      accent_color: '#ff0000',
      show_professional_first: true,
      allowed_origins: ['https://salon.com', 'https://*.salon.com'],
    });
    expect(cfg.display_name).toBe('Axum');
    expect(cfg.accent_color).toBe('#ff0000');
    expect(cfg.show_professional_first).toBe(true);
    expect(cfg.allowed_origins).toEqual(['https://salon.com', 'https://*.salon.com']);
    // Untouched fields fall back to defaults.
    expect(cfg.mode).toBe('dark');
    expect(cfg.allow_multi_service).toBe(true);
  });

  it('rejects malformed input by falling back to defaults (no throw)', () => {
    const cfg = parseWidgetConfig({
      mode: 'pink', // not in the enum
      accent_color: 'not-a-hex',
      allowed_origins: ['not-an-origin', 'javascript:alert(1)'],
    });
    // Whole object rejected — defaults returned.
    expect(cfg).toEqual(defaultWidgetConfig);
  });

  it('accepts the wildcard "*" in allowed_origins', () => {
    const cfg = parseWidgetConfig({ allowed_origins: ['*'] });
    expect(cfg.allowed_origins).toEqual(['*']);
  });
});

describe('frameAncestorsFor', () => {
  it('returns "*" when no origins are whitelisted', () => {
    expect(frameAncestorsFor(defaultWidgetConfig)).toBe('*');
  });

  it('returns "*" when the wildcard is in the list', () => {
    expect(frameAncestorsFor({ ...defaultWidgetConfig, allowed_origins: ['*'] })).toBe('*');
    expect(
      frameAncestorsFor({
        ...defaultWidgetConfig,
        allowed_origins: ['https://salon.com', '*'],
      }),
    ).toBe('*');
  });

  it('prepends "self" when a specific whitelist is provided', () => {
    expect(
      frameAncestorsFor({
        ...defaultWidgetConfig,
        allowed_origins: ['https://salon.com', 'https://*.salon.com'],
      }),
    ).toBe("'self' https://salon.com https://*.salon.com");
  });
});

describe('widgetThemeCss', () => {
  it('returns "" when no overrides apply', () => {
    expect(widgetThemeCss(defaultWidgetConfig)).toBe('');
  });

  it('emits an --accent override when accent_color is set', () => {
    const css = widgetThemeCss({ ...defaultWidgetConfig, accent_color: '#abcdef' });
    expect(css).toContain('--accent: #abcdef');
  });

  it('auto-derives --accent-hover + --accent-active from a custom accent (Loop 65 SR)', () => {
    // Pure red (#ff0000) → hover at 92% intensity = #eb0000, active at 84% = #d60000.
    // Without these auto-derives a yellow accent would have a default-purple
    // hover (because globals.css's --accent-hover is the original purple).
    const css = widgetThemeCss({ ...defaultWidgetConfig, accent_color: '#ff0000' });
    expect(css).toContain('--accent-hover: #eb0000');
    expect(css).toContain('--accent-active: #d60000');
  });

  it('auto-derives --accent-subtle, glow, ring from a custom accent (Loop 65 SR-of-SR)', () => {
    // Same root cause as the hover derivation: without these, a yellow
    // accent leaves the FOCUS RING + button hover tints at the
    // default purple. Alpha values match globals.css light-theme tokens.
    const css = widgetThemeCss({ ...defaultWidgetConfig, accent_color: '#ff0000' });
    expect(css).toContain('--accent-subtle: rgba(255, 0, 0, 0.08)');
    expect(css).toContain('--accent-subtle-strong: rgba(255, 0, 0, 0.14)');
    expect(css).toContain('--accent-glow: 0 0 0 4px rgba(255, 0, 0, 0.16)');
    expect(css).toContain('--accent-ring: rgba(255, 0, 0, 0.45)');
  });

  it('handles 3-digit hex by expanding to 6-digit', () => {
    const css = widgetThemeCss({ ...defaultWidgetConfig, accent_color: '#f00' });
    expect(css).toContain('--accent: #f00');
    expect(css).toContain('--accent-hover: #eb0000');
    // 3-digit hex expansion flows through to the rgba derivations too.
    expect(css).toContain('rgba(255, 0, 0,');
  });

  it('emits font-family for non-system fonts only', () => {
    expect(widgetThemeCss({ ...defaultWidgetConfig, font_family: 'system' })).toBe('');
    expect(widgetThemeCss({ ...defaultWidgetConfig, font_family: 'geist' })).toContain(
      "font-family: 'Geist'",
    );
    expect(widgetThemeCss({ ...defaultWidgetConfig, font_family: 'inter' })).toContain(
      "font-family: 'Inter'",
    );
  });

  it('emits radius overrides for sharp/pill only (rounded = default)', () => {
    expect(widgetThemeCss({ ...defaultWidgetConfig, border_radius: 'rounded' })).toBe('');
    expect(widgetThemeCss({ ...defaultWidgetConfig, border_radius: 'sharp' })).toContain(
      '--radius: 0px',
    );
    expect(widgetThemeCss({ ...defaultWidgetConfig, border_radius: 'pill' })).toContain(
      '--radius: 999px',
    );
  });
});
