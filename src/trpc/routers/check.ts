import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '../init';
import { fetchAllRows } from '@/utils/paginate';
import { decodeEntities } from '@/utils/decode-entities';

/**
 * The `/check` dedupe tool — CONTENT matching (with ids as a bonus catch).
 *
 * Ids alone can't be trusted: the same question from a different source carries
 * a different id. So the primary signal is the prose. A pasted item is a
 * duplicate when its whole text (passage + question prompt) — or, failing that,
 * its passage alone, or its id — already exists in the stored bank.
 *
 * The two sides often differ in *markup*: one may wrap a word in a semantic tag
 * the other doesn't, carry a screen-reader span, or encode a character as an
 * entity. So we compare a bare `[a-z0-9]` fingerprint — decode entities, drop
 * every tag, lowercase, keep only letters and digits. Two texts that read the
 * same match regardless of tags, punctuation, casing or whitespace.
 *
 * To split passage from prompt the same way the stored rows were split, we reduce
 * the pasted `stem` HTML exactly as `scripts/ingest-json-bank.mjs` did.
 *
 * Speed: every stored row is fingerprinted once into hash maps, so each pasted
 * item is matched with O(1) look-ups — the whole run is O(bank + paste).
 */

/* ------------------------------------------------------------------ *
 * stem HTML → { passage, question } text — mirrors the ingest
 * ------------------------------------------------------------------ */

/** Last-paragraph / prompt heuristic, copied from the ingest so the split lands
 *  in the same place the stored rows were split. */
const PROMPT_RE =
  /^(which choice|which finding|which quotation|which statement|which of the following|based on the (text|passage|table|graph|data)|the student (wants|would|is|notes)|according to the)/i;

function htmlToLines(html: string): string[] {
  const s = html
    // Visual/table blocks are stripped from the stored passage — drop them here too.
    .replace(/<table[\s\S]*?<\/table>/gi, '\n')
    .replace(/<figure[\s\S]*?<\/figure>/gi, '\n')
    .replace(/<div[^>]*class="sr-only"[^>]*role="region"[^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/<div[^>]*role="region"[^>]*class="sr-only"[^>]*>[\s\S]*?<\/div>/gi, '')
    // Screen-reader-only spans (e.g. the "blank" label) are dropped at ingest.
    .replace(/<span[^>]*class="sr-only"[^>]*>[\s\S]*?<\/span>/gi, '')
    // Block boundaries → newlines so the prompt lands on its own line.
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|figcaption|caption|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(s)
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean);
}

/** Split the final question prompt off the passage, as the ingest does. */
function splitStem(html: string): { passage: string; question: string } {
  const paras = htmlToLines(html);
  if (paras.length === 0) return { passage: '', question: '' };
  let qIdx = -1;
  for (let i = paras.length - 1; i >= 0; i--) {
    if (paras[i].endsWith('?') || PROMPT_RE.test(paras[i])) {
      qIdx = i;
      break;
    }
  }
  if (qIdx === -1) qIdx = paras.length - 1;
  return {
    question: paras[qIdx] ?? '',
    passage: paras.slice(0, qIdx).join(' ').trim(),
  };
}

/** Reduce any text to a comparison fingerprint: decoded, lowercased, letters
 *  and digits only. Immune to HTML, entities, punctuation and whitespace. */
function fingerprint(text: string | null | undefined): string {
  if (!text) return '';
  return decodeEntities(text)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Pull passage + question text off one pasted item, however it's shaped. */
function textsFor(item: Record<string, unknown>): { passage: string; question: string } {
  // Explicit fields win when present…
  const passageField = typeof item.passage === 'string' ? item.passage : '';
  const questionField =
    (typeof item.question_text === 'string' && item.question_text) ||
    (typeof item.prompt === 'string' && item.prompt) ||
    '';
  if (passageField || questionField) {
    return { passage: stripTags(passageField), question: stripTags(questionField) };
  }
  // …otherwise derive them from the combined `stem` HTML.
  const stem = typeof item.stem === 'string' ? item.stem : '';
  return splitStem(stem);
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Every candidate id on a pasted item, normalised (for the bonus id match). */
function idsFor(item: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const v of [item.external_id, item.questionId, item.question_id, item.id]) {
    if (typeof v === 'string' && v.trim()) out.push(v.trim().toLowerCase());
    else if (typeof v === 'number') out.push(String(v));
  }
  return out;
}

/** Short readable preview for the results list. */
function preview(passage: string, question: string): string {
  const text = `${passage} ${question}`.replace(/\s+/g, ' ').trim();
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

type StoredRow = {
  external_id: string | null;
  passage: string | null;
  question_text: string | null;
  skill: string | null;
  domain: string | null;
  section: string | null;
  difficulty: string | null;
  is_default: boolean | null;
};

type MatchReason = 'exact' | 'passage' | 'id';

export const checkRouter = createTRPCRouter({
  dedupe: protectedProcedure
    .input(z.object({ raw: z.string().min(1, 'Paste some JSON first.') }))
    .mutation(async ({ ctx, input }) => {
      // --- 1. Parse -----------------------------------------------------------
      let parsed: unknown;
      try {
        parsed = JSON.parse(input.raw);
      } catch (e) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `That isn't valid JSON: ${(e as Error).message}`,
        });
      }
      const items: unknown = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object'
          ? (parsed as Record<string, unknown>).questions ??
            (parsed as Record<string, unknown>).data ??
            (parsed as Record<string, unknown>).items
          : undefined;
      if (!Array.isArray(items)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Expected a JSON array of questions (or an object with a "questions" array).',
        });
      }
      const objects = items.filter(
        (x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x),
      );

      // --- 2. Load & fingerprint the stored bank (RLS-scoped) -----------------
      const stored = await fetchAllRows<StoredRow>((from, to) =>
        ctx.supabase
          .from('questions')
          .select('external_id, passage, question_text, skill, domain, section, difficulty, is_default')
          .order('id', { ascending: true })
          .range(from, to),
      );

      // Three indexes: whole-question (passage+prompt), passage-only, and id.
      const byFull = new Map<string, StoredRow>();
      const byPassage = new Map<string, StoredRow>();
      const byId = new Map<string, StoredRow>();
      for (const row of stored) {
        const p = fingerprint(row.passage);
        const q = fingerprint(row.question_text);
        if (p || q) byFull.set(`${p}${q}`, row);
        if (p) byPassage.set(p, row);
        if (row.external_id) byId.set(row.external_id.trim().toLowerCase(), row);
      }

      // --- 3. Match -----------------------------------------------------------
      const matched: Array<{
        index: number;
        reason: MatchReason;
        preview: string;
        stored: {
          skill: string | null;
          domain: string | null;
          section: string | null;
          difficulty: string | null;
          isDefault: boolean;
        };
      }> = [];
      const remaining: Record<string, unknown>[] = [];
      let noTextCount = 0;

      for (let index = 0; index < objects.length; index++) {
        const item = objects[index];
        const { passage, question } = textsFor(item);
        const ids = idsFor(item);
        const p = fingerprint(passage);
        const q = fingerprint(question);

        if (!p && !q && ids.length === 0) {
          noTextCount += 1;
          remaining.push(item);
          continue;
        }

        // Strongest: the whole question (passage + prompt) is already stored.
        let hit = p || q ? byFull.get(`${p}${q}`) : undefined;
        let reason: MatchReason = 'exact';
        // Next: an id lands on a stored row (definite same question).
        if (!hit) {
          const idHit = ids.map((id) => byId.get(id)).find(Boolean);
          if (idHit) {
            hit = idHit;
            reason = 'id';
          }
        }
        // Fallback: the passage alone already exists (same reading, maybe a
        // different prompt) — the "is this passage already here?" check.
        if (!hit && p) {
          hit = byPassage.get(p);
          reason = 'passage';
        }

        if (hit) {
          matched.push({
            index,
            reason,
            preview: preview(passage, question),
            stored: {
              skill: hit.skill,
              domain: hit.domain,
              section: hit.section,
              difficulty: hit.difficulty,
              isDefault: !!hit.is_default,
            },
          });
        } else {
          remaining.push(item);
        }
      }

      return {
        totalPasted: objects.length,
        totalStored: stored.length,
        matchedCount: matched.length,
        remainingCount: remaining.length,
        noTextCount,
        matched,
        remainingJson: JSON.stringify(remaining, null, 2),
      };
    }),
});
