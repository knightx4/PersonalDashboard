import { describe, expect, it } from 'vitest';
import { cleanNoteName, RENAME_ERRORS, renameNote, type RenameNotePorts } from '@/lib/vault/notes/rename';
import { VaultConflictError, VaultReadOnlyError, type VaultSource } from '@/lib/vault/providers/types';

type Row = { id: string; path: string; title: string; blobSha: string };

/** One stored note and the repository behind it, recording each commit in order. */
function vault(row: Row, files: Record<string, string>, source: Partial<VaultSource> = {}) {
  const stored = { ...row };
  const commits: string[] = [];
  const repo = {
    readBlob: async (sha: string) => (sha === row.blobSha ? '# Hello\n\nThe text.\n' : ''),
    createNote: async (path: string, _text: string, message: string) => {
      if (path in files) throw new VaultConflictError('exists', path);
      commits.push(`create ${path}: ${message}`);
      return { blobSha: 'new-sha', commitSha: 'c1' };
    },
    deleteNote: async (path: string, _sha: string, message: string) => {
      commits.push(`delete ${path}: ${message}`);
      return 'c2';
    },
    ...source,
  } as VaultSource;
  const ports: RenameNotePorts = {
    openSource: async () => repo,
    loadNote: async (path) => (path === stored.path ? { id: stored.id, path: stored.path, blobSha: stored.blobSha } : null),
    moveNote: async (id, expected, next) => {
      if (id === stored.id && expected === stored.blobSha) Object.assign(stored, next);
    },
  };
  return { ports, stored, commits };
}

const NOTE: Row = { id: 'n1', path: 'Daily/2026-09-23.md', title: '2026-09-23', blobSha: 'old-sha' };

describe('renaming a note', () => {
  it('moves the file in its folder and keeps the stored note, with its id', async () => {
    const { ports, stored, commits } = vault(NOTE, {});
    const result = await renameNote(ports, { path: NOTE.path, name: 'Planning day', expectedBlobSha: 'old-sha' });
    expect(result).toEqual({ ok: true, path: 'Daily/Planning day.md', title: 'Planning day' });
    expect(commits).toEqual([
      'create Daily/Planning day.md: Rename 2026-09-23 to Planning day from Dash',
      'delete Daily/2026-09-23.md: Rename 2026-09-23 to Planning day from Dash',
    ]);
    expect(stored).toEqual({ id: 'n1', path: 'Daily/Planning day.md', title: 'Planning day', blobSha: 'new-sha' });
  });

  it('takes a trailing .md off what is typed', () => {
    expect(cleanNoteName('  Planning day.md ')).toBe('Planning day');
  });

  it('refuses a name a file cannot hold, and writes nothing', async () => {
    const { ports, commits } = vault(NOTE, {});
    for (const name of ['', '   ', 'a/b', 'what?', '[[x]]']) {
      const result = await renameNote(ports, { path: NOTE.path, name, expectedBlobSha: 'old-sha' });
      expect(result.ok).toBe(false);
    }
    expect(commits).toEqual([]);
  });

  it('never writes over a note already at the new name', async () => {
    const { ports, stored, commits } = vault(NOTE, { 'Daily/Taken.md': '' });
    const result = await renameNote(ports, { path: NOTE.path, name: 'Taken', expectedBlobSha: 'old-sha' });
    expect(result).toEqual({ ok: false, reason: 'taken', error: RENAME_ERRORS.taken });
    expect(commits).toEqual([]);
    expect(stored.path).toBe(NOTE.path);
  });

  it('refuses when the note changed since the page showed it', async () => {
    const { ports } = vault(NOTE, {});
    const result = await renameNote(ports, { path: NOTE.path, name: 'New', expectedBlobSha: 'older' });
    expect(result.ok === false && result.reason).toBe('changed');
  });

  it('says so when the token cannot write', async () => {
    const { ports } = vault(NOTE, {}, {
      createNote: async () => {
        throw new VaultReadOnlyError('no');
      },
    });
    const result = await renameNote(ports, { path: NOTE.path, name: 'New', expectedBlobSha: 'old-sha' });
    expect(result.ok === false && result.reason).toBe('read-only');
  });

  it('takes the new copy back out when the old file cannot be removed', async () => {
    const deleted: string[] = [];
    const { ports, stored } = vault(NOTE, {}, {
      deleteNote: async (path: string) => {
        deleted.push(path);
        if (path === NOTE.path) throw new VaultConflictError('moved', path);
        return 'c3';
      },
    });
    const result = await renameNote(ports, { path: NOTE.path, name: 'New', expectedBlobSha: 'old-sha' });
    expect(result.ok === false && result.reason).toBe('changed');
    expect(deleted).toEqual([NOTE.path, 'Daily/New.md']);
    expect(stored.path).toBe(NOTE.path);
  });

  it('leaves Quick note triage its name', async () => {
    const { ports } = vault({ ...NOTE, path: 'Quick note triage.md' }, {});
    const result = await renameNote(ports, { path: 'Quick note triage.md', name: 'Other', expectedBlobSha: 'old-sha' });
    expect(result.ok === false && result.reason).toBe('protected');
  });
});
