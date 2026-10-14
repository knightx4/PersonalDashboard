import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { createQuiz, type NewQuizSource } from '@/lib/learn/quiz/save';
import { quizTitle } from '@/lib/learn/quiz/model';
import { fetchLinkMeta, saveLink } from '@/lib/learn/tracks/link';
import { addManualReading, createTrack } from '@/lib/learn/tracks/save';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import type { LearnReadingWritten, LearnTopicWritten, LearnQuizWritten } from '@/lib/capture/file';

/**
 * Capture's Learn writers (plan #1950.4), bound to the signed-in person in
 * app/capture-actions.ts. Each goes through the write its page used to call:
 * saveLink for a reading, createTrack and addManualReading for a topic and
 * the list pasted under it, createQuiz for a quiz. None throws; a failure is
 * the sentence the panel shows.
 */

export async function writeReading(
  learn: LearnSupabaseClient,
  userId: string,
  url: string,
): Promise<LearnReadingWritten> {
  try {
    const saved = await saveLink(learn, userId, { url, meta: await fetchLinkMeta(url) });
    return { ok: true, readingId: saved.readingId, title: saved.title, created: saved.created };
  } catch (error) {
    console.error('capture: saving a reading failed', error);
    return { ok: false, error: 'That link did not save. Try again.' };
  }
}

export async function writeTopic(
  learn: LearnSupabaseClient,
  userId: string,
  input: { title: string; readings: readonly { title: string; why: string | null }[] },
): Promise<LearnTopicWritten> {
  let trackId: string;
  try {
    trackId = await createTrack(learn, userId, { title: input.title, question: null });
  } catch (error) {
    console.error('capture: starting a topic failed', error);
    return { ok: false, error: 'Could not start that topic. Try again.' };
  }
  // In order, since each is appended after the last. A reading that fails
  // leaves the topic and the ones before it; the count says how many went in.
  let readings = 0;
  for (const reading of input.readings) {
    try {
      await addManualReading(learn, userId, { trackId, title: reading.title, why: reading.why });
      readings += 1;
    } catch (error) {
      console.error('capture: adding a reading to a new topic failed', error);
      break;
    }
  }
  return { ok: true, trackId, readings };
}

/** Escape what ilike reads as a wildcard, so a title is matched as written. */
function literal(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function writeQuiz(
  learn: LearnSupabaseClient,
  vault: (() => Promise<VaultSupabaseClient>) | null,
  userId: string,
  input: { paste: string; notes: readonly string[] },
): Promise<LearnQuizWritten> {
  const noteIds: string[] = [];
  const noteNames: string[] = [];
  if (input.notes.length > 0) {
    if (!vault) return { ok: false, error: 'Notes can be named only with the vault switched on.' };
    const client = await vault();
    for (const name of input.notes) {
      const { data, error } = await client
        .from('notes')
        .select('id, title')
        .ilike('title', literal(name))
        .is('deleted_at', null)
        .limit(1);
      if (error) {
        console.error('capture: finding a note for a quiz failed', error);
        return { ok: false, error: 'Your vault could not be read. Try again.' };
      }
      const note = (data as { id: string; title: string }[] | null)?.[0];
      if (!note) return { ok: false, error: `There is no note called ${name} in your vault.` };
      if (!noteIds.includes(note.id)) {
        noteIds.push(note.id);
        noteNames.push(note.title);
      }
    }
  }

  const sources: NewQuizSource[] = noteIds.map((noteId) => ({ noteId }));
  if (input.paste) sources.push({ body: input.paste });
  const title = quizTitle({ noteNames, today: new Date().toISOString().slice(0, 10) });
  try {
    const quizId = await createQuiz(learn, userId, { title, preparingFor: null, sources });
    return { ok: true, quizId, title };
  } catch (error) {
    console.error('capture: starting a quiz failed', error);
    return { ok: false, error: 'Could not start that quiz. Try again.' };
  }
}
