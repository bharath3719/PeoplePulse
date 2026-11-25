/**
 * The design token layer (ENGINEERING-STANDARDS.md §3).
 *
 * Colour, spacing, and type are defined HERE, once. Never a raw hex code in a
 * component — that is how you get eight slightly different greys across eight
 * modules over twelve months, and nobody can ever fix it because nobody can
 * find them all.
 *
 * Because we own our shadcn components outright (ADR-003) rather than consuming
 * a library, this file is the only thing keeping the product looking like one
 * product. It matters more here than it would elsewhere.
 */
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        canvas: 'hsl(var(--canvas))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        /** The selected nav item, a highlighted row: brand, but quiet. */
        brand: {
          soft: 'hsl(var(--brand-soft))',
          'soft-foreground': 'hsl(var(--brand-soft-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },

        /** Generic outcomes — a toast, a stat that moved, a checklist step done. */
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        info: 'hsl(var(--info))',

        /**
         * Semantic colours for the statuses this product actually has.
         *
         * PF status is not a generic "badge" — NOT_APPLICABLE, EXCLUDED and
         * MEMBER mean different things and HR must be able to tell them apart at
         * a glance in a list of 200 people. Naming them here stops someone
         * reaching for `bg-gray-100` and flattening the distinction.
         */
        status: {
          member: 'hsl(var(--status-member))',
          excluded: 'hsl(var(--status-excluded))',
          notApplicable: 'hsl(var(--status-na))',
        },

        /** Leave request states. Their own names, so a change to PF's colours cannot repaint leave. */
        leave: {
          approved: 'hsl(var(--leave-approved))',
          pending: 'hsl(var(--leave-pending))',
        },

        avatar: {
          1: 'hsl(var(--avatar-1))',
          2: 'hsl(var(--avatar-2))',
          3: 'hsl(var(--avatar-3))',
          4: 'hsl(var(--avatar-4))',
          5: 'hsl(var(--avatar-5))',
          6: 'hsl(var(--avatar-6))',
        },
      },
      borderRadius: {
        xl: 'calc(var(--radius) + 4px)',
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      boxShadow: {
        /** A card on the panel: a hairline of depth, not a float. */
        card: '0 1px 2px 0 rgb(16 24 40 / 0.04), 0 1px 3px 0 rgb(16 24 40 / 0.04)',
        /** The page panel on the canvas. */
        panel: '0 1px 3px 0 rgb(16 24 40 / 0.06), 0 0 0 1px rgb(16 24 40 / 0.03)',
        popover: '0 10px 32px -4px rgb(16 24 40 / 0.14), 0 4px 10px -2px rgb(16 24 40 / 0.06)',
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        // Tabular figures for money and employee codes. A salary register with
        // proportional digits is unreadable — the columns will not line up.
        mono: ['ui-monospace', 'SFMono-Regular', 'Cascadia Mono', 'Menlo', 'monospace'],
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'zoom-in': {
          from: { opacity: '0', transform: 'translate(-50%, -48%) scale(0.97)' },
          to: { opacity: '1', transform: 'translate(-50%, -50%) scale(1)' },
        },
        'slide-in-left': { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(0)' } },
        'pop-in': {
          from: { opacity: '0', transform: 'scale(0.96) translateY(-2px)' },
          to: { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        shimmer: { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.5' } },
        /** Horizontally centred, near the top: the command menu. Keeps its translateX. */
        'drop-in': {
          from: { opacity: '0', transform: 'translate(-50%, -6px) scale(0.98)' },
          to: { opacity: '1', transform: 'translate(-50%, 0) scale(1)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'zoom-in': 'zoom-in 160ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-left': 'slide-in-left 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        'pop-in': 'pop-in 120ms cubic-bezier(0.16, 1, 0.3, 1)',
        shimmer: 'shimmer 1.6s ease-in-out infinite',
        'drop-in': 'drop-in 140ms cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
};
