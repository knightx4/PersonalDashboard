import 'server-only';

import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import { loadNote } from '@/lib/vault/notes/load';
import { loadNoteThread, saveThought, type MayaDb } from './store';
import { MAYA_THOUGHT_OPERATION, writeThought } from './thought';

/**
 * What asking Maya about a note came to: the thread her thought is in (or
 * the one the note already had), a plain word that she had nothing to say,
 * or what went wrong.
 */
export type AskMayaOutcome =
  | { kind: 'thread'; threadId: string; notePath: string; existing: boolean }
  | { kind: 'message'; detail: string }
  | { kind: 'error'; detail: string };

/**
 * Ask Maya about one note (plan #1588): Ask Maya on a note's page, and Dash's
 * ask_maya once approved (plan #2228.5).
 *
 * The note is read again on the person's own client, so RLS decides whether
 * it is theirs. A note that already has a thread is not sent again: the
 * answer is that thread. A thought with no points is not stored, so the note
 * can be asked about again once the vault around it has grown.
 */
export async function askMayaAbout(input: {
  db: MayaDb;
  userId: string;
  notePath: string;
  apiKey: string;
}): Promise<AskMayaOutcome> {
  const { db, userId, apiKey } = input;
  const note = await loadNote(db.vault, input.notePath);
  if (!note) return { kind: 'error', detail: 'That note is not in the vault any more.' };

  const existing = await loadNoteThread(db, note.id);
  if (existing) return { kind: 'thread', threadId: existing.id, notePath: note.path, existing: true };

  const spend = collectSpend();
  const written = await writeThought({
    vault: db.vault,
    userId,
    noteId: note.id,
    anthropicApiKey: apiKey,
    onSpend: spend.sink,
  });
  await recordLearnSpend(userId, MAYA_THOUGHT_OPERATION, spend.reports);

  if (!written.ok) {
    return written.reason === 'error' || written.reason === 'no-key'
      ? { kind: 'error', detail: written.detail }
      : { kind: 'message', detail: written.detail };
  }
  if (written.points.length === 0) {
    return { kind: 'message', detail: 'Maya read this note and had nothing worth saying about it yet.' };
  }

  const saved = await saveThought(db, { userId, noteId: note.id, origin: 'asked', written });
  if (!saved.ok) return { kind: 'error', detail: saved.detail };
  return { kind: 'thread', threadId: saved.threadId, notePath: note.path, existing: false };
}
