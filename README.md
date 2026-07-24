# SPrep — SAT Trainer

Personal SAT practice dashboard: timed mock tests, a vocabulary decoder, and skill-level progress tracking. UI-only for now — all data is typed mock data in `src/lib/mock-data.ts`, shaped so the dormant Supabase/tRPC/Prisma scaffold can take over without reworking components.

```bash
npm install
npm run dev
```

## Routes

| Route | What it is |
|---|---|
| `/` | Overview: score stats, weakest-skill callout, struggle list, recent tests |
| `/practice` | Question banks + test configuration modal (timer, question count) |
| `/test/[id]` | Bluebook-style engine: timer, navigator, flagging, no feedback until submit |
| `/test/[id]/results` | Score breakdown + per-question review gated by "why I missed it" |
| `/vocabulary` | Context-decoding drill: commit charge + meaning before the reveal |
| `/progress` | Accuracy over time by domain, most-missed types, weakest-area verdict |

## Design tokens

Single source of truth: [`src/lib/tokens.ts`](src/lib/tokens.ts). `tailwind.config.ts` imports from it; components that need literals (SVG charts, GSAP) import from it too. **No hex values anywhere else.**

### Color

| Token | Value | Use |
|---|---|---|
| `paper` | `#F6F6F3` | App background |
| `surface` | `#FFFFFF` | Cards, panels |
| `sunken` | `#EFEFEA` | Wells, inactive tracks |
| `line` | `#E7E7E1` | Hairline borders |
| `ink.900/700/500/400` | grays | Headings / body / secondary / disabled |
| `blue` + `deep/tint/wash` | `#3D6BE0` | **Lead accent**: CTAs, active nav, selection |
| `coral` + `tint` | `#E86A4F` | Highlight data (most-missed bars) |
| `green` + `tint` | `#3E9E6E` | Semantic: correct |
| `amber` + `tint` | `#E2A63D` | Semantic: flagged / warning |
| `miss` + `deep/tint` | `#C7524A` | Semantic: missed — deliberately distinct from coral |

Rule: mostly white, punctuated by color. Remove the color and the layout still reads.

### Typography

Scraped from **cluely.com** (its `/_next/static/css` bundles, 2026-07-22): Geist 400/500/600 as `--font-sans`, EB Garamond 400 as the serif accent (`.accent-serif`, italic — used only for the weakest-skill name, results verdicts, and vocabulary reveals). Cluely's display face Forma DJR is commercial; Geist 600 with tight tracking stands in, matching their modest-heading rhythm.

Scale (in `tailwind.config.ts`): `micro 12` · `small 13` · `body 14` · `lead 16` · `h3 18` · `h2 22` · `h1 26` · `score 48`. Negative tracking from `h3` up. Numbers always `tabular-nums`.

### Space, radius, shadow, motion

- Spacing: strict 4px scale (Tailwind defaults only)
- Radius: `control 10px` (buttons/inputs/options) · `card 16px` · `pill`
- Shadow: one token, `lift` — soft, interactive surfaces only
- Motion (GSAP): 180–340ms, `power2.out`, 10px rises, 50ms staggers. Everything respects `prefers-reduced-motion`.

### Signature button

Flat fill + crisp border + a solid offset "plate" underneath (`shadow 0 3px 0 0 <deep>`). Hover lifts a notch, press drops the button onto its plate. All variants (`primary`/`ghost`/`danger`) share the mechanism — see [`src/components/ui/button.tsx`](src/components/ui/button.tsx).

## Component library

Primitives in `src/components/ui/`: `Button`, `Card`, `Stat` (GSAP count-up), `Badge`, `ProgressBar`, `SkillBar`, `Tabs`, `Table`, `Modal` (native `<dialog>`), `Timer`, `EmptyState`, `Input`/`Textarea`, `Icon` (typed Lineicons wrapper — one icon set, always through this component).

Composed in `src/components/`: `Sidebar`, `Topbar`, `PageHeader`, `Reveal` (GSAP entrances), `RevealGate`, `ChargePicker`, `TrendChart` (hand-rolled SVG).

## Backend scaffold (dormant)

tRPC 11 + Supabase SSR + Prisma are wired (`src/trpc/`, `src/utils/supabase/`, `prisma/`) following the CRC platform's architecture, but no UI component touches them. Copy `.env.example` → `.env.local` and fill Supabase credentials when it's time.
