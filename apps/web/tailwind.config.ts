import type { Config } from 'tailwindcss';

/**
 * Tailwind theme derived from design-system/runner-system/MASTER.md.
 * Token names mirror the CSS variables defined in globals.css so that
 * components can reference either (e.g. `bg-surface` or `bg-[var(--color-surface)]`).
 */
const config: Config = {
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans:  ['"Fira Sans"', 'Inter', 'system-ui', 'sans-serif'],
        mono:  ['"Fira Code"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        heading: ['"Fira Code"', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Semantic tokens (match globals.css CSS vars)
        bg:        'var(--color-bg)',          // #020617
        surface:   'var(--color-surface)',     // #0F172A
        surface2:  'var(--color-surface-2)',   // #1E293B
        border:    'var(--color-border)',      // #334155
        borderStrong: 'var(--color-border-strong)', // #475569
        fg:        'var(--color-fg)',          // #F8FAFC
        muted:     'var(--color-muted)',       // #94A3B8
        mutedStrong:'var(--color-muted-strong)', // #CBD5E1
        accent:    'var(--color-accent)',      // #22C55E
        accentFg:  'var(--color-accent-fg)',   // #052e16
        info:      'var(--color-info)',        // #38BDF8
        warn:      'var(--color-warn)',        // #F59E0B
        danger:    'var(--color-danger)',      // #EF4444
      },
      boxShadow: {
        'panel': '0 0 0 1px rgba(255,255,255,0.04), 0 8px 24px rgba(0,0,0,0.35)',
        'focus-accent': '0 0 0 2px rgba(34,197,94,0.55)',
      },
      transitionDuration: {
        250: '250ms',
      },
    },
  },
  plugins: [],
};

export default config;
