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
