import 'server-only';

import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { readStoredPoints, type WrittenThought } from './thought';
import type { MayaPoint, MayaSynthesis } from './verify';

/**
 * Keeping Maya's thoughts (plan #1285): a thread per note in
 * obsidian.maya_threads and the thought as its first message in
 * obsidian.maya_messages.
 *
 * Both functions take whichever vault client the caller has. The note page's
 * action passes the session client, so RLS and the column grants in
 * 0028_maya.sql decide what may be written; the hourly job (plan #1289)
 * passes the service role and says so with origin 'automatic'.
 */

export type MayaThreadOrigin = 'asked' | 'automatic';

/** A note's thread as the note page shows it. */
export type NoteThread = {
  id: string;
  question: string;
  createdAt: string;
  /** Maya's first thought in the thread, or null when it has none. */
  thought: { points: MayaPoint[]; synthesis: MayaSynthesis | null } | null;
};

export type SaveThoughtResult = { ok: true; threadId: string } | { ok: false; detail: string };

/** The thread on one note, with its first thought. Null when there is none. */
export async function loadNoteThread(vault: VaultSupabaseClient, noteId: string): Promise<NoteThread | null> {
  const { data: thread, error } = await vault
    .from('maya_threads')
    .select('id, question, created_at')
    .eq('note_id', noteId)
    .maybeSingle();
  if (error || !thread) return null;

  const { data: message } = await vault
    .from('maya_messages')
    .select('points')
    .eq('thread_id', thread.id)
    .eq('kind', 'thought')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  return {
    id: String(thread.id),
    question: String(thread.question),
    createdAt: String(thread.created_at),
    thought: message ? readStoredPoints(message.points) : null,
  };
}

/**
 * Open the note's thread and store the thought as its first message.
 *
 * A note has one thread. When one is already there (a second press that
 * crossed the first, or the job and the person on the same note) the thought
 * is not stored again and the existing thread is returned, so the caller
 * links to it either way.
 */
export async function saveThought(
  vault: VaultSupabaseClient,
  input: { userId: string; noteId: string; origin: MayaThreadOrigin; written: WrittenThought },
): Promise<SaveThoughtResult> {
  const { userId, noteId, origin, written } = input;

  const { data: thread, error } = await vault
    .from('maya_threads')
    .insert({ user_id: userId, note_id: noteId, question: written.question, origin })
    .select('id')
    .single();

  if (error || !thread) {
    // 23505: the note already has a thread.
    if (error?.code === '23505') {
      const { data: existing } = await vault
        .from('maya_threads')
        .select('id')
        .eq('note_id', noteId)
        .maybeSingle();
      if (existing) return { ok: true, threadId: String(existing.id) };
    }
    return { ok: false, detail: error?.message ?? 'The thread was not opened.' };
  }

  const threadId = String(thread.id);
  const { error: messageError } = await vault.from('maya_messages').insert({
    thread_id: threadId,
    user_id: userId,
    role: 'maya',
    kind: 'thought',
    body: written.body,
    points: written.points,
    note_blob_sha: written.noteBlobSha,
    model: written.model,
  });
  if (messageError) return { ok: false, detail: messageError.message };

  return { ok: true, threadId };
}

// ---------------------------------------------------------------------------
// The Maya tab (plan #1286): the list of threads, one thread with its
// messages, and what a reply writes.
// ---------------------------------------------------------------------------

/** The note a thread is on, or null when it has left the vault. */
export type MayaThreadNote = { id: string; path: string; title: string };

/** A thread as the Maya tab lists it. */
export type MayaThreadRow = {
  id: string;
  question: string;
  summary: string | null;
  origin: MayaThreadOrigin;
  createdAt: string;
  updatedAt: string;
  note: MayaThreadNote | null;
};

export type MayaMessage = {
  id: string;
  role: 'person' | 'maya';
  kind: 'thought' | 'reply';
  body: string;
  createdAt: string;
  /** A thought's points read back; null on a reply. */
  thought: { points: MayaPoint[]; synthesis: MayaSynthesis | null } | null;
};

export type MayaThreadDetail = MayaThreadRow & {
  noteId: string;
  summaryAt: string | null;
  messages: MayaMessage[];
};

/** The most threads the tab lists. */
export const MAYA_THREAD_LIMIT = 200;

type ThreadRow = {
  id: string;
  note_id: string;
  question: string;
  summary: string | null;
  summary_at: string | null;
  origin: string;
  created_at: string;
  updated_at: string;
};

const THREAD_SELECT = 'id, note_id, question, summary, summary_at, origin, created_at, updated_at';
const MESSAGE_SELECT = 'id, role, kind, body, points, created_at';

/** Path and title for each note id still in the vault, for linking to it. */
export async function loadNoteLinks(vault: VaultSupabaseClient, ids: readonly string[]): Promise<Map<string, MayaThreadNote>> {
  if (ids.length === 0) return new Map();
  const { data } = await vault
    .from('notes')
    .select('id, path, title')
    .in('id', [...new Set(ids)])
    .is('deleted_at', null);
  return new Map(
    ((data ?? []) as { id: string; path: string; title: string }[]).map((row) => [
      row.id,
      { id: row.id, path: row.path, title: row.title },
    ]),
  );
}

function toThreadRow(row: ThreadRow, notes: Map<string, MayaThreadNote>): MayaThreadRow {
  return {
    id: String(row.id),
    question: String(row.question),
    summary: row.summary,
    origin: row.origin === 'automatic' ? 'automatic' : 'asked',
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    note: notes.get(row.note_id) ?? null,
  };
}

function toMessage(row: {
  id: string;
  role: string;
  kind: string;
  body: string;
  points: unknown;
  created_at: string;
}): MayaMessage {
  const kind = row.kind === 'thought' ? 'thought' : 'reply';
  return {
    id: String(row.id),
    role: row.role === 'maya' ? 'maya' : 'person',
    kind,
    body: String(row.body),
    createdAt: String(row.created_at),
    thought: kind === 'thought' ? readStoredPoints(row.points) : null,
  };
}

/** Every thread, the one most recently talked in first. */
export async function loadThreads(vault: VaultSupabaseClient): Promise<MayaThreadRow[]> {
  const { data, error } = await vault
    .from('maya_threads')
    .select(THREAD_SELECT)
    .order('updated_at', { ascending: false })
    .limit(MAYA_THREAD_LIMIT);
  if (error) throw new Error(`Reading Maya's threads failed: ${error.message}`);
  const rows = (data ?? []) as ThreadRow[];
  const notes = await loadNoteLinks(
    vault,
    rows.map((row) => row.note_id),
  );
  return rows.map((row) => toThreadRow(row, notes));
}

/** One thread with every message in it, oldest first. Null when it is not there or not yours. */
export async function loadThread(vault: VaultSupabaseClient, threadId: string): Promise<MayaThreadDetail | null> {
  const { data, error } = await vault.from('maya_threads').select(THREAD_SELECT).eq('id', threadId).maybeSingle();
  if (error || !data) return null;
  const row = data as ThreadRow;

  const [notes, messages] = await Promise.all([
    loadNoteLinks(vault, [row.note_id]),
    vault.from('maya_messages').select(MESSAGE_SELECT).eq('thread_id', row.id).order('created_at', { ascending: true }),
  ]);
  if (messages.error) throw new Error(`Reading the thread failed: ${messages.error.message}`);

  return {
    ...toThreadRow(row, notes),
    noteId: String(row.note_id),
    summaryAt: row.summary_at,
    messages: ((messages.data ?? []) as Parameters<typeof toMessage>[0][]).map(toMessage),
  };
}

/** Add a reply to a thread, either way. The thread's owner is checked by RLS and the foreign key. */
export async function appendReply(
  vault: VaultSupabaseClient,
  input: { threadId: string; userId: string; role: 'person' | 'maya'; body: string; model?: string },
): Promise<MayaMessage | null> {
  const { data, error } = await vault
    .from('maya_messages')
    .insert({
      thread_id: input.threadId,
      user_id: input.userId,
      role: input.role,
      kind: 'reply',
      body: input.body,
      model: input.model ?? null,
    })
    .select(MESSAGE_SELECT)
    .single();
  if (error || !data) return null;
  return toMessage(data as Parameters<typeof toMessage>[0]);
}

/** Rewrite where the person has got to. Also moves the thread to the top of the list. */
export async function saveSummary(vault: VaultSupabaseClient, threadId: string, summary: string): Promise<boolean> {
  const { error } = await vault
    .from('maya_threads')
    .update({ summary, summary_at: new Date().toISOString() })
    .eq('id', threadId);
  return !error;
}

/** Rewrite the thread's question. */
export async function renameQuestion(
  vault: VaultSupabaseClient,
  threadId: string,
  question: string,
): Promise<boolean> {
  const { data, error } = await vault
    .from('maya_threads')
    .update({ question })
    .eq('id', threadId)
    .select('id')
    .maybeSingle();
  return !error && Boolean(data);
}
