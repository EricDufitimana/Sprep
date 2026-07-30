// Vocabulary free-response grader.
//
// Mirrors extract_questions_ai: npm: specifiers, Deno.serve with an explicit
// CORS preflight, a guarded JSON body parse, a RateLimiter, and a model read
// from an environment variable so it can change without a redeploy. The one
// provider call is isolated in a single clearly-marked block so it can be
// swapped without touching the contract around it.
//
// What this grades: whether the user's own words captured the *meaning* of a
// word — not whether they matched the reference wording. A correct idea phrased
// differently should score high; a fluent paraphrase that gets the charge
// (positive/negative) wrong should be called out even when it is close on sense.
//
// This function is pure: it takes an answer and returns a grade. It never writes
// to the database — the calling tRPC procedure (vocabulary.gradeAnswer) persists
// the result to the attempts tables. That keeps the AI key server-side and the
// grading logic in one replaceable place.
import "jsr:@supabase/functions-js/edge-runtime.d.ts"

// Declare Deno for TypeScript
declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

console.log("🚀 Vocabulary grading function starting up...");

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Verdict = 'close' | 'partial' | 'off';

interface GradeResult {
  score: number;      // 0–100, how well the answer captured the meaning
  verdict: Verdict;   // coarse bucket derived from the model's judgment
  feedback: string;   // 1–2 sentences: what was right, what was missing
  correctDefinition: string;
}

// The prompt grades meaning over wording and treats charge as a first-class
// dimension — a wrong charge is flagged even when the sense is close.
const GRADING_PROMPT = `You are grading a student's own-words definition of an SAT vocabulary word.

You will receive the WORD, the CORRECT DEFINITION, and the STUDENT ANSWER.

Grade the MEANING, not the wording. A correct idea expressed in different words should score high. Do not reward matching the reference phrasing; reward capturing the core sense.

Pay special attention to CHARGE — whether the word is positive, negative, or neutral in tone. If the student captures the general area of meaning but gets the charge wrong (e.g. defines a negative word as if it were positive), say so explicitly and cap the score in the partial range, because charge errors change what the word actually means on the test.

Return ONLY valid JSON of this exact shape:
{
  "score": <integer 0-100, how fully the answer captures the correct meaning>,
  "verdict": <"close" | "partial" | "off">,
  "feedback": <1-2 sentences, second person: name what they got right and what they missed. If the charge is wrong, say so.>
}

Guidance for score/verdict:
- 80-100 "close": core meaning captured, charge correct.
- 40-79 "partial": right general area but missing a key element, or charge wrong.
- 0-39 "off": wrong meaning, or too vague to show understanding.`;

// Rate limiter for API calls (same shape as extract_questions_ai).
class RateLimiter {
  private requests: number[] = [];
  private maxRequests: number;
  private timeWindow: number;

  constructor(maxRequests: number = 30, timeWindowMs: number = 60000) {
    this.maxRequests = maxRequests;
    this.timeWindow = timeWindowMs;
  }

  async waitIfNeeded(): Promise<void> {
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < this.timeWindow);

    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = Math.min(...this.requests);
      const waitTime = this.timeWindow - (now - oldestRequest) + 100;
      if (waitTime > 0) {
        console.log(`⏳ Rate limiting: waiting ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    this.requests.push(now);
  }
}

const rateLimiter = new RateLimiter(30, 60000);

/** Strip markdown fences and pull the JSON object out of a model response. */
function parseModelJson(raw: string): { score: number; verdict: string; feedback: string } | null {
  try {
    let jsonString = raw.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const firstBrace = jsonString.indexOf('{');
    const lastBrace = jsonString.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      jsonString = jsonString.slice(firstBrace, lastBrace + 1);
    }
    const parsed = JSON.parse(jsonString);
    if (typeof parsed.score !== 'number' || typeof parsed.feedback !== 'string') return null;
    return parsed;
  } catch (parseError) {
    console.error('❌ Error parsing model response:', parseError);
    return null;
  }
}

const clampScore = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Derive the coarse verdict from the score if the model omits or garbles it. */
function normalizeVerdict(raw: unknown, score: number): Verdict {
  if (raw === 'close' || raw === 'partial' || raw === 'off') return raw;
  if (score >= 80) return 'close';
  if (score >= 40) return 'partial';
  return 'off';
}

/**
 * ⟵ SWAP AI PROVIDER HERE
 *
 * Everything provider-specific lives in this one function. To move off OpenAI,
 * replace the fetch/body/parse below and return the same
 * { score, verdict, feedback } shape (or null on failure). The rest of the
 * function — contract, validation, fallback — is provider-agnostic.
 *
 * Model comes from OPENAI_MODEL and the key from OPENAI_API_KEY, exactly as in
 * extract_questions_ai, so both functions share deployment configuration.
 */
async function gradeWithProvider(
  word: string,
  correctDefinition: string,
  userAnswer: string,
): Promise<{ score: number; verdict: Verdict; feedback: string } | null> {
  const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiApiKey) {
    console.error('❌ OPENAI_API_KEY is not configured');
    return null;
  }
  const model = Deno.env.get("OPENAI_MODEL");
  if (!model) {
    console.error('❌ OPENAI_MODEL is not configured');
    return null;
  }

  console.log(`🤖 Grading "${word}" with ${model}...`);

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: GRADING_PROMPT },
          {
            role: 'user',
            content:
              `WORD: ${word}\n` +
              `CORRECT DEFINITION: ${correctDefinition}\n` +
              `STUDENT ANSWER: ${userAnswer}`,
          },
        ],
        max_completion_tokens: 300,
        // Deterministic grade for the same answer.
        temperature: 0,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Provider error:', response.status, errorText);
      return null;
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;
    if (!content) {
      console.error('❌ Unexpected provider response format');
      return null;
    }

    const parsed = parseModelJson(content);
    if (!parsed) return null;

    const score = clampScore(parsed.score);
    return { score, verdict: normalizeVerdict(parsed.verdict, score), feedback: parsed.feedback.trim() };
  } catch (error) {
    console.error('💥 Provider call failed:', error);
    return null;
  }
}
// ⟵ END SWAP AI PROVIDER BLOCK

console.log("✅ All functions loaded, starting server...");

// @ts-ignore
Deno.serve(async (req) => {
  console.log(`📨 ${req.method} request received`);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  let body;
  try {
    body = await req.json();
  } catch (jsonError) {
    console.error('❌ Invalid JSON in request body:', jsonError);
    return new Response(
      JSON.stringify({ error: "Invalid JSON in request body" }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
    );
  }

  const word = typeof body?.word === 'string' ? body.word.trim() : '';
  const correctDefinition = typeof body?.correctDefinition === 'string' ? body.correctDefinition.trim() : '';
  const userAnswer = typeof body?.userAnswer === 'string' ? body.userAnswer.trim() : '';

  if (!word || !correctDefinition || !userAnswer) {
    return new Response(
      JSON.stringify({ error: "word, correctDefinition, and userAnswer are all required" }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
    );
  }

  await rateLimiter.waitIfNeeded();
  const graded = await gradeWithProvider(word, correctDefinition, userAnswer);

  // Graceful failure: even when scoring is unavailable, the caller must be able
  // to show the learner the correct definition. We surface a 502 with the
  // definition attached; the tRPC procedure turns this into an ungraded reveal
  // rather than an error the user sees.
  if (!graded) {
    return new Response(
      JSON.stringify({ error: "Grading is unavailable right now", correctDefinition }),
      { status: 502, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
    );
  }

  const payload: GradeResult = {
    score: graded.score,
    verdict: graded.verdict,
    feedback: graded.feedback,
    correctDefinition,
  };

  console.log(`✅ Graded "${word}": ${payload.score} (${payload.verdict})`);

  return new Response(
    JSON.stringify(payload),
    { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
  );
});

console.log("🎉 Grading function fully loaded and ready!");
