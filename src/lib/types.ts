/** Domain model — shaped so a Supabase backend can slot in behind the same types. */

export type Domain =
  | 'Information & Ideas'
  | 'Craft & Structure'
  | 'Expression of Ideas'
  | 'Standard English Conventions';

export interface Skill {
  id: string;
  name: string;
  domain: Domain;
}

export type OptionIndex = 0 | 1 | 2 | 3;

export interface Question {
  id: string;
  bankId: string;
  skillId: string;
  /** Short passage or sentence context. Empty string when the stem stands alone. */
  passage: string;
  stem: string;
  options: [string, string, string, string];
  correctIndex: OptionIndex;
  explanation: string;
}

export interface QuestionBank {
  id: string;
  name: string;
  description: string;
  questionCount: number;
  skillIds: string[];
  /** Latest score on this bank, null if never attempted. */
  lastScorePct: number | null;
}

export interface DomainScore {
  domain: Domain;
  correct: number;
  total: number;
}

export interface TestRecord {
  id: string;
  bankId: string;
  bankName: string;
  dateISO: string;
  scorePct: number;
  sections: DomainScore[];
}

export interface SkillAccuracy {
  skillId: string;
  name: string;
  domain: Domain;
  accuracyPct: number;
  attempted: number;
}

export type Charge = 'positive' | 'negative' | 'neutral';

export interface VocabEntry {
  id: string;
  word: string;
  /** Sentence containing the word; the word itself is matched for highlighting. */
  sentence: string;
  charge: Charge;
  definition: string;
  root: string;
}

export interface ProgressPoint {
  dateISO: string;
  overallPct: number;
  byDomain: Record<Domain, number>;
}

/** A completed sitting, produced by the test engine and read by the results page. */
export interface TestResult {
  bankId: string;
  bankName: string;
  dateISO: string;
  minutes: number;
  questions: Question[];
  answers: (OptionIndex | null)[];
  flagged: boolean[];
  scorePct: number;
  sections: DomainScore[];
}
