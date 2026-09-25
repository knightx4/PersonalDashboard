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
      },
      required: ['as_of', 'records'],
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
- as_of is the date the document says its figures are current as of: a statement date, or the date an export or report was requested or produced. Not today's date, and not a due date. Null when it states none.`;
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
  const records =
    input && typeof input === 'object' && Array.isArray((input as { records?: unknown }).records)
      ? ((input as { records: unknown[] }).records as unknown[])
      : [];
  const live = liveFields(fields);
  const rows: PreviewRow[] = [];
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
    const row: PreviewRow = {};
    let filled = false;
    for (const field of live) {
      const raw = (record as Record<string, unknown>)[field.key];
      const shown = previewValue(field, raw);
      row[field.key] = shown;
      if (shown !== '') filled = true;
    }
    if (filled) rows.push(row);
    if (rows.length >= (shape === 'one' ? 1 : ROWS_MAX)) break;
  }
  return rows;
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
