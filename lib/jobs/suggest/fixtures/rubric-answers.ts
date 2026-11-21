import { CHANCE_QUESTIONS, FIT_QUESTIONS } from '../rubric';

/**
 * Jev's answers to every rubric question, for the tests: each score factor at
 * `level` (held to its top level), pay not given, no dealbreaker or blocker.
 */
export function rubricAnswers(level: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const [key, question] of Object.entries({ ...FIT_QUESTIONS, ...CHANCE_QUESTIONS })) {
    if (question.type === 'score') answers[key] = { score: Math.min(level, question.levels.length - 1), confidence: 0.6 };
    else if (question.type === 'yes-no') answers[key] = { noul: 0.1 };
    else answers[key] = { choice: 'not_given', confidence: 0.9, probabilities: { not_given: 0.9 } };
  }
  return { ...answers, ...overrides };
}
