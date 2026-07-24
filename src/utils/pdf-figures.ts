/**
 * Locate and crop figures (charts, tables, diagrams) out of a question PDF.
 *
 * Why geometric rather than AI:
 *
 * These papers draw every figure as *vector* art — inspecting the operator
 * lists shows `constructPath` + `fill`/`stroke` and **zero** image XObjects. So
 * there is no embedded bitmap to pull out, and any "extract the images"
 * approach finds nothing. Meanwhile the PDF states each shape's exact
 * coordinates, so the bounding box can be computed rather than guessed. That is
 * deterministic, free, and repeatable — strictly better than asking a vision
 * model to eyeball a crop box.
 *
 * The one trap: axis labels ("50", "Area (square km)") are *text items*, not
 * part of the vector art. Cropping the path bounds alone slices the labels off
 * and produces an unreadable chart. So a figure's box is the union of its path
 * cluster **and** any text sitting inside or hugging it.
 *
 * Pipeline per page:
 *   1. walk the operator list, tracking the CTM, collecting path bounding boxes
 *   2. discard rules/underlines (thin or trivial paths)
 *   3. cluster the survivors — a chart is many strokes in one region
 *   4. union each cluster with the text that belongs to it
 *   5. render the page at high DPI and crop
 *
 * Everything is reported in *top-left origin* pixel space at `RENDER_SCALE`,
 * matching the rendered bitmap.
 */

import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';

/**
 * pdfjs renders glyphs by handing a `Path2D` to `ctx.fill()` and builds
 * transforms with `DOMMatrix` — browser globals it expects to exist.
 * @napi-rs/canvas implements them but doesn't register them globally.
 *
 * This runs at *module load*, deliberately: pdfjs binds these at its own module
 * scope, so installing them lazily inside a function is too late and rendering
 * dies with `Value is none of these types 'String', 'Path'`. For the same
 * reason pdfjs is imported dynamically below, after this has executed.
 */
{
  const g = globalThis as Record<string, unknown>;
  g.Path2D ??= Path2D;
  g.DOMMatrix ??= DOMMatrix;
  g.ImageData ??= ImageData;
}

/** Cached pdfjs module — imported only after the globals above are in place. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjsPromise: Promise<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadPdfjs(): Promise<any> {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

/** 2x ≈ 144 DPI — sharp on retina without exploding file size. */
export const RENDER_SCALE = 2;

/**
 * A chart is many strokes (bars, ticks, gridlines), so this many paths marks
 * one confidently. Tables are the exception — they can be a single bordered
 * box whose rows are text, so they qualify via `looksTabular` instead.
 */
const MIN_PATHS_PER_FIGURE = 6;

/** A bordered box needs at least this many paths before tabular text counts. */
const MIN_PATHS_FOR_TABLE = 1;
const MIN_FIGURE_W = 60;
const MIN_FIGURE_H = 40;

/**
 * Clusters closer than this (PDF points) are one figure. Kept tight: at 28pt
 * a chart bridges to unrelated page furniture (headers, answer boxes) and the
 * crop balloons to the full page.
 */
const CLUSTER_GAP = 8;

/**
 * A figure is a *dense* region: many small strokes packed into a modest area
 * (bars, axis ticks, gridlines, table rules). Layout furniture is the opposite
 * — a couple of huge rects. Density separates the two far more reliably than
 * width, which misclassifies wide-but-real charts.
 */
const MIN_PATHS_PER_1000PT2 = 0.02;

/** Text within this distance of a cluster is part of the figure. */
const LABEL_REACH = 26;

/**
 * How many long prose lines may sit inside a figure before it's clearly a
 * block of body text, not a chart. A legend or caption can be wordy; a
 * rationale paragraph is not a figure.
 */
const MAX_PROSE_LINES_IN_FIGURE = 1;

/**
 * Every page of these exports opens with an Assessment/Test/Domain/Skill
 * metadata table. It's dense with rules, so it survives the density test, but
 * it is never part of a question. It's identifiable by shape: it spans the
 * full text column and sits in the top fifth of the page.
 */
function isMetadataTable(rect: Rect, pageWidth: number, pageHeight: number): boolean {
  const spansColumn = rect.w >= pageWidth * 0.7;
  const nearTop = rect.y + rect.h >= pageHeight * 0.8;
  return spansColumn && nearTop;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageFigure {
  pageNumber: number;
  /** Crop box in rendered-bitmap pixels, top-left origin. */
  rect: Rect;
  /** Top edge in PDF points, bottom-left origin — used to match a question. */
  pdfTop: number;
  pdfBottom: number;
  png: Buffer;
}

export interface QuestionAnchor {
  externalId: string;
  pageNumber: number;
  /** y of the "Question ID <id>" line, PDF points, bottom-left origin. */
  pdfY: number;
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

function overlapsOrNear(a: Rect, b: Rect, pad: number): boolean {
  return !(
    a.x > b.x + b.w + pad ||
    b.x > a.x + a.w + pad ||
    a.y > b.y + b.h + pad ||
    b.y > a.y + a.h + pad
  );
}

/** Is `inner` wholly inside `outer`? */
function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

/** Apply a 2D affine matrix [a,b,c,d,e,f] to a point. */
function apply(m: number[], x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function multiply(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/**
 * Collect the bounding box of every path painted on the page, in PDF space.
 * Transform state is tracked through save/restore/transform so nested
 * coordinate systems land in the right place.
 */
function collectPathBoxes(
  ops: { fnArray: number[]; argsArray: unknown[] },
  OPS: Record<string, number>,
  pageWidth: number,
  pageHeight: number,
): Rect[] {
  const boxes: Rect[] = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i] as never;

    if (fn === OPS.save) {
      stack.push(ctm.slice());
      continue;
    }
    if (fn === OPS.restore) {
      ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
      continue;
    }
    if (fn === OPS.transform) {
      ctm = multiply(ctm, args as unknown as number[]);
      continue;
    }
    if (fn !== OPS.constructPath) continue;

    // args = [opList, coords, bbox]. pdfjs already computes the path's bounding
    // box as arg[2] = [minX, minY, maxX, maxY] — use it rather than re-deriving
    // one from `coords`, whose layout varies per sub-op (a rect is
    // [x, y, w, h], not a point list).
    const bbox = (args as unknown as unknown[])[2] as number[] | undefined;
    if (!bbox || bbox.length < 4 || bbox.some((v) => !Number.isFinite(v))) continue;

    // Transform all four corners: the CTM may rotate or flip.
    const corners: [number, number][] = [
      apply(ctm, bbox[0], bbox[1]),
      apply(ctm, bbox[2], bbox[1]),
      apply(ctm, bbox[2], bbox[3]),
      apply(ctm, bbox[0], bbox[3]),
    ];
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const w = Math.max(...xs) - x;
    const h = Math.max(...ys) - y;

    boxes.push({ x, y, w, h });
  }

  // Drop page-sized rects: every page opens with a full-bleed background, and
  // the body text sits inside a full-column frame. Both are layout furniture
  // and both would merge every real figure into one page-sized blob.
  return boxes.filter(
    (b) => !(b.w >= pageWidth * 0.75 && b.h >= pageHeight * 0.75),
  );
}

/** Group nearby path boxes; a chart is many strokes in one region. */
function cluster(boxes: Rect[]): { rect: Rect; count: number }[] {
  const clusters: { rect: Rect; count: number }[] = [];

  for (const box of boxes) {
    // Skip hairlines: a rule is long and ~0 thick, or vice versa.
    const isRule = box.h < 2 || box.w < 2;
    let merged = false;

    for (const c of clusters) {
      if (overlapsOrNear(c.rect, box, CLUSTER_GAP)) {
        c.rect = union(c.rect, box);
        if (!isRule) c.count += 1;
        merged = true;
        break;
      }
    }
    if (!merged) clusters.push({ rect: { ...box }, count: isRule ? 0 : 1 });
  }

  // Merge clusters that grew into each other.
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        if (overlapsOrNear(clusters[i].rect, clusters[j].rect, CLUSTER_GAP)) {
          clusters[i].rect = union(clusters[i].rect, clusters[j].rect);
          clusters[i].count += clusters[j].count;
          clusters.splice(j, 1);
          changed = true;
          break outer;
        }
      }
    }
  }

  return clusters;
}

export interface ExtractOptions {
  /** Only keep figures on pages/regions belonging to these questions. */
  anchors?: QuestionAnchor[];
}

/**
 * Render every page, find its figures, and return cropped PNGs.
 */
export async function extractFigures(
  data: Uint8Array,
): Promise<{ figures: PageFigure[]; anchors: QuestionAnchor[] }> {
  const pdfjsLib = await loadPdfjs();

  const OPS = pdfjsLib.OPS as Record<string, number>;
  const doc = await pdfjsLib.getDocument({ data, disableFontFace: true }).promise;

  const figures: PageFigure[] = [];
  const anchors: QuestionAnchor[] = [];

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const pageHeight = page.getViewport({ scale: 1 }).height;

    const [ops, textContent] = await Promise.all([
      page.getOperatorList(),
      page.getTextContent(),
    ]);

    // Question anchors, for attributing figures later.
    //
    // getTextContent() splits a line into runs, so "Question ID" and the hex id
    // usually arrive as separate items. Match across a small lookahead window
    // rather than within a single item.
    const items = textContent.items as { str: string; transform: number[] }[];
    for (let i = 0; i < items.length; i++) {
      if (!/Question\s*ID/i.test(items[i].str)) continue;
      const joined = items
        .slice(i, i + 4)
        .map((t) => t.str)
        .join(' ');
      const m = joined.match(/Question\s*ID\s*([0-9a-f]{6,12})/i);
      if (m) anchors.push({ externalId: m[1], pageNumber: n, pdfY: items[i].transform[5] });
    }

    const pageWidth = page.getViewport({ scale: 1 }).width;
    const allText = (textContent.items as { str: string; transform: number[]; width: number; height: number }[])
      .filter((t) => t.str.trim());

    /**
     * A chart carries terse labels — numbers, short axis titles. A metadata
     * table or a rationale block carries prose. Counting the long text runs
     * inside a cluster is what separates the two: the tables on these pages
     * have dense rules and would otherwise pass the density test.
     */
    const proseInside = (rect: Rect): number =>
      allText.filter(
        (t) =>
          t.str.trim().split(/\s+/).length >= 8 &&
          contains(rect, { x: t.transform[4], y: t.transform[5], w: t.width || 1, h: t.height || 8 }),
      ).length;

    /**
     * Does the text inside this box lay out as a grid?
     *
     * Data tables in these papers are drawn as one bordered rect with no
     * internal rules — the rows and columns exist only in the text layer. The
     * chart heuristics (many paths) therefore reject them outright, yet their
     * contents are exactly the data a question turns on. Detect them by the
     * arrangement of the text instead: several rows, most holding more than
     * one cell.
     */
    const looksTabular = (rect: Rect): boolean => {
      const inside = allText.filter((t) =>
        contains(rect, { x: t.transform[4], y: t.transform[5], w: t.width || 1, h: t.height || 8 }),
      );
      if (inside.length < 4) return false;

      // Group into rows by baseline; PDF y is noisy, so allow a little slack.
      const rows = new Map<number, number>();
      for (const t of inside) {
        const key = Math.round(t.transform[5] / 4) * 4;
        rows.set(key, (rows.get(key) ?? 0) + 1);
      }
      const multiCellRows = Array.from(rows.values()).filter((n) => n >= 2).length;
      return rows.size >= 3 && multiCellRows >= 2;
    };

    const clusters = cluster(collectPathBoxes(ops, OPS, pageWidth, pageHeight)).filter((c) => {
      if (c.rect.w < MIN_FIGURE_W || c.rect.h < MIN_FIGURE_H) return false;
      if (isMetadataTable(c.rect, pageWidth, pageHeight)) return false;
      if (proseInside(c.rect) > MAX_PROSE_LINES_IN_FIGURE) return false;

      const isChart =
        c.count >= MIN_PATHS_PER_FIGURE &&
        c.count / ((c.rect.w * c.rect.h) / 1000) >= MIN_PATHS_PER_1000PT2;

      const isTable = c.count >= MIN_PATHS_FOR_TABLE && looksTabular(c.rect);

      return isChart || isTable;
    });

    if (clusters.length === 0) continue;

    // Absorb the text that belongs to each figure — axis labels, legends,
    // titles. Without this the crop cuts the numbers off the axes.
    // Word count is measured per *line*, not per run. pdfjs splits a line at
    // every style change, so an italic species name inside a paragraph becomes
    // its own two-word run — short enough to look like a label and drag the
    // crop down over the paragraph it belongs to.
    const wordsOnLine = new Map<number, number>();
    for (const t of allText) {
      const key = Math.round(t.transform[5] / 4) * 4;
      wordsOnLine.set(key, (wordsOnLine.get(key) ?? 0) + t.str.trim().split(/\s+/).length);
    }

    const textBoxes = allText.map((t) => ({
      x: t.transform[4],
      y: t.transform[5],
      w: t.width || t.str.length * 4,
      h: t.height || 8,
      words: wordsOnLine.get(Math.round(t.transform[5] / 4) * 4) ?? 0,
    }));

    for (const c of clusters) {
      // Test against a frozen copy of the path cluster: testing against the
      // growing rect makes absorption run away, each label extending the box
      // and pulling in more text until the "figure" is the whole page.
      const core = { ...c.rect };
      const reach = {
        x: core.x - LABEL_REACH,
        y: core.y - LABEL_REACH,
        w: core.w + LABEL_REACH * 2,
        h: core.h + LABEL_REACH * 2,
      };
      for (const tb of textBoxes) {
        // Containment, not overlap. A body-text line spans the full column, so
        // it always *overlaps* a chart's x-range and would stretch the crop to
        // full width. Axis labels and legends sit wholly inside the figure.
        //
        // Prose is never absorbed: a figure's labels are terse, and the
        // paragraph that follows a table sits within reach and would otherwise
        // be pulled into the crop.
        if (tb.words >= 8) continue;
        if (contains(reach, tb)) c.rect = union(c.rect, tb);
      }
    }

    // Render once, crop many.
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await page.render({ canvasContext: ctx as any, viewport }).promise;

    for (const c of clusters) {
      const pad = 6;
      // PDF space (bottom-left) -> bitmap space (top-left).
      const x = Math.max(0, (c.rect.x - pad) * RENDER_SCALE);
      const yTopPdf = c.rect.y + c.rect.h + pad;
      const y = Math.max(0, (pageHeight - yTopPdf) * RENDER_SCALE);
      const w = Math.min(viewport.width - x, (c.rect.w + pad * 2) * RENDER_SCALE);
      const h = Math.min(viewport.height - y, (c.rect.h + pad * 2) * RENDER_SCALE);
      if (w < 20 || h < 20) continue;

      const crop = createCanvas(w, h);
      crop.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);

      figures.push({
        pageNumber: n,
        rect: { x, y, w, h },
        pdfTop: c.rect.y + c.rect.h,
        pdfBottom: c.rect.y,
        png: crop.toBuffer('image/png'),
      });
    }
  }

  return { figures, anchors };
}

/**
 * Attribute each figure to the question it sits under.
 *
 * Anchors run down the page (PDF y decreases), so a figure belongs to the last
 * anchor above it on the same page.
 */
export function attributeFigures(
  figures: PageFigure[],
  anchors: QuestionAnchor[],
): Map<string, PageFigure[]> {
  const byQuestion = new Map<string, PageFigure[]>();
  const sorted = [...anchors].sort(
    (a, b) => a.pageNumber - b.pageNumber || b.pdfY - a.pdfY,
  );

  for (const fig of figures) {
    let owner: QuestionAnchor | null = null;
    for (const a of sorted) {
      if (a.pageNumber > fig.pageNumber) break;
      if (a.pageNumber < fig.pageNumber) {
        owner = a; // carries over from an earlier page
        continue;
      }
      if (a.pdfY >= fig.pdfTop) owner = a;
    }
    if (!owner) continue;
    const list = byQuestion.get(owner.externalId) ?? [];
    list.push(fig);
    byQuestion.set(owner.externalId, list);
  }

  return byQuestion;
}
