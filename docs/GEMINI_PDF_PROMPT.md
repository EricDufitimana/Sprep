# Gemini PDF → math JSON prompt

Paste the block below into Gemini, then attach/paste your PDF(s). It returns a
JSON array ready for `scripts/ingest-math-bank.mjs`. Everything the model needs is
inline, so it works without the rest of this repo.

Before pasting, edit the one line marked `ID PREFIX`.

---

````text
You are a precise data-extraction engine. You are given one or more PDFs of SAT
Math questions. Extract EVERY question into a single JSON array in the exact
schema below. Output ONLY the JSON array — no explanations, no markdown fences,
no comments. It must be valid JSON that parses on the first try.

ID PREFIX: "satm"   ← use this in every external_id, e.g. "satm-001".

============================ THE SCHEMA ============================
Each question is one object:

{
  "external_id": string,   // "<PREFIX>-001", "<PREFIX>-002", … zero-padded, in PDF order, unique
  "domain": "H" | "P" | "Q" | "S",
  "difficulty": "E" | "M" | "H",
  "skill_desc": string,    // short skill name, e.g. "Linear equations in two variables"
  "type": "mcq" | "spr",
  "stem": string,          // the question text (see MATH + FIGURES)
  "choices": [             // MCQ ONLY — exactly the choices shown, ids "A","B","C","D"
    { "id": "A", "body": string },
    { "id": "B", "body": string },
    { "id": "C", "body": string },
    { "id": "D", "body": string }
  ],
  "correct_answer": "A"|"B"|"C"|"D"  |  string[],   // MCQ: the letter. SPR: array of accepted forms
  "rationale": string,     // worked solution (see MATH)
  "graph":  { … },         // optional — a figure the question shows (see FIGURES: GRAPH)
  "graphs": { "id": {…} }, // optional — several graphs (e.g. answer-choice graphs)
  "table":  { … },         // optional — a data table (see FIGURES: TABLE)
  "tables": { "id": {…} }  // optional — several tables
}

DOMAIN codes (infer from the content if the PDF doesn't label it):
  H = Algebra
  P = Advanced Math (quadratics, polynomials, exponentials, functions)
  Q = Problem-Solving & Data Analysis (ratios, %, statistics, tables, scatterplots)
  S = Geometry & Trigonometry
DIFFICULTY: use the PDF's label if present; otherwise judge E/M/H. Default to "M".

MCQ vs SPR:
  - Multiple choice → "type":"mcq", include "choices" and set "correct_answer" to the letter.
  - Student-produced response / grid-in (no choices) → "type":"spr", OMIT "choices",
    and set "correct_answer" to an array listing EVERY form a student could type:
    fractions AND decimals, e.g. ["3/2","1.5"]; "any of" answers as ["7","8","13"].

============================ MATH = LaTeX ============================
Write ALL mathematical expressions as LaTeX between delimiters, inline in the text:
  - Inline (within a sentence):  \( ... \)
  - Display (its own line):      \[ ... \]
Use: \frac{}{}, x^{2}, x_{1}, \sqrt{}, \sqrt[3]{}, \pi, \le, \ge, \ne, \pm,
  \times, \div, \cdot, \left( \right), \% for percent, \degree or ^{\circ} for degrees.
Rules:
  - NEVER use a bare "$" as a math delimiter (it collides with dollar amounts).
    Only \( \) and \[ \]. Write money as plain text: "$5.00".
  - Every variable, equation, fraction, exponent, or symbol goes in LaTeX,
    including inside choices, table cells, and the rationale.
  - JSON-escape every backslash: LaTeX "\frac" becomes "\\frac" in the JSON string.
  - Reproduce the math EXACTLY as printed. Do not simplify or restate it.

===================== FIGURES: never reference an image =====================
The PDF may contain graphs, number lines, data tables, or diagrams. Do NOT write
"see figure" or embed an image. Re-express the figure as a spec object and place
it with a marker in the text. Markers:
  "{{graph}}" / "{{table}}"           → the single "graph"/"table" object
  "{{graph:ID}}" / "{{table:ID}}"     → an entry in the "graphs"/"tables" map
If a question has exactly one figure you may omit the marker; it is appended.
All coordinates are in DATA units (the numbers on the axes), not pixels.

--- FIGURES: GRAPH ---
Coordinate plane:
{ "type":"coordinate",
  "xRange":[lo,hi], "yRange":[lo,hi],
  "xLabel":"x", "yLabel":"y", "grid":true,
  "series":[ … ] }
  series marks (each may add "color": "plot"|"accent"|"green"|"amber"|"muted"):
    { "kind":"line", "slope":m, "intercept":b }
    { "kind":"line", "through":[[x1,y1],[x2,y2]] }
    { "kind":"curve", "smooth":true, "points":[[x,y], …] }   // SEE SAMPLING
    { "kind":"scatter", "points":[[x,y], …] }
    { "kind":"segment", "from":[x,y], "to":[x,y] }
    { "kind":"point", "at":[x,y], "label":"(x, y)", "open":false }  // open:true = hollow/excluded

Number line:
{ "type":"numberline", "range":[lo,hi], "step":1,
  "intervals":[ {"from":a,"to":b,"openFrom":false,"openTo":true} ],
  "points":[ {"at":x,"open":true,"label":"…"} ] }

Bar chart:
{ "type":"bar", "categories":[…], "values":[…], "yLabel":"…", "yMax":n }

Reading a graph OUT of the PDF: identify the exact features shown — intercepts,
vertex, plotted points, slope, marked coordinates — and rebuild them with the
marks above. For a scatterplot, list every visible data point in "points".

SAMPLING (curves have no equation evaluator — you must supply the points):
For any non-line curve (parabola, cubic, exponential, etc.), compute y at ~9–13
evenly spaced x values across xRange and list them as [x, y] pairs with
"smooth":true. Round y to 2 decimals. Choose xRange/yRange so the vertex, roots,
and intercepts are visible with a little margin.

--- FIGURES: TABLE ---
{ "headers":[ … ],           // column headers; omit for a headless grid. Cells may contain LaTeX.
  "rows":[ [cell, cell, …], … ],
  "align":[ "left"|"center"|"right", … ],   // optional, per column
  "rowHeaders": true,        // optional: first cell of each row becomes a row label <th>
  "caption":"…" }            // optional
Two-way / frequency table: give "headers" an empty first entry "" and set
"rowHeaders":true. Wrap any comparison inside a cell in LaTeX, e.g. "\\(x < 5\\)",
so a bare "<" is never read as a tag.

===================== GEOMETRY DIAGRAMS ("geometry" graph) =====================
For triangles/circles/angle diagrams, use a "graph" of type "geometry" — a plain
drawing space (y-up) that auto-fits with a uniform scale (shapes keep their true
proportions). NO axes.
{ "type":"geometry", "view":[x0,y0,x1,y1],   // view optional; auto-fits if omitted
  "elements":[
    { "kind":"polygon", "points":[[x,y],...], "fill":"plot", "stroke":"muted" },   // triangle/quad; close:false = open
    { "kind":"segment", "from":[x,y], "to":[x,y], "dash":true, "mark":1, "label":"m" },  // mark 1/2 = parallel arrows
    { "kind":"circle", "center":[x,y], "r":n, "dot":true },
    { "kind":"point", "at":[x,y], "label":"A", "labelPos":"below-left" },  // above|below|left|right|above-left|above-right|below-left|below-right
    { "kind":"label", "at":[x,y], "text":"5" },                 // a side length / angle value / free text
    { "kind":"angle", "at":[x,y], "from":[x,y], "to":[x,y], "label":"x°" },  // angle arc at a vertex
    { "kind":"rightangle", "at":[x,y], "from":[x,y], "to":[x,y] },           // right-angle square
    { "kind":"tick", "on":[[x,y],[x,y]], "count":2 } ] }        // congruence ticks on a side
Reproduce the figure: place each vertex, draw the sides as a polygon, label the
vertices and the given side lengths/angles, and add a rightangle mark where a
right angle is shown. Parallel lines cut by a transversal = two segments with the
SAME "mark" plus a crossing segment. A triangle split into more triangles = the
outer polygon plus segment cevians. Use ONLY measurements the figure gives; add
"not drawn to scale" to the stem if the source says so.

============================ ANSWERS ============================
- If the PDF includes an answer key or worked solution, use it. Match each answer
  to the right question by number.
- If no answer is given, SOLVE the question yourself, put the answer in
  "correct_answer", and show the work in "rationale". Double-check it.
- "rationale" is always required: a concise, correct, step-by-step solution in
  LaTeX. Never leave it empty.

============================ OUTPUT RULES ============================
- One object per question, in the order they appear across the PDFs.
- external_id: "<PREFIX>-001", "-002", … zero-padded to 3 digits, never reused.
- Include a figure field ONLY when the question actually shows that figure.
- Valid JSON only: double quotes, no trailing commas, no comments, no fences.
- Before you finish, silently verify the JSON parses and every backslash is
  doubled. Output the array and nothing else.
````
