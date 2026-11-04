import { z } from 'zod';

/**
 * The rules the vault map applies to a note before and after a model reads it.
 *
 * Nothing here calls a model or the database, so each rule can be tested on
 * its own. They are the trials' findings written as code: the 75-note trial
 * (a trial write-up, not kept in the repository because it quoted the person's own data) changed two routing rules, and
 * KNOWLEDGE-SPEC.md ("What the sweep must not read") adds two refusals.
 *
 * The learn module's classifier in lib/learn/vault still has four classes and
 * a 200-character floor. It is left alone because the Learn "from a note"
 * form reads through it, and these rules are the map's.
 */

// ------------------------------------------------------------ what is not read

/**
 * The folders of a vault whose notes are never sent to a model. Each person
 * sets their own on the vault settings page; they are kept on
 * obsidian.vault_connections (journal_folders, excluded_folders) and read by
 * loadVaultRules in ./vault-rules.ts.
 *
 * Both lists match a note's path as a folder prefix, ignoring case, so
 * `Journal` covers `journal/2026-10-01.md` and `Career/Job Applications`
 * covers that folder without the rest of `Career`. A note at the vault's top
 * level is in no folder and matches neither.
 *
 * - journalFolders: folders whose notes are journals.
 * - excludedFolders: folders the person asked the map to leave out.
 */
export type VaultRules = {
  journalFolders: readonly string[];
  excludedFolders: readonly string[];
};

/**
 * The rules for a person who has set none, equal to the column defaults in
 * supabase/migrations-vault/0041_vault_private_folders.sql. A call that cannot
 * read the person's own rules uses these, so the guard is never off.
 */
export const DEFAULT_VAULT_RULES: VaultRules = {
  journalFolders: ['Me', 'Journal', 'Journals', 'Diary', 'Private'],
  excludedFolders: [],
};

/** A folder as typed, without slashes or spaces around its segments. */
export function cleanFolder(folder: string): string {
  return folder
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('/');
}

/** The first of `folders` that holds `path`, as the person wrote it. */
function folderHolding(path: string, folders: readonly string[]): string | null {
  const lower = path.toLowerCase();
  for (const folder of folders) {
    const clean = cleanFolder(folder);
    if (clean && lower.startsWith(`${clean.toLowerCase()}/`)) return clean;
  }
  return null;
}

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
 *
 * `rules` are the person's own (loadVaultRules); left out, the defaults apply.
 */
export function whyNotRead(
  note: { path: string; body: string },
  rules: VaultRules = DEFAULT_VAULT_RULES,
): NotRead | null {
  const journal = folderHolding(note.path, rules.journalFolders);
  if (journal) {
    // Named as the path spells it, which is what the person sees in the vault.
    const folder = note.path.slice(0, journal.length);
    return { reason: 'journal', detail: `Not read: notes in ${folder}/ are journals.` };
  }
  const excluded = folderHolding(note.path, rules.excludedFolders);
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
  /**
   * One sentence on why, shown to the person. Haiku writes it; Jev gives
   * none, so a verdict Jev was sure of has null here (plan #1168).
   */
  reason: string | null;
  /** Jev's confidence in the class, when Jev's answer is the one used. */
  confidence?: number;
};

/** What the sweep records for a note it did not read, from the verdict. */
export function notReadDetail(verdict: MapVerdict): string {
  if (verdict.reason) return `Not read: ${verdict.reason}`;
  const sure =
    verdict.confidence === undefined ? '' : ` (${Math.round(verdict.confidence * 100)}% sure)`;
  return `Not read: judged a record with nothing argued${sure}.`;
}

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
