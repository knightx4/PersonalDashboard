import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { readStoredPoints } from './thought';
import type { MayaPoint, MayaSynthesis } from './verify';

/**
 * Storing Maya's thoughts and reading the latest one back (plan #1285).
 *
 * One thread per note (unique on user_id, note_id). The first thought on a
 * note opens the thread with the question the thought named; a later one goes
 * into the same thread as a new 'thought' message and leaves the question
 * alone, since the person may have rewritten it on the thread page.
 *
 * The writes go through the session client, so RLS decides whose note it is.
 * The hourly job (plan #1288) can pass a service client instead and origin
 * 'automatic'. storeThought takes a store rather than a client so the tests
 * can drive it in memory.
 */

/** What storeThought needs from writeThought's result. */
export type ThoughtToStore = {
  question: string;
  body: string;
  points: unknown[];
  noteBlobSha: string | null;
  model: string;
};

export type ThreadRow = { id: string; question: string };

export type MayaThreadStore = {
  /** The person's thread on this note, if there is one. */
  findThread(noteId: string): Promise<ThreadRow | null>;
  /** Opens the thread. Returns null when one already exists (a unique conflict). */
  insertThread(row: {
    noteId: string;
    question: string;
    origin: 'asked' | 'automatic';
  }): Promise<ThreadRow | null>;
  /** Moves the thread to the top of the Maya tab without changing anything the person wrote. */
  touchThread(thread: ThreadRow): Promise<void>;
  insertThought(threadId: string, thought: ThoughtToStore): Promise<void>;
};

export type StoredThought = { threadId: string; question: string; opened: boolean };

/** Puts one thought in the note's thread, opening the thread if it has none. Throws on a failed write. */
export async function storeThought(
  store: MayaThreadStore,
  input: { noteId: string; origin: 'asked' | 'automatic'; thought: ThoughtToStore },
): Promise<StoredThought> {
  let thread = await store.findThread(input.noteId);
  let opened = false;
  if (!thread) {
    thread = await store.insertThread({
      noteId: input.noteId,
      question: input.thought.question,
      origin: input.origin,
    });
    opened = thread !== null;
    // Somebody else opened it between the look and the insert: use theirs.
    thread ??= await store.findThread(input.noteId);
    if (!thread) throw new Error('maya: the thread could not be opened');
  } else {
    await store.touchThread(thread);
  }
  await store.insertThought(thread.id, input.thought);
  return { threadId: thread.id, question: thread.question, opened };
}

/** The store over a vault client, for one person. Every query names the account. */
export function mayaThreadStore(vault: VaultSupabaseClient, userId: string): MayaThreadStore {
  const fail = (what: string, message: string) => new Error(`maya: ${what} failed (${message})`);

  return {
    async findThread(noteId) {
      const { data, error } = await vault
        .from('maya_threads')
        .select('id, question')
        .eq('user_id', userId)
        .eq('note_id', noteId)
        .maybeSingle();
      if (error) throw fail('reading the thread', error.message);
      return (data as ThreadRow | null) ?? null;
    },

    async insertThread({ noteId, question, origin }) {
      const { data, error } = await vault
        .from('maya_threads')
        .insert({ user_id: userId, note_id: noteId, question, origin })
        .select('id, question')
        .single();
      if (error?.code === '23505') return null;
      if (error) throw fail('opening the thread', error.message);
      return data as ThreadRow;
    },

    async touchThread(thread) {
      // Writing the question back as it is fires the updated_at trigger, and
      // question is one of the three columns the owner may update.
      const { error } = await vault
        .from('maya_threads')
        .update({ question: thread.question })
        .eq('user_id', userId)
        .eq('id', thread.id);
      if (error) throw fail('touching the thread', error.message);
    },

    async insertThought(threadId, thought) {
      const { error } = await vault.from('maya_messages').insert({
        thread_id: threadId,
        user_id: userId,
        role: 'maya',
        kind: 'thought',
        body: thought.body,
        points: thought.points,
        note_blob_sha: thought.noteBlobSha,
        model: thought.model,
      });
      if (error) throw fail('storing the thought', error.message);
    },
  };
}

/** A note's thread as the note page shows it. */
export type NoteThread = {
  id: string;
  question: string;
  /** The newest thought in the thread, or null when it has none yet. */
  latest: {
    points: MayaPoint[];
    synthesis: MayaSynthesis | null;
    noteBlobSha: string | null;
    createdAt: string;
  } | null;
  /** Vault paths of the notes the latest thought cites, by note id, for links. */
  notePaths: Record<string, string>;
};

/** The person's thread on one note with its newest thought, or null. Throws on a failed read. */
export async function loadNoteThread(
  vault: VaultSupabaseClient,
  userId: string,
  noteId: string,
): Promise<NoteThread | null> {
  const thread = await mayaThreadStore(vault, userId).findThread(noteId);
  if (!thread) return null;

  const { data, error } = await vault
    .from('maya_messages')
    .select('points, note_blob_sha, created_at')
    .eq('user_id', userId)
    .eq('thread_id', thread.id)
    .eq('kind', 'thought')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`maya: reading the thought failed (${error.message})`);
  if (!data) return { ...thread, latest: null, notePaths: {} };

  const { points, synthesis } = readStoredPoints(data.points);
  const cited = [...new Set(points.flatMap((point) => point.notes.map((note) => note.noteId)))];
  const notePaths: Record<string, string> = {};
  if (cited.length > 0) {
    const { data: notes, error: notesError } = await vault
      .from('notes')
      .select('id, path')
      .eq('user_id', userId)
      .in('id', cited)
      .is('deleted_at', null);
    if (notesError) throw new Error(`maya: reading the cited notes failed (${notesError.message})`);
    for (const note of (notes ?? []) as { id: string; path: string }[])
      notePaths[note.id] = note.path;
  }

  return {
    ...thread,
    latest: {
      points,
      synthesis,
      noteBlobSha: (data.note_blob_sha as string | null) ?? null,
      createdAt: String(data.created_at),
    },
    notePaths,
  };
}
