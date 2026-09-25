/**
 * Filling a form from pasted text or a document (plan #955; docs/GOALS-SPEC.md,
 * "Four ways to fill a form", the second way).
 *
 * You paste a servicer page or drop in a statement, the model reads it
 * against the collection's definition, and the form comes back filled in for
 * you to check. Nothing is saved until you confirm. This file holds the parts
 * that do not need the model: which files can be read, where one is kept, the
 * tool the model answers through, and turning its answer into the values the
 * form starts from. The call itself is lib/goals/extract-model.ts.
 */

import {
  FIELD_KEY_PATTERN,
  FIELD_TYPES,
  ID_TYPES,
  LABEL_MAX,
  OPTIONS_MAX,
  idField,
  liveFields,
  parseFieldValue,
  type CollectionField,
  type CollectionShape,
  type FieldValue,
  type RecordValues,
} from '@/lib/goals/collections';
import { inputValue } from '@/lib/goals/information';

/** The private bucket documents are kept in (goals migration 0011). */
export const DOCUMENT_BUCKET = 'goals-documents';

/** The bucket refuses anything larger, and the model reads a PDF of up to 32 MB. */
export const DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;

/** A paste longer than this is cut, which is still several statements' worth. */
export const PASTE_MAX = 100_000;

/** The most rows one read fills in. */
export const ROWS_MAX = 50;

/** The most fields one read suggests adding, and the most cautions it hands back (plan #986). */
export const SUGGESTIONS_MAX = 20;
export const CAUTIONS_MAX = 10;

/** The longest reason or caution note kept from the model. */
export const NOTE_MAX = 300;

export type DocumentKind =
  | { kind: 'pdf' }
  | { kind: 'image'; mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' }
  | { kind: 'docx' }
  | { kind: 'text' };

const IMAGE_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
} as const;

/** The content type a file is uploaded with, by its extension, or null when the form cannot read it. */
export function documentContentType(name: string): string | null {
  const kind = documentKind(name);
  if (!kind) return null;
  switch (kind.kind) {
    case 'pdf':
      return 'application/pdf';
    case 'image':
      return kind.mediaType;
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'text': {
      const ext = extension(name);
      return ext === 'csv' ? 'text/csv' : ext === 'html' || ext === 'htm' ? 'text/html' : 'text/plain';
    }
  }
}

/**
 * What a file is, by its extension. The older .doc format is not read: it
 * is a binary format with no reader here, and Word saves .docx by default.
 */
export function documentKind(name: string): DocumentKind | null {
  const ext = extension(name);
  if (ext === 'pdf') return { kind: 'pdf' };
  if (ext in IMAGE_TYPES) {
    return { kind: 'image', mediaType: IMAGE_TYPES[ext as keyof typeof IMAGE_TYPES] };
  }
  if (ext === 'docx') return { kind: 'docx' };
  if (ext === 'txt' || ext === 'csv' || ext === 'html' || ext === 'htm') return { kind: 'text' };
  return null;
}

function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/**
 * Where a file is kept: your own folder, then a fresh id so two statements
 * with the same name do not collide. The name keeps letters, digits, dots,
 * dashes and underscores, which storage accepts in any position.
 */
export function documentPath(userId: string, id: string, name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|-+$/g, '')
    .slice(-100);
  return `${userId}/${id}-${cleaned || 'document'}`;
}

/** Whether a path is one of yours in the shape documentPath makes. */
export function ownsDocumentPath(userId: string, path: string): boolean {
  if (!path.startsWith(`${userId}/`)) return false;
  const rest = path.slice(userId.length + 1);
  return /^[0-9a-f-]{36}-[A-Za-z0-9._-]{1,100}$/.test(rest);
}

/** The one tool the model answers through. */
export const EXTRACT_TOOL = 'fill_form';

type JsonSchema = Record<string, unknown>;

function valueSchema(field: CollectionField): JsonSchema {
  const nullable = (type: string, extra: JsonSchema = {}) => ({ type: [type, 'null'], ...extra });
  switch (field.type) {
    case 'number':
      return nullable('number', { description: field.label });
    case 'money':
      return nullable('number', { description: `${field.label}, as an amount without the currency sign` });
    case 'percent':
      return nullable('number', { description: `${field.label}, as a percentage: 6.8 for 6.8%` });
    case 'day_of_month':
      return nullable('integer', { description: `${field.label}, the day of the month from 1 to 31` });
    case 'date':
      return nullable('string', { description: `${field.label}, as YYYY-MM-DD` });
    case 'yes_no':
      return nullable('boolean', { description: field.label });
    case 'choice':
      return {
        type: ['string', 'null'],
        enum: [...(field.options ?? []), null],
        description: field.label,
      };
    case 'link':
      return nullable('string', { description: `${field.label}, a web address` });
    default:
      return nullable('string', { description: field.label });
  }
}

/** The tool definition, drawn from the fields the form shows. */
export function extractionTool(fields: CollectionField[]): {
  name: string;
  description: string;
  input_schema: JsonSchema;
} {
  const properties: Record<string, JsonSchema> = {};
  for (const field of liveFields(fields)) properties[field.key] = valueSchema(field);
  return {
    name: EXTRACT_TOOL,
    description: 'Fill in the form with the values the text or document gives.',
    input_schema: {
      type: 'object',
      properties: {
        as_of: {
          type: ['string', 'null'],
          description:
            'The date the figures are current as of, as YYYY-MM-DD: the statement date, or the date the export or page was produced. Null when it gives none.',
        },
        records: {
          type: 'array',
          items: { type: 'object', properties, required: Object.keys(properties) },
        },
        extra: {
          type: 'array',
          description:
            'Facts the document gives about its items that no field in the form holds, one entry per fact. Empty when there are none.',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'A short name for the field, as a form would label it.' },
              type: { type: 'string', enum: [...FIELD_TYPES] },
              options: {
                type: ['array', 'null'],
                items: { type: 'string' },
                description: 'For a choice field, the values it can take. Null for any other type.',
              },
              identifies: {
                type: 'boolean',
                description: 'True when the value names the item, such as a loan or account number.',
              },
              values: {
                type: 'array',
                items: { type: ['string', 'number', 'boolean', 'null'] },
                description:
                  'One value for each entry in records, in the same order, written as that field type is in records. Null where the item has none.',
              },
              why: { type: 'string', description: 'One line on what someone tracking this could use it for.' },
            },
            required: ['label', 'type', 'options', 'identifies', 'values', 'why'],
          },
        },
        caution: {
          type: 'array',
          description:
            'Labels in the document that do not mean what their name says. Empty when there are none.',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'The label exactly as the document writes it.' },
              field: {
                type: ['string', 'null'],
                enum: [...Object.keys(properties), null],
                description: 'The key of the form field that label would seem to fill, or null when it fills none.',
              },
              note: { type: 'string', description: 'One line on what the value really is, and for which items.' },
            },
            required: ['label', 'field', 'note'],
          },
        },
      },
      required: ['as_of', 'records', 'extra', 'caution'],
    },
  };
}

/** The instructions for one read, naming the collection and whether it is one record or a list. */
export function extractionPrompt(name: string, shape: CollectionShape): string {
  const what =
    shape === 'one'
      ? `It is a single record, so return at most one.`
      : `It is a list with one record per item (for example one per loan), so return one record for each item the text describes.`;
  return `You fill in a form called "${name}" from text or a document the owner of a personal goals tracker gave you, such as a lender's web page, a statement or a screenshot. ${what}

Rules:

- Fill a field only with a value the text or document states. Do not guess, work out or carry a value over from one item to another; leave it null.
- Amounts of money are plain numbers without currency signs or thousands separators: 12450.37.
- Percentages are the number shown: 6.8 for 6.8%.
- Dates are YYYY-MM-DD. A day of the month is the day alone, 1 to 31.
- A choice field takes one of its listed options exactly, or null.
- When the document shows the same item more than once, such as a summary and a detail page for one loan, return it once.
- If nothing in it fits the form, return an empty list.
- as_of is the date the document says its figures are current as of: a statement date, or the date an export or report was requested or produced. Not today's date, and not a due date. Null when it states none.

The form may not have a place for everything useful in the document. In extra, list each other fact the document gives about its items that someone tracking them could use, such as a status and the date it began, a next due date, the principal and interest a balance is made of, or a number that identifies each item:

- Give it a short label and the type that fits: text, long_text, number, money, percent, date, day_of_month, yes_no, choice (with its options) or link.
- values holds one value for each entry in records, in the same order, null where that item has none.
- Mark identifies for a number or code that names each item, such as a loan or account number.
- why is one line on what a goal might use it for.
- Leave out anything a form field already holds, totals across items, contact details, addresses, and the document's own headings and page furniture.

In caution, list any label whose value does not mean what its name says, for all items or for some. Check each date against the item's type, status and other dates before trusting its label: a field called a start date that, for some kinds of item, holds when the money was paid out rather than when payments begin is one to list. Name the label as the document writes it, the form field it would seem to fill (null when none does), and one line on what the value really is and which items it applies to.`;
}

/** What the form starts from: each row's values as their inputs show them. */
export type PreviewRow = Record<string, string>;

/**
 * Turn the model's answer into the rows the form starts from. A value the
 * form would refuse is kept as the model wrote it, so it shows in its input
 * for you to correct and the save names the field. Rows with nothing filled
 * are dropped, and a one-record collection keeps only the first.
 */
export function readExtraction(
  fields: CollectionField[],
  shape: CollectionShape,
  input: unknown,
): PreviewRow[] {
  return extractRows(fields, shape, input).rows;
}

/** The rows, and for each the index of the record in the answer it came from. */
function extractRows(
  fields: CollectionField[],
  shape: CollectionShape,
  input: unknown,
): { rows: PreviewRow[]; from: number[] } {
  const records = listOf(input, 'records');
  const live = liveFields(fields);
  const rows: PreviewRow[] = [];
  const from: number[] = [];
  for (const [index, record] of records.entries()) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
    const row: PreviewRow = {};
    let filled = false;
    for (const field of live) {
      const raw = (record as Record<string, unknown>)[field.key];
      const shown = previewValue(field, raw);
      row[field.key] = shown;
      if (shown !== '') filled = true;
    }
    if (filled) {
      rows.push(row);
      from.push(index);
    }
    if (rows.length >= (shape === 'one' ? 1 : ROWS_MAX)) break;
  }
  return { rows, from };
}

function listOf(input: unknown, key: string): unknown[] {
  if (!input || typeof input !== 'object') return [];
  const list = (input as Record<string, unknown>)[key];
  return Array.isArray(list) ? list : [];
}

/**
 * A field the document has and the form lacks (plan #986): the field as it
 * would be added, its value for each preview row as the input would show
 * it, and why a goal might use it.
 */
export type SuggestedField = {
  field: CollectionField;
  values: string[];
  why: string;
};

/**
 * A label in the document that does not mean what its name says (plan
 * #986). `field` is the key of the form field it would seem to fill, or
 * null when it fills none.
 */
export type Caution = { label: string; field: string | null; note: string };

/** Everything one read hands back: the rows, their date, and what the form has no place for. */
export type ReadAnswer = {
  rows: PreviewRow[];
  asOf: string | null;
  suggestions: SuggestedField[];
  cautions: Caution[];
};

export function readAnswer(
  fields: CollectionField[],
  shape: CollectionShape,
  input: unknown,
): ReadAnswer {
  const { rows, from } = extractRows(fields, shape, input);
  return {
    rows,
    asOf: readAsOf(input),
    suggestions: readSuggestions(fields, input, from),
    cautions: readCautions(fields, input),
  };
}

/**
 * The fields the model found that the form lacks, each with a fresh key and
 * a value per row. `from` is, for each preview row, the index of the record
 * it came from, so a value lines up with its row when empty records were
 * dropped. A suggestion is left out when its label is one the form already
 * shows, when it repeats an earlier one, or when no row has a value for it.
 * A suggestion the model marks as identifying becomes the ID only when the
 * form has none and its type can be one.
 */
export function readSuggestions(
  fields: CollectionField[],
  input: unknown,
  from: number[],
): SuggestedField[] {
  const live = liveFields(fields);
  const shown = new Set(live.flatMap((f) => [sameLabel(f.label), sameLabel(f.key)]));
  const taken = new Set(fields.map((f) => f.key));
  let hasId = idField(fields) !== null;
  const out: SuggestedField[] = [];
  for (const entry of listOf(input, 'extra')) {
    if (out.length >= SUGGESTIONS_MAX) break;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const label = typeof e.label === 'string' ? e.label.trim().slice(0, LABEL_MAX) : '';
    if (!label || shown.has(sameLabel(label))) continue;
    let type = FIELD_TYPES.find((t) => t === e.type);
    if (!type) continue;
    const options = type === 'choice' ? choiceOptions(e.options) : null;
    if (type === 'choice' && !options) type = 'text';

    const key = suggestedKey(label, taken);
    const field: CollectionField = { key, label, type };
    if (options) field.options = options;
    if (e.identifies === true && !hasId && ID_TYPES.has(type)) field.id = true;

    const raw = Array.isArray(e.values) ? e.values : [];
    const values = from.map((index) => previewValue(field, raw[index]));
    if (values.every((v) => v === '')) continue;

    shown.add(sameLabel(label));
    taken.add(key);
    if (field.id) hasId = true;
    const why = typeof e.why === 'string' ? e.why.trim().slice(0, NOTE_MAX) : '';
    out.push({ field, values, why });
  }
  return out;
}

/** The labels in the document the model warned about, naming a form field only when it is one the form shows. */
export function readCautions(fields: CollectionField[], input: unknown): Caution[] {
  const keys = new Set(liveFields(fields).map((f) => f.key));
  const out: Caution[] = [];
  for (const entry of listOf(input, 'caution')) {
    if (out.length >= CAUTIONS_MAX) break;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const label = typeof e.label === 'string' ? e.label.trim().slice(0, LABEL_MAX) : '';
    const note = typeof e.note === 'string' ? e.note.trim().slice(0, NOTE_MAX) : '';
    if (!label || !note) continue;
    const field = typeof e.field === 'string' && keys.has(e.field) ? e.field : null;
    out.push({ label, field, note });
  }
  return out;
}

function sameLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function choiceOptions(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const options = [
    ...new Set(
      raw
        .filter((o): o is string => typeof o === 'string')
        .map((o) => o.trim().slice(0, LABEL_MAX))
        .filter(Boolean),
    ),
  ].slice(0, OPTIONS_MAX);
  return options.length > 0 ? options : null;
}

/**
 * A key for a new field, drawn from its label and not one the collection
 * has used, removed fields included: "Next payment due" is next_payment_due,
 * and a second one next_payment_due_2.
 */
export function suggestedKey(label: string, taken: ReadonlySet<string>): string {
  let base = label
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 36)
    .replace(/_+$/, '');
  if (!/^[a-z]/.test(base)) base = `field_${base}`.replace(/_+$/, '').slice(0, 36);
  let key = base;
  for (let n = 2; taken.has(key) || !FIELD_KEY_PATTERN.test(key); n++) key = `${base}_${n}`;
  return key;
}

function previewValue(field: CollectionField, raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') return '';
  const parsed = parseFieldValue(field, raw);
  if (parsed.ok) return inputValue(field, parsed.value as FieldValue);
  return String(raw).trim();
}

/**
 * The date the model read the figures as of, or null when it gave none or
 * gave something that is not a real YYYY-MM-DD date.
 */
export function readAsOf(input: unknown): string | null {
  const raw =
    input && typeof input === 'object' ? (input as { as_of?: unknown }).as_of : undefined;
  return typeof raw === 'string' ? parseDate(raw.trim()) : null;
}

/** A YYYY-MM-DD string that names a real day, or null. */
export function parseDate(raw: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const day = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== raw) return null;
  return raw < '1900-01-01' ? null : raw;
}

/**
 * The value a row is matched on: the ID field's value in one form, so
 * " ab-12 " typed and "AB-12" stored are the same loan. Null when the value
 * is empty or not valid for the field.
 */
export function idKey(field: CollectionField, raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const parsed = parseFieldValue(field, raw);
  if (!parsed.ok || parsed.value === null) return null;
  return String(parsed.value).trim().replace(/\s+/g, ' ').toLowerCase() || null;
}

/**
 * Which live record each read row updates (plan #985): the one whose ID
 * field holds the same value, or null for a row that adds a record. A
 * collection with no ID field matches nothing. Rows are values as the form
 * shows them or as stored; records are in position order, and the first
 * with a value wins.
 */
export function matchRows(
  fields: CollectionField[],
  rows: Record<string, unknown>[],
  records: { id: string; data: RecordValues }[],
): (string | null)[] {
  const field = idField(fields);
  if (!field) return rows.map(() => null);
  const byKey = new Map<string, string>();
  for (const record of records) {
    const key = idKey(field, record.data[field.key]);
    if (key !== null && !byKey.has(key)) byKey.set(key, record.id);
  }
  return rows.map((row) => {
    const key = idKey(field, row[field.key]);
    return key === null ? null : (byKey.get(key) ?? null);
  });
}

/**
 * The prefix a preview row's inputs carry before the field's own name, so one
 * form can hold every row: `r2:v:balance` is the third row's balance.
 */
export function previewRowPrefix(row: number): string {
  return `r${row}:`;
}
