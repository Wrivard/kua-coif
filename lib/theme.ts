/**
 * Loop 60 — theme helper.
 *
 * Bridges the `<ThemeToggle>` client component and the inline init script
 * embedded in `app/[locale]/layout.tsx`. The two must agree on:
 *   - storage key
 *   - attribute name on <html>
 *   - resolution order (explicit user choice → system preference → light)
 *
 * Both are exported from here so a future tweak (e.g. add a `system`
 * tri-state) only touches one file. The init script is hand-inlined for
 * FOUC reasons (see layout.tsx) but mirrors `resolveInitialTheme` exactly.
 */

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'kua-theme';
export const THEME_ATTRIBUTE = 'data-theme';

/**
 * Resolution at runtime (client-only). The same logic runs as an inline
 * script in <head> before React hydrates — see `THEME_INIT_SCRIPT`.
 */
export function resolveInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // localStorage can throw in private-browsing on some browsers.
    // Fall through to system preference.
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute(THEME_ATTRIBUTE, theme);
  // Keep the legacy `.dark` class in sync too — some hand-written CSS
  // selectors (and any future Tailwind `dark:` variants) may key off it.
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export function persistTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Same private-browsing failure mode — swallow. The toggle still
    // works for the current tab; persistence just won't survive.
  }
}

/**
 * Inline script that runs synchronously in <head> before any React code.
 * Matches `resolveInitialTheme` + `applyTheme` byte-for-byte so server-
 * rendered HTML already has the right `data-theme` attribute set — no
 * flash of unstyled content (FOUC) when the page hydrates.
 *
 * IIFE so the local vars don't pollute the page's global scope.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var s=window.localStorage.getItem('${THEME_STORAGE_KEY}');var t=(s==='light'||s==='dark')?s:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('${THEME_ATTRIBUTE}',t);if(t==='dark')document.documentElement.classList.add('dark');}catch(e){}})();`;
