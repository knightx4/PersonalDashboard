/**
 * Information steps: a step that needs facts from you and points at the
 * collection that holds them (plan #954; docs/GOALS-SPEC.md, "Information
 * steps and collections").
 *
 * The step names its collection (goals.items.collection_id) and, optionally,
 * the fields it needs filled (asks_for; every shown field when it is null).
 * This file decides what the form shows and when the step has what it asked
 * for. The rule for closing:
 *
 *   - A one-record collection is complete when its record is confirmed and
 *     has every asked field filled. The save that completes it closes the
 *     step.
 *   - A list is never complete from its rows alone, since the app cannot know
 *     there is not another loan to come. When every row is confirmed and
 *     filled, the step offers "That is all of them", and pressing it closes
 *     the step.
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

export type InformationRecord = { id: string; data: Record<string, FieldValue>; draft: boolean };

export type InformationProgress = {
  /** Live records. */
  count: number;
  /** Records waiting for you to confirm them. */
  drafts: number;
  /** Records with an asked field still empty. */
  unfilled: number;
  /** The collection has what the step asked for (a list also needs you to say it is whole). */
  complete: boolean;
};

export function informationProgress(
  shape: CollectionShape,
  asked: CollectionField[],
  records: InformationRecord[],
): InformationProgress {
  const drafts = records.filter((r) => r.draft).length;
  const unfilled = records.filter((r) => missingFields(asked, r.data).length > 0).length;
  const count = records.length;
  const complete = count > 0 && drafts === 0 && unfilled === 0 && (shape === 'list' || count === 1);
  return { count, drafts, unfilled, complete };
}

/**
 * Whether a write should close the step. Only a one-record collection closes
 * on its own; a list waits for "That is all of them".
 */
export function closesOnSave(shape: CollectionShape, progress: InformationProgress): boolean {
  return shape === 'one' && progress.complete;
}

/** Why a list cannot be called whole yet, or null when it can. */
export function unfinishedReason(progress: InformationProgress): string | null {
  if (progress.count === 0) return 'Add at least one row first.';
  if (progress.drafts > 0) {
    return progress.drafts === 1
      ? 'One row is a draft. Confirm or correct it first.'
      : `${progress.drafts} rows are drafts. Confirm or correct them first.`;
  }
  if (progress.unfilled > 0) {
    return progress.unfilled === 1
      ? 'One row still has an empty field the step needs.'
      : `${progress.unfilled} rows still have empty fields the step needs.`;
  }
  return null;
}

/** One line on the step: how far the collection has got. */
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
