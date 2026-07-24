/**
 * Design tokens — the single source of truth.
 *
 * tailwind.config.ts imports from this file, and any component that needs a
 * literal value (SVG charts, GSAP) imports from here too. No hex values live
 * anywhere else in the codebase.
 *
 * Typography provenance: scraped from cluely.com (2026-07-22) via raw CSS —
 * Geist 400/500/600 as --font-sans, EB Garamond 400 as the serif accent.
 * (Their third face, Forma DJR, is commercial; Geist 600 covers display duty.)
 * Firecrawl MCP was added via `claude mcp add` but MCP servers only register
 * on session start, so the scrape was done by fetching cluely.com's
 * /_next/static/css bundles directly — same data, different pipe.
 */

export const color = {
  // Neutral ramp — warm-leaning so white cards read as "paper on desk"
  paper: '#F6F6F3', // app background
  surface: '#FFFFFF', // cards, panels
  sunken: '#EFEFEA', // wells, inactive tracks
  line: '#E7E7E1', // hairline borders
  ink: {
    900: '#17181C', // headings
    700: '#41454E', // body
    500: '#71757F', // secondary
    400: '#9B9EA7', // placeholders, disabled
  },

  // Accents — flat, confident, each with a pale tint for chips/washes
  blue: {
    DEFAULT: '#3D6BE0', // lead accent: CTAs, active nav, focus
    deep: '#2C4FAD', // pressable-button offset, pressed fill
    tint: '#E9EFFC', // chips, selected washes
    wash: '#F4F7FE', // large soft panels
  },
  coral: {
    DEFAULT: '#E86A4F',
    tint: '#FCEDE8',
  },
  violet: {
    DEFAULT: '#7C6FDC',
    tint: '#EEEBFA',
  },
  // Egg-yolk gold — the login artwork panel's ground.
  yolk: {
    DEFAULT: '#F4C33F',
    deep: '#E0A92A',
    soft: '#F7D471',
  },
  green: {
    DEFAULT: '#3E9E6E', // semantic: correct
    tint: '#E7F4ED',
  },
  amber: {
    DEFAULT: '#E2A63D', // semantic: flagged
    tint: '#FBF2DF',
  },
  miss: {
    DEFAULT: '#C7524A', // semantic: missed — muted, distinct from coral
    deep: '#9E3F39',
    tint: '#F9EAE8',
  },
} as const;

export const radius = {
  control: '10px', // buttons, inputs, options
  card: '16px', // cards, panels
  pill: '999px',
} as const;

export const shadow = {
  // Single soft lift, interactive surfaces only
  lift: '0 2px 8px -2px rgba(23, 24, 28, 0.08)',
} as const;

/** GSAP motion constants — fast, never bouncy. */
export const motion = {
  fast: 0.18,
  base: 0.26,
  slow: 0.34,
  ease: 'power2.out',
  rise: 10, // px entrance offset
  stagger: 0.05,
} as const;
