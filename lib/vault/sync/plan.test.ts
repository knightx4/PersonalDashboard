import { describe, expect, it } from 'vitest';
import {
  deletionsFromSnapshot,
  mayAdvanceCursor,
  notesInTree,
  planBackfillBatch,
  planIncremental,
  type KnownNotes,
} from '@/lib/vault/sync/plan';
import { MAX_NOTE_BYTES } from '@/lib/vault/markdown/note';
import type { VaultEntry } from '@/lib/vault/providers/types';

function entry(path: string, blobSha = `sha-${path}`, sizeBytes = 100): VaultEntry {
  return { path, blobSha, sizeBytes };
}

function known(entries: Record<string, { blobSha: string; deleted?: boolean }>): KnownNotes {
  return new Map(
    Object.entries(entries).map(([path, v]) => [
      path,
      { blobSha: v.blobSha, deleted: v.deleted ?? false },
    ]),
  );
}

describe('notesInTree', () => {
  it('keeps markdown and drops everything else', () => {
    const notes = notesInTree(
      [
        entry('Ideas.md'),
        entry('Attachments/photo.png'),
        entry('Attachments/scan.pdf'),
        entry('Recording.m4a'),
        entry('Canvas.canvas'),
      ],
      '',
    );
    expect(notes.map((n) => n.path)).toEqual(['Ideas.md']);
  });

  it('drops Obsidian config and every other dotfile directory', () => {
    // .obsidian churns on every app launch and nobody wrote it; .trash is
    // Obsidian's own deleted-notes folder, which must not come back as notes.
    const notes = notesInTree(
      [
        entry('.obsidian/workspace.json'),
        entry('.obsidian/plugins/readme.md'),
        entry('.trash/Deleted.md'),
        entry('.git/COMMIT_EDITMSG'),
        entry('Real.md'),
      ],
      '',
    );
    expect(notes.map((n) => n.path)).toEqual(['Real.md']);
  });

  it('is case-insensitive about the extension', () => {
    expect(notesInTree([entry('Shouty.MD')], '').map((n) => n.path)).toEqual(['Shouty.MD']);
  });

  it('strips the subpath and ignores anything outside it', () => {
    const notes = notesInTree(
      [entry('vault/Ideas.md'), entry('vault/Daily/Today.md'), entry('README.md')],
      'vault',
    );
    expect(notes.map((n) => n.path)).toEqual(['Daily/Today.md', 'Ideas.md']);
  });

  it('sorts by path, because that ordering is the resume cursor', () => {
    const notes = notesInTree([entry('b.md'), entry('a/z.md'), entry('a/a.md')], '');
    expect(notes.map((n) => n.path)).toEqual(['a/a.md', 'a/z.md', 'b.md']);
  });
});

describe('planBackfillBatch', () => {
  const notes = [entry('a.md'), entry('b.md'), entry('c.md'), entry('d.md')];

  it('fetches everything on a first run of an empty vault', () => {
    const batch = planBackfillBatch({ notes, known: known({}), afterPath: null, limit: 10 });
    expect(batch.fetch.map((f) => f.path)).toEqual(['a.md', 'b.md', 'c.md', 'd.md']);
    expect(batch.done).toBe(true);
    expect(batch.nextAfterPath).toBeNull();
  });

  it('stops at the limit and reports where to resume', () => {
    const batch = planBackfillBatch({ notes, known: known({}), afterPath: null, limit: 2 });
    expect(batch.fetch.map((f) => f.path)).toEqual(['a.md', 'b.md']);
    expect(batch.done).toBe(false);
    expect(batch.nextAfterPath).toBe('b.md');
  });

  it('resumes exclusively, so the boundary note is neither repeated nor skipped', () => {
    const batch = planBackfillBatch({ notes, known: known({}), afterPath: 'b.md', limit: 10 });
    expect(batch.fetch.map((f) => f.path)).toEqual(['c.md', 'd.md']);
    expect(batch.done).toBe(true);
  });

  it('does no network work for a vault that has not changed', () => {
    // The whole point of storing git's blob sha: a re-scan is free, so it can
    // run to the end in one go rather than taking a hundred runs to notice.
    const batch = planBackfillBatch({
      notes,
      known: known({
        'a.md': { blobSha: 'sha-a.md' },
        'b.md': { blobSha: 'sha-b.md' },
        'c.md': { blobSha: 'sha-c.md' },
        'd.md': { blobSha: 'sha-d.md' },
      }),
      afterPath: null,
      limit: 2,
    });
    expect(batch.fetch).toEqual([]);
    expect(batch.unchanged).toHaveLength(4);
    expect(batch.done).toBe(true);
  });

  it('re-fetches a note whose content changed', () => {
    const batch = planBackfillBatch({
      notes: [entry('a.md', 'sha-new')],
      known: known({ 'a.md': { blobSha: 'sha-old' } }),
      afterPath: null,
      limit: 10,
    });
    expect(batch.fetch.map((f) => f.path)).toEqual(['a.md']);
  });

  it('re-fetches a note that was soft-deleted and has come back', () => {
    // A bad commit removed it, a later commit restored it. Same content, so a
    // sha comparison alone would leave the row hidden forever.
    const batch = planBackfillBatch({
      notes: [entry('a.md')],
      known: known({ 'a.md': { blobSha: 'sha-a.md', deleted: true } }),
      afterPath: null,
      limit: 10,
    });
    expect(batch.fetch.map((f) => f.path)).toEqual(['a.md']);
  });

  it('skips an oversized note without failing the run, and keeps going', () => {
    const batch = planBackfillBatch({
      notes: [entry('big.md', 'sha-big', MAX_NOTE_BYTES + 1), entry('small.md')],
      known: known({}),
      afterPath: null,
      limit: 10,
    });
    expect(batch.skipped).toEqual(['big.md']);
    expect(batch.fetch.map((f) => f.path)).toEqual(['small.md']);
    expect(batch.done).toBe(true);
  });

  it('is done on an empty vault', () => {
    const batch = planBackfillBatch({ notes: [], known: known({}), afterPath: null, limit: 10 });
    expect(batch).toMatchObject({ done: true, nextAfterPath: null, fetch: [] });
  });
});

describe('planIncremental', () => {
  it('fetches added and modified notes', () => {
    const plan = planIncremental({
      changes: [
        { kind: 'upsert', path: 'New.md', blobSha: 'sha1', sizeBytes: 10 },
        { kind: 'upsert', path: 'Edited.md', blobSha: 'sha2', sizeBytes: 20 },
      ],
      known: known({ 'Edited.md': { blobSha: 'old' } }),
      subpath: '',
    });
    expect(plan.fetch.map((f) => f.path)).toEqual(['New.md', 'Edited.md']);
    expect(plan.remove).toEqual([]);
  });

  it('removes a deleted note', () => {
    const plan = planIncremental({
      changes: [{ kind: 'delete', path: 'Gone.md' }],
      known: known({ 'Gone.md': { blobSha: 'sha' } }),
      subpath: '',
    });
    expect(plan.remove).toEqual(['Gone.md']);
  });

  it('ignores a delete for something it never held', () => {
    const plan = planIncremental({
      changes: [{ kind: 'delete', path: 'Attachments/photo.png' }],
      known: known({}),
      subpath: '',
    });
    expect(plan.remove).toEqual([]);
  });

  it('carries a rename through as one note keeping its identity', () => {
    // The row keeps its id, which is what stops a rename in Obsidian from
    // orphaning anything that cites the note later.
    const plan = planIncremental({
      changes: [
        { kind: 'upsert', path: 'New name.md', blobSha: 'sha', sizeBytes: 10, previousPath: 'Old name.md' },
      ],
      known: known({ 'Old name.md': { blobSha: 'sha' } }),
      subpath: '',
    });
    expect(plan.fetch).toEqual([
      { path: 'New name.md', blobSha: 'sha', sizeBytes: 10, previousPath: 'Old name.md' },
    ]);
    expect(plan.remove).toEqual([]);
  });

  it('treats a rename out of the vault as a delete', () => {
    const plan = planIncremental({
      changes: [
        { kind: 'upsert', path: 'elsewhere/Note.md', blobSha: 'sha', sizeBytes: 10, previousPath: 'vault/Note.md' },
      ],
      known: known({ 'Note.md': { blobSha: 'sha' } }),
      subpath: 'vault',
    });
    expect(plan.remove).toEqual(['Note.md']);
    expect(plan.fetch).toEqual([]);
  });

  it('treats a note renamed to a non-note as a delete', () => {
    const plan = planIncremental({
      changes: [
        { kind: 'upsert', path: 'Note.txt', blobSha: 'sha', sizeBytes: 10, previousPath: 'Note.md' },
      ],
      known: known({ 'Note.md': { blobSha: 'sha' } }),
      subpath: '',
    });
    expect(plan.remove).toEqual(['Note.md']);
  });

  it('ignores changes to files that were never notes', () => {
    const plan = planIncremental({
      changes: [
        { kind: 'upsert', path: 'Attachments/photo.png', blobSha: 'sha', sizeBytes: 900_000 },
        { kind: 'upsert', path: '.obsidian/workspace.json', blobSha: 'sha', sizeBytes: 10 },
      ],
      known: known({}),
      subpath: '',
    });
    expect(plan).toMatchObject({ fetch: [], remove: [], skipped: [] });
  });

  it('drops a stored note that has grown past the cap', () => {
    // Keeping the old copy would show content that no longer matches the file.
    const plan = planIncremental({
      changes: [{ kind: 'upsert', path: 'Huge.md', blobSha: 'sha', sizeBytes: MAX_NOTE_BYTES + 1 }],
      known: known({ 'Huge.md': { blobSha: 'old' } }),
      subpath: '',
    });
    expect(plan.skipped).toEqual(['Huge.md']);
    expect(plan.remove).toEqual(['Huge.md']);
    expect(plan.fetch).toEqual([]);
  });

  it('does not re-fetch a note whose content is already current', () => {
    const plan = planIncremental({
      changes: [{ kind: 'upsert', path: 'Same.md', blobSha: 'sha', sizeBytes: 10 }],
      known: known({ 'Same.md': { blobSha: 'sha' } }),
      subpath: '',
    });
    expect(plan.fetch).toEqual([]);
    expect(plan.unchanged).toEqual(['Same.md']);
  });
});

describe('deletionsFromSnapshot', () => {
  it('removes what the tree no longer mentions', () => {
    const gone = deletionsFromSnapshot({
      notes: [entry('Kept.md')],
      known: known({ 'Kept.md': { blobSha: 'sha' }, 'Gone.md': { blobSha: 'sha' } }),
    });
    expect(gone).toEqual(['Gone.md']);
  });

  it('does not re-delete something already gone', () => {
    const gone = deletionsFromSnapshot({
      notes: [],
      known: known({ 'Gone.md': { blobSha: 'sha', deleted: true } }),
    });
    expect(gone).toEqual([]);
  });
});

describe('mayAdvanceCursor', () => {
  it('advances only when the whole tree was read without failures', () => {
    expect(mayAdvanceCursor({ backfillDone: true, fetchFailures: 0 })).toBe(true);
  });

  it('refuses while a backfill is still walking', () => {
    // Advancing here is not a delay, it is a vault permanently missing
    // whatever was not reached: the next run only asks for changes since a
    // commit this one never finished.
    expect(mayAdvanceCursor({ backfillDone: false, fetchFailures: 0 })).toBe(false);
  });

  it('refuses when a note failed to fetch', () => {
    expect(mayAdvanceCursor({ backfillDone: true, fetchFailures: 1 })).toBe(false);
  });
});
