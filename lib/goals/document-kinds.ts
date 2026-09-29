/**
 * What each kind of document taught a form (plan #987; goals migration 0056).
 *
 * The first read of an NSLDS export, a servicer statement or a pay stub works
 * out which label fills which field, which labels are traps, and which fields
 * the form lacked. When the read is saved, that is kept as a document kind on
 * the collection: a name, how to recognise another of the kind, a note per
 * field, and the suggested fields the person left out. The next read is given
 * every kind the collection has learned, judges whether the document is one
 * of them, and follows that kind's notes, so it fills in without asking again.
 *
 * Whether two documents are the same kind is the reader's judgement against
 * each kind's name and recognise line, which the reader itself wrote the first
 * time and the person can edit. A fixed rule (a header line, a sender) would
 * need a different rule for each source, and a pasted page has no sender.
 *
 * Nothing here needs the model or the database: the prompt section, reading
 * the model's kind back, and working out what a saved read teaches.
 */

import {
  liveFields,
  parseFieldValue,
  type CollectionField,
  type FieldValue,
} from '@/lib/goals/collections';
import type { Caution } from '@/lib/goals/extract';

/** A kind of document one collection has learned. */
export type LearnedKind = {
  id: string;
  collectionId: string;
  name: string;
  /** How to tell a document is of this kind. */
  recognise: string;
  /** For each field key, which label fills it and what to avoid. */
  fieldNotes: Record<string, string>;
  /** Suggested fields the person left out, by the label the reader gave them. */
  skipped: string[];
  lastReadAt: string | null;
};

/** The longest a kind's name, recognise line, note and skipped label may be (migration 0056). */
export const KIND_NAME_MAX = 120;
export const RECOGNISE_MAX = 1000;
export const FIELD_NOTE_MAX = 1000;
export const SKIPPED_LABEL_MAX = 200;
export const SKIPPED_MAX = 60;

/** The prefix a field note's input carries on the step's edit form, before the field's key. */
export const KIND_NOTE_PREFIX = 'note:';

/** The most corrections one field's note keeps as examples. */
export const CORRECTIONS_KEPT = 3;

/** Two labels are the same when they match ignoring case, spaces and punctuation. */
export function sameLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * What the reader said about the document's kind: the known kind it judged
 * this to be (by id, or null for a kind not seen before), the name and
 * recognise line it would give the kind, and for each form field it filled,
 * the label in the document the value came from.
 */
export type KindRead = {
  knownId: string | null;
  name: string;
  recognise: string;
  labels: Record<string, string>;
};

/**
 * The part of the reader's instructions that lists the kinds already
 * learned. Empty when there are none, so a first read is asked only to name
 * the kind.
 */
export function kindsPrompt(kinds: LearnedKind[], fields: CollectionField[]): string {
  const naming = `In kind, say what kind of document this is:

- name: what someone would call it, in a few words, naming who issues it where that tells kinds apart ("NSLDS loan export", "Nelnet monthly statement", "Acme pay stub").
- recognise: one or two lines on how to tell another document of the same kind: its title or header line, who issues it, its layout or columns. Not the figures, which change from one to the next.
- labels: for each form field you filled, the label in the document its value came from, exactly as the document writes it.`;
  if (kinds.length === 0) return naming;

  const label = new Map(liveFields(fields).map((f) => [f.key, f.label]));
  const blocks = kinds.map((kind) => {
    const lines = [`Kind: "${kind.name}"`];
    if (kind.recognise) lines.push(`Recognise it by: ${kind.recognise}`);
    const notes = Object.entries(kind.fieldNotes).filter(([key, note]) => label.has(key) && note);
    if (notes.length > 0) {
      lines.push('Field notes:');
      for (const [key, note] of notes) lines.push(`- ${label.get(key)} (${key}): ${note}`);
    }
    if (kind.skipped.length > 0) {
      lines.push(`Left out on purpose, so do not list in extra: ${kind.skipped.join('; ')}`);
    }
    return lines.join('\n');
  });

  return `${naming}

This form has been filled from the kinds of document below before. Judge whether the document you are given is one of them by its name and what it says to recognise it by. If it is, set kind.known to that name exactly and keep its name; then fill each field as its note says, avoid the traps the note names, and leave out of extra everything listed as left out. If it is none of them, set kind.known to null.

${blocks.join('\n\n')}`;
}

/** The kind property of the reader's tool, drawn from the kinds already learned and the form's fields. */
export function kindSchema(kinds: LearnedKind[], fieldKeys: string[]): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      known: {
        type: ['string', 'null'],
        enum: [...kinds.map((k) => k.name), null],
        description: 'The name of the kind listed in the instructions that this document is, or null.',
      },
      name: { type: 'string', description: 'What someone would call this kind of document.' },
      recognise: {
        type: 'string',
        description: 'How to tell another document of the same kind: title, issuer, layout.',
      },
      labels: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string', enum: fieldKeys },
            label: { type: 'string', description: 'The label in the document, as it writes it.' },
          },
          required: ['field', 'label'],
        },
      },
    },
    required: ['known', 'name', 'recognise', 'labels'],
  };
}

/**
 * The kind the reader reported, or null when it gave none. A name that
 * matches a learned kind's is that kind even when the reader did not say so,
 * so one collection never holds two kinds of the same name.
 */
export function readKind(
  input: unknown,
  kinds: LearnedKind[],
  fields: CollectionField[],
): KindRead | null {
  const raw =
    input && typeof input === 'object' ? (input as { kind?: unknown }).kind : undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const k = raw as Record<string, unknown>;
  const text = (value: unknown, max: number) =>
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';

  const name = text(k.name, KIND_NAME_MAX);
  const recognise = text(k.recognise, RECOGNISE_MAX);
  const byName = (value: string) =>
    value ? kinds.find((kind) => sameLabel(kind.name) === sameLabel(value)) : undefined;
  const known = byName(text(k.known, KIND_NAME_MAX)) ?? byName(name);

  const keys = new Set(liveFields(fields).map((f) => f.key));
  const labels: Record<string, string> = {};
  if (Array.isArray(k.labels)) {
    for (const entry of k.labels) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      const field = typeof e.field === 'string' ? e.field : '';
      const label = text(e.label, SKIPPED_LABEL_MAX);
      if (keys.has(field) && label && !(field in labels)) labels[field] = label;
    }
  }

  if (!known && !name) return null;
  return {
    knownId: known?.id ?? null,
    name: known?.name ?? name,
    recognise: known?.recognise || recognise,
    labels,
  };
}

/** A value the person changed from what the reader gave, on one row. */
export type Correction = {
  key: string;
  /** What the reader gave, as the input showed it; empty when it found nothing. */
  read: string;
  /** What was saved. */
  saved: string;
  /** The row's ID value, naming which item it was on, when the form has an ID. */
  row: string | null;
};

/** A value in the one form an input shows it, so "12,450.00" and "12450" compare equal. */
export function shownValue(field: CollectionField, raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  const parsed = parseFieldValue(field, raw);
  if (!parsed.ok) return String(raw).trim();
  const value = parsed.value as FieldValue;
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

/**
 * The values the person corrected on the rows they saved. `read` is each
 * row as the reader filled it; `start` is what each input started from
 * where the reader found nothing (a saved record's value), so a value
 * carried over and left alone is not a correction; `saved` is what was
 * submitted. A field the reader left empty and the person filled counts:
 * the reader missed it.
 */
export function findCorrections(
  fields: CollectionField[],
  rows: {
    read: Record<string, string>;
    start: Record<string, string>;
    saved: Record<string, unknown>;
    id: string | null;
  }[],
): Correction[] {
  const out: Correction[] = [];
  for (const row of rows) {
    for (const field of liveFields(fields)) {
      const read = shownValue(field, row.read[field.key]);
      const began = read !== '' ? read : shownValue(field, row.start[field.key]);
      const saved = shownValue(field, row.saved[field.key]);
      if (saved === began) continue;
      if (saved === '' && read === '') continue;
      out.push({ key: field.key, read, saved, row: row.id });
    }
  }
  return out;
}

/** What a saved read teaches, beside the kind it read as. */
export type Lesson = {
  read: KindRead | null;
  /** The fields added from the reader's suggestions, with the label each came from. */
  added: { key: string; from: string }[];
  /** The labels of suggestions left out. */
  skipped: string[];
  cautions: Caution[];
  corrections: Correction[];
  /** The name to give a kind the reader did not name: the file's name, or "Pasted text". */
  fallbackName: string;
};

/** The kind as it should be stored, for an insert (no id) or an update. */
export type KindWrite = {
  id: string | null;
  name: string;
  recognise: string;
  fieldNotes: Record<string, string>;
  skipped: string[];
};

/**
 * The kind to write after a read is saved, or null when there is nothing to
 * write. A read the reader judged to be a learned kind always updates it,
 * even if only to date it. A new kind is written only when the read taught
 * something: a field added or left out, a trap the reader warned of, or a
 * value the person corrected. Existing notes are kept as written, since the
 * person may have edited them, and what is new is added after them while it
 * fits.
 */
export function learnKind(
  fields: CollectionField[],
  kinds: LearnedKind[],
  lesson: Lesson,
): KindWrite | null {
  const existing = lesson.read?.knownId
    ? (kinds.find((k) => k.id === lesson.read?.knownId) ?? null)
    : null;
  const taught =
    lesson.added.length > 0 ||
    lesson.skipped.length > 0 ||
    lesson.cautions.length > 0 ||
    lesson.corrections.length > 0;
  if (!existing && !taught) return null;

  const live = liveFields(fields);
  const keys = new Set(live.map((f) => f.key));
  const byLabel = new Map<string, string>();
  for (const { key, from } of lesson.added) if (from) byLabel.set(sameLabel(from), key);

  const fresh = new Map<string, string[]>();
  const say = (key: string, sentence: string) => {
    if (!keys.has(key)) return;
    fresh.set(key, [...(fresh.get(key) ?? []), sentence]);
  };
  for (const [key, label] of Object.entries(lesson.read?.labels ?? {})) {
    say(key, `Filled from "${label}".`);
  }
  for (const { key, from } of lesson.added) if (from) say(key, `Filled from "${from}".`);
  for (const caution of lesson.cautions) {
    const key = caution.field ?? byLabel.get(sameLabel(caution.label));
    if (key) say(key, `Trap: "${caution.label}": ${lowerFirst(caution.note)}`);
  }
  const perField = new Map<string, number>();
  for (const c of lesson.corrections) {
    const count = perField.get(c.key) ?? 0;
    if (count >= CORRECTIONS_KEPT) continue;
    perField.set(c.key, count + 1);
    const on = c.row ? ` for ${c.row}` : '';
    say(
      c.key,
      c.read
        ? `Corrected by hand${on}: the reader gave ${c.read}, the right value was ${c.saved}.`
        : `The reader found nothing here${on}; the right value was ${c.saved}.`,
    );
  }

  const fieldNotes: Record<string, string> = {};
  for (const [key, note] of Object.entries(existing?.fieldNotes ?? {})) {
    if (keys.has(key) && note.trim()) fieldNotes[key] = note.trim();
  }
  for (const [key, sentences] of fresh) {
    let note = fieldNotes[key] ?? '';
    for (const sentence of sentences) {
      if (note.includes(sentence)) continue;
      const next = note ? `${note} ${sentence}` : sentence;
      if (next.length > FIELD_NOTE_MAX) break;
      note = next;
    }
    if (note) fieldNotes[key] = note;
  }

  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const label of [...(existing?.skipped ?? []), ...lesson.skipped]) {
    const trimmed = label.trim().slice(0, SKIPPED_LABEL_MAX);
    if (!trimmed || seen.has(sameLabel(trimmed))) continue;
    // A label the form now has a field for is no longer left out.
    if (live.some((f) => sameLabel(f.label) === sameLabel(trimmed))) continue;
    seen.add(sameLabel(trimmed));
    skipped.push(trimmed);
  }

  return {
    id: existing?.id ?? null,
    name: existing?.name ?? (lesson.read?.name || lesson.fallbackName).slice(0, KIND_NAME_MAX),
    recognise: existing?.recognise || (lesson.read?.recognise ?? ''),
    fieldNotes,
    skipped: skipped.slice(-SKIPPED_MAX),
  };
}

function lowerFirst(text: string): string {
  const t = text.trim();
  return t ? t.charAt(0).toLowerCase() + t.slice(1) : t;
}

/**
 * The notes as the person edited them on the step: each live field's note,
 * trimmed, an empty one dropped. Keys that are not the collection's live
 * fields are left out.
 */
export function editedNotes(
  fields: CollectionField[],
  get: (key: string) => unknown,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of liveFields(fields)) {
    const raw = get(field.key);
    if (typeof raw !== 'string') continue;
    const note = raw.trim().slice(0, FIELD_NOTE_MAX);
    if (note) out[field.key] = note;
  }
  return out;
}
