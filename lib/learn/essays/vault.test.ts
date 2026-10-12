import { describe, expect, it, vi } from 'vitest';
import { parseNote } from '@/lib/vault/markdown/note';
import { VaultConflictError, type VaultSource } from '@/lib/vault/providers/types';
import { readEssayFrontmatter } from './note';
import { saveEssayToVault, type EssayVaultPatch, type EssayVaultPorts, type VaultEssay } from './vault';

/**
 * An in-memory vault: the repository's files by path, the stored notes the
 * sync keeps, and every commit made. Enough of both to run the essay's first
 * save, a later save, and a note edited in Obsidian in between.
 */
function world(essay: Partial<VaultEssay> = {}) {
  const files = new Map<string, { text: string; blob: string }>();
  const blobs = new Map<string, string>();
  const notes = new Map<string, { id: string; path: string; title: string; body: string; blobSha: string }>();
  const commits: Array<{ path: string; message: string; text: string }> = [];
  let n = 0;
  const blobFor = (text: string) => {
    n += 1;
    const blob = `blob-${n}`;
    blobs.set(blob, text);
    return blob;
  };

  const source: VaultSource = {
    provider: 'github',
    headCommit: vi.fn(),
    snapshot: vi.fn(),
    diff: vi.fn(),
    readBlobBytes: vi.fn(),
    canWrite: vi.fn(),
    deleteNote: vi.fn(),
    async readBlob(sha) {
      const text = blobs.get(sha);
      if (text === undefined) throw new Error(`no blob ${sha}`);
      return text;
    },
    async createNote(path, text, message) {
      if (files.has(path)) throw new VaultConflictError('exists', path);
      const blob = blobFor(text);
      files.set(path, { text, blob });
      commits.push({ path, message, text });
      return { blobSha: blob, commitSha: `commit-${commits.length}` };
    },
    async writeNote(path, text, expected, message) {
      const file = files.get(path);
      if (!file || file.blob !== expected) throw new VaultConflictError('moved on', path);
      const blob = blobFor(text);
      files.set(path, { text, blob });
      commits.push({ path, message, text });
      return { blobSha: blob, commitSha: `commit-${commits.length}` };
    },
  };

  const row: VaultEssay = {
    id: 'essay-1',
    path: 'Essays/Untitled essay.md',
    noteId: null,
    blobSha: null,
    slug: null,
    brief: { claim: 'Money holds its value only because it can become every other good.' },
    ...essay,
  };
  const stored: EssayVaultPatch[] = [];

  const ports: EssayVaultPorts = {
    loadEssay: async (id) => (id === row.id ? { ...row } : null),
    takenSlugs: async () => new Set(['money-odd-good-out']),
    storeEssay: async (_id, patch) => {
      stored.push(patch);
      Object.assign(row, { noteId: patch.noteId, path: patch.path, blobSha: patch.blobSha, slug: patch.slug });
    },
    create: {
      openSource: async () => source,
      storeNote: async (note) => {
        const id = `note-${notes.size + 1}`;
        notes.set(id, { id, path: note.path, title: note.title, body: note.body, blobSha: note.blobSha });
        return id;
      },
      afterSave: () => undefined,
    },
    save: {
      loadNote: async (path) => [...notes.values()].find((note) => note.path === path) ?? null,
      openSource: async () => source,
      storeNote: async (id, expected, saved) => {
        const note = notes.get(id);
        if (note && note.blobSha === expected) Object.assign(note, { title: saved.title, body: saved.body, blobSha: saved.blobSha });
      },
      afterSave: () => undefined,
    },
  };

  /** Someone edits the note in Obsidian, and the sync brings it in. */
  const editInObsidian = (path: string, text: string) => {
    const blob = blobFor(text);
    files.set(path, { text, blob });
    const note = [...notes.values()].find((each) => each.path === path)!;
    Object.assign(note, { body: parseNote(text, path).body, blobSha: blob });
  };

  return { ports, files, notes, commits, stored, row, editInObsidian };
}

const DRAFT = '# Why money is the odd good out\n\nEvery good you buy wears out.';

describe('saveEssayToVault', () => {
  it('writes the first save as one commit adding Essays/<title>.md with the essay frontmatter', async () => {
    const w = world();
    const result = await saveEssayToVault(w.ports, { id: 'essay-1', body: DRAFT, blobSha: null, today: '2026-10-12' });

    expect(result).toMatchObject({ ok: true, path: 'Essays/Why money is the odd good out.md', commitSha: 'commit-1' });
    expect(w.commits).toHaveLength(1);
    expect(w.commits[0]!.message).toBe('Add Why money is the odd good out from Dash');
    const parsed = parseNote(w.files.get('Essays/Why money is the odd good out.md')!.text, 'x');
    expect(parsed.body).toBe(`${DRAFT}\n`);
    expect(readEssayFrontmatter(parsed.frontmatter, { title: 'x', today: 'x' })).toMatchObject({
      title: 'Why money is the odd good out',
      type: 'essay',
      stage: 'draft',
      publish: false,
      // The person's other essay already holds the plain slug.
      slug: 'money-odd-good-out-2',
      description: 'Money holds its value only because it can become every other good.',
      created: '2026-10-12',
      updated: '2026-10-12',
    });
    expect(w.stored).toEqual([
      {
        noteId: 'note-1',
        path: 'Essays/Why money is the odd good out.md',
        blobSha: 'blob-1',
        slug: 'money-odd-good-out-2',
        draftBody: DRAFT,
      },
    ]);
  });

  it('edits the same note in place on the next save, from the blob the editor opened', async () => {
    const w = world();
    const first = await saveEssayToVault(w.ports, { id: 'essay-1', body: DRAFT, blobSha: null, today: '2026-10-12' });
    if (!first.ok) throw new Error(first.error);

    const next = `${DRAFT}\n\nA loaf is worth less on Thursday.`;
    const second = await saveEssayToVault(w.ports, { id: 'essay-1', body: next, blobSha: first.blobSha, today: '2026-10-13' });

    expect(second).toMatchObject({ ok: true, path: first.path, commitSha: 'commit-2' });
    expect(w.files.size).toBe(1);
    expect(w.commits[1]!.message).toBe('Edit Why money is the odd good out from Dash');
    const text = w.files.get(first.path)!.text;
    expect(text).toContain('updated: 2026-10-13\n');
    expect(text).toContain('created: 2026-10-12\n');
    expect(parseNote(text, first.path).body).toBe(`${next}\n`);
  });

  it('makes no commit when the vault already has the text', async () => {
    const w = world();
    const first = await saveEssayToVault(w.ports, { id: 'essay-1', body: DRAFT, blobSha: null, today: '2026-10-12' });
    if (!first.ok) throw new Error(first.error);
    const again = await saveEssayToVault(w.ports, { id: 'essay-1', body: `\n${DRAFT}\n`, blobSha: first.blobSha, today: '2026-10-13' });
    expect(again).toMatchObject({ ok: true, commitSha: null });
    expect(w.commits).toHaveLength(1);
  });

  it('does not overwrite a note changed in Obsidian since the editor opened it', async () => {
    const w = world();
    const first = await saveEssayToVault(w.ports, { id: 'essay-1', body: DRAFT, blobSha: null, today: '2026-10-12' });
    if (!first.ok) throw new Error(first.error);
    const theirs = w.files.get(first.path)!.text.replace('wears out.', 'wears out, they wrote.');
    w.editInObsidian(first.path, theirs);

    const result = await saveEssayToVault(w.ports, {
      id: 'essay-1',
      body: `${DRAFT} Mine.`,
      blobSha: first.blobSha,
      today: '2026-10-13',
    });

    expect(result).toMatchObject({ ok: false, reason: 'changed' });
    expect(w.files.get(first.path)!.text).toBe(theirs);
    expect(w.commits).toHaveLength(1);
  });

  it('is refused by the repository too when the sync has not caught up', async () => {
    const w = world();
    const first = await saveEssayToVault(w.ports, { id: 'essay-1', body: DRAFT, blobSha: null, today: '2026-10-12' });
    if (!first.ok) throw new Error(first.error);
    w.files.set(first.path, { text: 'changed in Obsidian', blob: 'blob-theirs' });

    const result = await saveEssayToVault(w.ports, { id: 'essay-1', body: `${DRAFT} Mine.`, blobSha: first.blobSha, today: '2026-10-13' });
    expect(result).toMatchObject({ ok: false, reason: 'changed' });
    expect(w.files.get(first.path)!.text).toBe('changed in Obsidian');
  });

  it('treats a tab that opened before the first save as out of date', async () => {
    const w = world();
    await saveEssayToVault(w.ports, { id: 'essay-1', body: DRAFT, blobSha: null, today: '2026-10-12' });
    const stale = await saveEssayToVault(w.ports, { id: 'essay-1', body: 'Other tab', blobSha: null, today: '2026-10-12' });
    expect(stale).toMatchObject({ ok: false, reason: 'changed' });
    expect(w.commits).toHaveLength(1);
  });

  it('writes a new note when the old one was deleted in Obsidian', async () => {
    const w = world({
      noteId: 'note-gone',
      path: 'Essays/Why money is the odd good out.md',
      blobSha: 'blob-gone',
      slug: 'money-odd-good-out',
    });
    const result = await saveEssayToVault(w.ports, { id: 'essay-1', body: DRAFT, blobSha: 'blob-gone', today: '2026-10-12' });
    expect(result).toMatchObject({ ok: true, path: 'Essays/Why money is the odd good out.md' });
    expect(w.stored[0]).toMatchObject({ noteId: 'note-1', slug: 'money-odd-good-out' });
  });

  it('numbers the file when Essays already has a note of that name, and writes nothing for an empty draft', async () => {
    const w = world();
    w.files.set('Essays/Why money is the odd good out.md', { text: 'someone else', blob: 'blob-x' });
    const result = await saveEssayToVault(w.ports, { id: 'essay-1', body: DRAFT, blobSha: null, today: '2026-10-12' });
    expect(result).toMatchObject({ ok: true, path: 'Essays/Why money is the odd good out 2.md' });

    const empty = await saveEssayToVault(world().ports, { id: 'essay-1', body: ' \n ', blobSha: null, today: '2026-10-12' });
    expect(empty).toMatchObject({ ok: false, reason: 'empty' });
  });
});
