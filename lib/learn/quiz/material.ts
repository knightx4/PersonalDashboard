import 'server-only';

import type { QuizSource } from '@/lib/learn/quiz/model';
import { createVaultClient } from '@/lib/vault/auth/server';
import { loadNotesByIds } from '@/lib/vault/notes/load';

/**
 * The material a quiz is over, read at the moment it is asked for.
 *
 * A note's body lives in the vault and is never copied into the learn schema,
 * which is the rule the todo module already holds to for rows belonging to
 * another schema: two copies of a note disagree the moment the vault syncs. So
 * the quiz stores an id and this is where that id turns back into text.
 *
 * A note deleted from the vault since comes back with no text at all rather
 * than failing the read. The quiz outlives its material, and a result page
 * that cannot say where a question came from is better than one that will not
 * render.
 */

export type QuizMaterial = {
  sourceId: string;
  position: number;
  /** What to call this piece of material on screen. */
  label: string;
  /** The text the questions are written from. Null on a note that is gone. */
  text: string | null;
  /** Where to read it, when it is a note that still exists. */
  href: string | null;
};

/** Enough of a paste to tell two of them apart in a list. */
function pasteLabel(body: string): string {
  const text = body.replace(/\s+/g, ' ').trim();
  return text.length > 60 ? `“${text.slice(0, 59)}…”` : `“${text}”`;
}

export async function readQuizMaterial(
  sources: readonly QuizSource[],
): Promise<QuizMaterial[]> {
  const noteIds = sources
    .map((source) => source.noteId)
    .filter((id): id is string => id !== null);

  const notes = noteIds.length > 0 ? await loadNotesByIds(await createVaultClient(), noteIds) : [];
  const byId = new Map(notes.map((note) => [note.id, note]));

  return sources.map((source) => {
    if (source.noteId === null) {
      return {
        sourceId: source.id,
        position: source.position,
        label: pasteLabel(source.body ?? ''),
        text: source.body,
        href: null,
      };
    }

    const note = byId.get(source.noteId);
    if (!note) {
      return {
        sourceId: source.id,
        position: source.position,
        label: 'A note that is no longer in the vault',
        text: null,
        href: null,
      };
    }

    return {
      sourceId: source.id,
      position: source.position,
      label: note.title,
      text: note.body,
      href: `/vault/n/${note.path.split('/').map(encodeURIComponent).join('/')}`,
    };
  });
}
