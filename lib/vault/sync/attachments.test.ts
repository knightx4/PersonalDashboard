import { describe, expect, it } from 'vitest';
import { attachmentMimeType, isOverAttachmentLimit } from '@/lib/vault/paths';
import type {
  VaultAttachmentChange,
  VaultAttachmentEntry,
  VaultSource,
} from '@/lib/vault/providers/types';
import {
  planAttachmentDiff,
  planAttachmentSnapshot,
  type AttachmentPlan,
  type KnownAttachment,
} from '@/lib/vault/sync/attachments';
import {
  runVaultSync,
  type VaultAttachmentPorts,
  type VaultConnectionRow,
} from '@/lib/vault/sync/run';

const folder = { userId: 'user-1', connectionId: 'conn-1' };
const stored = (sha: string) => `user-1/conn-1/${sha}`;

function file(path: string, blobSha = `sha-${path}`, sizeBytes = 1_000): VaultAttachmentEntry {
  const mimeType = attachmentMimeType(path);
  if (!mimeType) throw new Error(`not an attachment: ${path}`);
  return { path, blobSha, sizeBytes, mimeType, tooLarge: isOverAttachmentLimit(sizeBytes) };
}

function row(blobSha: string, copied = true, sizeBytes = 1_000): KnownAttachment {
  return { blobSha, sizeBytes, mimeType: 'image/png', storagePath: copied ? stored(blobSha) : null };
}

describe('planAttachmentSnapshot', () => {
  it('adds a row per new file and queues each distinct file for copying once', () => {
    const plan = planAttachmentSnapshot({
      attachments: [file('a.png', 'x'), file('b/c.png', 'x'), file('d.pdf', 'y')],
      known: new Map(),
      subpath: '',
      ...folder,
    });

    expect(plan.upserts.map((u) => u.path)).toEqual(['a.png', 'b/c.png', 'd.pdf']);
    expect(plan.copies.map((c) => c.storagePath)).toEqual([stored('x'), stored('y')]);
    expect(plan.copies[1].mimeType).toBe('application/pdf');
  });

  it('keeps an over-limit file as a row with no copy', () => {
    const plan = planAttachmentSnapshot({
      attachments: [file('big.mp3', 'big', 60_000_000)],
      known: new Map(),
      subpath: '',
      ...folder,
    });

    expect(plan.upserts[0]).toMatchObject({ path: 'big.mp3', storagePath: null });
    expect(plan.copies).toEqual([]);
    expect(plan.tooLarge).toBe(1);
  });

  it('leaves unchanged rows alone and re-queues one whose copy never landed', () => {
    const plan = planAttachmentSnapshot({
      attachments: [file('a.png', 'a'), file('b.png', 'b')],
      known: new Map([
        ['a.png', row('a')],
        ['b.png', row('b', false)],
      ]),
      subpath: '',
      ...folder,
    });

    expect(plan.upserts).toEqual([]);
    expect(plan.copies.map((c) => c.blobSha)).toEqual(['b']);
  });

  it('removes rows the tree no longer has, and their copies when unshared', () => {
    const plan = planAttachmentSnapshot({
      attachments: [file('kept.png', 'shared')],
      known: new Map([
        ['kept.png', row('shared')],
        ['twin.png', row('shared')],
        ['gone.png', row('gone')],
      ]),
      subpath: '',
      ...folder,
    });

    expect(plan.removes).toEqual(['gone.png', 'twin.png']);
    // The shared copy is still used by kept.png.
    expect(plan.orphans).toEqual([stored('gone')]);
  });

  it('reuses the existing copy when a file turns up under a new name', () => {
    const plan = planAttachmentSnapshot({
      attachments: [file('new.png', 'same')],
      known: new Map([['old.png', row('same')]]),
      subpath: '',
      ...folder,
    });

    expect(plan.upserts).toEqual([
      expect.objectContaining({ path: 'new.png', storagePath: stored('same') }),
    ]);
    expect(plan.copies).toEqual([]);
    expect(plan.orphans).toEqual([]);
  });

  it('keeps only files inside the vault folder, stored by vault path', () => {
    const plan = planAttachmentSnapshot({
      attachments: [file('notes/img/a.png', 'a'), file('elsewhere/b.png', 'b')],
      known: new Map(),
      subpath: 'notes',
      ...folder,
    });

    expect(plan.upserts.map((u) => u.path)).toEqual(['img/a.png']);
  });
});

describe('planAttachmentDiff', () => {
  const plan = (changes: VaultAttachmentChange[], known: Map<string, KnownAttachment>) =>
    planAttachmentDiff({ changes, known, subpath: '', ...folder });

  it('moves the row on a rename and copies nothing', () => {
    const result = plan(
      [{ kind: 'upsert', ...file('new.png', 'same'), previousPath: 'old.png' }],
      new Map([['old.png', row('same')]]),
    );

    expect(result.moves).toEqual([{ from: 'old.png', to: 'new.png' }]);
    expect(result.upserts).toEqual([]);
    expect(result.copies).toEqual([]);
    expect(result.orphans).toEqual([]);
  });

  it('moves the row and queues the new content on a rename with an edit', () => {
    const result = plan(
      [{ kind: 'upsert', ...file('new.png', 'edited'), previousPath: 'old.png' }],
      new Map([['old.png', row('before')]]),
    );

    expect(result.moves).toEqual([{ from: 'old.png', to: 'new.png' }]);
    expect(result.upserts).toEqual([
      expect.objectContaining({ path: 'new.png', blobSha: 'edited', storagePath: null }),
    ]);
    expect(result.copies.map((c) => c.blobSha)).toEqual(['edited']);
    expect(result.orphans).toEqual([stored('before')]);
  });

  it('replaces the copy of a changed file', () => {
    const result = plan(
      [{ kind: 'upsert', ...file('a.png', 'v2') }],
      new Map([['a.png', row('v1')]]),
    );

    expect(result.upserts[0]).toMatchObject({ blobSha: 'v2', storagePath: null });
    expect(result.copies.map((c) => c.blobSha)).toEqual(['v2']);
    expect(result.orphans).toEqual([stored('v1')]);
  });

  it('deletes the row and its copy when the file is removed', () => {
    const result = plan([{ kind: 'delete', path: 'a.png' }], new Map([['a.png', row('a')]]));

    expect(result.removes).toEqual(['a.png']);
    expect(result.orphans).toEqual([stored('a')]);
  });

  it('treats a file moved out of the vault folder as deleted', () => {
    const result = planAttachmentDiff({
      changes: [{ kind: 'upsert', ...file('archive/a.png', 'a'), previousPath: 'notes/a.png' }],
      known: new Map([['a.png', row('a')]]),
      subpath: 'notes',
      ...folder,
    });

    expect(result.removes).toEqual(['a.png']);
    expect(result.moves).toEqual([]);
  });

  it('moves the old file away and writes the new one when a path is reused', () => {
    const result = plan(
      [
        { kind: 'upsert', ...file('b.png', 'first'), previousPath: 'a.png' },
        { kind: 'upsert', ...file('a.png', 'second') },
      ],
      new Map([['a.png', row('first')]]),
    );

    expect(result.moves).toEqual([{ from: 'a.png', to: 'b.png' }]);
    expect(result.upserts.map((u) => u.path)).toEqual(['a.png']);
    expect(result.orphans).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The runner, against an in-memory table and bucket.
// ---------------------------------------------------------------------------

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

/** The table and the bucket, with the same rules as the real ones. */
function memoryStore() {
  const rows = new Map<string, KnownAttachment>();
  const bucket = new Map<string, number>();
  const failNext = { rows: false, uploads: new Set<string>() };

  const ports: VaultAttachmentPorts = {
    load: async () => new Map(rows),
    async applyRows(plan: AttachmentPlan) {
      if (failNext.rows) {
        failNext.rows = false;
        throw new Error('database unavailable');
      }
      for (const { from, to } of plan.moves) {
        const moved = rows.get(from);
        if (!moved || rows.has(to)) throw new Error(`bad move ${from} -> ${to}`);
        rows.delete(from);
        rows.set(to, moved);
      }
      for (const path of plan.removes) rows.delete(path);
      for (const { path, ...rest } of plan.upserts) rows.set(path, rest);
    },
    async removeObjects(paths) {
      const inUse = new Set([...rows.values()].map((r) => r.storagePath));
      for (const path of paths) if (!inUse.has(path)) bucket.delete(path);
    },
    async upload({ storagePath, bytes }) {
      if (failNext.uploads.delete(storagePath)) throw new Error('storage unavailable');
      bucket.set(storagePath, bytes.byteLength);
    },
    async markCopied(blobSha, storagePath) {
      for (const r of rows.values()) {
        if (r.blobSha === blobSha && r.storagePath === null && !isOverAttachmentLimit(r.sizeBytes)) {
          r.storagePath = storagePath;
        }
      }
    },
  };

  return { rows, bucket, failNext, ports };
}

function harness(opts: {
  attachments?: VaultAttachmentEntry[];
  diff?: VaultAttachmentChange[];
  store?: ReturnType<typeof memoryStore>;
  clock?: () => number;
}) {
  const store = opts.store ?? memoryStore();
  const progress: Record<string, unknown> = {};
  const bytesRead: string[] = [];

  const source: VaultSource = {
    provider: 'github',
    headCommit: async () => 'head-sha',
    snapshot: async () => ({ entries: [], truncated: false, attachments: opts.attachments ?? [] }),
    diff: async () => ({
      changes: [],
      complete: true,
      attachments: opts.diff ?? [],
      headCommittedAt: null,
    }),
    readBlob: async () => '',
    readBlobBytes: async (sha) => {
      bytesRead.push(sha);
      return new ArrayBuffer(8);
    },
    writeNote: async () => {
      throw new Error('the sync never writes');
    },
    canWrite: async () => {
      throw new Error('the sync never checks write access');
    },
    createNote: async () => {
      throw new Error('the sync never writes');
    },
    deleteNote: async () => {
      throw new Error('the sync never writes');
    },
  };

  const ports = {
    source,
    attachments: store.ports,
    loadKnownNotes: async () => new Map(),
    writeNotes: async () => {},
    softDelete: async () => {},
    saveProgress: async (p: Record<string, unknown>) => {
      Object.assign(progress, p);
    },
    ...(opts.clock ? { now: opts.clock } : {}),
  };

  return { ports, store, progress, bytesRead };
}

const synced = connection({ sync_cursor: 'old-sha', backfill_completed_at: '2026-01-01T00:00:00Z' });

describe('runVaultSync with attachments', () => {
  it('gives every allowed file in the repository a row and a copy', async () => {
    const { ports, store, progress } = harness({
      attachments: [file('a.png', 'a'), file('b.pdf', 'b'), file('huge.wav', 'h', 60_000_000)],
    });

    const summary = await runVaultSync({ connection: connection(), ports });

    expect([...store.rows.keys()].sort()).toEqual(['a.png', 'b.pdf', 'huge.wav']);
    expect(store.rows.get('a.png')?.storagePath).toBe(stored('a'));
    expect(store.rows.get('huge.wav')?.storagePath).toBeNull();
    expect([...store.bucket.keys()].sort()).toEqual([stored('a'), stored('b')]);
    expect(summary.attachments).toMatchObject({ copied: 2, pending: 0, tooLarge: 1 });
    expect(progress.syncCursor).toBe('head-sha');
  });

  it('finishes a first sync too large for one run across several', async () => {
    // Every clock read moves 20 seconds on, so each run fits a few copies.
    let t = 0;
    const clock = () => (t += 20_000);
    const attachments = Array.from({ length: 12 }, (_, i) => file(`img/${i}.png`, `s${i}`));
    const store = memoryStore();

    let runs = 0;
    let conn = connection();
    for (; runs < 10; runs += 1) {
      const { ports, progress } = harness({ attachments, store, clock });
      const summary = await runVaultSync({ connection: conn, ports, budgetMs: 150_000 });
      conn = connection({
        sync_cursor: (progress.syncCursor as string) ?? conn.sync_cursor,
        backfill_completed_at: (progress.backfillCompletedAt as string) ?? conn.backfill_completed_at,
      });
      if (summary.attachments.pending === 0) break;
    }

    expect(runs).toBeGreaterThan(0);
    expect(store.bucket.size).toBe(12);
    expect([...store.rows.values()].every((r) => r.storagePath !== null)).toBe(true);
  });

  it('retries a failed copy on the next sync without failing the run', async () => {
    const store = memoryStore();
    store.failNext.uploads.add(stored('a'));

    const first = harness({ attachments: [file('a.png', 'a')], store });
    const summary = await runVaultSync({ connection: connection(), ports: first.ports });

    expect(summary.attachments).toMatchObject({ copied: 0, failed: 1, pending: 1 });
    expect(first.progress.syncCursor).toBe('head-sha');
    expect(store.rows.get('a.png')?.storagePath).toBeNull();

    const second = harness({ diff: [], store });
    await runVaultSync({ connection: synced, ports: second.ports });

    expect(store.rows.get('a.png')?.storagePath).toBe(stored('a'));
    expect(store.bucket.has(stored('a'))).toBe(true);
  });

  it('reflects a change, a rename and a delete from the next diff', async () => {
    const store = memoryStore();
    await runVaultSync({
      connection: connection(),
      ports: harness({
        attachments: [file('edit.png', 'v1'), file('old.png', 'r'), file('gone.pdf', 'g')],
        store,
      }).ports,
    });

    const { ports, bytesRead } = harness({
      store,
      diff: [
        { kind: 'upsert', ...file('edit.png', 'v2') },
        { kind: 'upsert', ...file('new.png', 'r'), previousPath: 'old.png' },
        { kind: 'delete', path: 'gone.pdf' },
      ],
    });
    await runVaultSync({ connection: synced, ports });

    expect([...store.rows.keys()].sort()).toEqual(['edit.png', 'new.png']);
    expect(store.rows.get('edit.png')?.storagePath).toBe(stored('v2'));
    expect(store.rows.get('new.png')?.storagePath).toBe(stored('r'));
    // Only the edited file is fetched; the renamed one keeps its copy.
    expect(bytesRead).toEqual(['v2']);
    expect([...store.bucket.keys()].sort()).toEqual([stored('r'), stored('v2')]);
  });

  it('holds the cursor when the rows could not be written, and still writes notes', async () => {
    const store = memoryStore();
    store.failNext.rows = true;
    const { ports, progress } = harness({ store, diff: [{ kind: 'delete', path: 'a.png' }] });

    const summary = await runVaultSync({ connection: synced, ports });

    expect(summary.attachments.rowsOk).toBe(false);
    expect(progress.syncCursor).toBeUndefined();
    expect(progress.lastSyncedAt).toBeTruthy();
  });
});
