import type { Config } from 'tailwindcss';

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
        DEFAULT: 'var(--radius)',
        sm: 'var(--radius-sm)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      boxShadow: {
        // ─── Elevation scale (Phase 36) ──────────────────────────────
        // Each level is a drop shadow + inset highlight pair. The inset
        // is what makes dark UI feel "lit from above" rather than flat.
        sm: 'var(--shadow-sm), var(--inset-highlight)',
        md: 'var(--shadow-md), var(--inset-highlight)',
        lg: 'var(--shadow-lg), var(--inset-highlight)',
        xl: 'var(--shadow-xl), var(--inset-highlight)',
        // Without the inset — for surfaces that don't want the top
        // highlight (e.g., dropdowns that float free).
        'flat-md': 'var(--shadow-md)',
        'flat-lg': 'var(--shadow-lg)',
        // Glow for hover on accent buttons.
        'accent-glow': 'var(--accent-glow)',
      },
      spacing: {
        'sidebar-w': 'var(--sidebar-w)',
        'sidebar-w-open': 'var(--sidebar-w-open)',
        'header-h': 'var(--header-h)',
      },
      fontFamily: {
        sans: [
          'Geist',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
      fontSize: {
        // Refine the display end of the scale (Phase 36) — h1 on key
        // pages benefits from a heavier, tighter title than Tailwind's
        // default text-2xl.
        'display-sm': [
          '1.5rem',
          { lineHeight: '1.875rem', letterSpacing: '-0.02em', fontWeight: '600' },
        ],
        'display-md': [
          '1.875rem',
          { lineHeight: '2.25rem', letterSpacing: '-0.02em', fontWeight: '600' },
        ],
        'display-lg': [
          '2.25rem',
          { lineHeight: '2.5rem', letterSpacing: '-0.025em', fontWeight: '700' },
        ],
      },
      transitionTimingFunction: {
        // Single named easing used across the app for "natural" UI
        // (drawer slides, modal entries, hover transitions). Looks like
        // the curve Apple uses for sheet presentations.
        'out-quint': 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
};

export default config;
