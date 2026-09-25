/**
 * Worked-out answers on an information step (plan #989; docs/GOALS-SPEC.md,
 * "Information steps and collections").
 *
 * An information step exists to answer something, such as when the loan
 * payments start or what they come to a month. The goals routine works each
 * answer out from the step's records and stores it in goals.answers with the
 * rows it read and the date of each row's figures. The step shows the answers
 * above its figures. When one of those rows changes, or a new row arrives in
 * the collection, a trigger marks the answer out of date (migrations-goals
 * 0034) and the morning run works it again.
 *
 * The rules that need no database live here: reading the stored sources,
 * the line that names them, and which steps the morning run should send
 * back to the routine.
 */

import { liveFields, type CollectionField, type RecordValues } from '@/lib/goals/collections';
import { displayValue } from '@/lib/goals/information';
import type { StepNode } from '@/lib/goals/steps';
import type { Goal } from '@/lib/goals/tree';

/** One row an answer read, and the date its figures were current. */
export type AnswerSource = { recordId: string; asOf: string };

export type StepAnswer = {
  id: string;
  itemId: string;
  /** Names the question on its step ("first_payment"). */
  key: string;
  question: string;
  answer: string;
  sources: AnswerSource[];
  position: number;
  workedAt: string;
  /** When a row it read changed after it was worked out; null while it stands. */
  outOfDateAt: string | null;
  /** The date or amount the answer states, beside its wording (plan #1035). */
  value: AnswerValue;
  /**
   * The answer as it stood when its step last closed, which a change is
   * measured from (plan #1047); null when the step has not closed since the
   * answer was written.
   */
  closed: ClosedAnswer | null;
};

/**
 * What an answer states, stored beside its wording (plan #1035): a day, a
 * dollar amount, or neither. The goals routine writes it with the sentence,
 * so a later statement is compared on the number rather than on the words.
 */
export type AnswerValue =
  | { kind: 'date'; date: string }
  | { kind: 'amount'; amount: number }
  | { kind: 'text' };

/** An answer's wording and value when its step last closed. */
export type ClosedAnswer = { answer: string; value: AnswerValue };

function toAmount(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * The stored kind and typed columns (goals.answers kind, value_date,
 * value_amount) as the app reads them. A date or amount whose value is
 * missing or unreadable is read as text rather than shown wrong.
 */
export function readValue(kind: unknown, date: unknown, amount: unknown): AnswerValue {
  if (kind === 'date' && typeof date === 'string' && DAY.test(date)) return { kind: 'date', date };
  if (kind === 'amount') {
    const n = toAmount(amount);
    if (n !== null) return { kind: 'amount', amount: n };
  }
  return { kind: 'text' };
}

/**
 * The closing state (closed_answer, closed_date, closed_amount), or null when
 * the step has not closed since the answer was written. Its kind is whichever
 * value is set.
 */
export function readClosed(answer: unknown, date: unknown, amount: unknown): ClosedAnswer | null {
  if (typeof answer !== 'string') return null;
  if (typeof date === 'string' && DAY.test(date)) return { answer, value: { kind: 'date', date } };
  const n = amount === null || amount === undefined ? null : toAmount(amount);
  if (n !== null) return { answer, value: { kind: 'amount', amount: n } };
  return { answer, value: { kind: 'text' } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The stored sources, `[{"record_id", "as_of"}]`, as the app reads them. The
 * database checks the shape on write; anything that still does not fit is
 * left out rather than shown wrong.
 */
export function readSources(raw: unknown): AnswerSource[] {
  if (!Array.isArray(raw)) return [];
  const out: AnswerSource[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { record_id: recordId, as_of: asOf } = item as Record<string, unknown>;
    if (typeof recordId === 'string' && UUID.test(recordId) && typeof asOf === 'string' && DAY.test(asOf)) {
      out.push({ recordId, asOf });
    }
  }
  return out;
}

/**
 * One question an information step has to answer (plan #991), as stored in
 * goals.items.questions. `key` matches the answer's row in goals.answers.
 */
export type StepQuestion = { key: string; question: string };

const KEY = /^[a-z][a-z0-9_]{0,39}$/;

/** The most questions a step holds, as the database allows. */
export const MAX_QUESTIONS = 20;
/** The longest a question may be, as the database allows. */
export const MAX_QUESTION_LENGTH = 300;
/** A question's input name: `q:<key>` for one already on the step, `q:new` for one added. */
export const QUESTION_PREFIX = 'q:';

/**
 * The stored questions, `[{"key", "question"}]`, as the app reads them. The
 * database checks the shape on write; anything that still does not fit, or
 * repeats a key, is left out.
 */
export function readQuestions(raw: unknown): StepQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: StepQuestion[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { key, question } = item as Record<string, unknown>;
    if (typeof key !== 'string' || !KEY.test(key) || seen.has(key)) continue;
    if (typeof question !== 'string' || !question.trim()) continue;
    seen.add(key);
    out.push({ key, question });
  }
  return out;
}

/**
 * A key for a question the person adds, made from its words
 * ("What is the monthly total?" is `what_is_the_monthly_total`), and
 * numbered when the step already has that key.
 */
export function questionKey(question: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const words = question
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+|_+$/g, '');
  const base = (words || 'question').slice(0, 36).replace(/_+$/, '');
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const key = `${base}_${n}`;
    if (!used.has(key)) return key;
  }
}

/** A row as a source line names it: its first field with a value. */
export type SourceRecord = { id: string; data: RecordValues };

export function recordName(fields: CollectionField[], record: SourceRecord): string {
  for (const field of liveFields(fields)) {
    if (field.id) continue;
    const shown = displayValue(field, record.data[field.key]);
    if (shown) return shown;
  }
  return 'a row without a name';
}

const DATE = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** A stored day as the step writes a date elsewhere ("Sep 2, 2026"). */
function formatDay(day: string): string {
  return DATE.format(new Date(`${day}T00:00:00Z`));
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The line under an answer naming the rows it read and the date of their
 * figures: "From Grad PLUS 2024–25 and Grad PLUS 2025–26, figures as of
 * Sep 2, 2026". When the rows are of different dates each carries its own. A
 * row since archived is still counted, as "a row since archived".
 */
export function sourcesLine(
  sources: AnswerSource[],
  fields: CollectionField[],
  records: SourceRecord[],
): string {
  if (sources.length === 0) return 'No rows named.';
  const byId = new Map(records.map((r) => [r.id, r]));
  const name = (s: AnswerSource) => {
    const record = byId.get(s.recordId);
    return record ? recordName(fields, record) : 'a row since archived';
  };
  const dates = new Set(sources.map((s) => s.asOf));
  if (dates.size === 1) {
    return `From ${joinNames(sources.map(name))}, figures as of ${formatDay(sources[0].asOf)}`;
  }
  return `From ${joinNames(sources.map((s) => `${name(s)} (${formatDay(s.asOf)})`))}`;
}

/** An information step with answers the morning run should work again. */
export type OutOfDateStep = {
  id: string;
  title: string;
  goalTitle: string;
  questions: string[];
};

/**
 * The steps whose answers are out of date, in page order, for the morning
 * run. Only a step under an open goal, and not one that was dropped: a step
 * that is done still has its answers kept current, since what it answered can
 * move (plan #997 decides what happens to the step when it does).
 */
export function outOfDateSteps(
  goals: Goal[],
  stepsByGoal: Map<string, StepNode[]>,
  answers: Pick<StepAnswer, 'itemId' | 'question' | 'outOfDateAt'>[],
): OutOfDateStep[] {
  const byStep = new Map<string, string[]>();
  for (const answer of answers) {
    if (answer.outOfDateAt === null) continue;
    const list = byStep.get(answer.itemId) ?? [];
    list.push(answer.question);
    byStep.set(answer.itemId, list);
  }
  if (byStep.size === 0) return [];
  const out: OutOfDateStep[] = [];
  for (const goal of goals) {
    if (goal.status !== 'open') continue;
    const walk = (nodes: StepNode[]) => {
      for (const node of nodes) {
        if (node.status === 'dropped') continue;
        const questions = byStep.get(node.id);
        if (questions) out.push({ id: node.id, title: node.title, goalTitle: goal.title, questions });
        walk(node.children);
      }
    };
    walk(stepsByGoal.get(goal.id) ?? []);
  }
  return out;
}
