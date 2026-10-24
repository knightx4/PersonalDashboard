import { isGuess, isMisconceptionCandidate, type MissKind } from '@/lib/learn/confidence';

/**
 * One hint before the answer (plan #2522.7).
 *
 * A wrong written answer to an applied case, a cell question, a piece's check
 * or a review question is not recorded straight away. The grader that marked
 * it wrong has also written a hint, aimed at where the answer or its reasoning
 * went wrong, and labelled the kind of miss. The page shows the hint and a box
 * to try again, with Show the answer beside it. The question is recorded once:
 * on the retry, right or wrong, or on Show the answer, which records the first
 * try as it was marked. The expected answer is shown only then.
 *
 * Until then the row holds the first try in `first_try` (migration
 * learn_0191), `hints_used` is 1 and `miss_kind` is the first miss's kind.
 *
 * A right answer after a hint counts as right, and the idea stays at the rung
 * it was on: it moves no state, writes no met and earns no longer gap, the
 * same as a right guess (`holdsRung`).
 *
 * Pure: no database, no model. The graders and the stores call it.
 */

/** How many hints a question gives before the answer. */
export const HINTS_PER_QUESTION = 1;

/** The kinds a grader may label a miss with, in the order the prompt names them. */
export const MISS_KINDS: readonly MissKind[] = ['cue', 'wrong_idea', 'slip', 'careless', 'misconception'];

/** The longest hint kept. One or two sentences fit well inside it. */
export const HINT_MAX = 400;

/**
 * What a grader's system prompt adds when the answer may earn a hint. Our own
 * wording: a direction to look in, never the answer.
 */
export const HINT_RULE = `WHEN THE ANSWER IS WRONG, ALSO WRITE ONE HINT AND NAME THE KIND OF MISS.
They will read the hint and try once more before they see the expected
answer, so the hint must leave the answer for them to find.

The hint is one sentence, two at most, spoken to them. Aim it at the point
where their answer, or the reasoning they gave, went off: the part of the
situation they passed over, the idea they reached for instead, the step that
slipped. Point in a direction: a thing to look at again, a question to ask
themselves, a part of the case to reread. Never state the expected answer,
never name the term or the number it turns on, and never say which option
or value is right. A hint that hands over the answer is thrown away.

The kind of miss is one of:
- cue: they did not pick up what the question was asking for, or missed a
  detail in it that decides the answer.
- wrong_idea: they used a different idea from the one the question needs.
- slip: the right idea, carried out with a mistake on the way.
- careless: they seem to know it, but the answer is rushed, cut short or
  answers something nearby.
- misconception: what they wrote rests on a wrong belief about the idea
  itself.

On a right answer leave both out.`;

/** A grader's system prompt with the hint rule after it. */
export function withHintRule(system: string): string {
  return `${system}\n\n${HINT_RULE}`;
}

/** The two properties a grader's tool takes when a hint is wanted. */
export const HINT_TOOL_PROPERTIES = {
  hint: {
    type: 'string',
    description: 'On a wrong answer only: one or two sentences pointing where to look again, without the answer.',
  },
  miss_kind: {
    type: 'string',
    enum: [...MISS_KINDS],
    description: 'On a wrong answer only: the kind of miss.',
  },
} as const;

/** A miss kind from a grader, or null when it gave none or one not on the list. */
export function readMissKind(value: unknown): MissKind | null {
  return typeof value === 'string' && (MISS_KINDS as readonly string[]).includes(value) ? (value as MissKind) : null;
}

function words(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Whether a hint gives the expected answer away by repeating it whole, with
 * case and punctuation ignored. Crude on purpose: it catches the hint that
 * copies the answer out, and the prompt does the rest.
 */
export function givesAnswerAway(hint: string, expected: string | null | undefined): boolean {
  const h = words(hint);
  const e = words(expected ?? '');
  return e !== '' && h.includes(e);
}

/**
 * The hint as kept: trimmed, cut to HINT_MAX, and null when the grader gave
 * none, gave an empty one, or gave the answer away.
 */
export function readHint(value: unknown, expected?: string | null): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '') return null;
  if (givesAnswerAway(text, expected)) return null;
  return text.length > HINT_MAX ? `${text.slice(0, HINT_MAX - 1).trimEnd()}…` : text;
}

/** What a grader hands back beside its verdict when a hint was asked for. */
export type GraderHint = { hint: string | null; missKind: MissKind | null };

/** What the row keeps while the hint is on screen. */
export type FirstTry = {
  response: string;
  /** The marker's sentence on the first try. */
  why: string | null;
  hint: string;
  kind: MissKind | null;
  /** A cell question's verdicts on the first try, as its `grade` column keeps them. */
  grade?: unknown;
  /** Set when Show the answer recorded the first try. */
  revealed?: boolean;
};

/** The first try off a row, or null when there is none or it cannot be read. */
export function readFirstTry(value: unknown): FirstTry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.response !== 'string' || row.response.trim() === '') return null;
  if (typeof row.hint !== 'string' || row.hint.trim() === '') return null;
  return {
    response: row.response,
    why: typeof row.why === 'string' && row.why.trim() !== '' ? row.why : null,
    hint: row.hint,
    kind: readMissKind(row.kind),
    ...(row.grade !== undefined ? { grade: row.grade } : {}),
    ...(row.revealed === true ? { revealed: true } : {}),
  };
}

/** The hint and the first try, as the page is given them while a retry is open. */
export type HintView = { hint: string; response: string };

export function hintView(first: FirstTry | null): HintView | null {
  return first ? { hint: first.hint, response: first.response } : null;
}

/**
 * Whether a graded answer earns the hint rather than being recorded: wrong,
 * no hint given yet, and a usable hint written. A miss with no usable hint is
 * recorded as it is, with the answer shown.
 */
export function earnsHint(input: { correct: boolean; hintsUsed: number; hint: string | null }): boolean {
  return !input.correct && input.hintsUsed < HINTS_PER_QUESTION && input.hint !== null;
}

/** Whether a grader should be asked for a hint on this answer: none given yet. */
export function wantsHint(hintsUsed: number | null | undefined): boolean {
  return (hintsUsed ?? 0) < HINTS_PER_QUESTION;
}

/** The hints_used column off a row, which can arrive as text. */
export function readHintsUsed(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Whether a recorded answer leaves the idea at the rung it was on: right, but
 * a guess, or right only after a hint. Either way it shows less than a right
 * answer given unaided, so nothing moves up.
 */
export function holdsRung(input: { correct: boolean; confidence: number | null | undefined; hintsUsed: number }): boolean {
  return input.correct && (isGuess(input.confidence) || input.hintsUsed > 0);
}

/**
 * The miss kind a row keeps: a sure wrong answer is a misconception candidate
 * whatever the grader called it (plan #2522.3); otherwise the grader's label,
 * and null on a right answer.
 */
export function missKindOf(input: {
  correct: boolean;
  confidence: number | null | undefined;
  graderKind: MissKind | null;
}): MissKind | null {
  if (input.correct) return null;
  if (isMisconceptionCandidate({ correct: false, confidence: input.confidence })) return 'misconception';
  return input.graderKind;
}

/**
 * The lines a retry's grading prompt carries: the first try and the hint it
 * was given, so the grader reads the second answer as a second answer.
 */
export function retryLines(first: FirstTry | null): string[] {
  if (!first) return [];
  return [
    'This is their second try. Their first answer was marked wrong:',
    first.response,
    'They were then given this hint:',
    first.hint,
    'Grade the second answer on its own merits, exactly as you would a first answer.',
  ];
}

/** The line an answered question shows when a hint came before it, or null when none did. */
export function hintedLine(input: { correct: boolean | null; hintsUsed: number; revealed?: boolean }): string | null {
  if (input.hintsUsed <= 0 || input.correct === null) return null;
  if (input.correct) return 'After a hint, so it counts and the idea stays where it was until you get one without.';
  if (input.revealed) return 'You asked for the answer after the hint.';
  return 'Not after the hint either.';
}

/** What a question shows about its hint, read off its row. */
export type RowHint = {
  /** While a retry is open: the hint and the first try. Null once answered or when none was given. */
  hint: HintView | null;
  /** Hints given before the answer. */
  hintsUsed: number;
  /** Recorded by Show the answer. */
  revealed: boolean;
};

/** The hint fields off a stored question, which has `hints_used` and `first_try` (migrations learn_0190, learn_0191). */
export function rowHint(row: { hints_used?: unknown; first_try?: unknown }, answered: boolean): RowHint {
  const first = readFirstTry(row.first_try);
  return {
    hint: answered ? null : hintView(first),
    hintsUsed: readHintsUsed(row.hints_used),
    revealed: answered && first?.revealed === true,
  };
}
