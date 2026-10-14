/**
 * How much a vault note counts as evidence for an idea (plan #2006.3). Pure,
 * so the folder rule can be tested without a database; the matching is in
 * learn.vault_note_matches (migration learn 0122) and the writing in
 * ./notes-store.
 *
 * Your own writing counts fully. Bulk and Pending hold clippings, saved from
 * somewhere else, so a note there counts a quarter, unless you have written
 * into it since it arrived: obsidian.notes.written_at moves when a sync grows
 * a note by 200 characters of prose (vault 0025), so a written_at later than
 * created_at is a note you edited.
 */

/** Notes less alike than this back nothing. */
export const NOTE_MIN_SIMILARITY = 0.6;
/** Notes kept per idea, closest first. */
export const NOTES_PER_IDEA = 5;
/** What a clipping counts for, against 1 for your own writing. */
export const CLIPPING_WEIGHT = 0.25;

/** Top-level vault folders that hold clippings rather than your own writing. */
const CLIPPING_FOLDERS = new Set(['bulk', 'pending']);
/** A note stamped this long after it arrived has been written in since. */
const EDITED_AFTER_MS = 60_000;

/** One match as learn.vault_note_matches returns it. */
export type NoteMatch = {
  concept_id: string;
  note_id: string;
  path: string;
  title: string | null;
  similarity: number;
  created_at: string;
  written_at: string;
};

/** A link row for learn.evidence_links, without found_at so a refind keeps the first date. */
export type NoteLinkRow = {
  user_id: string;
  target_kind: 'idea';
  target_id: string;
  source_kind: 'note';
  source_id: string;
  similarity: number;
  weight: number;
  basis: string;
};

/** True when the note sits in a clippings folder. */
export function isClippingFolder(path: string): boolean {
  const top = path.split('/')[0]?.trim().toLowerCase() ?? '';
  return path.includes('/') && CLIPPING_FOLDERS.has(top);
}

/** True when the note grew after it first reached the app. */
export function wasEdited(note: { created_at: string; written_at: string }): boolean {
  const created = Date.parse(note.created_at);
  const written = Date.parse(note.written_at);
  if (!Number.isFinite(created) || !Number.isFinite(written)) return false;
  return written - created > EDITED_AFTER_MS;
}

/** 1 for your own writing or a clipping you wrote into, a quarter for an untouched clipping. */
export function noteWeight(note: { path: string; created_at: string; written_at: string }): number {
  if (isClippingFolder(note.path) && !wasEdited(note)) return CLIPPING_WEIGHT;
  return 1;
}

/** The note's title, or its file name when it has none. */
export function noteName(note: { path: string; title: string | null }): string {
  const title = note.title?.trim();
  if (title) return title;
  const file = note.path.split('/').pop() ?? note.path;
  return file.replace(/\.md$/i, '').trim() || note.path;
}

export function noteBasis(note: { path: string; title: string | null }): string {
  return `you wrote about this in ${noteName(note)}`;
}

/**
 * The link rows for a batch of matches: at most NOTES_PER_IDEA per idea, the
 * closest first, none below NOTE_MIN_SIMILARITY. The database already applies
 * both; they are applied again so the rule holds whatever it is asked.
 */
export function noteLinkRows(userId: string, matches: NoteMatch[]): NoteLinkRow[] {
  const byIdea = new Map<string, NoteMatch[]>();
  for (const match of matches) {
    if (!(match.similarity >= NOTE_MIN_SIMILARITY)) continue;
    const list = byIdea.get(match.concept_id) ?? [];
    list.push(match);
    byIdea.set(match.concept_id, list);
  }
  const rows: NoteLinkRow[] = [];
  for (const [ideaId, list] of byIdea) {
    const seen = new Set<string>();
    const kept = list
      .sort((a, b) => b.similarity - a.similarity || a.note_id.localeCompare(b.note_id))
      .filter((m) => (seen.has(m.note_id) ? false : (seen.add(m.note_id), true)))
      .slice(0, NOTES_PER_IDEA);
    for (const match of kept) {
      rows.push({
        user_id: userId,
        target_kind: 'idea',
        target_id: ideaId,
        source_kind: 'note',
        source_id: match.note_id,
        similarity: Math.min(1, Math.max(0, match.similarity)),
        weight: noteWeight(match),
        basis: noteBasis(match),
      });
    }
  }
  return rows;
}

/**
 * The ids of note links a refresh no longer finds: an existing link for an
 * idea in the batch whose note is not among the idea's fresh matches.
 */
export function staleLinkIds(
  existing: { id: string; target_id: string; source_id: string }[],
  fresh: { target_id: string; source_id: string }[],
): string[] {
  const keep = new Set(fresh.map((row) => `${row.target_id} ${row.source_id}`));
  return existing.filter((row) => !keep.has(`${row.target_id} ${row.source_id}`)).map((row) => row.id);
}
