/**
 * How long an answer may be (plan #2130.2).
 *
 * A limit is either set on the answer row (`application_answers.word_limit`,
 * always words) or written into the question by the employer: "(140
 * characters)", "200 words max", "in 150 to 200 words". The question's own
 * wording is read only where it says it is a limit, so "describe yourself in
 * three words" or "at least 100 words" is not taken for one.
 */

export type LimitUnit = 'words' | 'characters';

export type AnswerLimit = {
  count: number;
  unit: LimitUnit;
  /** Where it came from: the row's word_limit, or the question's wording. */
  from: 'set' | 'question';
};

const NUMBER = String.raw`(\d{1,3}(?:,\d{3})+|\d+)`;
/** A count, an optional range's upper end, and a unit. */
const COUNT = new RegExp(
  String.raw`${NUMBER}(?:\s*(?:-|–|—|to)\s*${NUMBER})?[\s-]*(words?|characters?|chars?)\b`,
  'gi',
);

/** Said just before the count: "max 200 words", "no more than 1,000 characters". */
const CUE_BEFORE =
  /\b(?:max(?:imum)?|limit(?:ed)?|up to|no more than|not (?:to )?exceed(?:ing)?|at most|under|fewer than|less than|within|keep (?:it|this|your answer) to)\b[^.?!]*$/;
/** Said just after it: "200 words max", "250 word limit", "100 words or less". */
const CUE_AFTER = /^\s*(?:max(?:imum)?|limit|or (?:less|fewer|under)|maximum)\b/;
/** A floor, which is not a limit. */
const FLOOR_BEFORE = /\b(?:at least|min(?:imum)?|(?<!no )more than)\b[^.?!]*$/;

function toNumber(raw: string): number {
  return Number(raw.replace(/,/g, ''));
}

/** The limit a question's own wording sets, or null when it sets none. */
export function limitFromQuestion(text: string): AnswerLimit | null {
  for (const match of text.matchAll(COUNT)) {
    const at = match.index ?? 0;
    const end = at + match[0].length;
    const before = text.slice(Math.max(0, at - 40), at).toLowerCase();
    const after = text.slice(end, end + 30).toLowerCase();

    if (FLOOR_BEFORE.test(before)) continue;
    const inParens = /\([^)]*$/.test(before) && /^[^(]*\)/.test(after);
    // A range ("150 to 200 words") is a length asked for, so its top is the limit.
    const range = match[2] !== undefined;
    if (!range && !inParens && !CUE_BEFORE.test(before) && !CUE_AFTER.test(after)) continue;

    const count = toNumber(match[2] ?? match[1]);
    if (!Number.isFinite(count) || count <= 0 || count > 100_000) continue;
    const unit: LimitUnit = /^w/i.test(match[3]) ? 'words' : 'characters';
    return { count, unit, from: 'question' };
  }
  return null;
}

/** The limit an answer is held to: the row's word_limit first, else the question's wording. */
export function answerLimit(wordLimit: number | null | undefined, question: string): AnswerLimit | null {
  if (typeof wordLimit === 'number' && wordLimit > 0) {
    return { count: wordLimit, unit: 'words', from: 'set' };
  }
  return limitFromQuestion(question);
}

/** "200 words" / "1,000 characters", for a prompt or a label. */
export function describeLimit(limit: AnswerLimit): string {
  return `${limit.count.toLocaleString('en-US')} ${limit.unit}`;
}
