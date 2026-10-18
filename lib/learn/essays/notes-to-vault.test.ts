import { describe, expect, it, vi } from 'vitest';
import { addNotesToVault, NOTES_TO_VAULT_ERRORS, previewNotesToVault } from './notes-to-vault';
import type { SavableNote, SavedNoteRow, SaveNotePorts } from '@/lib/vault/notes/save';
import {
  VaultConflictError,
  VaultReadOnlyError,
  type VaultSource,
} from '@/lib/vault/providers/types';

const RAW = '---\ntags: [reading]\n---\n\n# Attention\n\nWhat I read so far.\n';
const NOTE: SavableNote = {
  id: 'note-1',
  path: 'Reading/Attention.md',
  title: 'Attention',
  body: '# Attention\n\nWhat I read so far.\n',
  blobSha: 'blob-old',
};
const INPUT = {
  path: NOTE.path,
  notes: '---\nkind: essay\n---\n## What I think\n\nFocus is trained.',
  title: 'On focus',
  date: '2026-10-18',
};
const JOINED =
  '# Attention\n\nWhat I read so far.\n\n## 2026-10-18 · On focus\n\n## What I think\n\nFocus is trained.\n';

type Write = { path: string; text: string; expected: string; message: string };

function source(fail?: Error): VaultSource & { writes: Write[] } {
  const writes: Write[] = [];
  return {
    provider: 'github',
    writes,
    headCommit: vi.fn(),
    snapshot: vi.fn(),
    diff: vi.fn(),
    readBlobBytes: vi.fn(),
    canWrite: vi.fn(),
    createNote: vi.fn(),
    deleteNote: vi.fn(),
    async readBlob() {
      return RAW;
    },
    async writeNote(path, text, expected, message) {
      if (fail) throw fail;
      writes.push({ path, text, expected, message });
      return { blobSha: 'blob-new', commitSha: 'commit-1' };
    },
  };
}

function harness(opts: { note?: SavableNote | null; src?: VaultSource } = {}) {
  const stored: Array<{ id: string; expected: string; row: SavedNoteRow }> = [];
  const src = opts.src ?? source();
  const ports: SaveNotePorts = {
    loadNote: async (path) => {
      const note = opts.note === undefined ? NOTE : opts.note;
      return note && note.path === path ? note : null;
    },
    openSource: async () => src,
    storeNote: async (id, expected, row) => {
      stored.push({ id, expected, row });
    },
    afterSave: () => {},
    now: () => new Date('2026-10-18T09:00:00Z'),
  };
  return { ports, stored };
}

describe('previewNotesToVault', () => {
  it('shows the note with the essay notes at the end and writes nothing', async () => {
    const h = harness();
    const preview = await previewNotesToVault(h.ports.loadNote, INPUT);
    expect(preview).toEqual({
      ok: true,
      path: NOTE.path,
      title: 'Attention',
      blobSha: 'blob-old',
      before: NOTE.body,
      after: JOINED,
      unchanged: false,
    });
    expect(h.stored).toEqual([]);
  });

  it('falls back to the path when the note has no title', async () => {
    const h = harness({ note: { ...NOTE, title: '' } });
    const preview = await previewNotesToVault(h.ports.loadNote, INPUT);
    expect(preview.ok && preview.title).toBe(NOTE.path);
  });

  it('refuses empty notes and a note that is gone', async () => {
    const h = harness({ note: null });
    expect(await previewNotesToVault(h.ports.loadNote, { ...INPUT, notes: '  ' })).toMatchObject({ reason: 'empty' });
    expect(await previewNotesToVault(h.ports.loadNote, INPUT)).toMatchObject({ reason: 'not-found' });
  });
});

describe('addNotesToVault', () => {
  it('commits the note with the notes under a dated heading and its frontmatter kept', async () => {
    const src = source();
    const h = harness({ src });
    const result = await addNotesToVault(h.ports, { ...INPUT, expectedBlobSha: 'blob-old' });

    expect(result).toEqual({ ok: true, path: NOTE.path, blobSha: 'blob-new', commitSha: 'commit-1' });
    expect(src.writes).toHaveLength(1);
    expect(src.writes[0]).toMatchObject({ path: NOTE.path, expected: 'blob-old' });
    expect(src.writes[0].text).toBe(`---\ntags: [reading]\n---\n\n${JOINED}`);
    expect(h.stored[0]).toMatchObject({ id: 'note-1', expected: 'blob-old', row: { blobSha: 'blob-new', body: JOINED } });
  });

  it('refuses a note synced to a newer version since the preview, and writes nothing', async () => {
    const src = source();
    const h = harness({ src, note: { ...NOTE, blobSha: 'blob-synced' } });
    const result = await addNotesToVault(h.ports, { ...INPUT, expectedBlobSha: 'blob-old' });
    expect(result).toMatchObject({ ok: false, reason: 'changed' });
    expect(src.writes).toEqual([]);
    expect(h.stored).toEqual([]);
  });

  it('refuses a note changed in Obsidian that the sync has not brought in yet', async () => {
    const h = harness({ src: source(new VaultConflictError('stale blob', NOTE.path)) });
    const result = await addNotesToVault(h.ports, { ...INPUT, expectedBlobSha: 'blob-old' });
    expect(result).toMatchObject({ ok: false, reason: 'changed' });
    expect(h.stored).toEqual([]);
  });

  it('refuses a read-only vault', async () => {
    const h = harness({ src: source(new VaultReadOnlyError('no write scope')) });
    const result = await addNotesToVault(h.ports, { ...INPUT, expectedBlobSha: 'blob-old' });
    expect(result).toMatchObject({ ok: false, reason: 'read-only' });
    expect(h.stored).toEqual([]);
  });

  it('makes no commit when the notes are already the last block', async () => {
    const src = source();
    const h = harness({ src, note: { ...NOTE, body: JOINED } });
    const result = await addNotesToVault(h.ports, { ...INPUT, expectedBlobSha: 'blob-old' });
    expect(result).toEqual({ ok: true, path: NOTE.path, blobSha: 'blob-old', commitSha: null });
    expect(src.writes).toEqual([]);
  });

  it('refuses empty notes and a missing note', async () => {
    expect(await addNotesToVault(harness().ports, { ...INPUT, notes: '', expectedBlobSha: 'blob-old' })).toMatchObject({ reason: 'empty' });
    expect(await addNotesToVault(harness({ note: null }).ports, { ...INPUT, expectedBlobSha: 'blob-old' })).toMatchObject({ reason: 'not-found' });
  });

  it('has a plain message for every failure', () => {
    for (const message of Object.values(NOTES_TO_VAULT_ERRORS)) expect(message).toMatch(/\.$/);
  });
});
