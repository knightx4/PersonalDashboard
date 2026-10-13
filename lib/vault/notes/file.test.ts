import { describe, expect, it, vi } from 'vitest';
import type { CreateNotePorts, NewNoteRow, RemoveNotePorts } from '@/lib/vault/notes/create';
import { appendQuickNote, FILE_ERRORS, fileQuickNote, filedLine, type FileQuickNotePorts } from '@/lib/vault/notes/file';
import type { SaveNotePorts } from '@/lib/vault/notes/save';
import { VaultConflictError, VaultReadOnlyError, type VaultSource } from '@/lib/vault/providers/types';

const NOW = new Date('2026-10-10T09:00:00Z');

type Row = { id: string; path: string; title: string; body: string; blobSha: string; deleted: boolean };

/**
 * A vault of stored notes and the repository behind them, recording every
 * commit in order, so a test can read what happened and in which order.
 */
function vault(notes: Row[], source: Partial<VaultSource> = {}) {
  const rows = new Map(notes.map((note) => [note.path, { ...note }]));
  const blobs = new Map(notes.map((note) => [note.blobSha, note.body]));
  const commits: string[] = [];
  let n = 0;

  const repo: VaultSource = {
    readBlob: async (sha: string) => blobs.get(sha) ?? '',
    writeNote: async (path: string, text: string, expected: string, message: string) => {
      if (rows.get(path)?.blobSha !== expected) throw new VaultConflictError('stale', path);
      const blobSha = `w${(n += 1)}`;
      blobs.set(blobSha, text);
      commits.push(`write ${path}: ${message}`);
      return { blobSha, commitSha: `c${n}` };
    },
    createNote: async (path: string, text: string, message: string) => {
      if (rows.has(path) && !rows.get(path)!.deleted) throw new VaultConflictError('exists', path);
      const blobSha = `n${(n += 1)}`;
      blobs.set(blobSha, text);
      commits.push(`create ${path}: ${message}`);
      return { blobSha, commitSha: `c${n}` };
    },
    deleteNote: async (path: string, _expected: string, message: string) => {
      commits.push(`delete ${path}: ${message}`);
      return `c${(n += 1)}`;
    },
    ...source,
  } as VaultSource;

  const byId = (id: string) => [...rows.values()].find((row) => row.id === id) ?? null;

  const save: SaveNotePorts = {
    loadNote: async (path) => {
      const row = rows.get(path);
      return row && !row.deleted ? { id: row.id, path: row.path, title: row.title, body: row.body, blobSha: row.blobSha } : null;
    },
    openSource: async () => repo,
    storeNote: async (id, _expected, saved) => {
      const row = byId(id)!;
      Object.assign(row, { body: saved.body, blobSha: saved.blobSha });
    },
    afterSave: vi.fn(),
    now: () => NOW,
  };
  const create: CreateNotePorts = {
    openSource: async () => repo,
    storeNote: async (row: NewNoteRow) => {
      rows.set(row.path, { id: `id-${row.path}`, path: row.path, title: row.title, body: row.body, blobSha: row.blobSha, deleted: false });
      return `id-${row.path}`;
    },
    afterSave: vi.fn(),
    now: () => NOW,
  };
  const remove: RemoveNotePorts = {
    openSource: async () => repo,
    loadNote: async (id) => byId(id),
    markDeleted: async (id) => {
      byId(id)!.deleted = true;
    },
  };
  const ports: FileQuickNotePorts = { save, create, remove, now: () => NOW };
  return { ports, rows, commits, blobs };
}

const quick: Row = { id: 'q1', path: 'Inbox/Ask Ana about the lease.md', title: 'Ask Ana about the lease', body: 'Ask Ana about the lease\nbefore Friday\n', blobSha: 'qb', deleted: false };
const flat: Row = { id: 't1', path: 'Home/Flat.md', title: 'Flat', body: '# Flat\n\nThe boiler is due a service.\n', blobSha: 'tb', deleted: false };

describe('appendQuickNote', () => {
  it('puts the text at the foot under a dated line', () => {
    expect(filedLine(NOW)).toBe('*Added 10 October 2026*');
    expect(appendQuickNote('# Flat\n\nBoiler.\n\n\n', 'Call Ana\r\n', NOW)).toBe(
      '# Flat\n\nBoiler.\n\n*Added 10 October 2026*\n\nCall Ana\n',
    );
  });

  it('starts an empty note with the dated line', () => {
    expect(appendQuickNote('', 'Call Ana', NOW)).toBe('*Added 10 October 2026*\n\nCall Ana\n');
  });
});

describe('filing a quick note into a note', () => {
  it('saves the text to the target first, then removes the Inbox file', async () => {
    const { ports, rows, commits } = vault([quick, flat]);
    const result = await fileQuickNote(ports, { quickPath: quick.path, quickBlobSha: 'qb', target: { kind: 'note', path: flat.path, blobSha: 'tb' } });

    expect(result).toEqual({ ok: true, path: flat.path, title: 'Flat', removed: true });
    expect(commits).toEqual([
      'write Home/Flat.md: Edit Flat from Dash',
      'delete Inbox/Ask Ana about the lease.md: Remove Ask Ana about the lease from Dash',
    ]);
    expect(rows.get(flat.path)!.body).toBe(
      '# Flat\n\nThe boiler is due a service.\n\n*Added 10 October 2026*\n\nAsk Ana about the lease\nbefore Friday\n',
    );
    expect(rows.get(quick.path)!.deleted).toBe(true);
  });

  it('leaves the Inbox note untouched when the save is refused', async () => {
    // The target was changed in Obsidian and pushed: the repository refuses the stale write.
    const { ports, rows, commits } = vault([quick, flat], {
      writeNote: async (path: string) => {
        throw new VaultConflictError('stale', path);
      },
    });
    const result = await fileQuickNote(ports, { quickPath: quick.path, target: { kind: 'note', path: flat.path } });

    expect(result).toEqual({ ok: false, reason: 'changed', error: FILE_ERRORS.changed });
    expect(commits).toEqual([]);
    expect(rows.get(quick.path)).toMatchObject({ deleted: false, blobSha: 'qb' });
  });

  it('refuses a target the person saw at an older version, before writing anything', async () => {
    const { ports, commits } = vault([quick, flat]);
    const result = await fileQuickNote(ports, { quickPath: quick.path, target: { kind: 'note', path: flat.path, blobSha: 'old' } });
    expect(result).toMatchObject({ ok: false, reason: 'changed' });
    expect(commits).toEqual([]);
  });

  it('says so when the token cannot write, and moves nothing', async () => {
    const { ports, rows } = vault([quick, flat], {
      writeNote: async () => {
        throw new VaultReadOnlyError('read only');
      },
    });
    const result = await fileQuickNote(ports, { quickPath: quick.path, target: { kind: 'note', path: flat.path } });
    expect(result).toMatchObject({ ok: false, reason: 'read-only' });
    expect(rows.get(quick.path)!.deleted).toBe(false);
  });

  it('refuses a quick note edited since it was shown, a missing target, itself, and a note outside the Inbox', async () => {
    const { ports, commits } = vault([quick, flat]);
    const into = { kind: 'note' as const, path: flat.path };
    expect(await fileQuickNote(ports, { quickPath: quick.path, quickBlobSha: 'older', target: into })).toMatchObject({ reason: 'quick-changed' });
    expect(await fileQuickNote(ports, { quickPath: quick.path, target: { kind: 'note', path: 'Gone.md' } })).toMatchObject({ reason: 'not-found' });
    expect(await fileQuickNote(ports, { quickPath: quick.path, target: { kind: 'note', path: quick.path } })).toMatchObject({ reason: 'same-note' });
    expect(await fileQuickNote(ports, { quickPath: flat.path, target: { kind: 'own' } })).toMatchObject({ reason: 'not-quick' });
    expect(commits).toEqual([]);
  });

  it('reports the text filed but the Inbox file kept when only the removal fails', async () => {
    const { ports, rows } = vault([quick, flat], {
      deleteNote: async (path: string) => {
        throw new VaultConflictError('stale', path);
      },
    });
    const result = await fileQuickNote(ports, { quickPath: quick.path, target: { kind: 'note', path: flat.path } });
    expect(result).toMatchObject({ ok: true, path: flat.path, removed: false });
    expect(result.ok && result.warning).toContain('Flat');
    expect(rows.get(flat.path)!.body).toContain('before Friday');
    expect(rows.get(quick.path)!.deleted).toBe(false);
  });
});

describe('making a quick note a note of its own', () => {
  it('writes it at the top of the vault, named from its first line, then removes the Inbox file', async () => {
    const { ports, rows, commits } = vault([quick]);
    const result = await fileQuickNote(ports, { quickPath: quick.path, target: { kind: 'own' } });

    expect(result).toEqual({ ok: true, path: 'Ask Ana about the lease.md', title: 'Ask Ana about the lease', removed: true });
    expect(commits).toEqual([
      'create Ask Ana about the lease.md: Add Ask Ana about the lease from Dash',
      'delete Inbox/Ask Ana about the lease.md: Remove Ask Ana about the lease from Dash',
    ]);
    expect(rows.get('Ask Ana about the lease.md')!.body).toBe('Ask Ana about the lease\nbefore Friday\n');
    expect(rows.get(quick.path)!.deleted).toBe(true);
  });

  it('takes the next number when the name is already taken', async () => {
    const taken: Row = { id: 't2', path: 'Ask Ana about the lease.md', title: 'Ask Ana about the lease', body: 'Older\n', blobSha: 'ob', deleted: false };
    const { ports, rows } = vault([quick, taken]);
    const result = await fileQuickNote(ports, { quickPath: quick.path, target: { kind: 'own' } });

    expect(result).toMatchObject({ ok: true, path: 'Ask Ana about the lease 2.md', removed: true });
    expect(rows.get(taken.path)!.body).toBe('Older\n');
  });

  it('leaves the Inbox note where it was when the new note cannot be written', async () => {
    const { ports, rows, commits } = vault([quick], {
      createNote: async () => {
        throw new VaultReadOnlyError('read only');
      },
    });
    const result = await fileQuickNote(ports, { quickPath: quick.path, target: { kind: 'own' } });
    expect(result).toMatchObject({ ok: false, reason: 'read-only' });
    expect(commits).toEqual([]);
    expect(rows.get(quick.path)!.deleted).toBe(false);
  });
});
