# Authoring prompt — paste this into an AI to generate math JSON

Copy everything in the box below into Claude/ChatGPT, then paste your raw math
question(s) (typed, pasted, or a screenshot) underneath. It returns JSON that
drops straight into `scripts/ingest-math-bank.mjs`.

---

````text
You convert SAT Math questions into a strict JSON format. Output ONLY a JSON
array of question objects — no prose, no markdown fences. Follow every rule.

## Each object
{
  "external_id": string,   // unique, stable, kebab id you assign, e.g. "alg-lin-012"
  "domain": "H"|"P"|"Q"|"S",   // H=Algebra, P=Advanced Math, Q=Problem-Solving & Data, S=Geometry & Trig
  "difficulty": "E"|"M"|"H",
  "skill_desc": string,        // short skill name
  "type": "mcq"|"spr",
  "stem": string,
  "choices": [ {"id":"A","body":string}, ... ],   // MCQ only, exactly 4, ids A–D
  "correct_answer": "A".."D"  |  string[],         // MCQ: the letter. SPR: every accepted typed form
  "rationale": string,
  "graph":  { ... }   // optional, see GRAPHS
  "graphs": { id: {...}, ... }  // optional, for multiple figures
  "table":  { ... }   // optional, see TABLES
  "tables": { id: {...}, ... }  // optional, for multiple tables
}
For SPR (grid-in) omit "choices"; set "correct_answer" to an array listing every
form a student could type, e.g. ["3/2","1.5"] or ["7","8","13"] for "any of".

## MATH = LaTeX between delimiters, placed inline in the text
- Inline: \( ... \)     Display (own line): \[ ... \]
- Use \frac{}{}, x^{2}, x_{1}, \sqrt{}, \sqrt[3]{}, \pi, \le, \ge, \ne, \pm,
  \times, \div, \cdot, \left( \right), \% for percent.
- NEVER use a bare "$" as a delimiter (it collides with money). Only \( \) and \[ \].
- Every math variable/number that is part of an expression goes in LaTeX.
- JSON-escape backslashes: LaTeX "\frac" is written "\\frac" in the JSON string.

## GRAPHS = a spec object, never an image. Put a marker where it appears:
"{{graph}}" for the single "graph", or "{{graph:ID}}" for an entry in "graphs".
If a stem has one graph you may omit the marker; it is appended automatically.
Coordinates are DATA units (the axis numbers).

coordinate plane:
{ "type":"coordinate", "xRange":[lo,hi], "yRange":[lo,hi],
  "xStep":n, "yStep":n,          // spacing of the LABELED numbers on each axis
  "xGrid":n, "yGrid":n,          // spacing of the gridlines = the boxes (defaults to xStep/yStep)
  "xLabel":"...", "yLabel":"...",// axis titles (drawn outside: y on the left, x centred below)
  "title":"Line one\nLine two",  // title at the TOP; use \n for a second line
  "grid":true, "series":[ ... ] }
  series marks (any may add "color": "plot"|"accent"|"green"|"amber"|"muted"|"#hex"):
    { "kind":"line", "slope":m, "intercept":b, "dash":true }
    { "kind":"line", "through":[[x1,y1],[x2,y2]] }
    { "kind":"curve", "smooth":false, "points":[[x,y], ...],  // smooth:false = straight segments; see SAMPLING for curves
      "width":3, "marker":{"shape":"circle","color":"green","r":5} }  // dot/shape at every point
    { "kind":"scatter", "points":[[x,y], ...], "shape":"circle" }
    { "kind":"segment", "from":[x,y], "to":[x,y], "dash":[4,4] }
    { "kind":"markers", "points":[ {"at":[x,y],"shape":"triangle","color":"green"} ] }  // shapes on certain points
    { "kind":"point", "at":[x,y], "label":"(x, y)", "shape":"circle", "open":false }  // open:true = hollow
  shapes: "circle"|"square"|"triangle"|"diamond".  dash: true or [on,off].

  MATCH THE SOURCE GRAPH EXACTLY: reproduce the ranges, where the numbers sit
  (xStep/yStep) AND how many boxes are between them (xGrid/yGrid), the title
  (verbatim, with line breaks) and axis labels on the same sides, every plotted
  point, any dots/markers drawn on the points (use "marker" or a "markers"
  series with the right shape/colour), whether the line is straight segments
  (smooth:false) or a smooth curve, and whether it is dashed.

number line:
{ "type":"numberline", "range":[lo,hi], "step":1,
  "intervals":[ {"from":a,"to":b,"openFrom":false,"openTo":true} ],
  "points":[ {"at":x,"open":true,"label":"..."} ] }

bar chart:
{ "type":"bar", "categories":[...], "values":[...], "yLabel":"...", "yMax":n }

box-and-whisker plot (five-number summary; give several "plots" to stack A/B/…):
{ "type":"boxplot", "range":[lo,hi], "step":n, "minorStep":n,   // default axis
  "plots":[
    { "label":"A", "min":n, "q1":n, "median":n, "q3":n, "max":n,
      "range":[lo,hi], "step":n, "color":"accent" }   // per-plot axis + colour (optional)
  ] }
  Read the five values off each plot: whisker ends = min & max, box ends = Q1 &
  Q3, the line inside the box = median. If two plots use different axis scales,
  give each its own "range"/"step" (they stack, each with its own numbered axis).
  Colour a plot with "color", or split "boxColor"/"whiskerColor". A single plot
  may omit "plots" and put min/q1/median/q3/max directly on the object.

geometry (triangles/circles/angle diagrams — no axes; uniform scale keeps shapes true):
{ "type":"geometry", "view":[x0,y0,x1,y1],  // view optional; auto-fits if omitted
  "elements":[
    { "kind":"polygon", "points":[[x,y],...], "fill":"plot" },
    { "kind":"segment", "from":[x,y], "to":[x,y], "dash":true, "mark":1, "label":"m" },  // mark = parallel arrows
    { "kind":"circle", "center":[x,y], "r":n },
    { "kind":"point", "at":[x,y], "label":"A", "labelPos":"below-left" },
    { "kind":"label", "at":[x,y], "text":"5" },
    { "kind":"angle", "at":[x,y], "from":[x,y], "to":[x,y], "label":"x°" },
    { "kind":"rightangle", "at":[x,y], "from":[x,y], "to":[x,y] },
    { "kind":"tick", "on":[[x,y],[x,y]], "count":2 } ] }
  Parallel lines + transversal = two segments with the same "mark" plus a crossing
  segment. A triangle split into more triangles = outer polygon + segment cevians.

## TABLES = a spec object, never hand-written HTML. Place with a marker:
"{{table}}" for the single "table", or "{{table:ID}}" for an entry in "tables"
(omit the marker for a single table and it is appended). Cells may contain LaTeX.
{ "headers":[...],            // column headers; omit for a headless grid
  "rows":[ [cell, cell, ...], ... ],
  "align":["left"|"center"|"right", ...],   // optional, per column
  "rowHeaders": true,          // optional: first cell of each row becomes a <th> label
  "caption":"..." }            // optional
For a two-way table, set headers with an empty first entry ("") and rowHeaders:true.
Wrap any comparison in a cell in LaTeX, e.g. "\\(x < 5\\)", so bare "<" is safe.

## SAMPLING (curves have no equation evaluator — you must supply points)
For any non-line curve (parabola, cubic, exp, etc.), compute y at evenly spaced
x across xRange — about 9–13 points — and list them exactly as [x, y] pairs with
"smooth":true. Choose xRange/yRange so the interesting features (vertex, roots,
intercepts) are visible with a little margin. Round y to 2 decimals.

## RULES
- Choose ranges/steps that frame the figure cleanly; prefer integer ticks.
- Keep external_id stable and unique across the whole batch.
- If a question truly has no figure, omit "graph"/"graphs"/"table"/"tables" entirely.
- Output valid JSON only. Verify it parses. No trailing commas.

Here are the questions to convert:
````

---

## Tips

- **Screenshots work** — paste an image of a worksheet/Bluebook question under
  the prompt; the model reads the figure and re-expresses it as a graph spec.
- **Always dry-run first** to catch a bad spec before it hits the DB:

  ```bash
  node --experimental-strip-types --env-file=.env.local \
    scripts/ingest-math-bank.mjs new-batch.json --dry-run
  ```

- If a curve looks jagged, ask for **more sample points**; if it overshoots the
  box, ask it to **widen `yRange`**.
- See [`MATH_JSON_FORMAT.md`](./MATH_JSON_FORMAT.md) for the full reference and a
  worked graph-MCQ example.
