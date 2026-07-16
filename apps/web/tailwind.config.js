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
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
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
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        // Tabular figures for money and employee codes. A salary register with
        // proportional digits is unreadable — the columns will not line up.
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
