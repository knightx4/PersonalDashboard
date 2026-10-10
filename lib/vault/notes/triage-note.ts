import { createCapturedNote, type CreateNotePorts } from '@/lib/vault/notes/create';
import { saveNote, type SaveNotePorts } from '@/lib/vault/notes/save';
import { basenameOf, TRIAGE_NOTE_PATH, TRIAGE_NOTE_TITLE } from '@/lib/vault/paths';

/**
 * The Quick note triage note (plan #1732, feature #1726; decision #1731
 * answered B): a note at the top of the vault that lists every quick note
 * waiting in the Inbox, with its text, so it can be read in Obsidian.
 *
 * Dash owns the file and writes the whole of it each time a quick note is
 * added, filed or undone. To give an edit made in Obsidian as little to clash
 * with as it can:
 *
 * - the text is a pure function of the waiting quick notes, with no date or
 *   counter, so a rebuild that changes nothing writes nothing (no commit);
 * - it goes through the ordinary save, which refuses a file changed since it
 *   was stored, so a clash loses nothing. A refused rebuild is left for the
 *   next one, and the quick notes themselves are never touched by it;
 * - it is never created over a file already at the path (no numbered copy).
 *
 * It is outside the Inbox, so it is not a quick note, and the suggestions and
 * the place search leave it out (isTriageNotePath).
 */

/** A waiting quick note, as the note draws it. */
export type TriageNoteEntry = { path: string; body: string };

/** Longest quoted text for one quick note; the link above it opens the rest. */
const QUOTE_MAX_CHARS = 3000;

function quoted(body: string): string {
  const text = body.replace(/\r\n/g, '\n').trim();
  const cut =
    text.length > QUOTE_MAX_CHARS
      ? `${text.slice(0, QUOTE_MAX_CHARS).trimEnd()}\n\n(Cut short. Open the quick note for the rest.)`
      : text;
  return cut
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');
}

/** The whole note, from the waiting quick notes in the order given. */
export function renderTriageNote(entries: readonly TriageNoteEntry[]): string {
  const intro =
    'Dash keeps this note. It lists the quick notes waiting in your Inbox and is rewritten whenever one is added or filed, so edit the quick notes, not this note.';
  if (entries.length === 0) return `${intro}\n\nNothing is waiting.\n`;
  const count = entries.length === 1 ? '1 quick note waiting.' : `${entries.length} quick notes waiting.`;
  const sections = entries.map((entry) => {
    const target = entry.path.replace(/\.md$/i, '');
    return `## [[${target}|${basenameOf(entry.path)}]]\n\n${quoted(entry.body)}`;
  });
  return `${intro}\n\n${count}\n\n${sections.join('\n\n')}\n`;
}

export type TriageNotePorts = { save: SaveNotePorts; create: CreateNotePorts };

export type TriageNoteResult = 'written' | 'created' | 'unchanged' | 'skipped' | 'failed';

/**
 * Bring the note in line with the waiting quick notes. Never throws: this runs
 * after the person's own action, which has already succeeded.
 */
export async function syncTriageNote(
  ports: TriageNotePorts,
  entries: readonly TriageNoteEntry[],
): Promise<TriageNoteResult> {
  try {
    const text = renderTriageNote(entries);
    const existing = await ports.save.loadNote(TRIAGE_NOTE_PATH);
    if (!existing) {
      // Nothing to list and no note yet: do not put an empty note in the vault.
      if (entries.length === 0) return 'skipped';
      const created = await createCapturedNote(ports.create, text, TRIAGE_NOTE_TITLE, '', 1);
      if (!created.ok) console.error('[vault triage note] creating', created.error);
      return created.ok ? 'created' : 'failed';
    }
    if (existing.body.trim() === text.trim()) return 'unchanged';
    const saved = await saveNote(ports.save, {
      path: TRIAGE_NOTE_PATH,
      text,
      expectedBlobSha: existing.blobSha,
    });
    if (!saved.ok) console.error('[vault triage note] saving', saved.reason, saved.detail);
    return saved.ok ? 'written' : 'failed';
  } catch (error) {
    console.error('[vault triage note]', error instanceof Error ? error.message : error);
    return 'failed';
  }
}
