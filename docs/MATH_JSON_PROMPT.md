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
  "xLabel":"x", "yLabel":"y", "grid":true,
  "series":[ ... ] }
  series marks (any may add "color": "plot"|"accent"|"green"|"amber"|"muted"):
    { "kind":"line", "slope":m, "intercept":b }
    { "kind":"line", "through":[[x1,y1],[x2,y2]] }
    { "kind":"curve", "smooth":true, "points":[[x,y], ...] }   // see SAMPLING
    { "kind":"scatter", "points":[[x,y], ...] }
    { "kind":"segment", "from":[x,y], "to":[x,y] }
    { "kind":"point", "at":[x,y], "label":"(x, y)", "open":false }  // open:true = hollow/excluded

number line:
{ "type":"numberline", "range":[lo,hi], "step":1,
  "intervals":[ {"from":a,"to":b,"openFrom":false,"openTo":true} ],
  "points":[ {"at":x,"open":true,"label":"..."} ] }

bar chart:
{ "type":"bar", "categories":[...], "values":[...], "yLabel":"...", "yMax":n }

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
