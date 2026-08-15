import type { QuestionDomain } from '@/utils/question-bank-parser';

/**
 * Official Digital SAT Reading & Writing domain distribution, from College
 * Board's assessment specifications. A full R&W section is 54 questions; a
 * single module is 27. These weights are per-section proportions and hold at
 * any total.
 *
 *   Craft and Structure            ~28%
 *   Information and Ideas          ~26%
 *   Standard English Conventions   ~26%
 *   Expression of Ideas            ~20%
 */
export const DSAT_DOMAIN_WEIGHTS: Record<QuestionDomain, number> = {
  craft_and_structure: 0.28,
  information_and_ideas: 0.26,
  standard_english_conventions: 0.26,
  expression_of_ideas: 0.2,
};

/** One R&W module. The default a "DSAT Standard" module offers. */
export const DSAT_MODULE_QUESTIONS = 27;

/**
 * The order the four R&W domains actually appear in within a real Bluebook
 * module — questions are grouped in domain blocks in this exact sequence, and
 * within a block roughly easy→hard. This differs from `DOMAIN_ORDER` above,
 * which is the browse-page display order, not the on-exam question order. Used
 * to lay out a built exam module so it reads like the real thing.
 *
 *   1. Craft and Structure
 *   2. Information and Ideas
 *   3. Standard English Conventions
 *   4. Expression of Ideas
 */
export const RW_MODULE_DOMAIN_ORDER: QuestionDomain[] = [
  'craft_and_structure',
  'information_and_ideas',
  'standard_english_conventions',
  'expression_of_ideas',
];

export const DOMAIN_ORDER: QuestionDomain[] = [
  'information_and_ideas',
  'craft_and_structure',
  'expression_of_ideas',
  'standard_english_conventions',
];

/** The four math domains, in the order College Board lists them. */
export type MathDomain =
  | 'algebra'
  | 'advanced_math'
  | 'problem_solving_data_analysis'
  | 'geometry_trigonometry';

export const MATH_DOMAIN_ORDER: MathDomain[] = [
  'algebra',
  'advanced_math',
  'problem_solving_data_analysis',
  'geometry_trigonometry',
];

/**
 * Official Digital SAT Math domain distribution. A full Math section is 44
 * questions; a single module is 22.
 *
 *   Algebra                            ~35%
 *   Advanced Math                      ~35%
 *   Problem-Solving & Data Analysis    ~15%
 *   Geometry & Trigonometry            ~15%
 */
export const MATH_DOMAIN_WEIGHTS: Record<MathDomain, number> = {
  algebra: 0.35,
  advanced_math: 0.35,
  problem_solving_data_analysis: 0.15,
  geometry_trigonometry: 0.15,
};

/** One Math module. */
export const MATH_MODULE_QUESTIONS = 22;

export type Section = 'reading_writing' | 'math';

/** Ordered domain enum values for a section — the axis every page groups by. */
export function domainOrderFor(section: Section): string[] {
  return section === 'math' ? MATH_DOMAIN_ORDER : DOMAIN_ORDER;
}
