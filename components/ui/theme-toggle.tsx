'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { applyTheme, persistTheme, type Theme } from '@/lib/theme';

/**
 * Loop 60 — theme toggle.
 *
 * Sits alongside the locale switcher in the main sidebar. Mirrors that
 * component's "Link-styled-as-row" pattern so the two sit consistently
 * at the bottom of the rail.
 *
 * Hydration considerations:
 *   - The FOUC-safe init script in `<head>` has already set the
 *     attribute by the time React renders this; we read the
 *     `data-theme` attribute on first render to get the current value
 *     instead of running `resolveInitialTheme()` which would loop
 *     through localStorage a second time.
 *   - First render is gated on a `mounted` flag so the SSR and the
 *     first client render match (otherwise the icon would flicker
 *     between Sun/Moon during hydration).
 */
export function ThemeToggle({ expanded, onClick }: { expanded: boolean; onClick?: () => void }) {
  const t = useTranslations('common.theme');
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    // Read whatever the init script applied — single source of truth.
    const current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'dark' ? 'dark' : 'light');
    setMounted(true);
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
    persistTheme(next);
    onClick?.();
  }

  // Pre-mount render — match the SSR output exactly to avoid hydration
  // mismatch. Server doesn't know the user's theme so we render a
  // theme-neutral placeholder (Sun icon, "Theme" label) until mount.
  const isDark = mounted && theme === 'dark';
  const Icon = isDark ? Sun : Moon;
  const label = mounted ? (isDark ? t('switchToLight') : t('switchToDark')) : t('label');

  return (
    <button
      type="button"
      onClick={toggle}
      title={expanded ? undefined : label}
      aria-label={label}
      // Match the LocaleToggle's exact dimensions + interaction styles
      // so the two sit visually flush at the foot of the sidebar.
      className={cn(
        'flex h-10 w-full items-center gap-3 rounded px-2 transition-colors',
        'text-text-secondary hover:bg-bg-surface-2 hover:text-text-primary',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-focus',
      )}
    >
      <span className="relative inline-flex h-6 w-6 shrink-0 items-center justify-center">
        <Icon className="h-5 w-5" />
      </span>
      {expanded ? <span className="truncate text-sm font-medium">{label}</span> : null}
    </button>
  );
}
