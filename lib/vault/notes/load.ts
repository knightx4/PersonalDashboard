import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { VAULT_SCHEMA, type VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { folderOf } from '@/lib/vault/paths';
import type { LinkTarget } from '@/lib/vault/markdown/obsidian';
import type { SyncRunSummary } from '@/lib/vault/sync/progress';

/**
 * Reading the vault.
 *
 * Every query here goes through the session client, so RLS decides what comes
 * back. Nothing filters by user id in this file, deliberately: application code
 * never gets to decide who owns a row, and a query that looks like it forgot
 * has not -- the policy is doing it.
 */

export type NoteSummary = {
  id: string;
  path: string;
  title: string;
  folder: string;
  gitUpdatedAt: string | null;
  /** First line or so of the body, for the list. */
  excerpt: string;
};

export type NoteDetail = NoteSummary & {
  body: string;
  /** git's blob SHA for the body, which is what a map proposal is checked against. */
  blobSha: string;
  frontmatter: Record<string, unknown>;
  sizeBytes: number;
};

export type VaultConnectionSummary = {
  id: string;
  repoOwner: string;
  repoName: string;
  branch: string;
  subpath: string;
  status: 'active' | 'needs_reauth' | 'disconnected' | 'error';
  lastSyncedAt: string | null;
  lastError: string | null;
  backfillCompletedAt: string | null;
  syncCursor: string | null;
};

/** Enough of the body to tell two notes apart in a list. */
function excerptOf(body: string): string {
  const text = body
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 180 ? `${text.slice(0, 179)}…` : text;
}

type NoteRow = {
  id: string;
  path: string;
  title: string;
  body: string;
  git_updated_at: string | null;
};

function toSummary(row: NoteRow): NoteSummary {
  return {
    id: row.id,
    path: row.path,
    title: row.title,
    folder: folderOf(row.path),
    gitUpdatedAt: row.git_updated_at,
    excerpt: excerptOf(row.body ?? ''),
  };
}

export async function loadConnection(
  supabase: VaultSupabaseClient,
): Promise<VaultConnectionSummary | null> {
  const { data, error } = await supabase
    .from('vault_connections')
    // Never `select('*')` here: that would put the encrypted token on a row
    // travelling to a Server Component, and there is no reason for it to leave
    // the sync.
    .select(
      'id, repo_owner, repo_name, branch, subpath, status, last_synced_at, last_error, backfill_completed_at, sync_cursor',
    )
    .maybeSingle();

  assertSchemaExposed(error, VAULT_SCHEMA);
  if (error || !data) return null;

  const row = data as {
    id: string;
    repo_owner: string;
    repo_name: string;
    branch: string;
    subpath: string;
    status: VaultConnectionSummary['status'];
    last_synced_at: string | null;
    last_error: string | null;
    backfill_completed_at: string | null;
    sync_cursor: string | null;
  };

  return {
    id: row.id,
    repoOwner: row.repo_owner,
    repoName: row.repo_name,
    branch: row.branch,
    subpath: row.subpath,
    status: row.status,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
    backfillCompletedAt: row.backfill_completed_at,
    syncCursor: row.sync_cursor,
  };
}

/**
 * The last few sync runs, newest first.
 *
 * Through the session client like everything else here: the sync_runs policy
 * joins back to the connection's owner, so a run belonging to somebody else is
 * not filtered out in this file -- it never arrives.
 */
export async function loadSyncRuns(
  supabase: VaultSupabaseClient,
  limit = 5,
): Promise<SyncRunSummary[]> {
  const { data, error } = await supabase
    .from('sync_runs')
    .select(
      'id, type, status, notes_seen, notes_written, notes_deleted, notes_skipped, started_at, finished_at, error',
    )
    .order('created_at', { ascending: false })
    .limit(limit);

  assertSchemaExposed(error, VAULT_SCHEMA);
  if (error || !data) return [];

  type RunRow = {
    id: string;
    type: SyncRunSummary['type'];
    status: SyncRunSummary['status'];
    notes_seen: number;
    notes_written: number;
    notes_deleted: number;
    notes_skipped: number;
    started_at: string | null;
    finished_at: string | null;
    error: string | null;
  };

  return (data as RunRow[]).map((row) => ({
    id: row.id,
    type: row.type,
    status: row.status,
    notesSeen: row.notes_seen,
    notesWritten: row.notes_written,
    notesDeleted: row.notes_deleted,
    notesSkipped: row.notes_skipped,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error,
  }));
}

const LIST_LIMIT = 500;

/**
 * The note list, optionally filtered by a search.
 *
 * Ordered by path rather than by date, because a vault is a folder tree and
 * not a feed -- and because a first sync cannot date most notes at all: a tree
 * listing carries no timestamps, so only notes with a frontmatter date have
 * one until something changes them. Sorting by date would put the whole vault
 * in an arbitrary order and look like a bug.
 */
export async function loadNotes(
  supabase: VaultSupabaseClient,
  opts: { search?: string; folder?: string; limit?: number } = {},
): Promise<NoteSummary[]> {
  let query = supabase
    .from('notes')
    .select('id, path, title, body, git_updated_at')
    .is('deleted_at', null);

  const search = opts.search?.trim();
  if (search) {
    // Full text over title and body, through the generated tsvector column.
    // websearch_to_tsquery rather than plainto_: it understands quoted phrases
    // and OR, which is what someone typing into a search box expects.
    query = query.textSearch('search_tsv', search, { type: 'websearch', config: 'english' });
  }

  if (opts.folder) {
    query = query.like('path', `${opts.folder}/%`);
  }

  const { data, error } = await query.order('path').limit(opts.limit ?? LIST_LIMIT);

  assertSchemaExposed(error, VAULT_SCHEMA);
  if (error) throw new Error(`Reading the vault failed: ${error.message}`);

  return ((data ?? []) as NoteRow[]).map(toSummary);
}

type DetailRow = NoteRow & {
  frontmatter: Record<string, unknown>;
  size_bytes: number;
  blob_sha: string;
};

/**
 * Notes named by id, with their bodies, in the order they were asked for.
 *
 * For a caller holding ids it was given earlier rather than a path somebody
 * typed -- a quiz, which stores the notes it is over and reads them again when
 * its questions are written. RLS decides what comes back, so an id belonging
 * to somebody else is simply missing from the answer.
 *
 * A note deleted from the vault since is missing too, which is why this
 * returns what it found rather than throwing: the material a quiz was written
 * from can outlive one of its notes.
 */
export async function loadNotesByIds(
  supabase: VaultSupabaseClient,
  ids: readonly string[],
): Promise<NoteDetail[]> {
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from('notes')
    .select('id, path, title, body, frontmatter, size_bytes, git_updated_at, blob_sha')
    .in('id', [...ids])
    .is('deleted_at', null);

  assertSchemaExposed(error, VAULT_SCHEMA);
  if (error) throw new Error(`Reading the vault failed: ${error.message}`);

  const found = new Map(
    ((data ?? []) as DetailRow[]).map((row) => [
      row.id,
      {
        ...toSummary(row),
        body: row.body,
        blobSha: row.blob_sha,
        frontmatter: row.frontmatter ?? {},
        sizeBytes: row.size_bytes,
      },
    ]),
  );

  return ids.map((id) => found.get(id)).filter((note): note is NoteDetail => note !== undefined);
}

export async function loadNote(
  supabase: VaultSupabaseClient,
  path: string,
): Promise<NoteDetail | null> {
  const { data, error } = await supabase
    .from('notes')
    .select('id, path, title, body, frontmatter, size_bytes, git_updated_at, blob_sha')
    .eq('path', path)
    .is('deleted_at', null)
    .maybeSingle();

  assertSchemaExposed(error, VAULT_SCHEMA);
  if (error || !data) return null;

  const row = data as DetailRow;

  return {
    ...toSummary(row),
    body: row.body,
    blobSha: row.blob_sha,
    frontmatter: row.frontmatter ?? {},
    sizeBytes: row.size_bytes,
  };
}

/**
 * Every note's path and title, for resolving wikilinks.
 *
 * Deliberately not the bodies. A vault of several thousand notes is a large
 * amount of text and rendering one page must not load all of it -- this is two
 * short columns, which stays cheap as the vault grows.
 */
export async function loadLinkTargets(supabase: VaultSupabaseClient): Promise<LinkTarget[]> {
  const targets: LinkTarget[] = [];

  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('notes')
      .select('path, title')
      .is('deleted_at', null)
      .order('path')
      .range(from, from + 999);

    assertSchemaExposed(error, VAULT_SCHEMA);
    if (error) throw new Error(`Reading the vault index failed: ${error.message}`);
    if (!data?.length) break;

    targets.push(...(data as LinkTarget[]));
    if (data.length < 1000) break;
  }

  return targets;
}

/** Notes grouped by folder, in the order the list renders them. */
export function groupByFolder(notes: NoteSummary[]): Array<{ folder: string; notes: NoteSummary[] }> {
  const groups = new Map<string, NoteSummary[]>();
  for (const note of notes) {
    const existing = groups.get(note.folder);
    if (existing) existing.push(note);
    else groups.set(note.folder, [note]);
  }

  return [...groups.entries()]
    .map(([folder, items]) => ({ folder, notes: items }))
    // Root-level notes first, then folders alphabetically -- the same order
    // Obsidian's own file tree uses.
    .sort((a, b) => {
      if (a.folder === '') return -1;
      if (b.folder === '') return 1;
      return a.folder.localeCompare(b.folder);
    });
}
