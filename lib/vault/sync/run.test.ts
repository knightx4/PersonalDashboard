import { describe, expect, it } from 'vitest';
import { runVaultSync, type NoteWrite, type VaultConnectionRow } from '@/lib/vault/sync/run';
import type { KnownNotes } from '@/lib/vault/sync/plan';
import type { VaultChange, VaultEntry, VaultSource } from '@/lib/vault/providers/types';

function connection(overrides: Partial<VaultConnectionRow> = {}): VaultConnectionRow {
  return {
    id: 'conn-1',
    user_id: 'user-1',
    repo_owner: 'knightx4',
    repo_name: 'vault',
    branch: 'main',
    subpath: '',
    sync_cursor: null,
    backfill_after_path: null,
    backfill_commit_sha: null,
    backfill_completed_at: null,
    ...overrides,
  };
}

type Recorded = {
  writes: NoteWrite[];
  deleted: string[];
  progress: Record<string, unknown>;
  blobReads: string[];
};

function harness(opts: {
  head?: string;
  entries?: VaultEntry[];
  truncated?: boolean;
  diff?: { changes: VaultChange[]; complete: boolean; headCommittedAt: string | null };
  known?: KnownNotes;
  blob?: (sha: string) => string | Promise<string>;
  clock?: () => number;
}) {
  const recorded: Recorded = { writes: [], deleted: [], progress: {}, blobReads: [] };

  const source: VaultSource = {
    provider: 'github',
    headCommit: async () => opts.head ?? 'head-sha',
    snapshot: async () => ({ entries: opts.entries ?? [], truncated: opts.truncated ?? false }),
    diff: async () => opts.diff ?? { changes: [], complete: true, headCommittedAt: null },
    readBlob: async (sha) => {
      recorded.blobReads.push(sha);
      return opts.blob ? opts.blob(sha) : `# Note ${sha}`;
    },
  };

  const ports = {
    source,
    loadKnownNotes: async () => opts.known ?? (new Map() as KnownNotes),
    writeNotes: async (writes: NoteWrite[]) => {
      recorded.writes.push(...writes);
    },
    softDelete: async (paths: string[]) => {
      recorded.deleted.push(...paths);
    },
    saveProgress: async (progress: Record<string, unknown>) => {
      Object.assign(recorded.progress, progress);
    },
    ...(opts.clock ? { now: opts.clock } : {}),
  };

  return { ports, recorded };
}

function entry(path: string, blobSha = `sha-${path}`, sizeBytes = 50): VaultEntry {
  return { path, blobSha, sizeBytes };
}

describe('backfill', () => {
  it('writes every note and then claims the cursor', async () => {
    const { ports, recorded } = harness({
      entries: [entry('A.md'), entry('Daily/B.md'), entry('Attachments/c.png')],
    });

    const summary = await runVaultSync({ connection: connection(), ports });

    expect(recorded.writes.map((w) => w.path)).toEqual(['A.md', 'Daily/B.md']);
    expect(recorded.progress.syncCursor).toBe('head-sha');
    expect(recorded.progress.backfillCompletedAt).toBeTruthy();
    expect(summary).toMatchObject({ type: 'backfill', notesWritten: 2, complete: true });
  });

  it('never requests a blob for anything that is not a note', async () => {
    const { ports, recorded } = harness({
      entries: [entry('A.md'), entry('Attachments/c.png', 'sha-png'), entry('.obsidian/x.json', 'sha-cfg')],
    });

    await runVaultSync({ connection: connection(), ports });

    expect(recorded.blobReads).toEqual(['sha-A.md']);
  });

  it('stops on the clock, records where, and does not claim the cursor', async () => {
    // The property that matters: a run out of time is a normal end, but the
    // cursor must not move, or the next run asks for changes since a commit
    // this one never finished reading.
    let t = 0;
    const { ports, recorded } = harness({
      entries: Array.from({ length: 200 }, (_, i) => entry(`N${String(i).padStart(3, '0')}.md`)),
      clock: () => {
        t += 20_000;
        return t;
      },
    });

    const summary = await runVaultSync({ connection: connection(), ports, budgetMs: 60_000 });

    expect(summary.complete).toBe(false);
    expect(recorded.progress.syncCursor).toBeUndefined();
    expect(recorded.progress.backfillCompletedAt).toBeUndefined();
    expect(recorded.progress.backfillAfterPath).toBeTruthy();
    expect(recorded.progress.backfillCommitSha).toBe('head-sha');
  });

  it('resumes after the recorded path without repeating or skipping it', async () => {
    const { ports, recorded } = harness({
      entries: [entry('A.md'), entry('B.md'), entry('C.md')],
    });

    await runVaultSync({
      connection: connection({ backfill_after_path: 'B.md', backfill_commit_sha: 'head-sha' }),
      ports,
    });

    expect(recorded.writes.map((w) => w.path)).toEqual(['C.md']);
  });

  it('stays on the commit it started, so the tree cannot shift mid-walk', async () => {
    const { ports, recorded } = harness({
      head: 'newer-sha',
      entries: [entry('A.md')],
    });

    await runVaultSync({
      connection: connection({ backfill_after_path: null, backfill_commit_sha: 'older-sha' }),
      ports,
    });

    expect(recorded.progress.syncCursor).toBe('older-sha');
  });

  it('refuses to act on a truncated tree', async () => {
    // Proceeding would soft-delete every note the listing failed to mention.
    const { ports } = harness({ entries: [], truncated: true });
    await expect(runVaultSync({ connection: connection(), ports })).rejects.toThrow(/too large/i);
  });

  it('sweeps notes the tree no longer mentions, but only once finished', async () => {
    const { ports, recorded } = harness({
      entries: [entry('Kept.md')],
      known: new Map([
        ['Kept.md', { blobSha: 'sha-Kept.md', deleted: false }],
        ['Gone.md', { blobSha: 'sha-old', deleted: false }],
      ]),
    });

    await runVaultSync({ connection: connection(), ports });

    expect(recorded.deleted).toEqual(['Gone.md']);
  });

  it('does not advance the cursor when a note failed to read', async () => {
    const { ports, recorded } = harness({
      entries: [entry('Good.md'), entry('Bad.md', 'sha-bad')],
      blob: (sha) => {
        if (sha === 'sha-bad') throw new Error('boom');
        return '# Fine';
      },
    });

    const summary = await runVaultSync({ connection: connection(), ports });

    expect(recorded.writes.map((w) => w.path)).toEqual(['Good.md']);
    expect(recorded.progress.syncCursor).toBeUndefined();
    expect(summary.complete).toBe(false);
  });
});

describe('incremental', () => {
  const synced = connection({
    sync_cursor: 'old-sha',
    backfill_completed_at: '2024-01-01T00:00:00Z',
  });

  it('fetches only what changed and advances the cursor', async () => {
    const { ports, recorded } = harness({
      diff: {
        changes: [{ kind: 'upsert', path: 'Changed.md', blobSha: 'sha-new', sizeBytes: 10 }],
        complete: true,
        headCommittedAt: '2024-06-01T12:00:00Z',
      },
      known: new Map([['Changed.md', { blobSha: 'sha-old', deleted: false }]]),
    });

    const summary = await runVaultSync({ connection: synced, ports });

    expect(recorded.blobReads).toEqual(['sha-new']);
    expect(recorded.progress.syncCursor).toBe('head-sha');
    expect(summary).toMatchObject({ type: 'incremental', notesWritten: 1, complete: true });
  });

  it('dates a changed note by the commit that carried it', async () => {
    const { ports, recorded } = harness({
      diff: {
        changes: [{ kind: 'upsert', path: 'A.md', blobSha: 'sha', sizeBytes: 10 }],
        complete: true,
        headCommittedAt: '2024-06-01T12:00:00Z',
      },
    });

    await runVaultSync({ connection: synced, ports });

    expect(recorded.writes[0].gitUpdatedAt).toBe('2024-06-01T12:00:00Z');
  });

  it("lets a note's own frontmatter date win over the commit", async () => {
    // A vault-wide reformat should not restamp five years of journals as today.
    const { ports, recorded } = harness({
      diff: {
        changes: [{ kind: 'upsert', path: 'Journal.md', blobSha: 'sha', sizeBytes: 10 }],
        complete: true,
        headCommittedAt: '2024-06-01T12:00:00Z',
      },
      blob: () => '---\nupdated: 2019-04-02\n---\n\nOld entry.',
    });

    await runVaultSync({ connection: synced, ports });

    expect(recorded.writes[0].gitUpdatedAt).toBe(new Date('2019-04-02').toISOString());
  });

  it('soft-deletes a removed note', async () => {
    const { ports, recorded } = harness({
      diff: {
        changes: [{ kind: 'delete', path: 'Gone.md' }],
        complete: true,
        headCommittedAt: null,
      },
      known: new Map([['Gone.md', { blobSha: 'sha', deleted: false }]]),
    });

    await runVaultSync({ connection: synced, ports });

    expect(recorded.deleted).toEqual(['Gone.md']);
  });

  it('carries a rename through so the row keeps its identity', async () => {
    const { ports, recorded } = harness({
      diff: {
        changes: [
          { kind: 'upsert', path: 'New.md', blobSha: 'sha', sizeBytes: 10, previousPath: 'Old.md' },
        ],
        complete: true,
        headCommittedAt: null,
      },
      known: new Map([['Old.md', { blobSha: 'sha', deleted: false }]]),
    });

    await runVaultSync({ connection: synced, ports });

    expect(recorded.writes[0]).toMatchObject({ path: 'New.md', previousPath: 'Old.md' });
    expect(recorded.deleted).toEqual([]);
  });

  it('falls back to a full comparison when the history was rewritten', async () => {
    // A force push makes the cursor unreachable. This converges on the same
    // state rather than failing or starting the vault over.
    const { ports, recorded } = harness({
      diff: { changes: [], complete: false, headCommittedAt: null },
      entries: [entry('Kept.md'), entry('Fresh.md')],
      known: new Map([
        ['Kept.md', { blobSha: 'sha-Kept.md', deleted: false }],
        ['Vanished.md', { blobSha: 'sha', deleted: false }],
      ]),
    });

    const summary = await runVaultSync({ connection: synced, ports });

    // Kept.md is unchanged, so it is not re-fetched.
    expect(recorded.writes.map((w) => w.path)).toEqual(['Fresh.md']);
    expect(recorded.deleted).toEqual(['Vanished.md']);
    expect(recorded.progress.syncCursor).toBe('head-sha');
    expect(summary.complete).toBe(true);
  });

  it('does nothing at all when nothing changed', async () => {
    const { ports, recorded } = harness({
      diff: { changes: [], complete: true, headCommittedAt: null },
    });

    await runVaultSync({ connection: synced, ports });

    expect(recorded.blobReads).toEqual([]);
    expect(recorded.writes).toEqual([]);
    expect(recorded.deleted).toEqual([]);
    expect(recorded.progress.syncCursor).toBe('head-sha');
  });
});

describe('subpath vaults', () => {
  it('stores paths relative to the vault root, not the repository root', async () => {
    // Otherwise every note is prefixed with a folder that means nothing to the
    // person who wrote it, and moving the vault rewrites every path.
    const { ports, recorded } = harness({
      entries: [entry('notes/A.md'), entry('notes/Daily/B.md'), entry('README.md')],
    });

    await runVaultSync({ connection: connection({ subpath: 'notes' }), ports });

    expect(recorded.writes.map((w) => w.path)).toEqual(['A.md', 'Daily/B.md']);
  });
});
