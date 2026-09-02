/**
 * Deciding what a sync should do, without doing any of it.
 *
 * The interesting parts of a mirror are all decisions -- what changed, what to
 * fetch, what to stop fetching, when it is safe to say the mirror is caught
 * up. Kept pure and kept here, so they can be tested without a repository, a
 * token, a database or a clock.
 *
 * The rule the whole file serves: never claim to be caught up on work that was
 * not finished. A cursor advanced early is a permanently incomplete vault,
 * because the next run only asks for changes since a point it never reached.
 */
import { isNotePath, toVaultPath } from '@/lib/vault/paths';
import { noteTooLarge } from '@/lib/vault/markdown/note';
import type { VaultChange, VaultEntry } from '@/lib/vault/providers/types';

/** What the database already holds, keyed by vault path. */
export type KnownNote = { blobSha: string; deleted: boolean };
export type KnownNotes = ReadonlyMap<string, KnownNote>;

export type FetchTask = {
  path: string;
  blobSha: string;
  sizeBytes: number;
  /** Set when this path is the same file under a new name. */
  previousPath?: string;
};

export type BackfillBatch = {
  /** Notes to fetch and write, in path order. */
  fetch: FetchTask[];
  /** Paths present and unchanged; nothing to do, but they count as seen. */
  unchanged: string[];
  /** Paths too large to store. Counted, never fatal. */
  skipped: string[];
  /** Resume point for the next batch, or null when the tree is exhausted. */
  nextAfterPath: string | null;
  /** True when this batch reached the end of the tree. */
  done: boolean;
};

/**
 * Filter a source listing down to notes, in the order a backfill walks them.
 *
 * Sorted by path so that "where did we get to" is a single string, which is
 * what lets a backfill span as many runs as it needs without a job queue.
 */
export function notesInTree(entries: VaultEntry[], subpath: string): VaultEntry[] {
  const notes: VaultEntry[] = [];
  for (const entry of entries) {
    if (!isNotePath(entry.path)) continue;
    const path = toVaultPath(entry.path, subpath);
    if (path === null || !isNotePath(path)) continue;
    notes.push({ ...entry, path });
  }
  return notes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * The next slice of a backfill.
 *
 * `afterPath` is exclusive, so a run that was killed immediately after writing
 * a note does not rewrite it, and one killed before writing does not skip it.
 */
export function planBackfillBatch(opts: {
  notes: VaultEntry[];
  known: KnownNotes;
  afterPath: string | null;
  limit: number;
}): BackfillBatch {
  const { notes, known, afterPath, limit } = opts;

  const remaining = afterPath === null ? notes : notes.filter((n) => n.path > afterPath);

  const fetch: FetchTask[] = [];
  const unchanged: string[] = [];
  const skipped: string[] = [];
  let lastSeen: string | null = afterPath;
  let consumed = 0;
  let stoppedEarly = false;

  for (const note of remaining) {
    // A batch is bounded by how many notes it will *fetch*, not by how many it
    // looks at: a re-scan of an unchanged vault does no network work at all
    // and should run to the end rather than take a hundred runs to notice.
    if (consumed >= limit) {
      stoppedEarly = true;
      break;
    }

    lastSeen = note.path;

    if (noteTooLarge(note.sizeBytes)) {
      skipped.push(note.path);
      continue;
    }

    const existing = known.get(note.path);
    if (existing && !existing.deleted && existing.blobSha === note.blobSha) {
      unchanged.push(note.path);
      continue;
    }

    fetch.push({ path: note.path, blobSha: note.blobSha, sizeBytes: note.sizeBytes });
    consumed += 1;
  }

  // Null means "the tree is exhausted", which is a different statement from
  // "we happened to stop at the last path" -- the caller clears the resume
  // point on the first and keeps it on the second.
  return {
    fetch,
    unchanged,
    skipped,
    nextAfterPath: stoppedEarly ? lastSeen : null,
    done: !stoppedEarly,
  };
}

export type IncrementalPlan = {
  fetch: FetchTask[];
  unchanged: string[];
  skipped: string[];
  /** Vault paths to soft-delete. */
  remove: string[];
};

/**
 * What an incremental sync should do, given a diff.
 *
 * A rename keeps the row and its id. That costs nothing today and matters a
 * great deal later: a note is going to be cited by an evidence item, and
 * renaming a file in Obsidian must not orphan the citation.
 */
export function planIncremental(opts: {
  changes: VaultChange[];
  known: KnownNotes;
  subpath: string;
}): IncrementalPlan {
  const { changes, known, subpath } = opts;

  const fetch: FetchTask[] = [];
  const unchanged: string[] = [];
  const skipped: string[] = [];
  const remove: string[] = [];

  for (const change of changes) {
    const path = toVaultPath(change.path, subpath);

    if (change.kind === 'delete') {
      // A note moved out of the vault subdirectory, or renamed to something
      // that is no longer markdown, is a delete as far as the mirror goes.
      if (path !== null && known.has(path)) remove.push(path);
      continue;
    }

    if (path === null || !isNotePath(path)) {
      // Renamed out of the vault, or turned into something that is not a note.
      const gone = change.previousPath ? toVaultPath(change.previousPath, subpath) : null;
      if (gone !== null && known.has(gone)) remove.push(gone);
      continue;
    }

    const previousPath = change.previousPath
      ? (toVaultPath(change.previousPath, subpath) ?? undefined)
      : undefined;

    if (noteTooLarge(change.sizeBytes)) {
      skipped.push(path);
      // A note that grew past the cap stops being storable. Removing it is
      // more honest than leaving a stale copy that no longer matches the file.
      if (known.has(path)) remove.push(path);
      continue;
    }

    const existing = known.get(path);
    if (existing && !existing.deleted && existing.blobSha === change.blobSha && !previousPath) {
      unchanged.push(path);
      continue;
    }

    fetch.push({ path, blobSha: change.blobSha, sizeBytes: change.sizeBytes, previousPath });
  }

  return { fetch, unchanged, skipped, remove };
}

/**
 * Deletions implied by a full snapshot: everything we hold that the tree no
 * longer mentions.
 *
 * Only ever called with a complete tree. A truncated listing here would delete
 * every note it failed to mention, which is why the snapshot type carries that
 * flag and the caller refuses rather than guessing.
 */
export function deletionsFromSnapshot(opts: {
  notes: VaultEntry[];
  known: KnownNotes;
}): string[] {
  const present = new Set(opts.notes.map((n) => n.path));
  const gone: string[] = [];
  for (const [path, note] of opts.known) {
    if (!note.deleted && !present.has(path)) gone.push(path);
  }
  return gone.sort();
}

/**
 * Whether the mirror may now claim to be at `headSha`.
 *
 * The cursor is the promise that everything up to a commit is reflected. A
 * backfill still walking the tree, or a batch that ran out of budget, has not
 * earned it -- and advancing anyway is not a delay, it is a vault that is
 * permanently missing whatever was skipped.
 */
export function mayAdvanceCursor(opts: {
  backfillDone: boolean;
  fetchFailures: number;
}): boolean {
  return opts.backfillDone && opts.fetchFailures === 0;
}
