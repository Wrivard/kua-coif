'use client';

import { useEffect, useMemo, useState } from 'react';
import { displayNameFor, parseWidgetConfig, widgetThemeCss } from '@/lib/business/widget-config';
import type { WidgetConfig } from '@/lib/business/widget-config';
import type { BarberRow, ServiceCategoryRow, ServiceRow } from '@/db/rows';
import type { TipsConfig } from '@/lib/business/tips';
import {
  BookingWizard,
  type BookingShop,
  type BookingHours,
} from '../../book/[shopSlug]/booking-wizard';

/**
 * Phase H+10 — full live-preview wrapper for /embed/[shopSlug]?preview=1.
 *
 * Supersedes Loop 66's narrower `PreviewListener` (which only kept theme
 * tokens in sync). The wrapper owns the `WidgetConfig` as React state and
 * passes it down to `BookingWizard`, so EVERY toggle in /settings/widget
 * updates the iframe instantly without a Save round-trip:
 *
 *   - display_name        → wizard header title
 *   - show_address        → address line under the title
 *   - show_phone          → phone line under the address
 *   - mode                → data-theme + .dark class
 *   - accent_color        → CSS custom properties (--accent et al.)
 *   - font_family         → font-family CSS rule
 *   - border_radius       → --radius CSS variables
 *   - show_professional_first → wizard step ordering (1=barber vs 1=service)
 *   - allow_multi_service → service picker single/multi behavior
 *   - show_tip_step       → tip selector visibility on the confirm step
 *   - show_promo_code     → promo code field on the contact step
 *
 * The only field that still requires a hard reload is `default_locale`
 * (wizard translations come from next-intl which reads the URL locale —
 * the parent already swaps the iframe `src` to `${locale}/embed/...` when
 * the form value changes, so this is handled outside the wrapper).
 *
 * Security: same-origin check on every message + payload shape validation
 * via the existing `parseWidgetConfig` (garbage-in → defaults). Only
 * mounted when the embed page is rendered with `?preview=1`, so third-
 * party iframe visitors never receive this code.
 */

type RawShop = BookingShop;

type Props = {
  initialConfig: WidgetConfig;
  /**
   * Unredacted shop row (with full address + phone). The wrapper applies
   * `show_address` / `show_phone` / `display_name` overrides reactively
   * as the operator toggles them. Public embeds (no `?preview=1`) get
   * a server-redacted shop and bypass this wrapper entirely.
   */
  rawShop: RawShop;
  locale: string;
  shopSlug: string;
  hours: BookingHours[];
  daysOff: string[];
  barbers: BarberRow[];
  services: ServiceRow[];
  categories: ServiceCategoryRow[];
  tipsConfig?: TipsConfig;
};

const PREVIEW_STYLE_ID = 'kua-widget-preview-style';

function isPreviewMessage(data: unknown): data is { type: string; config: unknown } {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return obj.type === 'kua-widget-preview' && typeof obj.config === 'object' && obj.config !== null;
}

export function PreviewWrapper({
  initialConfig,
  rawShop,
  locale,
  shopSlug,
  hours,
  daysOff,
  barbers,
  services,
  categories,
  tipsConfig,
}: Props) {
  const [config, setConfig] = useState<WidgetConfig>(initialConfig);

  // Derive the shop the wizard sees. Each toggle in the Identity section
  // maps to a single field swap here, so the operator gets visual
  // feedback the instant they flip a switch.
  const shop: BookingShop = useMemo(() => {
    // Phase H+11 — display name resolution honors the per-locale
    // overrides (display_name_fr / display_name_en) with the legacy
    // single field as fallback, and finally the shop's row.name.
    const localeBucket: 'fr' | 'en' = locale === 'en' ? 'en' : 'fr';
    const overrideName = displayNameFor(config, localeBucket);
    return {
      ...rawShop,
      name: overrideName || rawShop.name,
      street: config.show_address ? rawShop.street : null,
      municipality: config.show_address ? rawShop.municipality : null,
      province: config.show_address ? rawShop.province : null,
      phone: config.show_phone ? (rawShop.phone ?? null) : null,
    };
    // `config` itself is a fresh object per postMessage so depending
    // on it re-derives every update — fine, the work is cheap.
  }, [config, locale, rawShop]);

  // postMessage listener — receives the parent's debounced broadcast
  // from /settings/widget. On mount we also send a `ready` ping so the
  // parent can immediately re-broadcast the current form state (covers
  // the race where the parent's first broadcast fires before this
  // effect runs).
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (!isPreviewMessage(event.data)) return;
      // Re-parse through the zod schema so garbage doesn't crash the
      // wizard mid-preview. If the payload is unparseable we silently
      // keep the previous config.
      const next = parseWidgetConfig(event.data.config);
      setConfig(next);
    }
    window.addEventListener('message', onMessage);
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'kua-widget-preview-ready' }, window.location.origin);
    }
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Reactively apply the theme CSS (accent, font, radius). `widgetThemeCss`
  // is the same pure helper the server uses for SSR — reusing it
  // guarantees saved-vs-preview rendering identity (same darken math,
  // same font fallback chain, same radius mapping).
  useEffect(() => {
    const css = widgetThemeCss(config);
    let style = document.getElementById(PREVIEW_STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = PREVIEW_STYLE_ID;
      document.head.appendChild(style);
    }
    style.textContent = css;
  }, [config]);

  // Reactively apply the color mode (data-theme + .dark class). Mirrors
  // the FOUC-prevention script in the embed page so the live update
  // walks the same code path as the saved render.
  useEffect(() => {
    const html = document.documentElement;
    if (config.mode === 'auto') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      html.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
      html.classList.toggle('dark', prefersDark);
    } else {
      html.setAttribute('data-theme', config.mode);
      html.classList.toggle('dark', config.mode === 'dark');
    }
  }, [config.mode]);

  return (
    <BookingWizard
      locale={locale}
      shopSlug={shopSlug}
      shop={shop}
      hours={hours}
      daysOff={daysOff}
      barbers={barbers}
      services={services}
      categories={categories}
      widgetConfig={config}
      tipsConfig={tipsConfig}
    />
  );
}
