import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import type { TalkCitation } from '@/lib/talk/talk';
import { readStoredPoints, type WrittenThought } from './thought';
import type { MayaPoint, MayaSynthesis } from './verify';

/**
 * Keeping Maya's threads. A note's thread with Maya is a row thread in
 * core.conversations under the note's ref, `obsidian.notes:<id>`, with
 * voice 'maya' (plan #1479, supabase/migrations-vault/0032): the thread's
 * question is the conversation's title, where the person has got to is its
 * summary, and Maya's thought is its first turn, the points kept in the
 * turn's detail. They were kept in obsidian.maya_threads and maya_messages
 * (plan #1285), which are read-only now.
 *
 * Every function takes whichever clients the caller has. The note page's
 * action and the Maya tab pass the session's, so RLS decides whose thread it
 * is; the hourly job (plan #1289) passes the service role and says so with
 * origin 'automatic'.
 */

/** The clients the store reads and writes with: core for the thread, the vault for the note. */
export type MayaDb = { core: CoreSupabaseClient; vault: VaultSupabaseClient };

export type MayaThreadOrigin = 'asked' | 'automatic';

/** The ref a note's thread sits under. */
export function noteRef(noteId: string): string {
  return `obsidian.notes:${noteId}`;
}

/** The note id in a thread's ref, or null when it is not a note's. */
function noteIdOf(ref: string): string | null {
  return ref.startsWith('obsidian.notes:') ? ref.slice('obsidian.notes:'.length) : null;
}

/** A note's thread as the note page shows it. */
export type NoteThread = {
  id: string;
  question: string;
  createdAt: string;
  /** Maya's first thought in the thread, or null when it has none. */
  thought: { points: MayaPoint[]; synthesis: MayaSynthesis | null } | null;
};

export type SaveThoughtResult = { ok: true; threadId: string } | { ok: false; detail: string };

type Detail = { kind?: unknown; points?: unknown; note_blob_sha?: unknown; model?: unknown };

function detailOf(value: unknown): Detail | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Detail) : null;
}

/** The thread on one note, with its first thought. Null when there is none. */
export async function loadNoteThread(db: MayaDb, noteId: string): Promise<NoteThread | null> {
  const { data: thread, error } = await db.core
    .from('conversations')
    .select('id, title, created_at')
    .eq('subject_kind', 'row')
    .eq('subject_ref', noteRef(noteId))
    .eq('voice', 'maya')
    .maybeSingle();
  if (error || !thread) return null;

  const { data: turn } = await db.core
    .from('conversation_turns')
    .select('detail')
    .eq('conversation_id', thread.id)
    .eq('detail->>kind', 'thought')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  const first = detailOf((turn as { detail: unknown } | null)?.detail);

  return {
    id: String(thread.id),
    question: String(thread.title ?? ''),
    createdAt: String(thread.created_at),
    thought: first ? readStoredPoints(first.points) : null,
  };
}

/**
 * Open the note's thread with Maya and keep the thought in it.
 *
 * A note has one thread, which Maya and Dash share: the comments on the note
 * page are the same conversation. When the note's thread is already Maya's (a
 * second press that crossed the first, or the job and the person on the same
 * note) the thought is not kept again and the existing thread is returned, so
 * the caller links to it either way. When the note has a thread of comments
 * and no thought yet, Maya takes it up: it becomes Maya's, and the thought is
 * added to it.
 */
export async function saveThought(
  db: MayaDb,
  input: { userId: string; noteId: string; origin: MayaThreadOrigin; written: WrittenThought },
): Promise<SaveThoughtResult> {
  const { userId, noteId, origin, written } = input;
  const ref = noteRef(noteId);

  const { data: thread, error } = await db.core
    .from('conversations')
    .insert({ user_id: userId, subject_kind: 'row', subject_ref: ref, title: written.question, voice: 'maya', origin })
    .select('id')
    .single();

  if (error || !thread) {
    // 23505: the note already has a thread.
    if (error?.code !== '23505') return { ok: false, detail: error?.message ?? 'The thread was not opened.' };
    const { data: existing } = await db.core
      .from('conversations')
      .select('id, voice')
      .eq('user_id', userId)
      .eq('subject_kind', 'row')
      .eq('subject_ref', ref)
      .maybeSingle();
    if (!existing) return { ok: false, detail: error.message };
    if (existing.voice === 'maya') return { ok: true, threadId: String(existing.id) };
    const { error: takeError } = await db.core
      .from('conversations')
      .update({ voice: 'maya', origin, title: written.question })
      .eq('id', existing.id);
    if (takeError) return { ok: false, detail: takeError.message };
    return keepThought(db, userId, String(existing.id), written);
  }

  return keepThought(db, userId, String(thread.id), written);
}

/** Keep the thought as a turn of the thread. */
async function keepThought(db: MayaDb, userId: string, threadId: string, written: WrittenThought): Promise<SaveThoughtResult> {
  const { error: turnError } = await db.core.from('conversation_turns').insert({
    conversation_id: threadId,
    user_id: userId,
    role: 'assistant',
    body: written.body,
    detail: {
      kind: 'thought',
      points: written.points,
      ...(written.noteBlobSha ? { note_blob_sha: written.noteBlobSha } : {}),
      model: written.model,
    },
  });
  if (turnError) return { ok: false, detail: turnError.message };

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
  /** The rows a reply of Maya's rests on, which a lookup returned. */
  citations?: TalkCitation[];
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
  subject_ref: string;
  title: string | null;
  summary: string | null;
  summary_at: string | null;
  origin: string | null;
  created_at: string;
};

const THREAD_SELECT = 'id, subject_ref, title, summary, summary_at, origin, created_at';
const TURN_SELECT = 'id, role, body, detail, citations, created_at';

type TurnRow = { id: string; role: string; body: string; detail: unknown; citations: unknown; created_at: string };

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

function toThreadRow(row: ThreadRow, notes: Map<string, MayaThreadNote>, updatedAt: string): MayaThreadRow {
  const noteId = noteIdOf(row.subject_ref);
  return {
    id: String(row.id),
    question: String(row.title ?? ''),
    summary: row.summary,
    origin: row.origin === 'automatic' ? 'automatic' : 'asked',
    createdAt: String(row.created_at),
    updatedAt,
    note: (noteId && notes.get(noteId)) || null,
  };
}

function toMessage(row: TurnRow): MayaMessage {
  const detail = detailOf(row.detail);
  const kind = detail?.kind === 'thought' ? 'thought' : 'reply';
  const citations = Array.isArray(row.citations) ? (row.citations as TalkCitation[]) : [];
  return {
    id: String(row.id),
    role: row.role === 'assistant' ? 'maya' : 'person',
    kind,
    body: String(row.body),
    createdAt: String(row.created_at),
    thought: kind === 'thought' ? readStoredPoints(detail?.points) : null,
    ...(citations.length > 0 ? { citations } : {}),
  };
}

/** The latest of the times given, as an ISO string. */
function latest(...times: (string | null | undefined)[]): string {
  return times.filter((t): t is string => !!t).sort().pop() ?? '';
}

/** Every thread, the one most recently talked in first. */
export async function loadThreads(db: MayaDb): Promise<MayaThreadRow[]> {
  const { data, error } = await db.core
    .from('conversations')
    .select(THREAD_SELECT)
    .eq('subject_kind', 'row')
    .eq('voice', 'maya')
    .order('created_at', { ascending: false })
    .limit(MAYA_THREAD_LIMIT);
  if (error) throw new Error(`Reading Maya's threads failed: ${error.message}`);
  const rows = (data ?? []) as ThreadRow[];
  if (rows.length === 0) return [];

  const [notes, turns] = await Promise.all([
    loadNoteLinks(
      db.vault,
      rows.map((row) => noteIdOf(row.subject_ref)).filter((id): id is string => id !== null),
    ),
    db.core
      .from('conversation_turns')
      .select('conversation_id, created_at')
      .in(
        'conversation_id',
        rows.map((row) => row.id),
      ),
  ]);
  if (turns.error) throw new Error(`Reading Maya's threads failed: ${turns.error.message}`);
  const lastTurn = new Map<string, string>();
  for (const turn of (turns.data ?? []) as { conversation_id: string; created_at: string }[]) {
    lastTurn.set(turn.conversation_id, latest(lastTurn.get(turn.conversation_id), turn.created_at));
  }

  return rows
    .map((row) => toThreadRow(row, notes, latest(row.created_at, row.summary_at, lastTurn.get(row.id))))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** One thread with every message in it, oldest first. Null when it is not there or not yours. */
export async function loadThread(db: MayaDb, threadId: string): Promise<MayaThreadDetail | null> {
  const { data, error } = await db.core
    .from('conversations')
    .select(THREAD_SELECT)
    .eq('id', threadId)
    .eq('voice', 'maya')
    .maybeSingle();
  if (error || !data) return null;
  const row = data as ThreadRow;
  const noteId = noteIdOf(row.subject_ref);
  if (!noteId) return null;

  const [notes, turns] = await Promise.all([
    loadNoteLinks(db.vault, [noteId]),
    db.core.from('conversation_turns').select(TURN_SELECT).eq('conversation_id', row.id).order('created_at', { ascending: true }),
  ]);
  if (turns.error) throw new Error(`Reading the thread failed: ${turns.error.message}`);
  const messages = ((turns.data ?? []) as TurnRow[]).map(toMessage);

  return {
    ...toThreadRow(row, notes, latest(row.created_at, row.summary_at, messages[messages.length - 1]?.createdAt)),
    noteId,
    summaryAt: row.summary_at,
    messages,
  };
}

/** Add a reply to a thread, either way. The thread's owner is checked by RLS and the foreign key. */
export async function appendReply(
  db: MayaDb,
  input: {
    threadId: string;
    userId: string;
    role: 'person' | 'maya';
    body: string;
    model?: string;
    /** The rows Maya's reply rests on, which a lookup returned. */
    citations?: TalkCitation[];
  },
): Promise<MayaMessage | null> {
  const maya = input.role === 'maya';
  const { data, error } = await db.core
    .from('conversation_turns')
    .insert({
      conversation_id: input.threadId,
      user_id: input.userId,
      role: maya ? 'assistant' : 'user',
      body: input.body,
      ...(maya ? { detail: { kind: 'reply', ...(input.model ? { model: input.model } : {}) } } : {}),
      ...(maya && input.citations?.length ? { citations: input.citations } : {}),
    })
    .select(TURN_SELECT)
    .single();
  if (error || !data) return null;
  return toMessage(data as TurnRow);
}

/** Rewrite where the person has got to. Also moves the thread to the top of the list. */
export async function saveSummary(db: MayaDb, threadId: string, summary: string): Promise<boolean> {
  const { error } = await db.core
    .from('conversations')
    .update({ summary, summary_at: new Date().toISOString() })
    .eq('id', threadId);
  return !error;
}

/** Rewrite the thread's question. */
export async function renameQuestion(db: MayaDb, threadId: string, question: string): Promise<boolean> {
  const { data, error } = await db.core
    .from('conversations')
    .update({ title: question })
    .eq('id', threadId)
    .eq('voice', 'maya')
    .select('id')
    .maybeSingle();
  return !error && Boolean(data);
}
