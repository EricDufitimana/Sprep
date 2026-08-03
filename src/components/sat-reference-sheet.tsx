'use client';

import { type ReactNode } from 'react';
import { Modal } from '@/components/ui/modal';

/**
 * The reference information shown at the start of every SAT Math section —
 * the geometry area/volume formulas, the two special right triangles, and the
 * three arc/angle facts. Recreated here (formulas + simple diagrams) so it's
 * available on demand while answering, exactly like Bluebook's "Reference"
 * button. Content is standard mathematical fact, not a copied image.
 */
export function SatReferenceSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Reference"
      className="max-w-3xl"
    >
      <div className="text-ink-900">
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
          {FIGURES.map((f) => (
            <figure key={f.key} className="flex flex-col items-center gap-2 text-center">
              <div className="flex h-[70px] items-center justify-center text-ink-900">{f.svg}</div>
              <figcaption className="space-y-0.5 text-[13px] leading-tight">
                {f.formulas.map((formula, i) => (
                  <div key={i} className="font-medium">
                    {formula}
                  </div>
                ))}
              </figcaption>
            </figure>
          ))}
        </div>

        <ul className="mt-6 space-y-1 border-t border-line pt-4 text-[13px] leading-relaxed text-ink-700">
          <li>The number of degrees of arc in a circle is 360.</li>
          <li>The number of radians of arc in a circle is 2{PI}.</li>
          <li>The sum of the measures in degrees of the angles of a triangle is 180.</li>
        </ul>
      </div>
    </Modal>
  );
}

/* ---- formula glyphs (kept as constants so they read cleanly inline) ---- */
const PI = 'π'; // π
const L = 'ℓ'; // ℓ (script small L, the SAT's length symbol)
const R2 = '²'; // ²
const R3 = '³'; // ³
const ROOT = '√'; // √

/* Shared SVG styling: hairline shapes that inherit the modal's ink color. */
const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinejoin: 'round' as const,
  strokeLinecap: 'round' as const,
};
const label = { fontSize: 9, fill: 'currentColor', stroke: 'none' } as const;

/** Each entry: a small diagram + the formula(s) that go beneath it. */
const FIGURES: { key: string; svg: ReactNode; formulas: ReactNode[] }[] = [
  {
    key: 'circle',
    formulas: [<span key="a">A = {PI}r{R2}</span>, <span key="c">C = 2{PI}r</span>],
    svg: (
      <svg width="84" height="66" viewBox="0 0 84 66" aria-hidden>
        <circle cx="42" cy="33" r="24" {...S} />
        <line x1="42" y1="33" x2="66" y2="33" {...S} />
        <text x="52" y="30" {...label}>r</text>
      </svg>
    ),
  },
  {
    key: 'rectangle',
    formulas: [<span key="a">A = {L}w</span>],
    svg: (
      <svg width="84" height="66" viewBox="0 0 84 66" aria-hidden>
        <rect x="14" y="16" width="56" height="34" {...S} />
        <text x="40" y="60" {...label} textAnchor="middle">{L}</text>
        <text x="6" y="36" {...label}>w</text>
      </svg>
    ),
  },
  {
    key: 'triangle',
    formulas: [<span key="a">A = ½bh</span>],
    svg: (
      <svg width="84" height="66" viewBox="0 0 84 66" aria-hidden>
        <path d="M16 52 L68 52 L44 14 Z" {...S} />
        <line x1="44" y1="52" x2="44" y2="14" {...S} strokeDasharray="3 3" />
        <text x="40" y="62" {...label} textAnchor="middle">b</text>
        <text x="47" y="36" {...label}>h</text>
      </svg>
    ),
  },
  {
    key: 'right-triangle',
    formulas: [<span key="a">c{R2} = a{R2} + b{R2}</span>],
    svg: (
      <svg width="84" height="66" viewBox="0 0 84 66" aria-hidden>
        <path d="M18 52 L66 52 L18 16 Z" {...S} />
        <path d="M18 46 L24 46 L24 52" {...S} />
        <text x="8" y="36" {...label}>a</text>
        <text x="40" y="62" {...label} textAnchor="middle">b</text>
        <text x="44" y="30" {...label}>c</text>
      </svg>
    ),
  },
  {
    key: '30-60-90',
    formulas: [<span key="a">Special right triangles</span>],
    svg: (
      <svg width="96" height="66" viewBox="0 0 96 66" aria-hidden>
        <path d="M16 52 L64 52 L16 18 Z" {...S} />
        <path d="M16 46 L22 46 L22 52" {...S} />
        <text x="4" y="38" {...label}>x</text>
        <text x="34" y="62" {...label} textAnchor="middle">x{ROOT}3</text>
        <text x="40" y="30" {...label}>2x</text>
        <text x="52" y="50" {...label}>30°</text>
        <text x="17" y="26" {...label}>60°</text>
      </svg>
    ),
  },
  {
    key: '45-45-90',
    formulas: [<span key="a">&nbsp;</span>],
    svg: (
      <svg width="96" height="66" viewBox="0 0 96 66" aria-hidden>
        <path d="M20 52 L68 52 L20 4 Z" {...S} />
        <path d="M20 46 L26 46 L26 52" {...S} />
        <text x="8" y="32" {...label}>s</text>
        <text x="40" y="62" {...label} textAnchor="middle">s</text>
        <text x="46" y="26" {...label}>s{ROOT}2</text>
        <text x="52" y="50" {...label}>45°</text>
      </svg>
    ),
  },
  {
    key: 'box',
    formulas: [<span key="a">V = {L}wh</span>],
    svg: (
      <svg width="84" height="66" viewBox="0 0 84 66" aria-hidden>
        <path d="M18 22 H58 V54 H18 Z" {...S} />
        <path d="M18 22 L34 10 H74 L58 22" {...S} />
        <path d="M58 54 L74 42 V10" {...S} />
        <text x="36" y="64" {...label} textAnchor="middle">{L}</text>
        <text x="10" y="40" {...label}>h</text>
        <text x="66" y="30" {...label}>w</text>
      </svg>
    ),
  },
  {
    key: 'cylinder',
    formulas: [<span key="a">V = {PI}r{R2}h</span>],
    svg: (
      <svg width="84" height="66" viewBox="0 0 84 66" aria-hidden>
        <ellipse cx="42" cy="14" rx="22" ry="7" {...S} />
        <path d="M20 14 V52" {...S} />
        <path d="M64 14 V52" {...S} />
        <path d="M20 52 A22 7 0 0 0 64 52" {...S} />
        <line x1="42" y1="14" x2="64" y2="14" {...S} />
        <text x="50" y="12" {...label}>r</text>
        <text x="68" y="36" {...label}>h</text>
      </svg>
    ),
  },
  {
    key: 'sphere',
    formulas: [<span key="a">V = 4⁄3 {PI}r{R3}</span>],
    svg: (
      <svg width="84" height="66" viewBox="0 0 84 66" aria-hidden>
        <circle cx="42" cy="33" r="24" {...S} />
        <ellipse cx="42" cy="33" rx="24" ry="8" {...S} strokeDasharray="3 3" />
        <line x1="42" y1="33" x2="66" y2="33" {...S} />
        <text x="52" y="30" {...label}>r</text>
      </svg>
    ),
  },
  {
    key: 'cone',
    formulas: [<span key="a">V = 1⁄3 {PI}r{R2}h</span>],
    svg: (
      <svg width="84" height="66" viewBox="0 0 84 66" aria-hidden>
        <path d="M42 8 L20 52 M42 8 L64 52" {...S} />
        <ellipse cx="42" cy="52" rx="22" ry="7" {...S} />
        <line x1="42" y1="52" x2="64" y2="52" {...S} />
        <line x1="42" y1="8" x2="42" y2="52" {...S} strokeDasharray="3 3" />
        <text x="50" y="50" {...label}>r</text>
        <text x="30" y="34" {...label}>h</text>
      </svg>
    ),
  },
  {
    key: 'pyramid',
    formulas: [<span key="a">V = 1⁄3 {L}wh</span>],
    svg: (
      <svg width="84" height="66" viewBox="0 0 84 66" aria-hidden>
        <path d="M14 46 L54 46 L44 54 L4 54 Z" {...S} />
        <path d="M4 54 L34 8 L54 46 M14 46 L34 8 L44 54" {...S} />
        <line x1="34" y1="8" x2="27" y2="50" {...S} strokeDasharray="3 3" />
        <text x="30" y="60" {...label}>{L}</text>
        <text x="48" y="52" {...label}>w</text>
        <text x="20" y="30" {...label}>h</text>
      </svg>
    ),
  },
];
