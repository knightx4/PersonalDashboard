/**
 * Information steps: a step that needs facts from you and points at the
 * collection that holds them (plan #954; docs/GOALS-SPEC.md, "Information
 * steps and collections").
 *
 * The step names its collection (goals.items.collection_id) and, optionally,
 * the fields it needs filled (asks_for; every shown field when it is null).
 * This file decides what the form shows and when the step is done.
 *
 * The rule for closing (plan #991, from #988's answer): a step closes when
 * each of its questions (items.questions) has an answer with its sources,
 * not when its fields are filled. The fields are how the goals routine
 * reaches the answers. The database closes the step when the last answer
 * lands (migrations-goals 0035), since the routine writes answers through
 * SQL; this file counts the same thing for the page. A step with no
 * questions never closes itself: the person closes it.
 *
 * A draft is a record found for you, in Gmail or a document, that you have
 * not confirmed. It counts for nothing until you do.
 */

import { sourceHref as catalogueHref, sourceModule } from '@/lib/sources/catalogue';
import {
  liveFields,
  type CollectionField,
  type CollectionShape,
  type FieldValue,
  type RecordSource,
} from '@/lib/goals/collections';
import { formatMoney } from '@/lib/money';
import type { StepAnswer, StepQuestion } from '@/lib/goals/answers';

/** The fields the step needs filled: those it names, or every shown field. */
export function askedFields(
  fields: CollectionField[],
  asksFor: string[] | null,
): CollectionField[] {
  const live = liveFields(fields);
  if (!asksFor) return live;
  const asked = live.filter((f) => asksFor.includes(f.key));
  // A step naming only fields since removed asks for nothing it can show,
  // so it falls back to the whole form rather than being complete when empty.
  return asked.length > 0 ? asked : live;
}

/** The asked fields a record has no value for. */
export function missingFields(
  asked: CollectionField[],
  data: Record<string, FieldValue>,
): CollectionField[] {
  return asked.filter((f) => data[f.key] === null || data[f.key] === undefined);
}

/**
 * Whether an answer settles its question: it names at least one row and no
 * row it read has changed since. The same rule the database closes the step
 * by (goals.close_answered_step, migrations-goals 0035).
 */
export function settles(answer: Pick<StepAnswer, 'sources' | 'outOfDateAt'> | undefined): boolean {
  return !!answer && answer.sources.length > 0 && answer.outOfDateAt === null;
}

export type InformationRecord = { id: string; data: Record<string, FieldValue>; draft: boolean };

export type InformationProgress = {
  /** Live records. */
  count: number;
  /** Records waiting for you to confirm them. */
  drafts: number;
  /** Records with an asked field still empty. */
  unfilled: number;
  /** The questions the step has to answer. */
  questions: number;
  /** The questions still without a current answer with sources, in order. */
  open: StepQuestion[];
  /** Every question is answered: the step has what it is for. */
  complete: boolean;
};

export function informationProgress(
  asked: CollectionField[],
  records: InformationRecord[],
  questions: StepQuestion[],
  answers: Pick<StepAnswer, 'key' | 'sources' | 'outOfDateAt'>[],
): InformationProgress {
  const drafts = records.filter((r) => r.draft).length;
  const unfilled = records.filter((r) => missingFields(asked, r.data).length > 0).length;
  const byKey = new Map(answers.map((a) => [a.key, a]));
  const open = questions.filter((q) => !settles(byKey.get(q.key)));
  return {
    count: records.length,
    drafts,
    unfilled,
    questions: questions.length,
    open,
    complete: questions.length > 0 && open.length === 0,
  };
}

/**
 * Why the step is still open, naming the questions without an answer, or
 * null when every one has one.
 */
export function unfinishedReason(progress: InformationProgress): string | null {
  if (progress.questions === 0) {
    return 'No questions yet. Add what this step has to answer, and it closes once each has an answer.';
  }
  if (progress.open.length === 0) return null;
  const quoted = progress.open.map((q) => `“${q.question}”`);
  const list =
    quoted.length === 1
      ? quoted[0]
      : `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
  return `Still to answer: ${list}`;
}

/** One line on the step: how far the collection and its questions have got. */
export function progressLine(shape: CollectionShape, progress: InformationProgress): string {
  const parts: string[] = [];
  if (shape === 'list') {
    parts.push(progress.count === 1 ? '1 row' : `${progress.count} rows`);
  } else if (progress.count === 0) {
    parts.push('Not filled in');
  }
  if (progress.drafts > 0)
    parts.push(
      progress.drafts === 1 ? '1 draft to confirm' : `${progress.drafts} drafts to confirm`,
    );
  if (progress.unfilled > 0)
    parts.push(progress.unfilled === 1 ? '1 with gaps' : `${progress.unfilled} with gaps`);
  if (progress.questions > 0) {
    const answered = progress.questions - progress.open.length;
    parts.push(
      `${answered} of ${progress.questions} ${progress.questions === 1 ? 'question' : 'questions'} answered`,
    );
  }
  return parts.join(', ');
}

/** Where a draft came from, as the step says it. */
export const SOURCE_LABELS: Record<RecordSource, string> = {
  typed: 'Typed',
  pasted: 'From pasted text',
  document: 'From a document',
  gmail: 'From Gmail',
  comment: 'From a comment',
  capture: 'From the capture box',
  app: 'From another module',
};

/** An `app` record's source_ref split into its table and row, or null when it is not one. */
export function appSource(ref: string | null): { table: string; ref: string } | null {
  const match = ref ? /^([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*):(.+)$/.exec(ref) : null;
  return match ? { table: match[1], ref: match[2] } : null;
}

/** A stored document's name as you gave it, from its path (lib/goals/extract.ts, documentPath). */
export function documentName(path: string): string {
  const last = path.slice(path.lastIndexOf('/') + 1);
  return last.replace(/^[0-9a-f-]{36}-/, '') || 'a document';
}

/** Where a record came from, naming the file when it came from one. */
export function sourceLabel(source: RecordSource, ref: string | null): string {
  if (source === 'document' && ref) return `From ${documentName(ref)}`;
  const app = source === 'app' ? appSource(ref) : null;
  if (app) return `From ${sourceModule(app.table)}`;
  return SOURCE_LABELS[source];
}

/** A link to where a record came from, when there is one to open. */
export function sourceHref(source: RecordSource, ref: string | null): string | null {
  if (!ref) return null;
  if (source === 'gmail' && /^[A-Za-z0-9_-]{1,200}$/.test(ref)) {
    return `https://mail.google.com/mail/u/0/#all/${ref}`;
  }
  // A document is kept in the private bucket; this route signs a link to it.
  if (source === 'document') return `/goals/document?path=${encodeURIComponent(ref)}`;
  if (source === 'app') {
    const app = appSource(ref);
    return app ? catalogueHref(app.table, app.ref) : null;
  }
  if (/^https?:\/\/\S+$/.test(ref)) return ref;
  return null;
}

const ORDINAL = new Intl.PluralRules('en-US', { type: 'ordinal' });
const ORDINAL_SUFFIX: Record<string, string> = { one: 'st', two: 'nd', few: 'rd', other: 'th' };
const DAY_FORMAT = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const NUMBER_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });

/** A stored value as the table shows it. Empty is an empty string. */
export function displayValue(field: CollectionField, value: FieldValue | undefined): string {
  if (value === null || value === undefined) return '';
  switch (field.type) {
    case 'money':
      return typeof value === 'number' ? formatMoney(Math.round(value * 100)) : String(value);
    case 'percent':
      return typeof value === 'number' ? `${NUMBER_FORMAT.format(value)}%` : String(value);
    case 'number':
      return typeof value === 'number' ? NUMBER_FORMAT.format(value) : String(value);
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? DAY_FORMAT.format(new Date(`${value}T00:00:00Z`))
        : String(value);
    case 'day_of_month':
      return typeof value === 'number'
        ? `${value}${ORDINAL_SUFFIX[ORDINAL.select(value)]}`
        : String(value);
    case 'yes_no':
      return value === true ? 'Yes' : value === false ? 'No' : String(value);
    default:
      return String(value);
  }
}

/** A stored value as its form input starts out. */
export function inputValue(field: CollectionField, value: FieldValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (field.type === 'yes_no') {
    // A string is already an input's value, as a filled-in preview holds it.
    return value === true ? 'yes' : value === false ? 'no' : typeof value === 'string' ? value : '';
  }
  return String(value);
}

/** The prefix a form input's name carries, so the values can be told from the ids. */
export const VALUE_PREFIX = 'v:';

/** The values a submitted form carries, keyed by field key. Only the shown fields are read. */
export function formValues(
  fields: CollectionField[],
  get: (name: string) => unknown,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of liveFields(fields)) {
    const raw = get(`${VALUE_PREFIX}${field.key}`);
    if (raw === null || raw === undefined) continue;
    values[field.key] = raw;
  }
  return values;
}
