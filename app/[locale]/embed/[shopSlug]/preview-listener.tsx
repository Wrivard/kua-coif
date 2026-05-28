'use client';

import { useEffect } from 'react';
import { widgetThemeCss } from '@/lib/business/widget-config';
import type { WidgetConfig } from '@/lib/business/widget-config';

/**
 * Loop 66 — Live preview message listener.
 *
 * The /settings/widget page hosts an iframe loading
 * /embed/[shopSlug]?preview=1. While the operator is editing form
 * fields, we want the iframe to reflect their unsaved changes
 * immediately — without round-tripping through Save → server
 * regenerate → iframe reload. Live theme/accent/font/radius
 * changes are mediated by this listener:
 *
 *   parent (settings UI) ─postMessage({type:'kua-widget-preview', config})→ iframe (embed)
 *                                                                              ↓
 *                                              this component applies the config to the DOM
 *
 * What we DON'T re-render on:
 *   - Wizard step ordering (show_professional_first) — that requires
 *     React tree updates; user has to Save to see those.
 *   - Display name override / show_address / show_phone — same.
 *   - allowed_origins — a CSP/middleware concern; needs page reload.
 *
 * Security:
 *   - Same-origin check on every message (the iframe and the settings
 *     page are on the same kua-coif.vercel.app origin in V1).
 *   - Type discriminator on the payload so cross-talk from other
 *     postMessage senders (e.g. our own WidgetResizeEmitter going
 *     UP to the parent — different direction, but still) is ignored.
 *
 * Only mounted when the embed page is rendered with `?preview=1`. The
 * public widget loaded by `widget.js` doesn't include this — third-
 * party sites have no reason to push config changes at runtime.
 */

type PreviewMessage = {
  type: 'kua-widget-preview';
  config: WidgetConfig;
};

const PREVIEW_STYLE_ID = 'kua-widget-preview-style';

function isPreviewMessage(data: unknown): data is PreviewMessage {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return obj.type === 'kua-widget-preview' && typeof obj.config === 'object' && obj.config !== null;
}

export function PreviewListener() {
  useEffect(() => {
    function applyMode(mode: WidgetConfig['mode']) {
      const html = document.documentElement;
      if (mode === 'auto') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        html.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
        html.classList.toggle('dark', prefersDark);
      } else {
        html.setAttribute('data-theme', mode);
        html.classList.toggle('dark', mode === 'dark');
      }
    }

    function applyThemeCss(config: WidgetConfig) {
      // widgetThemeCss is pure — same function the server uses during
      // SSR for the saved config. Reusing it client-side keeps the
      // saved-vs-preview rendering identical (same accent darken
      // math, same font fallback, same radius mapping).
      const css = widgetThemeCss(config);
      let style = document.getElementById(PREVIEW_STYLE_ID) as HTMLStyleElement | null;
      if (!style) {
        style = document.createElement('style');
        style.id = PREVIEW_STYLE_ID;
        document.head.appendChild(style);
      }
      style.textContent = css;
    }

    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (!isPreviewMessage(event.data)) return;
      const { config } = event.data;
      applyMode(config.mode);
      applyThemeCss(config);
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return null;
}
