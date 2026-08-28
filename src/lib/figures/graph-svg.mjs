/**
 * Turn a compact, declarative **graph spec** (plain JSON) into a self-contained,
 * theme-aware inline `<svg>` string — the "inbuilt graph thingy".
 *
 * Why this exists: a math question's figure used to have to be shipped as either
 * hand-authored inline SVG or a base64 <img>. Both are miserable to write and
 * impossible to eyeball in a JSON file. Instead the author writes a small object
 * like `{ "type": "coordinate", "series": [{ "kind": "line", "slope": 2,
 * "intercept": 1 }] }` and this module draws it. The output is rendered by the
 * existing <MathHtml> path (it already renders inline <svg>), so there are no
 * DB, schema, or runtime changes.
 *
 * Theming: every axis/grid/tick/label is drawn with `currentColor` (it inherits
 * the surrounding text color, so it flips automatically in dark mode). Plotted
 * series use `var(--graph-plot, #2563eb)` etc. — a CSS variable with a hard
 * fallback, so it works with or without a theme override in globals.css.
 *
 * Deterministic + offline: no expression evaluation, no randomness, no network.
 * Curves are drawn from points the author supplies (sample your function into
 * points — the authoring prompt explains this), which keeps the renderer tiny
 * and the stored SVG stable forever.
 *
 * Supported `type`s: "coordinate", "numberline", "bar", "boxplot".
 *
 * The coordinate plane carries the detail needed to reproduce a source graph: a
 * multi-line top `title`; separate label vs gridline spacing (`xStep`/`yStep` for
 * the numbers, `xGrid`/`yGrid` for the boxes); outside axis labels (y rotated on
 * the left, x centred below) or `axisLabels:"inline"`; point markers in circle/
 * square/triangle/diamond (filled or `open`), on curves (`marker`), scatter, a
 * `markers` series, or a single `point`; and dashed line-like marks (`dash`).
 *
 * Usage:
 *   import { renderGraphSvg } from './lib/graph-svg.mjs';
 *   const svg = renderGraphSvg(spec);      // -> "<svg …>…</svg>"
 */

import { expandFigureMarkers } from './figure-markers.mjs';

/* ------------------------------ small helpers ------------------------------ */

/** Round to 2dp and drop trailing zeros, so path data stays compact + stable. */
function n(v) {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
}

/** Escape text that gets injected as element content / attribute value. */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Named plot colors → a CSS var with a hard fallback (themeable, but works raw). */
const COLORS = {
  plot: 'var(--graph-plot, #2563eb)',
  accent: 'var(--graph-accent, #db2777)',
  green: 'var(--graph-green, #059669)',
  amber: 'var(--graph-amber, #d97706)',
  muted: 'currentColor',
};
function color(name) {
  if (!name) return COLORS.plot;
  return COLORS[name] || name; // allow a raw CSS color too
}

/** Nice default tick step for a span, if the author didn't give one. */
function niceStep(span) {
  const raw = span / 8;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const mult = raw / pow;
  const nice = mult >= 5 ? 5 : mult >= 2 ? 2 : 1;
  return nice * pow;
}

/**
 * Smooth a polyline into a Catmull-Rom → cubic-Bézier path (used for curves).
 * Straight `L` segments are used when `smooth` is false.
 */
function pathFrom(pts, smooth) {
  if (pts.length === 0) return '';
  if (pts.length < 3 || !smooth) {
    return 'M' + pts.map(([x, y]) => `${n(x)} ${n(y)}`).join(' L');
  }
  let d = `M${n(pts[0][0])} ${n(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${n(c1x)} ${n(c1y)} ${n(c2x)} ${n(c2y)} ${n(p2[0])} ${n(p2[1])}`;
  }
  return d;
}

/* ------------------------------ coordinate plane ------------------------------ */

/** A title as an array of lines (string with "\n", or an array, or none). */
function toLines(title) {
  if (!title) return [];
  return Array.isArray(title) ? title.map(String) : String(title).split('\n');
}

/** `stroke-dasharray` attribute for a dashed series: dash:true → "6 4", or [a,b]. */
function dashAttr(s) {
  if (!s.dash) return '';
  const d = s.dash === true ? '6 4' : Array.isArray(s.dash) ? s.dash.join(' ') : String(s.dash);
  return ` stroke-dasharray="${d}"`;
}

/** One point marker (circle | square | diamond | triangle), filled or open (hollow). */
function markerSvg(shape, cx, cy, r, fillColor, open) {
  const fill = open ? 'var(--graph-bg, #fff)' : fillColor;
  const stroke = open ? ` stroke="${fillColor}" stroke-width="1.5"` : '';
  switch (shape || 'circle') {
    case 'square':
      return `<rect x="${n(cx - r)}" y="${n(cy - r)}" width="${n(2 * r)}" height="${n(2 * r)}" fill="${fill}"${stroke}/>`;
    case 'diamond':
      return `<path d="M${n(cx)} ${n(cy - r)} L${n(cx + r)} ${n(cy)} L${n(cx)} ${n(cy + r)} L${n(cx - r)} ${n(cy)} Z" fill="${fill}"${stroke}/>`;
    case 'triangle':
      return `<path d="M${n(cx)} ${n(cy - r)} L${n(cx + r)} ${n(cy + r)} L${n(cx - r)} ${n(cy + r)} Z" fill="${fill}"${stroke}/>`;
    default:
      return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}"${stroke}/>`;
  }
}

function renderCoordinate(spec) {
  const width = spec.width ?? 400;
  const height = spec.height ?? 340;
  const [x0, x1] = spec.xRange ?? [-10, 10];
  const [y0, y1] = spec.yRange ?? [-10, 10];
  const xStep = spec.xStep ?? niceStep(x1 - x0); // spacing of LABELED ticks
  const yStep = spec.yStep ?? niceStep(y1 - y0);
  const xGrid = spec.xGrid ?? xStep; // spacing of gridlines (the "boxes")
  const yGrid = spec.yGrid ?? yStep;
  const grid = spec.grid !== false;
  const titleLines = toLines(spec.title);

  // Axis-label placement. Default 'outside' (y to the left, x centred below —
  // the way the PDF lays them out). `axisLabels:"inline"` (or per-axis
  // xLabelPos/yLabelPos:"inline") keeps the compact near-the-axis placement.
  const xLabelPos = spec.xLabelPos ?? (spec.axisLabels === 'inline' ? 'inline' : 'below');
  const yLabelPos = spec.yLabelPos ?? (spec.axisLabels === 'inline' ? 'inline' : 'left');

  // Dynamic margins: room for the title, tick labels, and outside axis labels.
  const padTop = 10 + (titleLines.length ? titleLines.length * 18 + 6 : 0);
  const padBottom = 24 + (spec.xLabel && xLabelPos === 'below' ? 20 : 0);
  const padLeft = 38 + (spec.yLabel && yLabelPos === 'left' ? 16 : 0);
  const padRight = 16;

  const iw = width - padLeft - padRight;
  const ih = height - padTop - padBottom;
  const px = (x) => padLeft + ((x - x0) / (x1 - x0)) * iw;
  const py = (y) => padTop + (1 - (y - y0) / (y1 - y0)) * ih;
  const inBox = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

  const parts = [];

  // Title (multi-line, centred, semibold).
  titleLines.forEach((line, i) => {
    parts.push(
      `<text x="${n(width / 2)}" y="${n(16 + i * 18)}" font-size="13" font-weight="600" ` +
        `text-anchor="middle" fill="currentColor">${esc(line)}</text>`,
    );
  });

  // Gridlines at the (possibly finer) grid step.
  if (grid) {
    const lines = [];
    for (let x = Math.ceil(x0 / xGrid) * xGrid; x <= x1 + 1e-9; x += xGrid) {
      lines.push(`M${n(px(x))} ${n(py(y0))} L${n(px(x))} ${n(py(y1))}`);
    }
    for (let y = Math.ceil(y0 / yGrid) * yGrid; y <= y1 + 1e-9; y += yGrid) {
      lines.push(`M${n(px(x0))} ${n(py(y))} L${n(px(x1))} ${n(py(y))}`);
    }
    parts.push(
      `<path d="${lines.join(' ')}" fill="none" stroke="currentColor" stroke-opacity="0.15" stroke-width="1"/>`,
    );
  }

  // Axes (at 0 if in range, else the plot edge).
  const axisX = y0 <= 0 && y1 >= 0 ? py(0) : py(y0);
  const axisY = x0 <= 0 && x1 >= 0 ? px(0) : px(x0);
  parts.push(
    `<path d="M${n(padLeft)} ${n(axisX)} L${n(width - padRight)} ${n(axisX)} M${n(axisY)} ${n(padTop)} L${n(axisY)} ${n(height - padBottom)}" ` +
      `fill="none" stroke="currentColor" stroke-opacity="0.7" stroke-width="1.5"/>`,
  );

  // Tick labels at the label step.
  const ticks = [];
  for (let x = Math.ceil(x0 / xStep) * xStep; x <= x1 + 1e-9; x += xStep) {
    if (Math.abs(x) < 1e-9) continue;
    ticks.push(
      `<text x="${n(px(x))}" y="${n(axisX + 14)}" font-size="10" text-anchor="middle" ` +
        `fill="currentColor" fill-opacity="0.7">${esc(n(x))}</text>`,
    );
  }
  for (let y = Math.ceil(y0 / yStep) * yStep; y <= y1 + 1e-9; y += yStep) {
    if (Math.abs(y) < 1e-9) continue;
    ticks.push(
      `<text x="${n(axisY - 6)}" y="${n(py(y) + 3)}" font-size="10" text-anchor="end" ` +
        `fill="currentColor" fill-opacity="0.7">${esc(n(y))}</text>`,
    );
  }
  parts.push(ticks.join(''));

  // Series.
  for (const s of spec.series ?? []) {
    parts.push(renderSeries(s, { px, py, x0, x1, y0, y1, inBox }));
  }

  // Axis labels.
  if (spec.xLabel) {
    if (xLabelPos === 'below') {
      parts.push(
        `<text x="${n(padLeft + iw / 2)}" y="${n(height - 6)}" font-size="11" text-anchor="middle" ` +
          `font-style="italic" fill="currentColor">${esc(spec.xLabel)}</text>`,
      );
    } else {
      parts.push(
        `<text x="${n(width - padRight + 2)}" y="${n(axisX - 6)}" font-size="11" text-anchor="end" ` +
          `font-style="italic" fill="currentColor">${esc(spec.xLabel)}</text>`,
      );
    }
  }
  if (spec.yLabel) {
    if (yLabelPos === 'left') {
      const lx = 14;
      const ly = padTop + ih / 2;
      parts.push(
        `<text x="${n(lx)}" y="${n(ly)}" font-size="11" text-anchor="middle" font-style="italic" ` +
          `fill="currentColor" transform="rotate(-90 ${n(lx)} ${n(ly)})">${esc(spec.yLabel)}</text>`,
      );
    } else {
      parts.push(
        `<text x="${n(axisY + 6)}" y="${n(padTop + 4)}" font-size="11" text-anchor="start" ` +
          `font-style="italic" fill="currentColor">${esc(spec.yLabel)}</text>`,
      );
    }
  }

  return svgWrap(width, height, parts.join(''));
}

/**
 * Draw one coordinate series.
 *   line     straight line by slope/intercept or two points, across the window
 *   curve    a polyline/curve through supplied points; `smooth`, `dash`, `marker`
 *   segment  a single from→to segment; `dash`
 *   scatter  dots at points; `shape`
 *   point    one marked point with optional `label`, `open`, `shape`
 *   markers  shaped markers at a list of points (dots/shapes "on certain points")
 * Any line-like series takes `dash` (true or [on,off]); curve takes `marker`
 * ({shape,color,r,open} or true) to draw a marker at each of its points.
 */
function renderSeries(s, ctx) {
  const { px, py, x0, x1, y0, y1 } = ctx;
  const c = color(s.color);
  const w = s.width ?? 2;

  if (s.kind === 'line') {
    let m, b;
    if (typeof s.slope === 'number') {
      m = s.slope;
      b = s.intercept ?? 0;
    } else if (Array.isArray(s.through) && s.through.length >= 2) {
      const [ax, ay] = s.through[0];
      const [bx, by] = s.through[1];
      if (bx === ax) {
        return `<path d="M${n(px(ax))} ${n(py(y0))} L${n(px(ax))} ${n(py(y1))}" fill="none" stroke="${c}" stroke-width="${w}"${dashAttr(s)}/>`;
      }
      m = (by - ay) / (bx - ax);
      b = ay - m * ax;
    } else {
      return '';
    }
    const p1 = [x0, m * x0 + b];
    const p2 = [x1, m * x1 + b];
    return `<path d="M${n(px(p1[0]))} ${n(py(p1[1]))} L${n(px(p2[0]))} ${n(py(p2[1]))}" fill="none" stroke="${c}" stroke-width="${w}"${dashAttr(s)}/>`;
  }

  if (s.kind === 'curve') {
    const dpts = s.points ?? [];
    const pts = dpts.map(([x, y]) => [px(x), py(y)]);
    let out =
      `<path d="${pathFrom(pts, s.smooth !== false)}" fill="none" stroke="${c}" stroke-width="${w}"` +
      `${dashAttr(s)} stroke-linejoin="round" stroke-linecap="round"/>`;
    if (s.marker) {
      const mk = s.marker === true ? {} : s.marker;
      const mc = color(mk.color ?? s.color ?? 'plot');
      const mr = mk.r ?? 4;
      out += dpts.map(([x, y]) => markerSvg(mk.shape, px(x), py(y), mr, mc, mk.open)).join('');
    }
    return out;
  }

  if (s.kind === 'segment') {
    const [ax, ay] = s.from;
    const [bx, by] = s.to;
    return `<path d="M${n(px(ax))} ${n(py(ay))} L${n(px(bx))} ${n(py(by))}" fill="none" stroke="${c}" stroke-width="${w}"${dashAttr(s)}/>`;
  }

  if (s.kind === 'scatter') {
    const r = s.r ?? 3;
    return (s.points ?? []).map(([x, y]) => markerSvg(s.shape, px(x), py(y), r, c, s.open)).join('');
  }

  if (s.kind === 'markers') {
    // Shaped markers on specific points. Each entry is [x,y] or
    // {at:[x,y], shape?, color?, r?, open?, label?}.
    return (s.points ?? [])
      .map((p) => {
        const pt = Array.isArray(p) ? { at: p } : p;
        const [x, y] = pt.at;
        const mc = color(pt.color ?? s.color ?? 'plot');
        const mr = pt.r ?? s.r ?? 4;
        const dot = markerSvg(pt.shape ?? s.shape, px(x), py(y), mr, mc, pt.open);
        const label = pt.label
          ? `<text x="${n(px(x) + 6)}" y="${n(py(y) - 6)}" font-size="10" fill="currentColor">${esc(pt.label)}</text>`
          : '';
        return dot + label;
      })
      .join('');
  }

  if (s.kind === 'point') {
    const [x, y] = s.at;
    const r = s.r ?? 3.5;
    const dot = markerSvg(s.shape, px(x), py(y), r, c, s.open);
    const label = s.label
      ? `<text x="${n(px(x) + 6)}" y="${n(py(y) - 6)}" font-size="10" fill="currentColor">${esc(s.label)}</text>`
      : '';
    return dot + label;
  }

  return '';
}

/* ------------------------------ number line ------------------------------ */

function renderNumberLine(spec) {
  const width = spec.width ?? 420;
  const height = spec.height ?? 64;
  const pad = spec.pad ?? 24;
  const [a, b] = spec.range ?? [-5, 5];
  const step = spec.step ?? 1;
  const y = height / 2;
  const px = (x) => pad + ((x - a) / (b - a)) * (width - pad * 2);

  const parts = [];
  // main line with end arrows
  parts.push(
    `<path d="M${n(pad - 6)} ${n(y)} L${n(width - pad + 6)} ${n(y)}" fill="none" stroke="currentColor" stroke-width="1.5"/>` +
      `<path d="M${n(pad - 6)} ${n(y)} l6 -4 v8 z" fill="currentColor"/>` +
      `<path d="M${n(width - pad + 6)} ${n(y)} l-6 -4 v8 z" fill="currentColor"/>`,
  );
  // ticks + labels
  for (let x = Math.ceil(a / step) * step; x <= b + 1e-9; x += step) {
    parts.push(
      `<path d="M${n(px(x))} ${n(y - 4)} L${n(px(x))} ${n(y + 4)}" stroke="currentColor" stroke-opacity="0.6"/>` +
        `<text x="${n(px(x))}" y="${n(y + 18)}" font-size="10" text-anchor="middle" fill="currentColor" fill-opacity="0.7">${esc(n(x))}</text>`,
    );
  }
  // shaded intervals
  for (const iv of spec.intervals ?? []) {
    const c = color(iv.color);
    parts.push(
      `<path d="M${n(px(iv.from))} ${n(y)} L${n(px(iv.to))} ${n(y)}" stroke="${c}" stroke-width="3"/>`,
    );
    for (const [val, open] of [
      [iv.from, iv.openFrom],
      [iv.to, iv.openTo],
    ]) {
      parts.push(
        open
          ? `<circle cx="${n(px(val))}" cy="${n(y)}" r="4.5" fill="var(--graph-bg, #fff)" stroke="${c}" stroke-width="1.5"/>`
          : `<circle cx="${n(px(val))}" cy="${n(y)}" r="4.5" fill="${c}"/>`,
      );
    }
  }
  // standalone points
  for (const p of spec.points ?? []) {
    const c = color(p.color);
    parts.push(
      p.open
        ? `<circle cx="${n(px(p.at))}" cy="${n(y)}" r="4.5" fill="var(--graph-bg, #fff)" stroke="${c}" stroke-width="1.5"/>`
        : `<circle cx="${n(px(p.at))}" cy="${n(y)}" r="4.5" fill="${c}"/>`,
    );
    if (p.label) {
      parts.push(
        `<text x="${n(px(p.at))}" y="${n(y - 10)}" font-size="10" text-anchor="middle" fill="currentColor">${esc(p.label)}</text>`,
      );
    }
  }
  return svgWrap(width, height, parts.join(''), spec.title);
}

/* ------------------------------ bar chart ------------------------------ */

function renderBar(spec) {
  const width = spec.width ?? 360;
  const height = spec.height ?? 280;
  const padL = 34;
  const padR = 12;
  const padT = 14;
  const padB = 34;
  const cats = spec.categories ?? [];
  const vals = spec.values ?? [];
  const yMax = spec.yMax ?? Math.max(1, ...vals) * 1.1;
  const iw = width - padL - padR;
  const ih = height - padT - padB;
  const bandW = iw / Math.max(1, cats.length);
  const barW = bandW * 0.6;
  const py = (v) => padT + (1 - v / yMax) * ih;
  const c = color(spec.color || 'plot');

  const parts = [];
  // y grid + labels
  const yStep = spec.yStep ?? niceStep(yMax);
  for (let v = 0; v <= yMax + 1e-9; v += yStep) {
    parts.push(
      `<path d="M${n(padL)} ${n(py(v))} L${n(width - padR)} ${n(py(v))}" stroke="currentColor" stroke-opacity="0.12"/>` +
        `<text x="${n(padL - 6)}" y="${n(py(v) + 3)}" font-size="10" text-anchor="end" fill="currentColor" fill-opacity="0.65">${esc(n(v))}</text>`,
    );
  }
  // baseline
  parts.push(
    `<path d="M${n(padL)} ${n(py(0))} L${n(width - padR)} ${n(py(0))}" stroke="currentColor" stroke-opacity="0.55"/>`,
  );
  // bars + category labels
  cats.forEach((cat, i) => {
    const v = vals[i] ?? 0;
    const x = padL + bandW * i + (bandW - barW) / 2;
    parts.push(
      `<rect x="${n(x)}" y="${n(py(v))}" width="${n(barW)}" height="${n(py(0) - py(v))}" fill="${c}" rx="1"/>` +
        `<text x="${n(x + barW / 2)}" y="${n(height - padB + 14)}" font-size="10" text-anchor="middle" fill="currentColor" fill-opacity="0.75">${esc(cat)}</text>`,
    );
  });
  if (spec.yLabel) {
    parts.push(
      `<text x="${n(padL - 6)}" y="${n(padT - 4)}" font-size="10" text-anchor="end" fill="currentColor" fill-opacity="0.75">${esc(spec.yLabel)}</text>`,
    );
  }
  return svgWrap(width, height, parts.join(''), spec.title);
}

/* ------------------------------ box-and-whisker ------------------------------ */

/**
 * Box-and-whisker plot(s) from a five-number summary. Each plot draws a box from
 * Q1→Q3 with a median line, whiskers to min/max with end caps, an optional label
 * centred in the box, and its own numbered axis beneath it.
 *
 * Spec:
 *   {
 *     "type": "boxplot",
 *     "range": [0, 40], "step": 4,        // default axis for plots that omit their own
 *     "minorStep": 2,                     // optional minor ticks (default: step/2)
 *     "plots": [
 *       { "label":"A", "min":22, "q1":27, "median":30, "q3":46, "max":58,
 *         "range":[20,60], "step":4, "color":"accent" },  // per-plot axis + colour
 *       { "label":"B", "min":6, "q1":12, "median":33, "q3":37, "max":38, "range":[0,40] }
 *     ]
 *   }
 * A single plot may be written inline (min/q1/… on the spec, no `plots`).
 */
function renderBoxplot(spec) {
  const plots = Array.isArray(spec.plots) ? spec.plots : [spec];
  const width = spec.width ?? 480;
  const padL = 30;
  const padR = 22;
  const boxH = 34;
  const axisGap = 12;
  const bandH = boxH + axisGap + 30; // box + gap + axis (ticks/labels)
  const height = spec.height ?? plots.length * bandH + 14;

  const parts = [];
  plots.forEach((p, i) => {
    const [x0, x1] = p.range ?? spec.range ?? [0, 10];
    const step = p.step ?? spec.step ?? niceStep(x1 - x0);
    const minorStep = p.minorStep ?? spec.minorStep ?? step / 2;
    const boxC = color(p.boxColor ?? p.color ?? spec.color ?? 'plot');
    const whiskerC = color(p.whiskerColor ?? p.color ?? spec.color ?? 'plot');
    const top = 10 + i * bandH;
    const iw = width - padL - padR;
    const px = (v) => padL + ((v - x0) / (x1 - x0)) * iw;
    const midY = top + boxH / 2;
    const q1 = px(p.q1);
    const q3 = px(p.q3);
    const med = px(p.median);
    const mn = px(p.min);
    const mx = px(p.max);

    // Whiskers + end caps.
    parts.push(
      `<path d="M${n(mn)} ${n(midY)} L${n(q1)} ${n(midY)} M${n(q3)} ${n(midY)} L${n(mx)} ${n(midY)}" fill="none" stroke="${whiskerC}" stroke-width="2"/>` +
        `<path d="M${n(mn)} ${n(top + 5)} L${n(mn)} ${n(top + boxH - 5)} M${n(mx)} ${n(top + 5)} L${n(mx)} ${n(top + boxH - 5)}" stroke="${whiskerC}" stroke-width="2"/>`,
    );
    // Box + median.
    parts.push(
      `<rect x="${n(q1)}" y="${n(top)}" width="${n(q3 - q1)}" height="${n(boxH)}" fill="var(--graph-bg, #fff)" stroke="${boxC}" stroke-width="2"/>` +
        `<path d="M${n(med)} ${n(top)} L${n(med)} ${n(top + boxH)}" stroke="${boxC}" stroke-width="2"/>`,
    );
    // Label centred in the box.
    if (p.label != null && p.label !== '') {
      parts.push(
        `<text x="${n((q1 + q3) / 2)}" y="${n(midY + 4)}" font-size="13" font-weight="700" text-anchor="middle" fill="currentColor">${esc(p.label)}</text>`,
      );
    }
    // Axis with minor + major ticks and numbers.
    const axisY = top + boxH + axisGap + 6;
    parts.push(
      `<path d="M${n(padL)} ${n(axisY)} L${n(width - padR)} ${n(axisY)}" stroke="currentColor" stroke-opacity="0.7" stroke-width="1.5"/>`,
    );
    const ticks = [];
    if (minorStep > 0) {
      for (let v = Math.ceil(x0 / minorStep) * minorStep; v <= x1 + 1e-9; v += minorStep) {
        ticks.push(
          `<path d="M${n(px(v))} ${n(axisY - 3)} L${n(px(v))} ${n(axisY + 3)}" stroke="currentColor" stroke-opacity="0.4"/>`,
        );
      }
    }
    for (let v = Math.ceil(x0 / step) * step; v <= x1 + 1e-9; v += step) {
      ticks.push(
        `<path d="M${n(px(v))} ${n(axisY - 5)} L${n(px(v))} ${n(axisY + 5)}" stroke="currentColor" stroke-opacity="0.7"/>` +
          `<text x="${n(px(v))}" y="${n(axisY + 17)}" font-size="10" text-anchor="middle" fill="currentColor" fill-opacity="0.8">${esc(n(v))}</text>`,
      );
    }
    parts.push(ticks.join(''));
  });

  return svgWrap(width, height, parts.join(''), spec.title);
}

/* ------------------------------ wrapper ------------------------------ */

function svgWrap(width, height, inner, title) {
  const cap = title
    ? `<text x="${n(width / 2)}" y="${n(height - 4)}" font-size="10" text-anchor="middle" fill="currentColor" fill-opacity="0.7">${esc(title)}</text>`
    : '';
  // role/aria make it announce as an image; width:100% + max-width keeps it in-column.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `width="${width}" height="${height}" role="img" ` +
    `style="max-width:100%;height:auto;color:inherit">${inner}${cap}</svg>`
  );
}

/**
 * Render any supported graph spec to an inline `<svg>` string.
 * Throws on an unknown/invalid spec so a bad figure is caught at ingest, never
 * silently dropped.
 */
export function renderGraphSvg(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('graph spec must be an object');
  switch (spec.type) {
    case 'coordinate':
      return renderCoordinate(spec);
    case 'numberline':
      return renderNumberLine(spec);
    case 'bar':
      return renderBar(spec);
    case 'boxplot':
      return renderBoxplot(spec);
    default:
      throw new Error(`unknown graph type: ${JSON.stringify(spec.type)}`);
  }
}

/**
 * Expand `{{graph}}` / `{{graph:ID}}` markers in a rich-HTML fragment, replacing
 * each with the rendered SVG (wrapped in a <figure>). If the html contains no
 * marker but a default graph exists, the default is appended. Returns the html
 * unchanged when there are no graphs to place.
 *
 * @param {string} html
 * @param {Record<string,string>} svgById  id → svg string (the default graph is id "graph")
 */
export function expandGraphMarkers(html, svgById) {
  return expandFigureMarkers(html, 'graph', svgById, (svg) => `<figure class="graph-figure">${svg}</figure>`);
}
