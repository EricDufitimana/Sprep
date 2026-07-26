'use client';

import { useEffect, useRef, useState } from 'react';
import { RichText } from '@/components/rich-text';

/**
 * /tester — a design sandbox for the test-taking surface.
 *
 * Keeps the sitting screen's LAYOUT (header · split-pane stimulus/question ·
 * footer) but explores a fresh visual design, away from the Bluebook-grey of
 * the real `/test/[id]` screen. It renders a single, representative question so
 * the question aesthetic can be dialled in, and ships a live font playground —
 * reading is the whole job here, so the reading typeface is a first-class knob.
 *
 * Readable typefaces on offer (all research-backed for extended screen reading):
 *   • Atkinson Hyperlegible — Braille Institute; maximises letter distinction
 *   • Lexend — engineered to improve reading speed / reduce visual stress
 *   • Inter — neutral, high-legibility UI sans
 *   • Literata / Newsreader / Source Serif 4 — comfortable reading serifs
 */

const FONTS = [
  { label: 'Atkinson Hyperlegible', stack: "'Atkinson Hyperlegible', sans-serif", note: 'Sans · max legibility' },
  { label: 'Lexend', stack: "'Lexend', sans-serif", note: 'Sans · reading speed' },
  { label: 'Inter', stack: "'Inter', sans-serif", note: 'Sans · neutral UI' },
  { label: 'Literata', stack: "'Literata', Georgia, serif", note: 'Serif · book' },
  { label: 'Newsreader', stack: "'Newsreader', Georgia, serif", note: 'Serif · editorial' },
  { label: 'Source Serif 4', stack: "'Source Serif 4', Georgia, serif", note: 'Serif · clean' },
  { label: 'Georgia', stack: 'Georgia, serif', note: 'Serif · system' },
] as const;

const GOOGLE_FONTS_HREF =
  'https://fonts.googleapis.com/css2?' +
  [
    'family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400',
    'family=Lexend:wght@400;500;600;700',
    'family=Inter:wght@400;500;600;700',
    'family=Literata:opsz,wght@7..72,400;7..72,600;7..72,700',
    'family=Newsreader:opsz,wght@6..72,400;6..72,600;6..72,700',
    'family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700',
  ].join('&') +
  '&display=swap';

/** One real, representative Reading & Writing question (Inferences). */
const SAMPLE = {
  section: 'Section 1 — Reading & Writing',
  skill: 'Inferences',
  difficulty: 'Hard',
  number: 7,
  total: 27,
  passage:
    "One recognized social norm of gift giving is that <u>the time spent obtaining a gift will be viewed as a reflection of the gift’s thoughtfulness</u>. Marketing experts Farnoush Reshadi, Julian Givi, and Gopal Das addressed this view in their studies of norms specifically surrounding the giving of gift cards, noting that while recipients tend to view digital gift cards (which can be purchased online from anywhere and often can be redeemed online as well) as superior to physical gift cards (which sometimes must be purchased in person and may only be redeemable in person) in terms of usage, 94.8 percent of participants surveyed indicated that it is more socially acceptable to give a physical gift card to a recipient. This finding suggests that ______",
  question: 'Which choice most logically completes the text?',
  options: [
    { letter: 'A', text: 'gift givers likely overestimate the amount of effort required to use digital gift cards and thus mistakenly assume gift recipients will view them as less desirable than physical gift cards.' },
    { letter: 'B', text: 'physical gift cards are likely preferred by gift recipients because the tangible nature of those cards offers a greater psychological sense of ownership than digital gift cards do.' },
    { letter: 'C', text: 'physical gift cards are likely less desirable to gift recipients than digital gift cards are because of the perception that physical gift cards require unnecessary effort to obtain.' },
    { letter: 'D', text: 'gift givers likely perceive digital gift cards as requiring relatively low effort to obtain and thus wrongly assume gift recipients will appreciate them less than they do physical gift cards.' },
  ],
};

export default function TesterPage() {
  // Defaults are the house reading setting: Inter · 16px · 1.60 · 0.01em.
  const [fontIndex, setFontIndex] = useState(2); // Inter
  const [size, setSize] = useState(16);
  const [leading, setLeading] = useState(1.6);
  const [tracking, setTracking] = useState(0.01);

  const [selected, setSelected] = useState<string | null>(null);
  const [flagged, setFlagged] = useState(false);

  // The difficulty label stays hidden by default; the "More" menu reveals it.
  const [showDifficulty, setShowDifficulty] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Dismiss the "More" menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const font = FONTS[fontIndex];

  // The reading knobs, handed to the surface as CSS variables.
  const readingVars = {
    ['--reading' as string]: font.stack,
    ['--rsize' as string]: `${size}px`,
    ['--rlh' as string]: String(leading),
    ['--rtrack' as string]: `${tracking}em`,
  } as React.CSSProperties;

  return (
    <>
      {/* Load the candidate reading typefaces. */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href={GOOGLE_FONTS_HREF} />

      <div className="flex h-dvh flex-col bg-[#FAF8F3] text-[#23201B]">
        {/* ── Playground toolbar ─────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-[#ECE6DA] bg-white px-5 py-2.5">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#3B5BDB] text-[13px] font-bold text-white">
              A
            </span>
            <span className="text-[13px] font-semibold tracking-tight text-[#23201B]">
              Test design sandbox
            </span>
          </div>

          <label className="flex items-center gap-2 text-[12px] text-[#6B6559]">
            Typeface
            <select
              value={fontIndex}
              onChange={(e) => setFontIndex(Number(e.target.value))}
              className="rounded-lg border border-[#DED7C9] bg-white px-2.5 py-1.5 text-[12px] font-medium text-[#23201B] focus:outline-none focus:ring-2 focus:ring-[#3B5BDB]"
            >
              {FONTS.map((f, i) => (
                <option key={f.label} value={i}>
                  {f.label} — {f.note}
                </option>
              ))}
            </select>
          </label>

          <Slider label="Size" value={size} min={15} max={24} step={1} suffix="px" onChange={setSize} />
          <Slider label="Line height" value={leading} min={1.4} max={2.1} step={0.05} onChange={setLeading} />
          <Slider label="Tracking" value={tracking} min={-0.02} max={0.06} step={0.005} suffix="em" onChange={setTracking} />

          <button
            onClick={() => {
              setFontIndex(2);
              setSize(16);
              setLeading(1.6);
              setTracking(0.01);
            }}
            className="ml-auto rounded-lg border border-[#DED7C9] px-3 py-1.5 text-[12px] font-medium text-[#6B6559] hover:bg-[#FAF8F3]"
          >
            Reset
          </button>
        </div>

        {/* ── Test surface (single question) ─────────────────────────── */}
        <div className="flex min-h-0 flex-1 flex-col" style={readingVars}>
          {/* Header */}
          <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[#ECE6DA] bg-white/70 px-6 py-3 backdrop-blur">
            <div className="flex items-center gap-3">
              <span className="rounded-full bg-[#23201B] px-3 py-1 text-[12px] font-semibold text-white">
                {SAMPLE.section}
              </span>
              <span className="hidden items-center gap-1.5 text-[12px] text-[#6B6559] sm:flex">
                <span className="h-1 w-1 rounded-full bg-[#C6BEAF]" />
                Practice · no time pressure
              </span>
            </div>

            {/* Timer chip — a soft, rounded readout instead of Bluebook's slab */}
            <div className="flex items-center gap-2 rounded-full border border-[#E4DECF] bg-[#FFFDF8] px-4 py-1.5">
              <span className="h-2 w-2 rounded-full bg-[#3B5BDB]" />
              <span className="text-[15px] font-semibold tabular-nums text-[#23201B]">12:45</span>
            </div>

            <div className="flex items-center gap-4 text-[12px] text-[#9A9280]">
              <span className="hidden sm:inline">Highlights</span>

              {/* "More" menu — houses the optional difficulty reveal. */}
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setMenuOpen((o) => !o)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  className="flex items-center gap-1 rounded-md px-1.5 py-1 hover:text-[#6B6559]"
                >
                  More
                  <span aria-hidden className="text-[10px]">▾</span>
                </button>

                {menuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 top-full z-10 mt-2 w-52 overflow-hidden rounded-xl border border-[#E7E0D2] bg-white py-1 shadow-[0_8px_24px_rgba(0,0,0,0.10)]"
                  >
                    <button
                      role="menuitemcheckbox"
                      aria-checked={showDifficulty}
                      onClick={() => {
                        setShowDifficulty((s) => !s);
                        setMenuOpen(false);
                      }}
                      className="flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-[13px] text-[#23201B] hover:bg-[#FAF8F3]"
                    >
                      Show difficulty
                      <span
                        className={
                          'flex h-4 w-4 items-center justify-center rounded-[5px] border text-[10px] font-bold ' +
                          (showDifficulty
                            ? 'border-[#3B5BDB] bg-[#3B5BDB] text-white'
                            : 'border-[#CFC7B4] text-transparent')
                        }
                      >
                        ✓
                      </span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </header>

          {/* Split panes */}
          <main className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
            {/* Left: passage / stimulus */}
            <section className="min-h-0 overflow-y-auto border-[#ECE6DA] px-8 py-8 md:border-r md:px-10">
              <div className="mx-auto max-w-[38rem]">
                <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#B0A891]">
                  Passage
                </p>
                <div className="rounded-2xl border border-[#EFE9DC] bg-[#FFFDF8] px-7 py-6 shadow-[0_1px_0_rgba(0,0,0,0.02)]">
                  <p
                    className="whitespace-pre-line text-[#2E2A23]"
                    style={{
                      fontFamily: 'var(--reading)',
                      fontSize: 'var(--rsize)',
                      lineHeight: 'var(--rlh)',
                      letterSpacing: 'var(--rtrack)',
                    }}
                  >
                    <RichText>{SAMPLE.passage}</RichText>
                  </p>
                </div>
              </div>
            </section>

            {/* Right: question + answer choices */}
            <section className="min-h-0 overflow-y-auto border-t border-[#ECE6DA] px-8 py-8 md:border-t-0 md:px-10">
              <div className="mx-auto max-w-[38rem]">
                {/* Question meta row */}
                <div className="mb-5 flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#3B5BDB] text-[15px] font-bold text-white shadow-[0_2px_0_#2C46AD]">
                    {SAMPLE.number}
                  </span>
                  <span className="rounded-full bg-[#EEF2FF] px-2.5 py-1 text-[12px] font-medium text-[#3B5BDB]">
                    {SAMPLE.skill}
                  </span>
                  {showDifficulty && (
                    <span className="rounded-full bg-[#FBEEE6] px-2.5 py-1 text-[12px] font-medium text-[#C2683B]">
                      {SAMPLE.difficulty}
                    </span>
                  )}

                  <button
                    onClick={() => setFlagged((f) => !f)}
                    aria-pressed={flagged}
                    className={
                      'ml-auto flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ' +
                      (flagged
                        ? 'border-[#E0A92A] bg-[#FBF2DF] text-[#8A6A16]'
                        : 'border-[#E4DECF] text-[#6B6559] hover:bg-[#FFFDF8]')
                    }
                  >
                    <span aria-hidden>{flagged ? '★' : '☆'}</span>
                    {flagged ? 'Marked' : 'Mark for review'}
                  </button>
                </div>

                {/* Question stem */}
                <p
                  className="mb-6 font-semibold text-[#23201B]"
                  style={{
                    fontFamily: 'var(--reading)',
                    fontSize: 'calc(var(--rsize) + 1px)',
                    lineHeight: 'calc(var(--rlh) - 0.1)',
                    letterSpacing: 'var(--rtrack)',
                  }}
                >
                  <RichText>{SAMPLE.question}</RichText>
                </p>

                {/* Options */}
                <div role="radiogroup" aria-label="Answer choices" className="space-y-3">
                  {SAMPLE.options.map((opt) => {
                    const isSel = selected === opt.letter;
                    return (
                      <button
                        key={opt.letter}
                        role="radio"
                        aria-checked={isSel}
                        onClick={() => setSelected(isSel ? null : opt.letter)}
                        className={
                          'group flex w-full items-start gap-3.5 rounded-2xl border px-4 py-3.5 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B5BDB] ' +
                          (isSel
                            ? 'border-[#3B5BDB] bg-[#EEF2FF] shadow-[0_2px_0_rgba(59,91,219,0.18)]'
                            : 'border-[#E7E0D2] bg-white hover:border-[#C9C0AD] hover:bg-[#FFFDF8]')
                        }
                      >
                        <span
                          className={
                            'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[13px] font-bold transition-colors ' +
                            (isSel
                              ? 'border-[#3B5BDB] bg-[#3B5BDB] text-white'
                              : 'border-[#CFC7B4] text-[#6B6559] group-hover:border-[#A9A08B]')
                          }
                        >
                          {opt.letter}
                        </span>
                        <span
                          className="text-[#2E2A23]"
                          style={{
                            fontFamily: 'var(--reading)',
                            fontSize: 'calc(var(--rsize) - 1px)',
                            lineHeight: 'var(--rlh)',
                            letterSpacing: 'var(--rtrack)',
                          }}
                        >
                          <RichText>{opt.text}</RichText>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
          </main>

          {/* Footer */}
          <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-[#ECE6DA] bg-white px-6 py-3">
            {/* Progress */}
            <div className="flex items-center gap-3">
              <span className="text-[13px] font-semibold tabular-nums text-[#23201B]">
                {String(SAMPLE.number).padStart(2, '0')}
                <span className="text-[#B0A891]"> / {SAMPLE.total}</span>
              </span>
              <div className="hidden h-1.5 w-40 overflow-hidden rounded-full bg-[#EDE7DA] sm:block">
                <div
                  className="h-full rounded-full bg-[#3B5BDB]"
                  style={{ width: `${(SAMPLE.number / SAMPLE.total) * 100}%` }}
                />
              </div>
            </div>

            {/* Review pill */}
            <button className="rounded-full border border-[#E4DECF] px-4 py-1.5 text-[13px] font-medium text-[#6B6559] hover:bg-[#FAF8F3]">
              Question {SAMPLE.number} of {SAMPLE.total} ⌄
            </button>

            {/* Nav — the app's tactile pressable treatment */}
            <div className="flex items-center gap-2">
              <button className="rounded-full border border-[#DED7C9] bg-white px-5 py-2 text-[13px] font-semibold text-[#6B6559] transition-transform hover:-translate-y-px active:translate-y-0">
                Back
              </button>
              <button className="rounded-full border border-[#2C46AD] bg-[#3B5BDB] px-6 py-2 text-[13px] font-semibold text-white shadow-[0_3px_0_#2C46AD] transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[0_4px_0_#2C46AD] active:translate-y-[3px] active:shadow-none">
                Next
              </button>
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}

/** Compact labelled range slider for the playground toolbar. */
function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix = '',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[12px] text-[#6B6559]">
      {label}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-24 cursor-pointer accent-[#3B5BDB]"
      />
      <span className="w-12 tabular-nums text-[#23201B]">
        {step < 1 ? value.toFixed(2) : value}
        {suffix}
      </span>
    </label>
  );
}
