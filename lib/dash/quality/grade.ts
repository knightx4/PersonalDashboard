import type { TalkCitation, TalkToolCall } from '@/lib/talk/talk';
import { LOOKUP_NOT_RUN } from '@/lib/talk/talk';

/**
 * Grading one answer of the nightly Dash check (supabase/migrations/0277).
 *
 * Every answer is held to the same floor: Dash answered in words, did not fall
 * back to "I could not finish", was not cut off by a limit, and no lookup
 * broke. A case's `expect` adds what this question's answer must show. The
 * text checks ignore case, and a name counts as shown when it is in the
 * answer's words or in the title of a row it cites.
 */

export type CaseExpect = {
  /** Every one of these must be in the answer. */
  mentions_all?: string[];
  /** At least one of these must be in the answer. */
  mentions_any?: string[];
  /** None of these may be in the answer: a wrong row, a refusal, a vendor name. */
  mentions_none?: string[];
  /** At least one cited row's title must contain one of these. */
  cites_any?: string[];
  /** The most lookups the answer may take. */
  max_lookups?: number;
  /** The most seconds the answer may take. */
  max_seconds?: number;
  /** True when a failed lookup is expected and the answer is graded on its words alone. */
  allow_failed_lookups?: boolean;
};

/** What one run of a case gave back. */
export type CaseOutcome =
  | {
      ok: true;
      body: string;
      stop: string;
      citations: readonly TalkCitation[];
      toolCalls: readonly TalkToolCall[];
      seconds: number;
    }
  | { ok: false; detail: string; toolCalls: readonly TalkToolCall[]; seconds: number };

/** The opening of the answer built when the model wrote none (lib/dash/loop.ts answerFromLookups). */
export const UNFINISHED_OPENING = 'I could not finish this answer';

/** Sentences limitNote ends an answer with when a limit cut it short. */
export const LIMIT_MARKS = ['I stopped after', 'I stopped looking before I had checked everything'];

/** Words that are never right in front of the person (CLAUDE.md: the assistant is Dash). */
const NEVER_SAID = ['Claude'];

function parsedList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
  return list.length > 0 ? list : undefined;
}

function parsedNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** A case's expect column, kept to the fields it knows. */
export function parseExpect(raw: unknown): CaseExpect {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    mentions_all: parsedList(r.mentions_all),
    mentions_any: parsedList(r.mentions_any),
    mentions_none: parsedList(r.mentions_none),
    cites_any: parsedList(r.cites_any),
    max_lookups: parsedNumber(r.max_lookups),
    max_seconds: parsedNumber(r.max_seconds),
    allow_failed_lookups: r.allow_failed_lookups === true,
  };
}

function failedLookups(calls: readonly TalkToolCall[]): { name: string; error: string }[] {
  return calls.flatMap((call) => {
    const result = call.result as { ok?: unknown; error?: unknown } | undefined;
    if (!result || result.ok !== false) return [];
    const error = typeof result.error === 'string' ? result.error : 'no reason given';
    if (error === LOOKUP_NOT_RUN) return [];
    return [{ name: call.name, error: error.replace(/\s+/g, ' ').slice(0, 200) }];
  });
}

function skippedLookups(calls: readonly TalkToolCall[]): number {
  return calls.filter((call) => (call.result as { error?: unknown } | undefined)?.error === LOOKUP_NOT_RUN).length;
}

/** Each way the answer fell short, in a sentence; empty when it passed. */
export function gradeAnswer(expect: CaseExpect, outcome: CaseOutcome): string[] {
  const failures: string[] = [];
  if (!outcome.ok) return [`No answer: ${outcome.detail}`];

  const body = outcome.body.trim();
  const lower = body.toLowerCase();
  const cited = outcome.citations.map((c) => c.title.toLowerCase());
  const shown = (text: string) => {
    const t = text.toLowerCase();
    return lower.includes(t) || cited.some((title) => title.includes(t));
  };

  if (!body) failures.push('The answer is empty.');
  if (body.startsWith(UNFINISHED_OPENING)) failures.push('Dash fell back to "I could not finish this answer".');
  if (outcome.stop !== 'answered') failures.push(`The answer stopped as "${outcome.stop}", not answered.`);
  if (LIMIT_MARKS.some((mark) => body.includes(mark))) failures.push('A limit cut the answer short.');
  for (const word of NEVER_SAID) {
    if (new RegExp(`\\b${word}\\b`).test(body)) failures.push(`The answer says "${word}".`);
  }

  if (!expect.allow_failed_lookups) {
    for (const failed of failedLookups(outcome.toolCalls)) {
      failures.push(`Lookup ${failed.name} failed: ${failed.error}`);
    }
  }
  const skipped = skippedLookups(outcome.toolCalls);
  if (skipped > 0) failures.push(`${skipped} lookup${skipped === 1 ? ' was' : 's were'} refused at a limit.`);

  for (const text of expect.mentions_all ?? []) {
    if (!shown(text)) failures.push(`The answer does not mention "${text}".`);
  }
  if (expect.mentions_any && !expect.mentions_any.some(shown)) {
    failures.push(`The answer mentions none of ${expect.mentions_any.map((t) => `"${t}"`).join(', ')}.`);
  }
  for (const text of expect.mentions_none ?? []) {
    if (lower.includes(text.toLowerCase())) failures.push(`The answer says "${text}", which it should not.`);
  }
  if (expect.cites_any && !expect.cites_any.some((t) => cited.some((title) => title.includes(t.toLowerCase())))) {
    failures.push(`No cited row matches ${expect.cites_any.map((t) => `"${t}"`).join(', ')}.`);
  }
  const lookups = outcome.toolCalls.length;
  if (expect.max_lookups !== undefined && lookups > expect.max_lookups) {
    failures.push(`It took ${lookups} lookup${lookups === 1 ? '' : 's'}, more than ${expect.max_lookups}.`);
  }
  if (expect.max_seconds !== undefined && outcome.seconds > expect.max_seconds) {
    failures.push(`It took ${Math.round(outcome.seconds)} seconds, more than ${expect.max_seconds}.`);
  }
  return failures;
}
