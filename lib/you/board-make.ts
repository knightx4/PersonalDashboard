import type { BoardOption } from '@/lib/you/board-questions';
import type { BoardVerdict, QuestionDecision } from '@/lib/you/board-debate';

/**
 * Make it happen (plan #2561.9): a decided question written as todos or as
 * steps under a goal. One row for the action the person decided on, and one
 * for each condition of the verdict, dated where the words give a date.
 *
 * Pure: no clients here, so the page and the server action work out the same
 * list from the same question. The server never takes a title from the page;
 * it takes the keys the person picked and builds the rows from the question.
 */

/** Longest title a todo or step holds. */
export const MAKE_TITLE_MAX = 500;

export type MakeRole = 'action' | 'condition';

export type MakeCandidate = {
  /** `action`, or `condition-<index>` into the verdict's conditions. */
  key: string;
  role: MakeRole;
  text: string;
  /** A date the words give, YYYY-MM-DD, or null. */
  dueOn: string | null;
};

export type MadeKind = 'todo' | 'step';

/** One row a question made, as stored in you.board_questions.made. */
export type MadeRef = { kind: MadeKind; id: string; key: string };

/** A made row read back from its table, for the question to list. */
export type MadeItem = MadeRef & {
  title: string;
  dueOn: string | null;
  done: boolean;
  href: string;
  /** The goal a step sits under; null for a todo. */
  goal: string | null;
};

export type GoalChoice = { id: string; title: string; area: string };

export type MakeTarget = { kind: 'todo' } | { kind: 'goal'; goalId: string };

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

const pad = (n: number) => String(n).padStart(2, '0');

function real(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function monthOf(word: string): number | null {
  const w = word.toLowerCase().replace(/\.$/, '');
  if (w.length < 3) return null;
  const at = MONTHS.findIndex(
    (m) => m === w || (w.length === 3 && m.startsWith(w)) || (w === 'sept' && m === 'september'),
  );
  return at === -1 ? null : at + 1;
}

/**
 * The first date a sentence gives: `2026-11-16`, `16 November`, `16 Nov 2026`
 * or `November 16`. A date with no year is the next one on or after today.
 * A month word needs a day beside it, so "may" alone is not a date.
 */
export function dateIn(text: string, today: string): string | null {
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) {
    const found = real(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (found) return found;
  }
  const dayFirst = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]{3,9})\.?(?:,?\s+(\d{4}))?/g;
  const monthFirst = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?/g;
  const hits: { at: number; day: number; month: number; year: number | null }[] = [];
  for (const m of text.matchAll(dayFirst)) {
    const month = monthOf(m[2]);
    if (month) hits.push({ at: m.index ?? 0, day: Number(m[1]), month, year: m[3] ? Number(m[3]) : null });
  }
  for (const m of text.matchAll(monthFirst)) {
    const month = monthOf(m[1]);
    if (month) hits.push({ at: m.index ?? 0, day: Number(m[2]), month, year: m[3] ? Number(m[3]) : null });
  }
  hits.sort((a, b) => a.at - b.at);
  const startYear = Number(today.slice(0, 4));
  for (const hit of hits) {
    if (hit.year) {
      const found = real(hit.year, hit.month, hit.day);
      if (found) return found;
      continue;
    }
    for (const year of [startYear, startYear + 1]) {
      const found = real(year, hit.month, hit.day);
      if (found && found >= today) return found;
    }
  }
  return null;
}

/** Cut under the title limit. */
export function clipTitle(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= MAKE_TITLE_MAX) return flat;
  return `${flat.slice(0, MAKE_TITLE_MAX - 1).trimEnd()}…`;
}

/**
 * What a decided question offers to write: the option they decided, and the
 * verdict's conditions when they decided what the board recommended (the
 * conditions belong to that option). Nothing for a question put off or turned
 * down.
 */
export function makeCandidates(
  question: { options: readonly BoardOption[]; verdict: BoardVerdict | null; decision: QuestionDecision | null },
  today: string,
): MakeCandidate[] {
  const decision = question.decision;
  if (!decision || decision.kind !== 'option' || !decision.option) return [];
  const option = question.options.find((o) => o.letter === decision.option);
  if (!option) return [];
  const out: MakeCandidate[] = [
    { key: 'action', role: 'action', text: option.text, dueOn: dateIn(option.text, today) },
  ];
  if (question.verdict && question.verdict.recommended === decision.option) {
    question.verdict.conditions.forEach((condition, index) => {
      out.push({ key: `condition-${index}`, role: 'condition', text: condition, dueOn: dateIn(condition, today) });
    });
  }
  return out;
}

/** The candidates the question has not already made rows for. */
export function stillToMake(
  candidates: readonly MakeCandidate[],
  made: readonly { key: string }[],
): MakeCandidate[] {
  const done = new Set(made.map((m) => m.key));
  return candidates.filter((c) => !done.has(c.key));
}

/** The refs a question row holds, dropping any entry of the wrong shape. */
export function madeRefsOf(value: unknown): MadeRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): MadeRef[] => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    const kind = row.kind === 'todo' || row.kind === 'step' ? row.kind : null;
    if (!kind || typeof row.id !== 'string' || typeof row.key !== 'string') return [];
    return [{ kind, id: row.id, key: row.key }];
  });
}

/** What a written row links back to: the question, in its meeting, with the option decided. */
export function backLink(
  question: { id: string; question: string; options: readonly BoardOption[] },
  meetingId: string | null,
  decided: string | null,
): string {
  const q = question.question.replace(/\s+/g, ' ').trim();
  const clipped = q.length > 120 ? `${q.slice(0, 119).trimEnd()}…` : q;
  const picked = decided ? ` (option ${decided})` : '';
  const where = meetingId ? `/you/board/${meetingId}#board-q-${question.id}` : '/you/board';
  return `From the board's decision on [${clipped}](${where})${picked}.`;
}
