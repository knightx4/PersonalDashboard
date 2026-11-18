import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { checkSource, type Basis, type PreparedSource } from '@/lib/learn/reader/source';
import { shelve, type Origin, type ReaderRow, type ReaderStatus } from '@/lib/learn/reader/shelves';

/**
 * Reading and writing the reader's sources (learn 0195). The pages read with
 * the person's own client; the routine's script (scripts/learn-reader.ts)
 * writes with the service role, always for one user id.
 */

export type ReaderSource = ReaderRow & {
  prepared: PreparedSource | null;
  givenText: boolean;
  asked: string | null;
  error: string | null;
};

const ROW_COLUMNS =
  'id, title, author, origin, why, status, basis, progress, verdict, parent_id, parent_section, requested_at, prepared_at, opened_at';

type Row = Record<string, unknown>;

function readRow(row: Row, prepared: PreparedSource | null): ReaderRow {
  const read = ((row.progress ?? {}) as { read?: number[] }).read ?? [];
  return {
    id: row.id as string,
    title: row.title as string,
    author: (row.author as string | null) ?? null,
    origin: row.origin as Origin,
    why: (row.why as string | null) ?? null,
    status: row.status as ReaderStatus,
    basis: (row.basis as Basis | null) ?? null,
    read,
    verdict: (row.verdict as 'kept' | 'dropped' | null) ?? null,
    parentId: (row.parent_id as string | null) ?? null,
    openedAt: (row.opened_at as string | null) ?? null,
    requestedAt: row.requested_at as string,
    // What the home screen needs of the prepared source, without its text.
    outline: prepared
      ? {
          published: prepared.published,
          minutes: prepared.minutes,
          idea: prepared.idea,
          sections: prepared.sections.map((section) => ({
            title: section.title,
            minutes: section.minutes,
            idea: section.idea,
          })),
        }
      : null,
  };
}

/** Every source of the person's, as the home screen shelves them. */
export async function loadShelves(client: LearnSupabaseClient, userId: string) {
  const { data, error } = await client
    .from('reader_sources')
    .select(`${ROW_COLUMNS}, prepared`)
    .eq('user_id', userId)
    .order('requested_at', { ascending: false });
  if (error) throw new Error(`Reading what there is to read failed: ${error.message}`);
  const rows = ((data ?? []) as Row[]).map((row) =>
    readRow(row, (row.prepared as PreparedSource | null) ?? null),
  );
  return shelve(rows);
}

/** One source with everything prepared for it, or null when it is not this person's. */
export async function loadSource(
  client: LearnSupabaseClient,
  userId: string,
  sourceId: string,
): Promise<ReaderSource | null> {
  const { data, error } = await client
    .from('reader_sources')
    .select(`${ROW_COLUMNS}, prepared, asked, error, given_text`)
    .eq('user_id', userId)
    .eq('id', sourceId)
    .maybeSingle();
  if (error) throw new Error(`Reading the source failed: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as Row;
  const prepared = (row.prepared as PreparedSource | null) ?? null;
  return {
    ...readRow(row, prepared),
    prepared,
    givenText: Boolean(row.given_text),
    asked: (row.asked as string | null) ?? null,
    error: (row.error as string | null) ?? null,
  };
}

export type NewSource = {
  title: string;
  author?: string | null;
  origin: Origin;
  asked?: string | null;
  why?: string | null;
  givenText?: string | null;
  readingId?: string | null;
  parentId?: string | null;
  parentSection?: number | null;
};

/** Queue a source for the routine to prepare. A reading already queued is found, not queued twice. */
export async function queueSource(
  client: LearnSupabaseClient,
  userId: string,
  source: NewSource,
): Promise<{ id: string; created: boolean }> {
  if (source.readingId) {
    const { data } = await client
      .from('reader_sources')
      .select('id')
      .eq('user_id', userId)
      .eq('reading_id', source.readingId)
      .maybeSingle();
    if (data) return { id: (data as { id: string }).id, created: false };
  }
  const { data, error } = await client
    .from('reader_sources')
    .insert({
      user_id: userId,
      title: source.title.trim().slice(0, 300),
      author: source.author ?? null,
      origin: source.origin,
      asked: source.asked ?? null,
      why: source.why ?? null,
      given_text: source.givenText ?? null,
      reading_id: source.readingId ?? null,
      parent_id: source.parentId ?? null,
      parent_section: source.parentSection ?? null,
      status: 'queued',
    })
    .select('id')
    .single();
  if (error) throw new Error(`Queuing that failed: ${error.message}`);
  return { id: (data as { id: string }).id, created: true };
}

/** A source a session took and then went quiet on is handed out again after this long. */
export const PREPARE_STALE_MS = 45 * 60 * 1000;

/** Take the oldest queued source, or one whose preparation went quiet, for the routine's session. */
export async function takeSource(client: LearnSupabaseClient, userId: string, sourceId?: string) {
  const stale = new Date(Date.now() - PREPARE_STALE_MS).toISOString();
  let query = client
    .from('reader_sources')
    .select(
      'id, title, author, origin, asked, why, given_text, parent_id, parent_section, reading_id, prepared',
    )
    .eq('user_id', userId);
  query = sourceId
    ? query.eq('id', sourceId).in('status', ['queued', 'preparing', 'failed'])
    : query.or(`status.eq.queued,and(status.eq.preparing,updated_at.lt.${stale})`);
  const { data, error } = await query.order('requested_at').limit(1);
  if (error) throw new Error(`Reading the queue failed: ${error.message}`);
  const row = ((data ?? []) as Row[])[0];
  if (!row) return null;
  const now = new Date().toISOString();
  const { error: failed } = await client
    .from('reader_sources')
    .update({ status: 'preparing', taken_at: now, updated_at: now, error: null })
    .eq('id', row.id as string)
    .eq('user_id', userId);
  if (failed) throw new Error(`Taking the source failed: ${failed.message}`);
  return row;
}

/** Check a prepared source and keep it. */
export async function saveSource(
  client: LearnSupabaseClient,
  userId: string,
  sourceId: string,
  input: unknown,
  options: { basis: Basis; fullText: string | null },
): Promise<
  { ok: true; title: string; sections: number; minutes: number } | { ok: false; problems: string[] }
> {
  const checked = checkSource(input, options.fullText);
  if (!checked.ok) return checked;
  const open = checked.source.rights === 'open';
  if (open && !options.fullText)
    return {
      ok: false,
      problems: [
        'An open work is saved with its full text file, so its paragraphs can be checked.',
      ],
    };
  if (open !== (options.basis === 'text'))
    return {
      ok: false,
      problems: ['The basis is "text" exactly when the work is open and its text is shown.'],
    };
  const now = new Date().toISOString();
  const { data, error } = await client
    .from('reader_sources')
    .update({
      prepared: checked.source,
      title: checked.source.title,
      author: checked.source.author,
      basis: options.basis,
      status: 'ready',
      prepared_at: now,
      updated_at: now,
      error: null,
    })
    .eq('id', sourceId)
    .eq('user_id', userId)
    .select('id');
  if (error) throw new Error(`Saving the source failed: ${error.message}`);
  if (!data || data.length === 0) throw new Error(`No source ${sourceId} for the owner.`);
  return {
    ok: true,
    title: checked.source.title,
    sections: checked.source.sections.length,
    minutes: checked.source.minutes,
  };
}

/** Close a request that asked for more to read, once the rows it added are queued. */
export async function finishRefill(
  client: LearnSupabaseClient,
  userId: string,
  sourceId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await client
    .from('reader_sources')
    .update({ status: 'ready', prepared_at: now, updated_at: now })
    .eq('id', sourceId)
    .eq('user_id', userId)
    .eq('origin', 'refill');
  if (error) throw new Error(`Closing the request failed: ${error.message}`);
}

export async function failSource(
  client: LearnSupabaseClient,
  userId: string,
  sourceId: string,
  why: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await client
    .from('reader_sources')
    .update({ status: 'failed', error: why.slice(0, 1000), updated_at: now })
    .eq('id', sourceId)
    .eq('user_id', userId);
  if (error) throw new Error(`Recording the failure failed: ${error.message}`);
}

/** Mark a section read or unread, and note that the source was opened. */
export async function setSectionRead(
  client: LearnSupabaseClient,
  userId: string,
  sourceId: string,
  section: number,
  read: boolean,
): Promise<void> {
  const { data, error } = await client
    .from('reader_sources')
    .select('progress')
    .eq('id', sourceId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) throw new Error('That is not here.');
  const kept = new Set((((data as Row).progress ?? {}) as { read?: number[] }).read ?? []);
  if (read) kept.add(section);
  else kept.delete(section);
  const now = new Date().toISOString();
  const { error: failed } = await client
    .from('reader_sources')
    .update({ progress: { read: [...kept].sort((a, b) => a - b) }, opened_at: now })
    .eq('id', sourceId)
    .eq('user_id', userId);
  if (failed) throw new Error(`Saving that failed: ${failed.message}`);
}

/** Keep it, or say it is not for you. */
export async function setVerdict(
  client: LearnSupabaseClient,
  userId: string,
  sourceId: string,
  verdict: 'kept' | 'dropped' | null,
): Promise<void> {
  const { error } = await client
    .from('reader_sources')
    .update({ verdict })
    .eq('id', sourceId)
    .eq('user_id', userId);
  if (error) throw new Error(`Saving that failed: ${error.message}`);
}

/** The person's own copy of a work whose text could not be shown: kept, and the source queued to be prepared from it. */
export async function giveText(
  client: LearnSupabaseClient,
  userId: string,
  sourceId: string,
  givenText: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await client
    .from('reader_sources')
    .update({ given_text: givenText, status: 'queued', requested_at: now, updated_at: now })
    .eq('id', sourceId)
    .eq('user_id', userId);
  if (error) throw new Error(`Saving your copy failed: ${error.message}`);
}
