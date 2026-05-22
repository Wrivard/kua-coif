import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Surfaces
        'bg-base': 'var(--bg-base)',
        'bg-surface': 'var(--bg-surface)',
        'bg-surface-2': 'var(--bg-surface-2)',
        'bg-elevated': 'var(--bg-elevated)',
        border: 'var(--border)',

        // Text
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-muted': 'var(--text-muted)',

        // Accent (Küa purple) — single source of truth for rebrand
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          fg: 'var(--accent-fg)',
          subtle: 'var(--accent-subtle)',
        },

        // Status
        success: 'var(--success)',
        warning: 'var(--warning)',
        danger: 'var(--danger)',
        info: 'var(--info)',

        // Calendar appointment blocks
        'appt-green': 'var(--appt-green)',
        'appt-purple': 'var(--appt-purple)',
        'appt-blue': 'var(--appt-blue)',
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        sm: 'var(--radius-sm)',
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
    },
  },
  plugins: [],
};

export default config;
