# Math question JSON — authoring format

This is the canonical shape for a **SAT Math** question record that
[`scripts/ingest-math-bank.mjs`](../scripts/ingest-math-bank.mjs) accepts. One
question = one JSON object; a file is either one object or an array of them.

Two things make math easy to author here:

1. **Equations are LaTeX**, written inline between delimiters. MathJax renders
   them to crisp SVG. You never write MathML by hand.
2. **Figures are declarative** — you describe a graph as a small JSON object and
   the ingest bakes it into a themed, self-contained SVG. You never make images.

---

## 1. The record

```jsonc
{
  "external_id": "math-0001",       // required, unique, stable — your id for the row
  "domain": "H",                    // H=Algebra  P=Advanced  Q=Problem-Solving/Data  S=Geometry/Trig
  "difficulty": "M",                // E=easy  M=medium  H=hard
  "skill_desc": "Linear equations in one variable",  // optional, shown as the skill tag

  "type": "mcq",                    // "mcq" or "spr" (student-produced grid-in)
  "stem": "If \\(2x + 3 = 11\\), what is the value of \\(x\\)?",

  // MCQ only:
  "choices": [
    { "id": "A", "body": "\\(2\\)" },
    { "id": "B", "body": "\\(4\\)", "correct": true },
    { "id": "C", "body": "\\(6\\)" },
    { "id": "D", "body": "\\(8\\)" }
  ],
  "correct_answer": "B",            // the correct choice id (or use "correct": true above)

  // SPR only (instead of choices/correct_answer above):
  // "correct_answer": ["3/2", "1.5"],   // every accepted typed form

  "rationale": "Subtract 3: \\(2x = 8\\). Divide by 2: \\(x = 4\\)."
}
```

### Field notes

| Field | Rule |
|---|---|
| `external_id` | Required and **unique**. Re-ingesting the same id updates that row only with `--update`. |
| `domain` | One of `H` `P` `Q` `S`. Anything else is skipped. |
| `difficulty` | One of `E` `M` `H`. |
| `type` | `"mcq"` needs `choices` (≥2) + a correct id. `"spr"` needs `correct_answer` as an array of accepted strings. |
| `stem`, `choices[].body`, `rationale` | Rich text: plain words + **LaTeX** + optional **graph markers** (below). |
| `correct_answer` (SPR) | List **every** form a student could type: `["3/2", "1.5"]`, `["7", "8", "13"]` for "any of". The grader matches literally. |

---

## 2. Writing math (LaTeX)

Put LaTeX between delimiters, right inside the text:

- **Inline** (flows in a sentence): `\( ... \)`
  `The slope of \(y = 3x - 2\) is \(3\).`
- **Display** (its own centered line): `\[ ... \]`
  `\[ x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a} \]`

Common snippets: `\frac{a}{b}` · `x^{2}` · `x_{1}` · `\sqrt{x}` · `\sqrt[3]{x}` ·
`\pi` · `\le \ge \ne` · `\times \div \cdot` · `\pm` · `\%` (percent) ·
`\left( ... \right)` for auto-sized brackets.

**Do not** use a bare `$`. It is intentionally not a math delimiter (so "$5" stays
a price). Always use `\( \)` or `\[ \]`.

Backslashes must be escaped in JSON, so one LaTeX `\` becomes `\\` in the file:
`"\\(\\frac{1}{2}\\)"` renders as ½.

---

## 3. Graphs (the inbuilt graph engine)

Instead of an image, attach a **graph spec** and drop a marker where it should
appear. At ingest the spec becomes a themed inline SVG.

- One graph → add `"graph": { … }`. Place it with `{{graph}}` in the text, or
  leave the marker out and it's appended to the end of the stem.
- Several graphs (e.g. a "which graph is correct?" MCQ) → add
  `"graphs": { "opt_a": {…}, "opt_b": {…} }` and reference each with
  `{{graph:opt_a}}` — works inside `stem`, any `choices[].body`, or `rationale`.

Coordinates are in **data units** (your axis numbers), not pixels.

### 3a. `type: "coordinate"` — the xy-plane

```jsonc
{
  "type": "coordinate",
  "xRange": [0, 50], "yRange": [0, 950],  // visible window
  "xStep": 10, "yStep": 300,              // spacing of LABELED ticks (auto if omitted)
  "xGrid": 5,  "yGrid": 100,              // spacing of gridlines = the "boxes" (defaults to xStep/yStep)
  "xLabel": "Additive concentration (%)", // x-axis title
  "yLabel": "Cycle life (cycles)",        // y-axis title
  "grid": true,                           // optional, default true
  "title": "Mean Cycle Life of an LMA–PEO Cell,\nat Varying Additive Concentrations",
  "series": [ /* one or more of the marks below */ ]
}
```

**Matching a source graph exactly** — set the intervals to match the picture:

- `xStep`/`yStep` are where the **numbers** appear on each axis.
- `xGrid`/`yGrid` are the **gridline** spacing — i.e. how many boxes. If the source
  labels every 10 but has 2 boxes between labels, use `"xStep": 10, "xGrid": 5`.
- `title` is drawn at the **top**; use `\n` for a second line.
- Axis titles sit **outside** by default (y rotated on the left, x centred below —
  like most textbook graphs). Add `"axisLabels": "inline"` to tuck them next to
  the axes instead.

Series marks:

```jsonc
// Straight line — by slope/intercept OR two points (extended across the window)
{ "kind": "line", "slope": 2, "intercept": 1 }
{ "kind": "line", "through": [[0,1],[3,7]], "dash": true }   // dash:true or [on,off]

// Curve/polyline — YOU supply the points. smooth:true → smooth; smooth:false →
// straight segments between points. "marker" puts a dot/shape at EVERY point.
{ "kind": "curve", "smooth": false,
  "points": [[0,0],[10,150],[20,300],[30,300],[40,520],[50,950]],
  "color": "#8B0000", "width": 3,
  "marker": { "shape": "circle", "color": "green", "r": 5 } }

// Scatter — dots (or a "shape") at points
{ "kind": "scatter", "points": [[1,2],[2,3],[4,5]], "shape": "circle" }

// Segment — from one point to another (not extended)
{ "kind": "segment", "from": [0,0], "to": [3,4], "dash": [4,4] }

// Shaped markers on specific points ("dots/shapes on certain points")
{ "kind": "markers", "points": [
    { "at": [2,5], "shape": "triangle", "color": "green" },
    { "at": [4,3], "shape": "diamond", "open": true, "label": "P" }
] }

// Single marked point — hollow with open:true (excluded endpoint)
{ "kind": "point", "at": [2,5], "label": "(2, 5)", "shape": "circle", "open": false }
```

- `"color"`: `"plot"` (blue, default), `"accent"` (pink), `"green"`, `"amber"`,
  `"muted"` (ink), or a raw CSS color like `"#8B0000"`.
- `"shape"` (markers/points/scatter): `"circle"` (default), `"square"`,
  `"triangle"`, `"diamond"`. `"open": true` = hollow.
- `"dash"` (any line-like mark): `true` for a standard dash, or `[on, off]` like
  `[6,4]`.
- `"width"`: line thickness (default 2).

> **Curves have no equation evaluator** — the renderer only connects the points
> you give it, using **monotone cubic interpolation** (like d3's `curveMonotoneX`)
> so a `smooth` curve passes through your points **without overshooting** — no
> spurious bumps or wiggles between samples. Sample the function yourself (see the
> prompt in [`MATH_JSON_PROMPT.md`](./MATH_JSON_PROMPT.md), which does this for
> you); ~8–12 points across the window is plenty, and points must go left→right
> (x strictly increasing). Include the key x-values — roots, the vertex/turning
> points, and the endpoints — so the shape is faithful.

### 3b. `type: "numberline"`

```jsonc
{
  "type": "numberline",
  "range": [-3, 7], "step": 1,
  "intervals": [ { "from": 1, "to": 5, "openFrom": false, "openTo": true } ],
  "points": [ { "at": -2, "open": true, "label": "−2" } ]
}
```

`open: true` (and `openFrom`/`openTo`) draw a **hollow** dot = value excluded;
solid = included.

### 3c. `type: "bar"`

```jsonc
{
  "type": "bar",
  "categories": ["Mon", "Tue", "Wed", "Thu", "Fri"],
  "values":     [4, 7, 3, 8, 5],
  "yLabel": "Sales",
  "yMax": 10,          // optional; auto-fit if omitted
  "color": "plot"
}
```

### 3d. `type: "boxplot"` — box-and-whisker

A five-number summary (min, Q1, median, Q3, max) drawn as a box with a median
line and whiskers, over its own numbered axis. Give several `plots` to stack
comparisons (like a labeled A and B); each plot can carry **its own axis range**,
so two plots with different scales sit one above the other.

```jsonc
{
  "type": "boxplot",
  "range": [0, 40], "step": 4,      // default axis for plots that omit their own
  "minorStep": 2,                   // optional small ticks between labels (default step/2)
  "plots": [
    { "label": "A", "min": 22, "q1": 27, "median": 30, "q3": 46, "max": 58,
      "range": [20, 60], "step": 4, "color": "accent" },
    { "label": "B", "min": 6, "q1": 12, "median": 33, "q3": 37, "max": 38,
      "range": [0, 40], "boxColor": "muted", "whiskerColor": "green" }
  ]
}
```

- Each plot: `min`, `q1`, `median`, `q3`, `max` (required). Optional `label`
  (shown in the box), `range`/`step` (its own axis), and `color` — or split
  `boxColor` / `whiskerColor`.
- A **single** box plot may be written inline (put `min`/`q1`/… on the spec, no
  `plots` array).

---

## 4. Tables (the inbuilt table engine)

Same idea as graphs: instead of hand-writing an HTML `<table>`, attach a **table
spec** and place it with a marker.

- One table → add `"table": { … }`; place with `{{table}}` or omit the marker to
  append it.
- Several → add `"tables": { "data": {…}, … }` and reference with `{{table:data}}`.
  Works in `stem`, any `choices[].body`, or `rationale`.

**Cells accept LaTeX** (same `\( … \)` rules as everywhere else).

```jsonc
{
  "headers": ["\\(x\\)", "\\(f(x)\\)"],   // column headers (optional — omit for a headless grid)
  "rows": [
    ["1", "1"],
    ["2", "4"],
    ["3", "9"]
  ],
  "align": ["center", "right"],   // optional, per column: left | center | right (default center)
  "rowHeaders": true,             // optional: render each row's first cell as a <th> label
  "caption": "Values of f"        // optional caption under the table
}
```

A two-way frequency table (row + column headers) — put an empty string in the
corner header and turn on `rowHeaders`:

```jsonc
{
  "headers": ["", "Boys", "Girls", "Total"],
  "rows": [
    ["Grade 9",  "14", "16", "30"],
    ["Grade 10", "11", "13", "24"],
    ["Total",    "25", "29", "54"]
  ],
  "rowHeaders": true
}
```

> Wrap comparisons like `x < 5` in LaTeX (`\(x < 5\)`) so a bare `<` in a cell is
> never mistaken for a tag.

---

## 5. Full example — a graph MCQ

```json
{
  "external_id": "math-graph-12",
  "domain": "H",
  "difficulty": "M",
  "skill_desc": "Linear functions — interpreting slope",
  "type": "mcq",
  "stem": "The graph of a linear function is shown. {{graph}} What is the slope of the line?",
  "graph": {
    "type": "coordinate",
    "xRange": [-1, 6], "yRange": [-1, 8],
    "xLabel": "x", "yLabel": "y",
    "series": [
      { "kind": "line", "through": [[0, 1], [3, 7]], "color": "plot" },
      { "kind": "point", "at": [0, 1], "label": "(0, 1)" },
      { "kind": "point", "at": [3, 7], "label": "(3, 7)" }
    ]
  },
  "choices": [
    { "id": "A", "body": "\\(\\frac{1}{2}\\)" },
    { "id": "B", "body": "\\(1\\)" },
    { "id": "C", "body": "\\(2\\)", "correct": true },
    { "id": "D", "body": "\\(3\\)" }
  ],
  "correct_answer": "C",
  "rationale": "Slope \\(= \\frac{7 - 1}{3 - 0} = \\frac{6}{3} = 2\\)."
}
```

---

## 6. Loading the questions

Two ways, same JSON — both use the shared figure engines in `src/lib/figures/`:

### In the app (easiest)

Click **Create a test**, attach the `.json`, and it builds a bank you can then
sit (timed, your choice of minutes) from the bank page — exactly like an English
JSON. The importer auto-detects math records (`type`, `id`/`body` choices,
`graph`/`table` specs) and stores them with `section = math`, so the calculator,
LaTeX rendering, and grid-in grading all light up. English JSON still imports the
same as before.

### CLI (batch / scripted)

```bash
node --experimental-strip-types --env-file=.env.local \
  scripts/ingest-math-bank.mjs path/to/questions.json
```

- Add `--dry-run` to validate + map without writing (does everything but the DB
  insert — a **malformed graph spec fails here, loudly**, so always dry-run a new
  batch first).
- Add `--update` to overwrite existing rows with the same `external_id`.
- Add `--batch <key>` to tag brand-new rows as a release cohort.

---

## 7. Graphs & tables in **Reading & Writing** JSON

The same declarative figure specs (§3, §4) work in R&W question JSON — a data
question describes its chart or table as JSON instead of shipping an image. The
importer detects R&W vs Math by the record's shape (R&W uses `options: [{letter,
text}]` and word domains like `"Information and Ideas"`); adding a `graph`/`table`
never changes that.

They render through the app's existing R&W surfaces, so placement differs
slightly from Math:

- **Graph** — add a `graph` spec (same fields as §3a). It renders as a clean
  inline **SVG** in the question's figure slot (beside the passage), via the same
  crisp path Math uses — **not** an image. You don't need a marker; a `{{graph}}`
  marker in the text is ignored (the figure has its own slot). One graph per
  question.
- **Table** — add a `table`/`tables` spec (same fields as §4). Place it with a
  `{{table}}` / `{{table:ID}}` marker in the `passage` or `question_text`; with no
  marker a single `table` is appended to the passage. It renders as a real inline
  `<table>`.

Everything else about an R&W record is unchanged. Example:

```json
{
  "external_id": "rw-data-07",
  "domain": "Information and Ideas",
  "difficulty": "medium",
  "passage": "The researcher's results are shown.",
  "question_text": "Which choice best describes the trend in the data?",
  "graph": {
    "type": "coordinate",
    "xRange": [0, 10], "yRange": [0, 10], "xLabel": "week", "yLabel": "count",
    "series": [{ "kind": "scatter", "points": [[1,2],[3,4],[5,6],[7,9]] }]
  },
  "options": [
    { "letter": "A", "text": "It increases." },
    { "letter": "B", "text": "It decreases." },
    { "letter": "C", "text": "It stays flat." },
    { "letter": "D", "text": "It has no pattern." }
  ],
  "correct_answer": "A",
  "explanation": "The plotted points rise from left to right."
}
```

Both import paths (in-app upload and CLI) handle R&W JSON figures the same way.

### Inline scientific notation in R&W text

R&W has no LaTeX renderer (it flows through `<RichText>`), but you can still write
inline **subscripts/superscripts** with `$…$` — the importer converts them to the
`<sub>`/`<sup>` tags R&W renders:

- `$N_2O$` → N₂O, `$CO_2$` → CO₂, `$H_2O$` → H₂O
- `$x^2$` → x², `$SO_4^{2-}$` → SO₄²⁻ (use braces for multi-character scripts)

This is **currency-safe**: a `$…$` run is only treated as notation when it
actually contains a `_` or `^`, so prose like "costs $5" or "$5 and $10" is left
exactly as written. Full LaTeX (fractions, roots) isn't rendered in R&W — put that
kind of question in the Math section.
