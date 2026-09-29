/**
 * New statements from Gmail, read into the collections they belong to (plan
 * #1023).
 *
 * A collection whose documents arrive by email has a learned kind of
 * document with its senders (goals.document_kinds.senders, migration 0057).
 * Each morning the brief of the goals run lists those collections: the Gmail
 * search to run, and every confirmed row by its ID with the tracked values
 * as they stand. The session reads each new statement and, as #1022 settled,
 * updates a row in place when the statement names it by its ID and the
 * change is ordinary; anything else goes in as a draft for the person to
 * confirm. Updating the row is what moves a goal's number (plan #1024): the
 * records trigger writes a reading dated by the statement.
 *
 * Ordinary means every value that changed is either a date or a tracked
 * money value that moved by no more than a month's payment plus a month's
 * interest. The payment is the row's payment field (a money field named for
 * a payment or minimum that is not itself tracked), and the interest is the
 * largest tracked money value at the row's rate. A status, a rate, a new
 * payment amount or any other change waits for the person.
 *
 * Pure: statements-store.ts reads the rows, inngest/goals/daily.ts puts the
 * lines in the brief, and the goals skill ("Reading new statements from
 * Gmail") says how the session writes.
 */
import {
  idField,
  liveFields,
  type CollectionField,
  type CollectionShape,
  type FieldValue,
  type RecordValues,
} from '@/lib/goals/collections';
import type { CollectionRecord } from '@/lib/goals/collections-store';
import type { LearnedKind } from '@/lib/goals/document-kinds';
import { formatMoney } from '@/lib/money';

/** The furthest back a search reaches, so a row untouched for a year does not ask for a year of mail. */
export const SEARCH_BACK_DAYS = 62;
/** The latest a search starts, so a statement that arrives a few days after its date is still found. */
export const SEARCH_OVERLAP_DAYS = 7;

export type StatementCollection = {
  id: string;
  name: string;
  shape: CollectionShape;
  fields: CollectionField[];
};

export type StatementRow = {
  recordId: string;
  /** The row's value in the ID field, as saved. */
  idValue: string;
  /** What the row is called, when a field other than the ID names it. */
  label: string | null;
  /** The date its figures are as of: the record's as_of, or the day it was last saved. */
  asOf: string;
  /** The tracked values as they stand, by field key. */
  tracked: Record<string, number>;
  /** The most a tracked money value may move and still go straight in, or null when nothing may. */
  limit: number | null;
};

export type StatementSource = {
  collectionId: string;
  name: string;
  idKey: string;
  idLabel: string;
  kinds: { id: string; name: string }[];
  senders: string[];
  /** The Gmail search: mail from the senders since the oldest row's date, within bounds. */
  query: string;
  rows: StatementRow[];
};

const PAYMENT_PATTERN = /payment|minimum|instal/i;

const round2 = (n: number) => Math.round(n * 100) / 100;

function num(value: FieldValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The most a tracked money value on this row may move and still be an
 * ordinary change: a month's payment plus a month's interest on the largest
 * tracked money value. Null when the row has no tracked money value to move.
 */
export function ordinaryLimit(fields: CollectionField[], data: RecordValues): number | null {
  const live = liveFields(fields);
  const tracked = live
    .filter((f) => f.type === 'money' && f.tracked)
    .map((f) => num(data[f.key]))
    .filter((v): v is number => v !== null);
  if (tracked.length === 0) return null;
  const base = Math.max(...tracked.map(Math.abs));
  const paymentField = live.find(
    (f) =>
      f.type === 'money' &&
      !f.tracked &&
      (PAYMENT_PATTERN.test(f.key) || PAYMENT_PATTERN.test(f.label)),
  );
  const payment = paymentField ? Math.abs(num(data[paymentField.key]) ?? 0) : 0;
  const rateField = live.find((f) => f.type === 'percent' && num(data[f.key]) !== null);
  const rate = rateField ? (num(data[rateField.key]) ?? 0) : 0;
  return round2(payment + (base * rate) / 1200);
}

export type ChangeCheck = { ordinary: true } | { ordinary: false; reason: string };

/**
 * Whether a statement's values for a saved row are an ordinary change, which
 * goes straight in, or one that waits for the person as a draft (#1022's
 * answer, C). Values the statement leaves out are not changes.
 */
export function checkChange(
  fields: CollectionField[],
  before: RecordValues,
  after: RecordValues,
): ChangeCheck {
  const byKey = new Map(liveFields(fields).map((f) => [f.key, f]));
  const limit = ordinaryLimit(fields, before);
  for (const [key, value] of Object.entries(after)) {
    if (value === null || value === undefined) continue;
    if ((before[key] ?? null) === value) continue;
    const field = byKey.get(key);
    if (!field) return { ordinary: false, reason: `${key} is not a field on the form` };
    if (field.id) return { ordinary: false, reason: `its ${field.label} is different` };
    if (field.type === 'date' || field.type === 'day_of_month') continue;
    if (field.type === 'money' && field.tracked) {
      const old = num(before[key]);
      const next = num(value);
      if (old === null || next === null) {
        return { ordinary: false, reason: `${field.label} had no figure before` };
      }
      if (limit === null || Math.abs(next - old) > limit + 0.005) {
        return {
          ordinary: false,
          reason: `${field.label} moved by ${formatMoney(Math.round(Math.abs(next - old) * 100))}, more than a month's payment and interest`,
        };
      }
      continue;
    }
    return { ordinary: false, reason: `${field.label} changed` };
  }
  return { ordinary: true };
}

/** A day as the Gmail search writes it. */
function gmailDay(day: string): string {
  return day.replaceAll('-', '/');
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The Gmail search for mail from these senders since a day. A term with a space is quoted. */
export function gmailQuery(senders: string[], since: string): string {
  const terms = senders.map((s) => (/\s/.test(s) ? `"${s}"` : s));
  const from = terms.length === 1 ? `from:${terms[0]}` : `from:(${terms.join(' OR ')})`;
  return `${from} after:${gmailDay(since)}`;
}

/**
 * The collections the morning run reads statements into: a live collection
 * with an ID field and at least one learned kind with a sender, with every
 * confirmed row that has an ID. Drafts are left out: they are not saved rows
 * yet, and the session checks for one before writing another.
 */
export function statementSources(input: {
  collections: StatementCollection[];
  kinds: LearnedKind[];
  records: CollectionRecord[];
  today: string;
}): StatementSource[] {
  const sources: StatementSource[] = [];
  for (const collection of input.collections) {
    if (collection.shape !== 'list') continue;
    const id = idField(collection.fields);
    if (!id) continue;
    const kinds = input.kinds.filter(
      (k) => k.collectionId === collection.id && k.senders.length > 0,
    );
    if (kinds.length === 0) continue;
    const senders: string[] = [];
    const seen = new Set<string>();
    for (const sender of kinds.flatMap((k) => k.senders)) {
      if (seen.has(sender.toLowerCase())) continue;
      seen.add(sender.toLowerCase());
      senders.push(sender);
    }

    const live = liveFields(collection.fields);
    const tracked = live.filter((f) => f.tracked);
    const labelField = live.find((f) => f.type === 'text' && !f.id);
    const rows: StatementRow[] = [];
    for (const record of input.records) {
      if (record.collectionId !== collection.id || record.draft) continue;
      const idValue = record.data[id.key];
      if (idValue === null || idValue === undefined || idValue === '') continue;
      const values: Record<string, number> = {};
      for (const f of tracked) {
        const v = num(record.data[f.key]);
        if (v !== null) values[f.key] = v;
      }
      const label = labelField ? record.data[labelField.key] : null;
      rows.push({
        recordId: record.id,
        idValue: String(idValue),
        label: typeof label === 'string' && label.trim() ? label.trim() : null,
        asOf: record.asOf ?? record.updatedAt.slice(0, 10),
        tracked: values,
        limit: ordinaryLimit(collection.fields, record.data),
      });
    }

    const earliest = addDays(input.today, -SEARCH_BACK_DAYS);
    const latest = addDays(input.today, -SEARCH_OVERLAP_DAYS);
    const oldest = rows.reduce<string | null>(
      (min, r) => (min === null || r.asOf < min ? r.asOf : min),
      null,
    );
    let since = oldest ?? earliest;
    if (since < earliest) since = earliest;
    if (since > latest) since = latest;

    sources.push({
      collectionId: collection.id,
      name: collection.name,
      idKey: id.key,
      idLabel: id.label,
      kinds: kinds.map((k) => ({ id: k.id, name: k.name })),
      senders,
      query: gmailQuery(senders, since),
      rows,
    });
  }
  return sources;
}

function rowLine(row: StatementRow): string {
  const values = Object.entries(row.tracked).map(([key, value]) => `${key} ${value}`);
  const name = row.label ? `${row.idValue}, ${row.label}` : row.idValue;
  const room =
    row.limit === null
      ? 'nothing goes straight in'
      : `straight in when each money value moves by no more than ${formatMoney(Math.round(row.limit * 100))}`;
  return `  - ${name} (goals.records id ${row.recordId}), figures as of ${row.asOf}: ${values.join(', ') || 'no tracked values'}; ${room}`;
}

/**
 * The part of the morning brief that asks for the new statements, or no
 * lines when no collection has a sender to search.
 */
export function statementLines(sources: StatementSource[]): string[] {
  if (sources.length === 0) return [];
  const blocks = sources.flatMap((source) => [
    `- ${source.name} (goals.collections id ${source.collectionId}), matched by ${source.idLabel} (${source.idKey}),`,
    `  from ${source.kinds.map((k) => `"${k.name}" (goals.document_kinds id ${k.id})`).join(', ')}.`,
    `  Search Gmail for: ${source.query}`,
    ...(source.rows.length > 0 ? source.rows.map(rowLine) : ['  No saved rows yet.']),
  ]);
  return [
    'Before anything else, read the new statements in Gmail into the collections below, so the',
    'goals are reviewed on current figures. For each, run the search, read every message newer',
    "than a row's figures, and update the row its ID names in place when the change is ordinary;",
    'anything else goes in as a draft. Follow .claude/skills/goals/SKILL.md, "Reading new',
    'statements from Gmail".',
    '',
    ...blocks,
    '',
  ];
}
