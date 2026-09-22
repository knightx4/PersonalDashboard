import { z } from 'zod';

/**
 * The rules the vault map applies to a note before and after a model reads it.
 *
 * Nothing here calls a model or the database, so each rule can be tested on
 * its own. They are the trials' findings written as code: the 75-note trial
 * (docs/trials/2026-09-19-map-75-notes.md) changed two routing rules, and
 * KNOWLEDGE-SPEC.md ("What the sweep must not read") adds two refusals.
 *
 * The learn module's classifier in lib/learn/vault still has four classes and
 * a 200-character floor. It is left alone because the Learn "from a note"
 * form reads through it, and these rules are the map's.
 */

// ------------------------------------------------------------ what is not read

/**
 * Folders whose notes are journals. The person's answer on plan #752: skip
 * everything in `Me/`. Matched on the first path segment, case as written.
 */
export const JOURNAL_FOLDERS = ['Me'] as const;

/**
 * Folders the person asked the map to leave out, matched as a path prefix so
 * a nested folder can be named without the rest of its parent. Job
 * applications are cover letters and forms, not what the person thinks about.
 */
export const EXCLUDED_FOLDERS = ['Career/Job Applications'] as const;

/**
 * Strings shaped like an API key. A note carrying one is never sent to a
 * model, since extraction would post the key to an API and could store it in
 * a quote.
 */
export const CREDENTIAL_PATTERN = /sk-ant-|sk-proj-|ghp_|AKIA[0-9A-Z]{16}/;

export type NotReadReason = 'journal' | 'excluded' | 'credential';

export type NotRead = { reason: NotReadReason; detail: string };

/**
 * Why this note must not be sent to a model, or null when it may be.
 *
 * The path is read here and nowhere after: the privacy page promises a note's
 * folder and path never reach a model.
 */
export function whyNotRead(note: { path: string; body: string }): NotRead | null {
  const folder = note.path.split('/')[0];
  if (note.path.includes('/') && (JOURNAL_FOLDERS as readonly string[]).includes(folder)) {
    return { reason: 'journal', detail: `Not read: notes in ${folder}/ are journals.` };
  }
  const excluded = EXCLUDED_FOLDERS.find((prefix) => note.path.startsWith(`${prefix}/`));
  if (excluded) {
    return { reason: 'excluded', detail: `Not read: ${excluded}/ is left out of the map.` };
  }
  if (CREDENTIAL_PATTERN.test(note.body)) {
    return {
      reason: 'credential',
      detail: 'Not read: the note contains what looks like an API key.',
    };
  }
  return null;
}

// ------------------------------------------------------------------- classify

/** Three classes. Evidence is a flag beside them, not a fourth. */
export const MAP_NOTE_CLASSES = ['knowledge', 'mixed', 'operational'] as const;
export type MapNoteClass = (typeof MAP_NOTE_CLASSES)[number];

/**
 * Below this a note is too short to state anything, and is answered without a
 * call. The trial moved it from 200 to 80: a 128-character note stating one
 * thing plainly was among the best sources in the sample.
 */
export const MIN_MAP_BODY_CHARS = 80;

export function tooShortForMap(body: string): boolean {
  return body.trim().length < MIN_MAP_BODY_CHARS;
}

export const mapClassifySchema = z.object({
  class: z.enum(MAP_NOTE_CLASSES),
  is_evidence: z.boolean().default(false),
  reason: z.string().trim().min(1).max(300),
});

export type MapVerdict = {
  noteClass: MapNoteClass;
  /** The note evidences what somebody was taught. It is still read. */
  isEvidence: boolean;
  reason: string;
};

export function readsForMap(noteClass: MapNoteClass): boolean {
  return noteClass !== 'operational';
}

// ----------------------------------------------------------------- stance

/**
 * Obsidian's callout for a note a model wrote, e.g. `> [!note] Created by
 * Claude`. Every position from such a note is `generated`, whatever the model
 * reading it says: nothing inside the note attributes the ideas elsewhere, so
 * the trial's reader marked all fifteen from one of these `held`.
 */
const GENERATED_CALLOUT = /^\s*>\s*\[![^\]]+\][-+]?[^\n]*\bcreated by (claude|chatgpt|an? ai)\b/im;

export function isGenerated(body: string): boolean {
  return GENERATED_CALLOUT.test(body);
}

// ----------------------------------------------------------------- quotes

/**
 * The quote as it will be stored, or null when the note does not contain it.
 *
 * Checked character for character, as QUOTE_RULE tells the model. Only
 * whitespace at either end is removed first, which changes nothing inside the
 * sentence. obsidian.accept_note_map runs the same check again with strpos.
 */
export function quoteInNote(quote: string, body: string): string | null {
  const trimmed = quote.trim();
  if (trimmed.length === 0) return null;
  return body.includes(trimmed) ? trimmed : null;
}
