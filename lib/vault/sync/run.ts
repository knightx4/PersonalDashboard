import 'server-only';

import { canStartAnotherBatch } from '@/lib/core/inbox/pump-budget';
import { parseNote } from '@/lib/vault/markdown/note';
import { normaliseSubpath } from '@/lib/vault/paths';
import {
  deletionsFromSnapshot,
  mayAdvanceCursor,
  notesInTree,
  planBackfillBatch,
  planIncremental,
  type FetchTask,
  type KnownNotes,
} from '@/lib/vault/sync/plan';
import type { VaultSource } from '@/lib/vault/providers/types';

/**
 * Running one sync.
 *
 * The vault does not need the mailbox's hand-off chain, and that is worth
 * saying plainly because the spec assumed it would. A Gmail backfill has to
 * chain HTTP invocations because its position in the mailbox is a page token
 * that only exists inside the run. The vault's position is a path, stored on
 * the connection, in sort order -- so a run that stops early has already
 * written down where to start again, and the next cron tick continues it.
 * Nothing needs to keep a chain alive, which removes the entire class of
 * failure that resume.ts exists to recover from.
 *
 * What is reused is pump-budget: the question "is there time for another batch
 * and the write after it" is the same question here, and its answer is already
 * measured rather than guessed.
 *
 * The rule this file must not break: never advance the cursor past work that
 * did not happen. A cursor is a promise that everything up to that commit is
 * reflected, and a promise made early is a vault permanently missing whatever
 * was skipped -- the next run only asks for changes since a point this one
 * never reached.
 */

/** How many notes to fetch before checking the clock again. */
const FETCH_BATCH = 25;

/**
 * Hard cap on notes fetched in one run.
 *
 * Time is the usual stopping condition; this is the other one. A fine-grained
 * PAT allows 5,000 requests an hour and a first sync of a large vault is one
 * request per note, so an unbounded run could spend the whole hour's budget
 * and leave nothing for the tree and compare calls the next one needs. Two
 * thousand keeps a wide margin and still finishes most vaults in a single
 * pass.
 */
const BACKFILL_FETCH_LIMIT = 2_000;

/** Wall clock a single run may spend, leaving room for the write after it. */
export const RUN_BUDGET_MS = 240_000;

export type VaultConnectionRow = {
  id: string;
  user_id: string;
  repo_owner: string;
  repo_name: string;
  branch: string;
  subpath: string;
  sync_cursor: string | null;
  backfill_after_path: string | null;
  backfill_commit_sha: string | null;
  backfill_completed_at: string | null;
};

export type NoteWrite = {
  path: string;
  title: string;
  body: string;
  frontmatter: Record<string, unknown>;
  blobSha: string;
  sizeBytes: number;
  gitUpdatedAt: string | null;
  previousPath?: string;
};

/** Everything the runner needs from the outside world, so tests need none of it. */
export type VaultSyncPorts = {
  source: VaultSource;
  /** Current mirror state, keyed by vault path. */
  loadKnownNotes(connectionId: string): Promise<KnownNotes>;
  /** Upsert notes by (user, path). Renames must move the row, not clone it. */
  writeNotes(writes: NoteWrite[]): Promise<void>;
  /** Soft-delete: set deleted_at, never remove the row. */
  softDelete(paths: string[]): Promise<void>;
  /** Persist cursor and backfill position. */
  saveProgress(progress: {
    syncCursor?: string | null;
    backfillAfterPath?: string | null;
    backfillCommitSha?: string | null;
    backfillCompletedAt?: string | null;
    lastSyncedAt?: string | null;
  }): Promise<void>;
  now?(): number;
};

export type VaultSyncSummary = {
  type: 'backfill' | 'incremental';
  fromSha: string | null;
  toSha: string;
  notesSeen: number;
  notesWritten: number;
  notesDeleted: number;
  notesSkipped: number;
  /** False when the run stopped early and another is needed to finish. */
  complete: boolean;
};

/**
 * Fetch and parse a batch, stopping when the budget runs out.
 *
 * Returns what it managed, plus whether it got through the whole list -- a
 * partial batch is a normal, successful end to a run, not a failure, but it is
 * emphatically not "done".
 */
async function fetchNotes(opts: {
  tasks: FetchTask[];
  source: VaultSource;
  gitUpdatedAt: string | null;
  deadline: number;
  now: () => number;
}): Promise<{ writes: NoteWrite[]; complete: boolean; failures: number; lastPath: string | null }> {
  const { tasks, source, gitUpdatedAt, deadline, now } = opts;

  const writes: NoteWrite[] = [];
  let failures = 0;
  let lastPath: string | null = null;
  let slowestBatchMs = 0;

  for (let i = 0; i < tasks.length; i += FETCH_BATCH) {
    if (!canStartAnotherBatch({ remainingMs: deadline - now(), slowestBatchMs })) {
      return { writes, complete: false, failures, lastPath };
    }

    const startedAt = now();
    const slice = tasks.slice(i, i + FETCH_BATCH);

    for (const task of slice) {
      try {
        const raw = await source.readBlob(task.blobSha);
        const parsed = parseNote(raw, task.path);
        writes.push({
          path: task.path,
          title: parsed.title,
          body: parsed.body,
          frontmatter: parsed.frontmatter,
          blobSha: task.blobSha,
          sizeBytes: task.sizeBytes,
          // A note's own frontmatter date beats the commit that carried it:
          // "when I wrote this" is what a reader means, and a vault-wide
          // reformat should not restamp five years of journals as today.
          gitUpdatedAt: parsed.updatedAt ?? gitUpdatedAt,
          ...(task.previousPath ? { previousPath: task.previousPath } : {}),
        });
        lastPath = task.path;
      } catch {
        // One unreadable note must not lose the run's other work. It is
        // counted, which is what stops the cursor advancing past it.
        failures += 1;
      }
    }

    slowestBatchMs = Math.max(slowestBatchMs, now() - startedAt);
  }

  return { writes, complete: true, failures, lastPath };
}

/**
 * Bring the mirror up to date, as far as the budget allows.
 *
 * One entry point for both shapes of sync, because which one is needed is a
 * property of the connection rather than a decision the caller should be
 * making: no cursor means a backfill, a cursor means a diff, and a diff the
 * source cannot express falls back to a snapshot comparison.
 */
export async function runVaultSync(opts: {
  connection: VaultConnectionRow;
  ports: VaultSyncPorts;
  budgetMs?: number;
}): Promise<VaultSyncSummary> {
  const { connection, ports } = opts;
  const now = ports.now ?? (() => Date.now());
  const deadline = now() + (opts.budgetMs ?? RUN_BUDGET_MS);
  const subpath = normaliseSubpath(connection.subpath);

  const head = await ports.source.headCommit();
  const known = await ports.loadKnownNotes(connection.id);

  const backfilling = !connection.sync_cursor || !connection.backfill_completed_at;

  if (backfilling) {
    return runBackfill({ connection, ports, known, head, subpath, deadline, now });
  }

  const diff = await ports.source.diff(connection.sync_cursor as string, head);

  if (!diff.complete) {
    // Either the history was rewritten under us or the diff was too large to
    // express. A full snapshot comparison converges on the same state, so this
    // is a slower path rather than an error -- the same shape as the mailbox's
    // expired-historyId catch-up.
    return runSnapshotRepair({ connection, ports, known, head, subpath, deadline, now });
  }

  const plan = planIncremental({ changes: diff.changes, known, subpath });

  const { writes, complete, failures } = await fetchNotes({
    tasks: plan.fetch,
    source: ports.source,
    gitUpdatedAt: diff.headCommittedAt,
    deadline,
    now,
  });

  if (writes.length) await ports.writeNotes(writes);
  if (plan.remove.length) await ports.softDelete(plan.remove);

  const advance = mayAdvanceCursor({ backfillDone: complete, fetchFailures: failures });
  await ports.saveProgress({
    ...(advance ? { syncCursor: head } : {}),
    lastSyncedAt: new Date().toISOString(),
  });

  return {
    type: 'incremental',
    fromSha: connection.sync_cursor,
    toSha: head,
    notesSeen: plan.fetch.length + plan.unchanged.length + plan.remove.length,
    notesWritten: writes.length,
    notesDeleted: plan.remove.length,
    notesSkipped: plan.skipped.length,
    complete: advance,
  };
}

async function runBackfill(opts: {
  connection: VaultConnectionRow;
  ports: VaultSyncPorts;
  known: KnownNotes;
  head: string;
  subpath: string;
  deadline: number;
  now: () => number;
}): Promise<VaultSyncSummary> {
  const { connection, ports, known, subpath, deadline, now } = opts;

  // A backfill in flight stays on the commit it started from. Letting it drift
  // forward under itself would mean the tree changing shape mid-walk, and
  // "everything before path P" would stop meaning anything.
  const commit = connection.backfill_commit_sha ?? opts.head;

  const snapshot = await ports.source.snapshot(commit);
  if (snapshot.truncated) {
    throw new Error(
      'The repository tree was too large to list in one response. ' +
        'The vault sync cannot safely proceed on a partial listing.',
    );
  }

  const notes = notesInTree(snapshot.entries, subpath);
  const batch = planBackfillBatch({
    notes,
    known,
    afterPath: connection.backfill_after_path,
    limit: BACKFILL_FETCH_LIMIT,
  });

  const { writes, complete, failures, lastPath } = await fetchNotes({
    tasks: batch.fetch,
    source: ports.source,
    // Nothing dates a file in a tree listing, so a note without its own
    // frontmatter date stays undated until something changes it. Showing every
    // note as modified on the day of the first sync would be worse than
    // showing nothing: it is wrong, and it looks right.
    gitUpdatedAt: null,
    deadline,
    now,
  });

  if (writes.length) await ports.writeNotes(writes);

  const finished = complete && batch.done;

  if (finished) {
    const gone = deletionsFromSnapshot({ notes, known });
    if (gone.length) await ports.softDelete(gone);

    const advance = mayAdvanceCursor({ backfillDone: true, fetchFailures: failures });
    await ports.saveProgress({
      ...(advance
        ? {
            syncCursor: commit,
            backfillCompletedAt: new Date().toISOString(),
            backfillAfterPath: null,
            backfillCommitSha: null,
          }
        : {}),
      lastSyncedAt: new Date().toISOString(),
    });

    return {
      type: 'backfill',
      fromSha: null,
      toSha: commit,
      notesSeen: notes.length,
      notesWritten: writes.length,
      notesDeleted: gone.length,
      notesSkipped: batch.skipped.length,
      complete: advance,
    };
  }

  // Stopped early, for one of two reasons, and they resume from different
  // places. Out of time: the last note actually written, because everything
  // after it is untouched. Out of fetch budget: the planner's own stopping
  // point, which is past the notes it found unchanged and correctly does not
  // make the next run walk them again.
  const resumeFrom = complete
    ? (batch.nextAfterPath ?? lastPath)
    : (lastPath ?? connection.backfill_after_path);

  await ports.saveProgress({
    backfillAfterPath: resumeFrom,
    backfillCommitSha: commit,
    lastSyncedAt: new Date().toISOString(),
  });

  return {
    type: 'backfill',
    fromSha: null,
    toSha: commit,
    notesSeen: notes.length,
    notesWritten: writes.length,
    notesDeleted: 0,
    notesSkipped: batch.skipped.length,
    complete: false,
  };
}

/**
 * The recovery path: compare the whole tree against what we hold.
 *
 * Reached when a diff cannot be expressed -- a force push, or a change set too
 * large for one response. It costs a tree listing and fetches only what
 * actually differs, so on a vault that has merely been reorganised it is
 * closer to free than to a re-backfill.
 */
async function runSnapshotRepair(opts: {
  connection: VaultConnectionRow;
  ports: VaultSyncPorts;
  known: KnownNotes;
  head: string;
  subpath: string;
  deadline: number;
  now: () => number;
}): Promise<VaultSyncSummary> {
  const { connection, ports, known, head, subpath, deadline, now } = opts;

  const snapshot = await ports.source.snapshot(head);
  if (snapshot.truncated) {
    throw new Error('The repository tree was too large to list in one response.');
  }

  const notes = notesInTree(snapshot.entries, subpath);
  const batch = planBackfillBatch({
    notes,
    known,
    afterPath: null,
    limit: BACKFILL_FETCH_LIMIT,
  });

  const { writes, complete, failures } = await fetchNotes({
    tasks: batch.fetch,
    source: ports.source,
    gitUpdatedAt: null,
    deadline,
    now,
  });

  if (writes.length) await ports.writeNotes(writes);

  // Deleting on a partial pass would remove notes this run simply never got
  // to. Only a pass that saw the whole tree may say what is missing from it.
  const swept = complete && batch.done;
  const gone = swept ? deletionsFromSnapshot({ notes, known }) : [];
  if (gone.length) await ports.softDelete(gone);

  const advance = mayAdvanceCursor({ backfillDone: swept, fetchFailures: failures });
  await ports.saveProgress({
    ...(advance ? { syncCursor: head } : {}),
    lastSyncedAt: new Date().toISOString(),
  });

  return {
    type: 'incremental',
    fromSha: connection.sync_cursor,
    toSha: head,
    notesSeen: notes.length,
    notesWritten: writes.length,
    notesDeleted: gone.length,
    notesSkipped: batch.skipped.length,
    complete: advance,
  };
}
