import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ─── Surfaces (Phase 36 — depth scale) ─────────────────────────
        'bg-base': 'var(--bg-base)',
        'bg-surface': 'var(--bg-surface)',
        'bg-surface-2': 'var(--bg-surface-2)',
        'bg-elevated': 'var(--bg-elevated)',
        'bg-overlay': 'var(--bg-overlay)',
        border: 'var(--border)',
        'border-strong': 'var(--border-strong)',
        'border-soft': 'var(--border-soft)',
        'border-faint': 'var(--border-faint)',

        // ─── Text ────────────────────────────────────────────────────
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-muted': 'var(--text-muted)',
        'text-disabled': 'var(--text-disabled)',

        // ─── Accent (Küa purple — single source of truth) ────────────
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          active: 'var(--accent-active)',
          fg: 'var(--accent-fg)',
          subtle: 'var(--accent-subtle)',
          'subtle-strong': 'var(--accent-subtle-strong)',
          ring: 'var(--accent-ring)',
        },

        // ─── Status (default + subtle bg pair) ───────────────────────
        success: 'var(--success)',
        'success-subtle': 'var(--success-subtle)',
        warning: 'var(--warning)',
        'warning-subtle': 'var(--warning-subtle)',
        danger: 'var(--danger)',
        'danger-subtle': 'var(--danger-subtle)',
        info: 'var(--info)',
        'info-subtle': 'var(--info-subtle)',

        // ─── Calendar appointment blocks ─────────────────────────────
        'appt-green': 'var(--appt-green)',
        'appt-purple': 'var(--appt-purple)',
        'appt-blue': 'var(--appt-blue)',
      },
      borderRadius: {
        // Phase 75 — Vercel granular radius scale (2/4/6/8/12/16).
        '2xs': 'var(--radius-2xs)',
        xs: 'var(--radius-xs)',
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      boxShadow: {
        // ─── Elevation scale (Phase 75 — Vercel multi-layer stacks) ─────
        // Each level stacks shadow-as-border (1px) + ambient depth +
        // inner #fafafa highlight ring. Pure Vercel philosophy: shadows
        // do the work of borders + elevation simultaneously.
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md), var(--inset-highlight)',
        lg: 'var(--shadow-lg), var(--inset-highlight)',
        xl: 'var(--shadow-xl), var(--inset-highlight)',
        // Warm-tinted elevation (Hero-booking polish) — espresso-toned
        // shadows for the public booking surface. Tokens live in
        // globals.css under both themes. Same layer recipe as sm/md/lg.
        'warm-sm': 'var(--shadow-warm-sm)',
        'warm-md': 'var(--shadow-warm-md), var(--inset-highlight)',
        'warm-lg': 'var(--shadow-warm-lg), var(--inset-highlight)',
        // Without the inner highlight — for surfaces that don't want
        // it (dropdowns, popovers floating away from a card surface).
        'flat-md': 'var(--shadow-md)',
        'flat-lg': 'var(--shadow-lg)',
        // Phase 76 — shadow-as-border utility. Replaces CSS `border` on
        // every component (Vercel rule). Use `shadow-border` or
        // `shadow-border-strong` instead of `border border-border`.
        border: 'var(--shadow-border)',
        'border-strong': 'var(--shadow-border-strong)',
        // Glow for hover on accent buttons.
        'accent-glow': 'var(--accent-glow)',
        // Refonte Step 0 — deepest modal ambient + the one accent-beat elevation.
        modal: 'var(--shadow-modal)',
        'accent-md': 'var(--shadow-accent-md)',
      },
      spacing: {
        'sidebar-w': 'var(--sidebar-w)',
        'sidebar-w-open': 'var(--sidebar-w-open)',
        'header-h': 'var(--header-h)',
      },
      fontFamily: {
        // Loop 37 (P114) — Geist Sans + Mono loaded via next/font in
        // app/[locale]/layout.tsx expose two CSS variables. The
        // fallbacks stay in place so SSR HTML pre-hydration still
        // renders with a reasonable system font (Geist's fallback is
        // baked into the font itself but the chain helps when the
        // font asset hasn't loaded yet).
        sans: [
          'var(--font-geist-sans)',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        mono: [
          'var(--font-geist-mono)',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'Liberation Mono',
          'Courier New',
          'monospace',
        ],
      },
      fontSize: {
        // Phase 75 — Vercel display sizes with aggressive negative
        // letter-spacing. The curve: -0.025em at 48px → -0.020em at
        // 32px → -0.015em at 24px. font-weight stays at 600 max (Vercel
        // forbids 700 even at display sizes).
        'display-sm': [
          '1.5rem', // 24px
          { lineHeight: '1.875rem', letterSpacing: '-0.015em', fontWeight: '600' },
        ],
        'display-md': [
          '1.875rem', // 30px
          { lineHeight: '2.25rem', letterSpacing: '-0.02em', fontWeight: '600' },
        ],
        'display-lg': [
          '2.25rem', // 36px
          { lineHeight: '2.5rem', letterSpacing: '-0.025em', fontWeight: '600' },
        ],
        'display-xl': [
          '3rem', // 48px — true hero size
          { lineHeight: '1.05', letterSpacing: '-0.03em', fontWeight: '600' },
        ],
      },
      transitionTimingFunction: {
        // Single named easing used across the app for "natural" UI
        // (drawer slides, modal entries, hover transitions). Looks like
        // the curve Apple uses for sheet presentations.
        'out-quint': 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      ringColor: {
        // Phase 78 — Vercel saturated blue focus ring. Replaces the
        // soft accent ring on every interactive surface. Same-blue-on-
        // any-bg is consistently more visible for low-vision users
        // than a brand-tinted ring.
        focus: 'var(--focus-ring)',
      },
    },
  },
  plugins: [
    // Phase 76 — `shadow-border` Tailwind utility for the Vercel
    // shadow-as-border technique. Registering as a plugin (vs the
    // boxShadow theme key) lets us use it as `shadow-border` cleanly
    // without conflicting with the `border-border` color utility.
    plugin(({ addUtilities }) => {
      addUtilities({
        '.shadow-border': {
          'box-shadow': 'var(--shadow-border)',
        },
        '.shadow-border-strong': {
          'box-shadow': 'var(--shadow-border-strong)',
        },
        // Combo: ring-border + sm elevation in one class for cards
        // that previously did `border border-border shadow-sm`.
        '.shadow-card': {
          'box-shadow': 'var(--shadow-sm)',
        },
      });
    }),
  ],
};

export default config;
