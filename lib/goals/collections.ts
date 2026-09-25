/**
 * Collections: the facts a goal needs, kept in one checked place (plan #953).
 *
 * A collection is a definition, such as loans with a name, servicer, balance,
 * rate, minimum and due day, and a record is one filled-in set of its values
 * (docs/GOALS-SPEC.md, "Information steps and collections"). Claude picks
 * fields from the ten types below and never writes a table.
 *
 * This file holds the field types and the one validator every record write
 * goes through: checkRecord turns what was typed, pasted or found into the
 * stored form and refuses a value that breaks its field, naming the field.
 * supabase/migrations-goals/0009_collections.sql checks the same stored form
 * again in the database, so a write made straight through SQL is held to the
 * same rules. The two have to agree; the tests for both sit in
 * lib/goals/collections.test.ts and tests/rls-goals.test.ts.
 *
 * The reads and writes are in lib/goals/collections-store.ts.
 */

import { parseNumber } from '@/lib/goals/readings';

export const FIELD_TYPES = [
  'text',
  'long_text',
  'number',
  'money',
  'percent',
  'date',
  'day_of_month',
  'yes_no',
  'choice',
  'link',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

/** How each type is named to a person, in a form or an error. */
export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text',
  long_text: 'Long text',
  number: 'Number',
  money: 'Money',
  percent: 'Percent',
  date: 'Date',
  day_of_month: 'Day of month',
  yes_no: 'Yes/no',
  choice: 'Choice',
  link: 'Link',
};

/** The types whose changes can be kept as a series of readings. */
export const TRACKABLE_TYPES: ReadonlySet<FieldType> = new Set(['number', 'money', 'percent']);

/** The types a field must have to be a collection's ID. */
export const ID_TYPES: ReadonlySet<FieldType> = new Set(['text', 'number']);

export type CollectionField = {
  /** What the value is stored under in records.data. Never changes. */
  key: string;
  label: string;
  type: FieldType;
  /** A change writes a dated reading. Number, money and percent only. */
  tracked?: boolean;
  /** Choice fields only. */
  options?: string[];
  /** Hidden from the form; values already kept stay in the record. */
  removed?: boolean;
  /**
   * The value names the record, so a read row with the same value updates it
   * rather than adding a copy (plan #985). Text and number only, and at most
   * one live field per collection.
   */
  id?: boolean;
};

export type CollectionShape = 'one' | 'list';

export type CollectionDefinition = {
  name: string;
  shape: CollectionShape;
  fields: CollectionField[];
};

/** A value in the form it is stored in records.data. */
export type FieldValue = string | number | boolean | null;
export type RecordValues = Record<string, FieldValue>;

/**
 * Where a record's values came from (goals.records.source). `app` is another
 * module of this app, with `schema.table:ref` as its source_ref (0032).
 */
export const RECORD_SOURCES = ['typed', 'pasted', 'document', 'gmail', 'comment', 'capture', 'app'] as const;
export type RecordSource = (typeof RECORD_SOURCES)[number];

/** The limits the database sets (0009_collections.sql). */
export const FIELDS_MAX = 60;
export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
export const LABEL_MAX = 200;
export const OPTIONS_MAX = 100;
export const TEXT_MAX = 500;
export const LONG_TEXT_MAX = 20000;
export const LINK_MAX = 2000;
export const PERCENT_ABS_MAX = 1000;
export const NUMBER_ABS_MAX = 1e12;
export const COLLECTION_NAME_MAX = 200;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

/** What is wrong with a list of fields, or null when nothing is. Mirrors goals.collection_fields_error. */
export function fieldsError(fields: unknown): string | null {
  if (!Array.isArray(fields)) return 'The fields must be a list.';
  if (fields.length > FIELDS_MAX) return `A collection holds at most ${FIELDS_MAX} fields.`;
  const seen = new Set<string>();
  let idFields = 0;
  for (const field of fields as Partial<CollectionField>[]) {
    if (!field || typeof field !== 'object') return 'Each field must be an object.';
    const key = field.key;
    if (typeof key !== 'string' || !FIELD_KEY_PATTERN.test(key)) {
      return `The field key ${String(key ?? '(missing)')} must be lower case letters, digits and _.`;
    }
    if (seen.has(key)) return `The field key ${key} is used twice.`;
    seen.add(key);
    if (typeof field.label !== 'string' || field.label.trim() === '' || field.label.length > LABEL_MAX) {
      return `The field ${key} needs a label of up to ${LABEL_MAX} characters.`;
    }
    if (!FIELD_TYPES.includes(field.type as FieldType)) {
      return `The field ${key} has no type the app knows: ${String(field.type ?? '(missing)')}.`;
    }
    if (field.tracked !== undefined && typeof field.tracked !== 'boolean') {
      return `The field ${key}: tracked must be true or false.`;
    }
    if (field.tracked && !TRACKABLE_TYPES.has(field.type as FieldType)) {
      return `The field ${key}: only a number, money or percent can be tracked.`;
    }
    if (field.removed !== undefined && typeof field.removed !== 'boolean') {
      return `The field ${key}: removed must be true or false.`;
    }
    if (field.id !== undefined && typeof field.id !== 'boolean') {
      return `The field ${key}: id must be true or false.`;
    }
    if (field.id) {
      if (!ID_TYPES.has(field.type as FieldType)) {
        return `The field ${key}: only a text or number field can be the ID.`;
      }
      if (!field.removed && ++idFields > 1) return 'A collection has at most one ID field.';
    }
    if (field.type === 'choice') {
      const options = field.options;
      if (!Array.isArray(options) || options.length === 0 || options.length > OPTIONS_MAX) {
        return `The choice field ${key} needs a list of 1 to ${OPTIONS_MAX} options.`;
      }
      for (const option of options) {
        if (typeof option !== 'string' || option.trim() === '' || option.length > LABEL_MAX) {
          return `The choice field ${key}: each option must be text of up to ${LABEL_MAX} characters.`;
        }
      }
      if (new Set(options).size !== options.length) {
        return `The choice field ${key} lists an option twice.`;
      }
    } else if (field.options !== undefined) {
      return `The field ${key}: only a choice field has options.`;
    }
  }
  return null;
}

/**
 * Whether a revised list of fields may replace the current one. A field is
 * never taken out, only marked removed, and keeps its type, so every record
 * written against an earlier version still reads the same.
 */
export function revisionError(current: CollectionField[], next: CollectionField[]): string | null {
  const problem = fieldsError(next);
  if (problem) return problem;
  for (const field of current) {
    const kept = next.find((f) => f.key === field.key);
    if (!kept) return `The field ${field.label} cannot be taken out; mark it removed.`;
    if (kept.type !== field.type) {
      return `The field ${field.label} stays ${FIELD_TYPE_LABELS[field.type].toLowerCase()}; add a new field for another type.`;
    }
  }
  return null;
}

/** The live field marked as the collection's ID, or null when it has none. */
export function idField(fields: CollectionField[]): CollectionField | null {
  return fields.find((f) => f.id && !f.removed) ?? null;
}

/** The fields a form shows: the ones not removed, in order. */
export function liveFields(fields: CollectionField[]): CollectionField[] {
  return fields.filter((f) => !f.removed);
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isEmpty(raw: unknown): boolean {
  return raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '');
}

/**
 * One value as it arrived, from a form, a paste or a routine, turned into
 * the form it is stored in. Empty is null and is allowed for every field.
 * The error names the field by its label.
 */
export function parseFieldValue(field: CollectionField, raw: unknown): Parsed<FieldValue> {
  if (isEmpty(raw)) return { ok: true, value: null };
  const fail = (what: string): Parsed<FieldValue> => ({ ok: false, error: `${field.label} must be ${what}.` });
  const text = typeof raw === 'string' ? raw.trim() : null;

  switch (field.type) {
    case 'text': {
      if (text === null || /[\r\n]/.test(text) || text.length > TEXT_MAX) {
        return fail(`one line of text, up to ${TEXT_MAX} characters`);
      }
      return { ok: true, value: text };
    }
    case 'long_text': {
      // Kept as typed, apart from the ends, so paragraphs survive.
      if (text === null || text.length > LONG_TEXT_MAX) {
        return fail(`text of up to ${LONG_TEXT_MAX} characters`);
      }
      return { ok: true, value: text };
    }
    case 'number': {
      const n = parseNumber(raw);
      if (n === null || Math.abs(n) >= NUMBER_ABS_MAX) return fail('a number');
      return { ok: true, value: n };
    }
    case 'money': {
      const n = parseNumber(raw);
      if (n === null || Math.abs(n) >= NUMBER_ABS_MAX || Math.abs(Math.round(n * 100) - n * 100) > 1e-6) {
        return fail('an amount of money, to the cent');
      }
      return { ok: true, value: Math.round(n * 100) / 100 };
    }
    case 'percent': {
      const n = parseNumber(typeof raw === 'string' ? raw.replace(/%\s*$/, '') : raw);
      if (n === null || Math.abs(n) > PERCENT_ABS_MAX) return fail('a percentage');
      return { ok: true, value: n };
    }
    case 'date': {
      if (text === null || !isRealDate(text)) return fail('a date');
      return { ok: true, value: text };
    }
    case 'day_of_month': {
      const n =
        typeof raw === 'number'
          ? raw
          : text !== null && /^\d{1,2}(st|nd|rd|th)?$/i.test(text)
            ? Number.parseInt(text, 10)
            : NaN;
      if (!Number.isInteger(n) || n < 1 || n > 31) return fail('a day of the month, 1 to 31');
      return { ok: true, value: n };
    }
    case 'yes_no': {
      if (typeof raw === 'boolean') return { ok: true, value: raw };
      const word = text?.toLowerCase();
      if (word === 'yes' || word === 'y' || word === 'true' || word === 'on') return { ok: true, value: true };
      if (word === 'no' || word === 'n' || word === 'false' || word === 'off') return { ok: true, value: false };
      return fail('yes or no');
    }
    case 'choice': {
      if (text === null) return fail('one of its options');
      const options = field.options ?? [];
      const match = options.find((o) => o === text) ?? options.find((o) => o.toLowerCase() === text.toLowerCase());
      if (match === undefined) return fail('one of its options');
      return { ok: true, value: match };
    }
    case 'link': {
      if (text === null || !/^https?:\/\/\S+$/.test(text) || text.length > LINK_MAX) {
        return fail('a web address starting http:// or https://');
      }
      return { ok: true, value: text };
    }
  }
}

export type RecordCheck =
  | { ok: true; data: RecordValues }
  | { ok: false; field: string; error: string };

/**
 * The validator every record write goes through. Takes the values being
 * written, keyed by field key, and the record's values before the write
 * (null for a new record), and returns the whole record in its stored form.
 *
 * Only the values that change are checked, as the database does, so a value
 * kept from an earlier version of the definition stays. A key the definition
 * does not have, or a removed field, is refused unless it is the value the
 * record already held. Values the write does not mention are kept.
 */
export function checkRecord(
  fields: CollectionField[],
  values: Record<string, unknown>,
  previous: RecordValues | null,
): RecordCheck {
  const data: RecordValues = { ...(previous ?? {}) };
  for (const [key, raw] of Object.entries(values)) {
    const field = fields.find((f) => f.key === key);
    if (!field || field.removed) {
      if (isEmpty(raw) || (previous && previous[key] === raw)) continue;
      return { ok: false, field: key, error: `There is no field ${key} to fill in.` };
    }
    if (previous && key in previous && previous[key] === raw) continue;
    const parsed = parseFieldValue(field, raw);
    if (!parsed.ok) return { ok: false, field: key, error: parsed.error };
    data[key] = parsed.value;
  }
  return { ok: true, data };
}

/**
 * The tracked fields a write changes, with their new values: what the
 * database writes to goals.readings. For showing what a save will record;
 * the rows themselves come from the trigger.
 */
export function trackedChanges(
  fields: CollectionField[],
  previous: RecordValues | null,
  next: RecordValues,
): { key: string; value: number }[] {
  return fields
    .filter((f) => f.tracked && !f.removed)
    .flatMap((f) => {
      const value = next[f.key];
      if (typeof value !== 'number') return [];
      if (previous && previous[f.key] === value) return [];
      return [{ key: f.key, value }];
    });
}

/** A collection's name, from a form. */
export function parseCollectionName(raw: unknown): Parsed<string> {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (name === '') return { ok: false, error: 'Name the collection.' };
  if (name.length > COLLECTION_NAME_MAX) {
    return { ok: false, error: `Keep the name under ${COLLECTION_NAME_MAX} characters.` };
  }
  return { ok: true, value: name };
}
