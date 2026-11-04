import { numbersIn } from '@/lib/timeline/year-review';
import type { MonthFacts, ReviewFact, ReviewFactKind } from './facts';

/**
 * Wording the monthly money review (plan #2593.8.2): the prompt the model is
 * given, and the check its reply passes before anything is stored.
 *
 * The model words the lines; it never chooses them. Every fact the code found
 * becomes a line in the code's order, with the transactions behind it, so a
 * line the model left out or wrote badly falls back to the code's own
 * sentence rather than going missing. A worded line is kept only when every
 * number in it is a number in that fact's own sentence, and the opening only
 * when its numbers are in some fact's sentence or the month's name.
 */

/** One line of the review as finances.month_reviews.lines stores it. */
export interface StoredLine {
  id: string;
  kind: ReviewFactKind;
  text: string;
  transaction_ids: string[];
  account_ids: string[];
}

/** The model's reply, unchecked. */
export interface RawWording {
  summary?: unknown;
  lines?: unknown;
}

export interface CheckedWording {
  summary: string;
  lines: StoredLine[];
  /** model when at least one sentence of the model's was kept. */
  source: 'model' | 'plain';
  /** Fact ids whose wording was thrown away, and why. */
  dropped: { id: string; reason: 'missing' | 'numbers' | 'empty' }[];
}

/** The longest line kept; a longer one falls back to the code's sentence. */
const MAX_LINE = 320;
const MAX_SUMMARY = 400;

/** One line, trimmed, no dashes standing in for punctuation, ending in a full stop. */
export function cleanText(text: unknown, max: number): string | null {
  if (typeof text !== 'string') return null;
  let out = text
    .replace(/\s+/g, ' ')
    .replace(/\s*[–—]\s*/g, ', ')
    .replace(/\s+-\s+/g, ', ')
    .replace(/!/g, '.')
    .trim();
  if (!out) return null;
  if (!/[.?]$/.test(out)) out += '.';
  return out.length > max ? null : out;
}

function numbersAllowed(text: string, sources: readonly string[]): boolean {
  const allowed = new Set(sources.flatMap((s) => numbersIn(s)));
  return numbersIn(text).every((n) => allowed.has(n));
}

function stored(fact: ReviewFact, text: string): StoredLine {
  return {
    id: fact.id,
    kind: fact.kind,
    text,
    transaction_ids: fact.transactionIds,
    account_ids: fact.accountIds,
  };
}

/** The review in the code's own words, for a month with no model or nothing to word. */
export function plainWording(facts: MonthFacts): CheckedWording {
  return {
    summary: facts.plainSummary,
    lines: facts.facts.map((f) => stored(f, f.plain)),
    source: 'plain',
    dropped: [],
  };
}

export function checkWording(raw: RawWording | null, facts: MonthFacts): CheckedWording {
  if (!raw) return plainWording(facts);
  const worded = new Map<string, unknown>();
  if (Array.isArray(raw.lines)) {
    for (const item of raw.lines) {
      const line = item as { fact?: unknown; text?: unknown } | null;
      if (line && typeof line.fact === 'string' && !worded.has(line.fact)) worded.set(line.fact, line.text);
    }
  }

  const dropped: CheckedWording['dropped'] = [];
  let kept = 0;
  const lines = facts.facts.map((fact) => {
    if (!worded.has(fact.id)) {
      dropped.push({ id: fact.id, reason: 'missing' });
      return stored(fact, fact.plain);
    }
    const text = cleanText(worded.get(fact.id), MAX_LINE);
    if (!text) {
      dropped.push({ id: fact.id, reason: 'empty' });
      return stored(fact, fact.plain);
    }
    if (!numbersAllowed(text, [fact.plain])) {
      dropped.push({ id: fact.id, reason: 'numbers' });
      return stored(fact, fact.plain);
    }
    kept += 1;
    return stored(fact, text);
  });

  let summary = facts.plainSummary;
  const summaryText = cleanText(raw.summary, MAX_SUMMARY);
  if (summaryText && numbersAllowed(summaryText, [facts.label, ...facts.facts.map((f) => f.plain)])) {
    summary = summaryText;
    kept += 1;
  } else {
    dropped.push({ id: 'summary', reason: summaryText ? 'numbers' : 'empty' });
  }

  return { summary, lines, source: kept > 0 ? 'model' : 'plain', dropped };
}

/** What the model is given: the month and each fact with its sentence and figures. */
export function reviewPrompt(facts: MonthFacts): string {
  const lines = facts.facts.map((f) => {
    const figures = Object.entries(f.figures)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
    return `- id: ${f.id}\n  kind: ${f.kind}\n  sentence: ${f.plain}\n  figures: ${figures}`;
  });
  return [
    `The month: ${facts.label}.`,
    '',
    'The facts, in the order the review shows them:',
    ...lines,
  ].join('\n');
}
