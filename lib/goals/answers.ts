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
};

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
