/**
 * How sure you were and how you reasoned, as the graders and the state rules
 * read them (plan #2522.3).
 *
 * Every question in Learn can carry two optional signals beside the answer:
 * a confidence from 0 to 1, which the page stores as one of four steps, and a
 * line or two of reasoning. Both are stored on the answered row (migration
 * learn_0190) and both reach the grader. Three rules follow from them:
 *
 * - A right answer at Guessing leaves the idea where it was. It is recorded
 *   as right, but it moves no state and writes no `met` (`isGuess`).
 * - A right answer whose reasoning contradicts it is graded wrong, with the
 *   grader's sentence saying why (`REASONING_RULE`, `signalLines`).
 * - A wrong answer at Fairly sure or Certain is a misconception candidate,
 *   written to the row's `miss_kind` as 'misconception' for the next step to
 *   name (`isMisconceptionCandidate`, `missKindFor`).
 *
 * Pure: no database, no model. The stores and the graders call it.
 */

/** The four steps the page offers, as stored. */
export const CONFIDENCE = {
  guessing: 0.25,
  unsure: 0.5,
  fairlySure: 0.75,
  certain: 0.95,
} as const;

/** At or below this, an answer is a guess. */
export const GUESS_MAX = CONFIDENCE.guessing;

/** At or above this, a wrong answer is a misconception candidate. */
export const MISCONCEPTION_CANDIDATE_MIN = CONFIDENCE.fairlySure;

/** The longest reasoning kept, the same cap a written answer has. */
export const REASONING_MAX = 2000;

/** What can come with an answer. Both optional; absent means not given. */
export type AnswerSignals = {
  confidence?: number | null;
  reasoning?: string | null;
};

/** The signals as stored: each one given or null. */
export type CleanSignals = { confidence: number | null; reasoning: string | null };

/** A confidence from a form or a caller: a number from 0 to 1, or null. */
export function readConfidence(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  return n;
}

/** Reasoning from a form or a caller: trimmed text, cut to REASONING_MAX, or null when empty. */
export function readReasoning(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '') return null;
  return text.slice(0, REASONING_MAX);
}

/** Both signals cleaned, from whatever the caller passed. */
export function cleanSignals(signals?: AnswerSignals | null): CleanSignals {
  return {
    confidence: readConfidence(signals?.confidence),
    reasoning: readReasoning(signals?.reasoning),
  };
}

/**
 * The signals off a submitted form, from fields named `confidence` and
 * `reasoning`. A form without them gives nulls, so a page that does not ask
 * yet answers exactly as before.
 */
export function readAnswerSignals(formData: FormData): CleanSignals {
  return {
    confidence: readConfidence(formData.get('confidence')),
    reasoning: readReasoning(formData.get('reasoning')),
  };
}

/** Whether the answer was given as a guess. No confidence given is not a guess. */
export function isGuess(confidence: number | null | undefined): boolean {
  return typeof confidence === 'number' && confidence <= GUESS_MAX;
}

/**
 * Whether a miss is a misconception candidate: wrong, at Fairly sure or
 * Certain. Being sure and wrong says a wrong idea is held, rather than a gap,
 * so it is named straight away instead of waiting for the same wrong answer
 * twice. The next step (plan #2522.4) reads this off `miss_kind`.
 */
export function isMisconceptionCandidate(answer: { correct: boolean; confidence: number | null | undefined }): boolean {
  return !answer.correct && typeof answer.confidence === 'number' && answer.confidence >= MISCONCEPTION_CANDIDATE_MIN;
}

/** The kinds of miss migration learn_0190 allows in `miss_kind`. */
export type MissKind = 'cue' | 'wrong_idea' | 'slip' | 'careless' | 'misconception';

/**
 * What goes in the row's `miss_kind` when the answer is recorded: 'misconception'
 * for a candidate, otherwise null, so a miss nothing has judged stays unjudged.
 */
export function missKindFor(answer: { correct: boolean; confidence: number | null | undefined }): MissKind | null {
  return isMisconceptionCandidate(answer) ? 'misconception' : null;
}

/**
 * The columns an answered row takes from the signals. Only what was given is
 * written, so a caller that passes nothing leaves the row's own values alone.
 */
export function signalColumns(
  signals: CleanSignals,
  correct: boolean,
): { confidence?: number; reasoning?: string; miss_kind?: MissKind } {
  const kind = missKindFor({ correct, confidence: signals.confidence });
  return {
    ...(signals.confidence !== null && { confidence: signals.confidence }),
    ...(signals.reasoning !== null && { reasoning: signals.reasoning }),
    ...(kind !== null && { miss_kind: kind }),
  };
}

/** The step a confidence reads as, in the page's words. */
export function confidenceWords(confidence: number): 'Guessing' | 'Unsure' | 'Fairly sure' | 'Certain' {
  if (confidence <= (CONFIDENCE.guessing + CONFIDENCE.unsure) / 2) return 'Guessing';
  if (confidence < (CONFIDENCE.unsure + CONFIDENCE.fairlySure) / 2) return 'Unsure';
  if (confidence < (CONFIDENCE.fairlySure + CONFIDENCE.certain) / 2) return 'Fairly sure';
  return 'Certain';
}

/**
 * The lines a grader's prompt carries for the signals, after the answer.
 * Empty when neither was given, so a prompt without them is unchanged.
 */
export function signalLines(signals: AnswerSignals | null | undefined): string[] {
  const { confidence, reasoning } = cleanSignals(signals);
  const lines: string[] = [];
  if (confidence !== null) {
    lines.push(`How sure they said they were: ${confidenceWords(confidence)}. This is context only; it does not change the grade.`);
  }
  if (reasoning !== null) lines.push('Their reasoning, written beside the answer:', reasoning);
  return lines;
}

/**
 * What a grader's system prompt adds when reasoning may come with the answer.
 * Appended to each grader's own prompt rather than written into it, so the
 * rule reads the same in every one.
 */
export const REASONING_RULE = `WHEN THEIR REASONING IS GIVEN, READ IT WITH THE ANSWER. If the reasoning
contradicts the answer, or reaches it by an idea that is wrong, the answer is
wrong however right the result looks: grade it wrong and say in your sentence
which part of the reasoning does not hold. Reasoning that is short, rough or
incomplete but consistent with a right answer changes nothing. How sure they
said they were never changes the grade.`;

/** A grader's system prompt with the reasoning rule after it. */
export function withReasoningRule(system: string): string {
  return `${system}\n\n${REASONING_RULE}`;
}
