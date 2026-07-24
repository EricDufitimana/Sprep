import type { Config } from 'tailwindcss';
import { color, radius, shadow } from './src/lib/tokens';

const config: Config = {
  content: [
    './src/components/**/*.{ts,tsx}',
    './src/app/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        paper: color.paper,
        surface: color.surface,
        sunken: color.sunken,
        line: color.line,
        ink: color.ink,
        blue: color.blue,
        coral: color.coral,
        violet: color.violet,
        yolk: color.yolk,
        green: color.green,
        amber: color.amber,
        miss: color.miss,
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
        // Bluebook mimicry on the test screen only.
        bluebook: ['var(--font-bluebook)', 'Charter', 'Georgia', 'serif'],
      },
      borderRadius: {
        control: radius.control,
        card: radius.card,
        pill: radius.pill,
      },
      boxShadow: {
        lift: shadow.lift,
        none: 'none',
      },
      fontSize: {
        // Tight, sane scale — Cluely rhythm: modest headings, legible body
        micro: ['0.75rem', { lineHeight: '1rem' }], // 12/16
        small: ['0.8125rem', { lineHeight: '1.125rem' }], // 13/18
        body: ['0.875rem', { lineHeight: '1.25rem' }], // 14/20
        lead: ['1rem', { lineHeight: '1.5rem' }], // 16/24
        h3: ['1.125rem', { lineHeight: '1.625rem', letterSpacing: '-0.01em' }], // 18/26
        h2: ['1.375rem', { lineHeight: '1.75rem', letterSpacing: '-0.015em' }], // 22/28
        h1: ['1.625rem', { lineHeight: '2rem', letterSpacing: '-0.02em' }], // 26/32
        score: ['3rem', { lineHeight: '3.25rem', letterSpacing: '-0.02em' }], // 48/52
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
