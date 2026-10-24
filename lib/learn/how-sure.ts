import { CONFIDENCE, readConfidence, readReasoning } from '@/lib/learn/confidence';

/**
 * How sure you are, and how you got there, as the screens ask and show it
 * (plan #2522.2): Practice, a subject's questions, a piece's check and
 * review. The values and the rules are in lib/learn/confidence.ts (plan
 * #2522.3), which also writes them; this is the page's side: the four
 * choices in the page's words, and a stored row read back for the answered
 * question.
 *
 * Four rather than a finer scale: they are quicker to press on a phone and
 * still tell a guess from a certainty, which is what grading reads them for.
 */

export type HowSureKey = 'guessing' | 'unsure' | 'fairly' | 'certain';

export const HOW_SURE: ReadonlyArray<{ key: HowSureKey; label: string; value: number }> = [
  { key: 'guessing', label: 'Guessing', value: CONFIDENCE.guessing },
  { key: 'unsure', label: 'Unsure', value: CONFIDENCE.unsure },
  { key: 'fairly', label: 'Fairly sure', value: CONFIDENCE.fairlySure },
  { key: 'certain', label: 'Certain', value: CONFIDENCE.certain },
];

/** What was given with an answer. Null on either side when it was left out. */
export type HowSure = { confidence: number | null; reasoning: string | null };

export const NO_HOW_SURE: HowSure = { confidence: null, reasoning: null };

export { REASONING_MAX } from '@/lib/learn/confidence';

/** The choice a stored confidence reads as: the nearest of the four, or null. */
export function howSureChoice(confidence: number | null | undefined): (typeof HOW_SURE)[number] | null {
  if (confidence === null || confidence === undefined || !Number.isFinite(confidence)) return null;
  let best = HOW_SURE[0];
  for (const choice of HOW_SURE) {
    if (Math.abs(choice.value - confidence) < Math.abs(best.value - confidence)) best = choice;
  }
  return best;
}

/** What a stored row says, with the numeric column (which can arrive as text) read as a number. */
export function rowHowSure(row: { confidence?: unknown; reasoning?: unknown }): HowSure {
  return { confidence: readConfidence(row.confidence), reasoning: readReasoning(row.reasoning) };
}

