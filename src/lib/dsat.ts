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

export const DOMAIN_ORDER: QuestionDomain[] = [
  'information_and_ideas',
  'craft_and_structure',
  'expression_of_ideas',
  'standard_english_conventions',
];
