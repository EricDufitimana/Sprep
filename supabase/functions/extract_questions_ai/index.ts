// SAT Question Extraction AI Processor
// Mirrors the structure of scan_report_card_ai: npm: specifiers, service-role
// client from Deno.env, Deno.serve with explicit CORS preflight, guarded JSON
// body parse, and a RateLimiter. Vision runs on OpenAI; the model comes from
// the OPENAI_MODEL environment variable so it can change without a redeploy.
//
// The difference is what "verification" means. A report card has one number to
// extract; a question paper has hundreds of fields where a plausible-looking
// hallucination is indistinguishable from a correct read. So nothing here is
// trusted on a single pass — see the verification ladder in verifyQuestion().
import "jsr:@supabase/functions-js/edge-runtime.d.ts"

// Use consistent npm: imports
// @ts-ignore
import { createClient } from "npm:@supabase/supabase-js@2";

// Declare Deno for TypeScript
declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

console.log("🚀 Question extraction function starting up...");

// Service role: this function writes on behalf of the user after verifying the
// bank's ownership itself. AI keys live only in this function's environment.
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

console.log("✅ Supabase client initialized");

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LETTERS = ['A', 'B', 'C', 'D'];

type ExtractionStatus = 'verified' | 'needs_review' | 'skipped';

interface ExtractedOption {
  letter: string;
  text: string;
}

interface ExtractedQuestion {
  position: number;
  passage: string | null;
  question_text: string;
  options: ExtractedOption[];
  correct_answer: string;
  explanation: string | null;
  has_visual: boolean;
  visual_data: string | null;
  domain: string | null;
  skill: string | null;
  difficulty: string | null;
  extraction_status: ExtractionStatus;
  review_reason: string | null;
}

const EXTRACTION_PROMPT = `You are extracting SAT Reading & Writing questions from a scanned page image.

Return ONLY valid JSON of this exact shape:
{
  "questions": [
    {
      "position": <number, the printed question number>,
      "passage": <the passage or stimulus text, or null if the question has none>,
      "question_text": <the question stem>,
      "options": [{"letter":"A","text":"..."},{"letter":"B","text":"..."},{"letter":"C","text":"..."},{"letter":"D","text":"..."}],
      "correct_answer": <"A"|"B"|"C"|"D" if the page marks one, otherwise null>,
      "explanation": <explanation text if printed, otherwise null>,
      "has_visual": <true if the question depends on a chart, graph, table, or figure>,
      "visual_data": <if has_visual: transcribe every label and value as text, e.g. "Bar chart. 1990: 12%, 2000: 19%, 2010: 31%". Otherwise null>,
      "domain": <one of "information_and_ideas","craft_and_structure","expression_of_ideas","standard_english_conventions", or null>,
      "skill": <specific skill name, e.g. "Words in Context", "Transitions", "Boundaries", or null>,
      "difficulty": <"easy"|"medium"|"hard" or null>
    }
  ]
}

RULES:
- Transcribe verbatim. Never paraphrase, complete, or correct the source text.
- Every question must have exactly 4 options lettered A, B, C, D.
- If a field is genuinely unreadable, use null. Never guess.
- For has_visual questions, visual_data must capture every number and label needed to answer without seeing the image.`;

// Rate limiter for API calls
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
function parseModelJson(raw: string): { questions: ExtractedQuestion[] } | null {
  try {
    let jsonString = raw.trim()
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '');

    const firstBrace = jsonString.indexOf('{');
    const lastBrace = jsonString.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      jsonString = jsonString.slice(firstBrace, lastBrace + 1);
    }

    const parsed = JSON.parse(jsonString);
    if (!Array.isArray(parsed.questions)) return null;
    return parsed;
  } catch (parseError) {
    console.error('❌ Error parsing model response:', parseError);
    return null;
  }
}

/**
 * OpenAI vision extraction for one page image.
 *
 * The model is read from OPENAI_MODEL so it can be changed without a redeploy.
 * `variant` exists for the visual double-read: the second pass runs at a
 * non-zero temperature so it is a genuine re-read rather than a cache-identical
 * repeat of the first — see the note in the main loop.
 */
async function extractPageWithOpenAI(
  imageUrl: string,
  variant: 'primary' | 'second-opinion' = 'primary',
): Promise<ExtractedQuestion[] | null> {
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

  console.log(`🤖 Calling OpenAI (${model}, ${variant}) to extract page...`);

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiApiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: EXTRACTION_PROMPT },
              { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } }
            ]
          }
        ],
        max_completion_tokens: 8000,
        // A deterministic first read; a slightly loosened second one, so the
        // agreement check can actually disagree.
        temperature: variant === 'primary' ? 0 : 0.4,
        response_format: { type: "json_object" }
      })
    });

    console.log('📡 OpenAI API response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ OpenAI API error:', response.status, errorText);

      if (response.status === 429) {
        console.log('⏳ Rate limited, waiting 1 second...');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      return null;
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;
    if (!content) {
      console.error('❌ Unexpected OpenAI response format');
      return null;
    }

    const parsed = parseModelJson(content);
    if (!parsed) return null;

    console.log(`✅ OpenAI extracted ${parsed.questions.length} questions`);
    return parsed.questions;

  } catch (error) {
    console.error('💥 OpenAI API call failed:', error);
    return null;
  }
}

/**
 * Normalize a transcription for comparison: a visual read that differs only in
 * spacing or casing is the same read, one that differs in a digit is not.
 */
function normalizeForCompare(value: string | null): string {
  return (value ?? '').toLowerCase().replace(/[\s,]+/g, ' ').replace(/[^\w %.:-]/g, '').trim();
}

/** Do two independent visual reads agree on every number they contain? */
function visualReadsAgree(a: string | null, b: string | null): boolean {
  if (normalizeForCompare(a) === normalizeForCompare(b)) return true;

  // Numbers are what a chart question actually turns on — require those to
  // match exactly even if the surrounding prose is worded differently.
  const numsA = (a ?? '').match(/-?\d+(\.\d+)?/g) ?? [];
  const numsB = (b ?? '').match(/-?\d+(\.\d+)?/g) ?? [];
  if (numsA.length === 0 || numsA.length !== numsB.length) return false;
  return numsA.every((n, i) => n === numsB[i]);
}

/**
 * The verification ladder. A question is only `verified` if it clears every
 * rung; otherwise it is downgraded with a reason recorded for the review UI.
 */
function verifyQuestion(
  q: ExtractedQuestion,
  secondPass: ExtractedQuestion | undefined,
  answerKey: Map<number, string>,
  onVisualFailure: 'skip' | 'review',
): ExtractedQuestion {
  const reasons: string[] = [];
  let status: ExtractionStatus = 'verified';

  // Rung 1 — structure: exactly four options, lettered A-D exactly once.
  const letters = (q.options ?? []).map(o => (o.letter ?? '').trim().toUpperCase());
  const structureOk =
    Array.isArray(q.options) &&
    q.options.length === 4 &&
    LETTERS.every(l => letters.filter(x => x === l).length === 1) &&
    q.options.every(o => typeof o.text === 'string' && o.text.trim().length > 0);

  if (!structureOk) {
    reasons.push('Options are not exactly A, B, C, D with text');
    status = 'needs_review';
  }

  if (!q.question_text || q.question_text.trim().length === 0) {
    reasons.push('Question text is empty');
    status = 'needs_review';
  }

  // Rung 2 — answer key cross-check against ground truth.
  const keyed = answerKey.get(q.position);
  const extracted = (q.correct_answer ?? '').trim().toUpperCase();

  if (!keyed) {
    reasons.push(`No answer key entry for question ${q.position}`);
    status = 'needs_review';
  } else if (!LETTERS.includes(extracted)) {
    // The key is ground truth, so an unreadable extraction is recoverable —
    // but it still gets human eyes, since a misread number means the key row
    // may not correspond to this question at all.
    q.correct_answer = keyed;
    reasons.push('Answer not readable on the page; filled from answer key');
    status = 'needs_review';
  } else if (extracted !== keyed) {
    q.correct_answer = keyed;
    reasons.push(`Extracted answer ${extracted} disagrees with answer key ${keyed}`);
    status = 'needs_review';
  } else {
    q.correct_answer = extracted;
  }

  // Rung 3 — visual self-verification via two independent reads.
  if (q.has_visual) {
    if (!secondPass) {
      reasons.push('Visual question could not be independently re-extracted');
      status = onVisualFailure === 'skip' ? 'skipped' : 'needs_review';
    } else if (!visualReadsAgree(q.visual_data, secondPass.visual_data)) {
      reasons.push('Two independent reads of the visual disagree');
      // Default config: a chart we cannot self-verify is excluded from tests
      // rather than silently trusted. A wrong chart transcription produces a
      // question that is unanswerable but looks fine.
      status = onVisualFailure === 'skip' ? 'skipped' : 'needs_review';
    } else if (!q.visual_data || q.visual_data.trim().length === 0) {
      reasons.push('Visual question has no transcribed data');
      status = onVisualFailure === 'skip' ? 'skipped' : 'needs_review';
    }
  }

  return {
    ...q,
    options: (q.options ?? []).map(o => ({
      letter: (o.letter ?? '').trim().toUpperCase(),
      text: (o.text ?? '').trim(),
    })),
    extraction_status: status,
    review_reason: reasons.length > 0 ? reasons.join('; ') : null,
  };
}

/** Signed URL for a stored page image, readable by the vision APIs. */
async function signedUrlFor(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('question-papers')
    .createSignedUrl(path, 3600);

  if (error || !data?.signedUrl) {
    console.error('❌ Failed to sign storage path:', path, error);
    return null;
  }
  return data.signedUrl;
}

async function updateJob(jobId: string, patch: Record<string, unknown>) {
  const { error } = await supabase.from('extraction_jobs').update(patch).eq('id', jobId);
  if (error) console.error('❌ Failed to update job:', error);
}

console.log("✅ All functions loaded, starting server...");

// @ts-ignore
Deno.serve(async (req) => {
  console.log(`📨 ${req.method} request received`);

  if (req.method === 'OPTIONS') {
    console.log('✅ Handling OPTIONS request');
    return new Response('ok', { headers: CORS_HEADERS });
  }

  let body;
  try {
    body = await req.json();
  } catch (jsonError) {
    console.error('❌ Invalid JSON in request body:', jsonError);
    return new Response(
      JSON.stringify({ error: "Invalid JSON in request body" }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  const { jobId, bankId, sourcePaths, answerKey, config } = body;
  const onVisualFailure: 'skip' | 'review' = config?.onVisualFailure ?? 'skip';

  if (!jobId || !bankId || !Array.isArray(sourcePaths) || sourcePaths.length === 0) {
    return new Response(
      JSON.stringify({ error: "jobId, bankId, and a non-empty sourcePaths array are required" }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  if (!Array.isArray(answerKey) || answerKey.length === 0) {
    return new Response(
      JSON.stringify({ error: "answerKey is required — extraction cannot self-verify without ground truth" }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  try {
    console.log(`🚀 Extraction started: job ${jobId}, ${sourcePaths.length} pages`);

    // Resolve the owning user from the bank so inserted rows are attributed
    // correctly — the service role has no auth.uid() of its own.
    const { data: bank, error: bankError } = await supabase
      .from('question_banks')
      .select('id, user_id')
      .eq('id', bankId)
      .single();

    if (bankError || !bank) {
      throw new Error(`Question bank ${bankId} not found`);
    }

    await updateJob(jobId, {
      status: 'running',
      started_at: new Date().toISOString(),
      total_pages: sourcePaths.length,
    });

    const keyMap = new Map<number, string>(
      answerKey.map((k: { position: number; correct_answer: string }) => [
        k.position,
        k.correct_answer.trim().toUpperCase(),
      ])
    );

    const allQuestions: ExtractedQuestion[] = [];

    for (let i = 0; i < sourcePaths.length; i++) {
      const path = sourcePaths[i];
      console.log(`📄 Page ${i + 1}/${sourcePaths.length}: ${path}`);

      const imageUrl = await signedUrlFor(path);
      if (!imageUrl) {
        console.error(`❌ Skipping unreadable page: ${path}`);
        await updateJob(jobId, { pages_done: i + 1 });
        continue;
      }

      await rateLimiter.waitIfNeeded();
      const firstPass = await extractPageWithOpenAI(imageUrl, 'primary');

      if (!firstPass) {
        console.error(`❌ Extraction failed for page ${i + 1}`);
        await updateJob(jobId, { pages_done: i + 1 });
        continue;
      }

      // Second independent pass, but only when the page actually has a visual
      // question on it — re-running every page would double cost for nothing.
      let secondPass: ExtractedQuestion[] = [];
      if (firstPass.some(q => q.has_visual)) {
        // Second read of the same page by the same model. Now that there is a
        // single provider this is a weaker check than a cross-provider one —
        // it catches unstable reads, not a systematic misread both passes share.
        // The non-zero temperature is what stops it collapsing into a repeat.
        console.log('🔁 Page has visuals — running second-opinion pass');
        await rateLimiter.waitIfNeeded();
        secondPass = (await extractPageWithOpenAI(imageUrl, 'second-opinion')) ?? [];
      }

      const secondByPosition = new Map(secondPass.map(q => [q.position, q]));

      for (const q of firstPass) {
        allQuestions.push(
          verifyQuestion(q, secondByPosition.get(q.position), keyMap, onVisualFailure)
        );
      }

      await updateJob(jobId, { pages_done: i + 1, questions_found: allQuestions.length });
    }

    if (allQuestions.length === 0) {
      await updateJob(jobId, {
        status: 'failed',
        error_message: 'No questions could be extracted from the supplied pages',
        finished_at: new Date().toISOString(),
      });

      return new Response(
        JSON.stringify({ success: false, error: "No questions could be extracted" }),
        { status: 422, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // Insert with the resolved owner. RLS is bypassed by the service role, so
    // user_id is set explicitly rather than defaulting to auth.uid().
    const rows = allQuestions.map(q => ({
      bank_id: bankId,
      user_id: bank.user_id,
      position: q.position,
      domain: q.domain,
      skill: q.skill,
      difficulty: q.difficulty,
      passage: q.passage,
      question_text: q.question_text,
      options: q.options,
      correct_answer: q.correct_answer,
      explanation: q.explanation,
      has_visual: q.has_visual,
      visual_data: q.visual_data,
      extraction_status: q.extraction_status,
    }));

    const { error: insertError } = await supabase.from('questions').insert(rows);

    if (insertError) {
      throw new Error(`Failed to insert questions: ${insertError.message}`);
    }

    const verified = allQuestions.filter(q => q.extraction_status === 'verified').length;
    const needsReview = allQuestions.filter(q => q.extraction_status === 'needs_review').length;
    const skipped = allQuestions.filter(q => q.extraction_status === 'skipped').length;

    // total_questions counts only what can actually be sat.
    await supabase.from('question_banks').update({ total_questions: verified }).eq('id', bankId);

    await updateJob(jobId, {
      status: 'succeeded',
      pages_done: sourcePaths.length,
      questions_found: allQuestions.length,
      verified_count: verified,
      needs_review_count: needsReview,
      skipped_count: skipped,
      finished_at: new Date().toISOString(),
    });

    console.log(`✅ Done: ${verified} verified, ${needsReview} need review, ${skipped} skipped`);

    return new Response(
      JSON.stringify({
        success: true,
        jobId,
        bankId,
        questionsFound: allQuestions.length,
        verified,
        needsReview,
        skipped,
        // Reasons let the review UI explain why each row was held back.
        review: allQuestions
          .filter(q => q.extraction_status !== 'verified')
          .map(q => ({
            position: q.position,
            status: q.extraction_status,
            reason: q.review_reason,
          })),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );

  } catch (err) {
    console.error('💥 Extraction error:', err);

    await updateJob(jobId, {
      status: 'failed',
      error_message: err instanceof Error ? err.message : 'Unknown error',
      finished_at: new Date().toISOString(),
    });

    return new Response(
      JSON.stringify({
        success: false,
        error: `Extraction failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        details: err instanceof Error ? err.stack : 'No stack trace'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }
});

console.log("🎉 Edge function fully loaded and ready!");
