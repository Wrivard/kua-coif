'use client';

import Script from 'next/script';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

/**
 * Cloudflare Turnstile widget — Phase 30.
 *
 * Renders the challenge inline on a parent form. The parent passes
 * `onToken(token)` to receive the verification token, then includes it in
 * the form submission. The server (`lib/security/turnstile.ts`) verifies
 * server-side.
 *
 * Renders nothing when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is not set — the
 * parent form should still submit normally; the server skips verification
 * too in that case. This makes activation a pure env-var flip with no
 * code changes.
 *
 * Why we use the `next/script` loader rather than dropping a <script> in a
 * layout:
 *   - Cloudflare's JS exposes `window.turnstile`; we want to render the
 *     widget only after the script's `onLoad` so we don't race a missing
 *     global.
 *   - The script is shared across all Turnstile renders, so we de-duplicate
 *     via `next/script`'s built-in cache.
 */

type TurnstileApi = {
  render: (
    selector: string | HTMLElement,
    options: {
      sitekey: string;
      callback?: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: () => void;
      theme?: 'light' | 'dark' | 'auto';
      size?: 'normal' | 'compact' | 'invisible';
      action?: string;
    },
  ) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

type Props = {
  /** Called with the verification token. Empty string means expired/cleared. */
  onToken: (token: string) => void;
  /** Override theme. Defaults to 'dark' to match the app's dark-only V1. */
  theme?: 'light' | 'dark' | 'auto';
  /** 'compact' fits better inside dense forms (booking step 4). */
  size?: 'normal' | 'compact';
  /** Optional "action" label sent to Cloudflare analytics (e.g. 'booking'). */
  action?: string;
};

export function TurnstileWidget({ onToken, theme = 'dark', size = 'normal', action }: Props) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const containerId = useId();
  const widgetIdRef = useRef<string | null>(null);
  const [scriptReady, setScriptReady] = useState(
    // If the script is already on the page (e.g. shared with another widget
    // in the same session), skip the loader's onReady.
    typeof window !== 'undefined' && Boolean(window.turnstile),
  );

  const mount = useCallback(() => {
    if (!siteKey) return;
    const tunnel = typeof window !== 'undefined' ? window.turnstile : undefined;
    if (!tunnel) return;
    const el = document.getElementById(containerId);
    if (!el) return;
    if (widgetIdRef.current) return; // Already mounted — don't double-render.
    widgetIdRef.current = tunnel.render(el, {
      sitekey: siteKey,
      theme,
      size,
      action,
      callback: (token: string) => onToken(token),
      'expired-callback': () => onToken(''),
      'error-callback': () => onToken(''),
    });
  }, [siteKey, containerId, theme, size, action, onToken]);

  // Mount when both the script is ready AND the component has rendered.
  useEffect(() => {
    if (!scriptReady) return;
    mount();
    return () => {
      const tunnel = typeof window !== 'undefined' ? window.turnstile : undefined;
      if (tunnel && widgetIdRef.current) {
        try {
          tunnel.remove(widgetIdRef.current);
        } catch {
          // Cloudflare API throws if the widget was already detached — ignore.
        }
        widgetIdRef.current = null;
      }
    };
  }, [scriptReady, mount]);

  // Feature off → render nothing. The parent form should still allow submit
  // and the server-side verifier returns ok when env vars are missing.
  if (!siteKey) return null;

  return (
    <>
      {!scriptReady ? (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="lazyOnload"
          onLoad={() => setScriptReady(true)}
          onReady={() => setScriptReady(true)}
        />
      ) : null}
      <div id={containerId} />
    </>
  );
}

/** Convenience for parent forms that need to know whether to enforce the token. */
export function turnstileSiteKeyConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
}
