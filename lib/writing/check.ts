import type { SpendSink } from '@/lib/core/spend/pricing';
import { askJevAll, type JevFailure, type JevQuestion } from '@/lib/jev/wire';

/**
 * Score text Dash writes against docs/WRITING-GUIDE.md (plan #1175).
 *
 * Six of the guide's failure patterns, each asked of Jev as a yes/no question
 * in one request. A few of them also have a plain rule that recognises the
 * guide's own examples ("not X, it's Y", "not only X but also Y", repeated em
 * dashes, a "Label: explanation" title), so the check still says something
 * when Jev is off, unreachable or unsure. A pattern's score is Jev's
 * probability that the text shows it, or 1 when a rule matched.
 *
 * It only warns. The guide treats these as signals rather than forbidden
 * tokens, and Jev scores against its examples, so it will flag some text a
 * person would accept. Nothing here refuses a write, and a failed call is the
 * same as a clean score.
 *
 * No `server-only` guard, so scripts/plan.ts can run it under plain `tsx`.
 */

export type WritingPattern =
  | 'inflated_contrast'
  | 'em_dashes'
  | 'slogan'
  | 'colon_title'
  | 'stock_formula'
  | 'restating';

/**
 * The text to score, by field. `title` is the one field the colon-title rule
 * reads; the rest (detail, done-when, a note, a reply) are read as prose.
 * Empty fields are left out of what Jev reads.
 */
export type WritingText = Readonly<Record<string, string | null | undefined>>;

type PatternSpec = {
  /** How the warning names it. */
  label: string;
  question: string;
  /** A rule for the guide's own examples of it, where one can be written. */
  rule?: (text: WritingText) => boolean;
};

/**
 * The fields the rules read, joined, with quoted spans taken out: a row that
 * quotes "not X, it's Y" is naming the pattern, not using it. Jev reads the
 * text as written.
 */
function prose(text: WritingText): string {
  return Object.values(text)
    .filter((value): value is string => typeof value === 'string')
    .join('\n')
    .replace(/"[^"\n]*"|“[^”\n]*”/g, '""');
}

const INFLATED_CONTRAST = [
  // "This isn't just a calendar", "is not merely a detail".
  /\b(?:is|are|was|were|does|do)(?:n['’]t| not) (?:just|only|merely|simply)\b/i,
  // "not X, it's Y" and "not a detail; it is the heart of".
  /\bnot [^.;:!?\n]{1,50}[,;]\s*(?:it|this|that|they)(?:['’](?:s|re)| is| are)\b/i,
  // "It's not X. It's Y." and "This isn't X - it's Y."
  /\b(?:it|this|that)(?:['’]s not| is not| isn['’]t) [^.;:!?\n]{1,50}(?:[.;,]|\s[-–—]{1,2})\s*(?:it|this|that)(?:['’]s| is)\b/i,
];

const STOCK_FORMULA = [/\bnot (?:only|just)\b[^.\n]{1,80}\bbut(?: also)?\b/i];

/** Two or more em dashes, en dashes or spaced double hyphens used as dashes. */
function dashCount(text: string): number {
  return (text.match(/—|\s–\s|\s--\s/g) ?? []).length;
}

export const WRITING_PATTERNS: Readonly<Record<WritingPattern, PatternSpec>> = {
  inflated_contrast: {
    label: 'inflated contrast',
    question:
      'Does the text use inflated contrast to make a point sound bigger than it is, such as ' +
      '"this isn\'t just X, it\'s Y", "it\'s not X, it\'s Y" or "X is not a detail. It\'s the ' +
      'heart of Y"? A plain distinction such as "the bug is in the parser, not the tokenizer" ' +
      'does not count.',
    rule: (text) => INFLATED_CONTRAST.some((pattern) => pattern.test(prose(text))),
  },
  em_dashes: {
    label: 'em dashes for rhythm',
    question:
      'Does the text use em dashes or spaced dashes to add rhythm, emphasis or an ' +
      'interruption, where a comma, a full stop or a plain sentence would read better?',
    rule: (text) => dashCount(prose(text)) >= 2,
  },
  slogan: {
    label: 'slogan',
    question:
      'Does the text use a slogan-like fragment or staged cadence in place of a plain ' +
      'sentence, such as "One team. One vision.", "Win the close. Keep the evidence." or ' +
      '"From paper forms to a shared workspace."?',
  },
  colon_title: {
    label: 'colon title',
    question:
      'Is the title written as "Label: explanation", or does the text chain short label-colon ' +
      'clauses such as "Universities: reinforce guidance. Students: reduce contact."?',
    rule: (text) => /^[^:\n]{1,40}:\s+\S/.test(text.title?.trim() ?? ''),
  },
  stock_formula: {
    label: 'stock formula',
    question:
      'Does the text use a stock formula such as "not only X, but also Y", a triad like ' +
      '"faster, smarter and more intuitive", balance without a real tradeoff such as "while X ' +
      'offers A, it also presents B", or a canned ending about challenges or the future?',
    rule: (text) => STOCK_FORMULA.some((pattern) => pattern.test(prose(text))),
  },
  restating: {
    label: 'restating the request',
    question:
      'Does the text open by restating the request, setting a generic scene or announcing ' +
      'itself, such as "When it comes to X, there are several things to consider" or "Below ' +
      'is a comprehensive rewrite", before getting to the point?',
  },
};

export const WRITING_PATTERN_IDS = Object.keys(WRITING_PATTERNS) as WritingPattern[];

/**
 * A pattern is warned about at this score. For a Jev answer it is a yes at
 * the app's 0.8 confidence floor (confidence is |2p - 1|, so p = 0.9); a rule
 * match scores 1. Set from scripts/writing-scores.ts over the last 100 plan
 * rows, where clean rows sat well under it.
 */
export const WRITING_WARN_AT = 0.9;

/**
 * At this score the warning is also written into the row's comment, so a
 * person reading the row sees it. Higher than the warning, since it stays.
 */
export const WRITING_NOTE_AT = 0.97;

export type PatternScore = {
  pattern: WritingPattern;
  score: number;
  /** Which gave the score: Jev's probability, or a rule's match. */
  by: 'jev' | 'rule';
};

export type WritingScore = {
  scores: PatternScore[];
  /** Why Jev was not heard from, when it was not. */
  jevFailure: JevFailure['reason'] | 'not-enabled' | null;
};

export const WRITING_QUESTIONS: Readonly<Record<WritingPattern, JevQuestion>> = Object.fromEntries(
  WRITING_PATTERN_IDS.map((id) => [id, { type: 'yes-no', question: WRITING_PATTERNS[id].question }]),
) as Record<WritingPattern, JevQuestion>;

/** What Jev reads: the non-empty fields, or null when there is nothing to read. */
export function writingState(text: WritingText): Record<string, string> | null {
  const state: Record<string, string> = {};
  for (const [field, value] of Object.entries(text)) {
    const trimmed = value?.trim();
    if (trimmed) state[field] = trimmed;
  }
  return Object.keys(state).length > 0 ? state : null;
}

/** The rules alone: 1 where one matched, 0 elsewhere. */
export function ruleScores(text: WritingText): PatternScore[] {
  return WRITING_PATTERN_IDS.map((pattern) => ({
    pattern,
    score: WRITING_PATTERNS[pattern].rule?.(text) ? 1 : 0,
    by: 'rule' as const,
  }));
}

export type CheckWritingInput = {
  text: WritingText;
  /** False for an account that has not agreed to send text to TypeSafe: rules only. */
  enabled?: boolean;
  onSpend?: SpendSink;
  apiKey?: string | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

/**
 * Score the text on every pattern. Never throws. Each pattern takes the higher
 * of Jev's probability and the rule's match, so a rule catches the guide's own
 * examples whether or not Jev is reachable.
 */
export async function checkWriting(input: CheckWritingInput): Promise<WritingScore> {
  const rules = ruleScores(input.text);
  const state = writingState(input.text);
  if (!state) return { scores: rules, jevFailure: null };
  if (input.enabled === false) return { scores: rules, jevFailure: 'not-enabled' };

  const asked = await askJevAll({
    state,
    questions: WRITING_QUESTIONS,
    onSpend: input.onSpend,
    apiKey: input.apiKey,
    fetch: input.fetch,
    timeoutMs: input.timeoutMs,
  });
  if (!asked.ok) return { scores: rules, jevFailure: asked.reason };

  const scores = rules.map((rule): PatternScore => {
    const answer = asked.answers[rule.pattern];
    if (!answer.ok || answer.answer.type !== 'yes-no') return rule;
    const probability = answer.answer.probability;
    return rule.score >= probability ? rule : { pattern: rule.pattern, score: probability, by: 'jev' };
  });
  return { scores, jevFailure: null };
}

/** The patterns at or over a score, highest first. */
export function flaggedAt(result: WritingScore, at: number): PatternScore[] {
  return result.scores.filter((s) => s.score >= at).sort((a, b) => b.score - a.score);
}

function describe(flagged: readonly PatternScore[]): string {
  return flagged
    .map((s) => `${WRITING_PATTERNS[s.pattern].label} (${s.by === 'rule' ? 'rule' : s.score.toFixed(2)})`)
    .join(', ');
}

/** The line printed to the session, or null when nothing reached the warning. */
export function writingWarning(result: WritingScore): string | null {
  const flagged = flaggedAt(result, WRITING_WARN_AT);
  if (flagged.length === 0) return null;
  return `Writing check: ${describe(flagged)}. See docs/WRITING-GUIDE.md.`;
}

/** The one-line note for the row's comment, or null when nothing reached it. */
export function writingNote(result: WritingScore, date: string): string | null {
  const flagged = flaggedAt(result, WRITING_NOTE_AT);
  if (flagged.length === 0) return null;
  return `Writing check ${date}: ${describe(flagged)}.`;
}
