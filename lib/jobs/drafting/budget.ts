/**
 * Cutting gathered material to size (plan #2130.2).
 *
 * Every part of what an application's drafts draw on has a budget in
 * characters, so the whole stays well inside one model call however much the
 * person has written. A text past its budget is cut at a word and says it was
 * cut; a list past its budget keeps items in the order given (the caller puts
 * the best first) and counts what it left out.
 */

/** Characters per part. Their sum is GATHER_BUDGET less room for headings. */
export const BUDGETS = {
  posting: 8_000,
  companyResearch: 3_000,
  perspective: 3_000,
  earlierLetters: 4_000,
  earlierLetter: 2_000,
  researchWriteUp: 6_000,
  notes: 3_000,
  requirements: 4_000,
  evidence: 30_000,
  evidenceItem: 1_500,
  resume: 12_000,
  pastAnswers: 15_000,
  pastAnswer: 1_500,
  thoughts: 6_000,
  thought: 1_200,
  style: 3_000,
  questions: 15_000,
  currentAnswer: 3_000,
  vault: 8_000,
  vaultPassage: 1_200,
  comments: 6_000,
  comment: 1_000,
  /** A comment on the letter can be a whole letter pasted as the model to follow. */
  letterComment: 3_000,
} as const;

/**
 * The most the rendered material may run to: about 32,500 tokens, which
 * leaves the rest of a call for the instructions and every answer drafted.
 */
export const GATHER_BUDGET = 130_000;

/** The marker a cut text ends with. */
export const CUT_MARK = ' […]';

/** The text, cut at a word to at most `max` characters (the marker included). */
export function cutText(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const room = Math.max(0, max - CUT_MARK.length);
  const head = trimmed.slice(0, room);
  const space = head.lastIndexOf(' ');
  // Cut at the last word break unless that throws away most of the room.
  const kept = space > room * 0.6 ? head.slice(0, space) : head;
  return `${kept.trimEnd()}${CUT_MARK}`;
}

/** The text cut to `max`, or null when there is none. */
export function cutOptional(text: string | null | undefined, max: number): string | null {
  const trimmed = text?.trim();
  return trimmed ? cutText(trimmed, max) : null;
}

/**
 * The items, in the order given, that fit in `budget` characters by `size`.
 * Stops at the first that does not fit, so a long item never lets a later
 * short one jump the order.
 */
export function fitToBudget<T>(
  items: readonly T[],
  size: (item: T) => number,
  budget: number,
): { kept: T[]; omitted: number } {
  const kept: T[] = [];
  let used = 0;
  for (const item of items) {
    const next = size(item);
    if (used + next > budget) break;
    kept.push(item);
    used += next;
  }
  return { kept, omitted: items.length - kept.length };
}
