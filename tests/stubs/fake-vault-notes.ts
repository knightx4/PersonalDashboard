import { parseNote } from '@/lib/vault/markdown/note';
import type { VaultUndoPorts } from '@/lib/vault/notes/undo';
import { VaultConflictError, type VaultSource } from '@/lib/vault/providers/types';

/**
 * A vault in memory for the note writes and their Undo (plan #1894.9.3): the
 * stored notes as obsidian.notes rows in a list, the way fakeSchemaDb keeps a
 * table, and a repository behind them that refuses a stale write as GitHub
 * does and records every commit in order.
 *
 * The four ports are the ones lib/vault/db/ports.ts makes, over that list, so
 * the same rows are what a fakeSchemaDb read finds.
 */

type Row = Record<string, unknown>;

export function fakeVaultNotes(rows: Row[], userId: string) {
  const blobs = new Map<string, string>(rows.map((row) => [row.blob_sha as string, row.body as string]));
  const commits: string[] = [];
  let n = 0;

  const live = (path: string) => rows.find((row) => row.path === path && row.deleted_at == null && row.user_id === userId) ?? null;
  const byId = (id: string) => rows.find((row) => row.id === id && row.user_id === userId) ?? null;

  const repo = {
    readBlob: async (sha: string) => blobs.get(sha) ?? '',
    writeNote: async (path: string, text: string, expected: string, message: string) => {
      if (live(path)?.blob_sha !== expected) throw new VaultConflictError('stale', path);
      const blobSha = `w${(n += 1)}`;
      blobs.set(blobSha, text);
      commits.push(`write ${path}: ${message}`);
      return { blobSha, commitSha: `c${n}` };
    },
    createNote: async (path: string, text: string, message: string) => {
      if (live(path)) throw new VaultConflictError('exists', path);
      const blobSha = `n${(n += 1)}`;
      blobs.set(blobSha, text);
      commits.push(`create ${path}: ${message}`);
      return { blobSha, commitSha: `c${n}` };
    },
    deleteNote: async (path: string, expected: string, message: string) => {
      if (live(path)?.blob_sha !== expected) throw new VaultConflictError('stale', path);
      commits.push(`delete ${path}: ${message}`);
      return `c${(n += 1)}`;
    },
  } as unknown as VaultSource;

  const ports: VaultUndoPorts = {
    save: {
      loadNote: async (path) => {
        const row = live(path);
        return row ? { id: row.id as string, path: row.path as string, title: row.title as string, body: row.body as string, blobSha: row.blob_sha as string } : null;
      },
      openSource: async () => repo,
      storeNote: async (id, expected, saved) => {
        const row = byId(id);
        if (row && row.blob_sha === expected) Object.assign(row, { title: saved.title, body: saved.body, blob_sha: saved.blobSha });
      },
      afterSave: () => {},
    },
    create: {
      openSource: async () => repo,
      storeNote: async (note) => {
        const kept = rows.find((row) => row.path === note.path && row.user_id === userId);
        if (kept) {
          Object.assign(kept, { title: note.title, body: note.body, blob_sha: note.blobSha, deleted_at: null });
          return kept.id as string;
        }
        const id = `00000000-0000-4000-8000-${String(rows.length + 100).padStart(12, '0')}`;
        rows.push({ id, user_id: userId, path: note.path, title: note.title, body: note.body, blob_sha: note.blobSha, deleted_at: null });
        return id;
      },
      afterSave: () => {},
    },
    remove: {
      openSource: async () => repo,
      loadNote: async (id) => {
        const row = byId(id);
        return row
          ? { id: row.id as string, path: row.path as string, title: row.title as string, blobSha: row.blob_sha as string, deleted: row.deleted_at != null }
          : null;
      },
      markDeleted: async (id, blobSha) => {
        const row = byId(id);
        if (row && row.blob_sha === blobSha) row.deleted_at = '2026-10-14T09:00:00Z';
      },
    },
    rename: {
      openSource: async () => repo,
      loadNote: async (path) => {
        const row = live(path);
        return row ? { id: row.id as string, path: row.path as string, blobSha: row.blob_sha as string } : null;
      },
      moveNote: async (id, expected, moved) => {
        const row = byId(id);
        if (row && row.blob_sha === expected) Object.assign(row, { path: moved.path, title: moved.title, blob_sha: moved.blobSha });
      },
    },
  };

  /** A stored note as the sync would store it from its file. */
  function note(id: string, path: string, body: string, blobSha: string): Row {
    blobs.set(blobSha, body);
    return { id, user_id: userId, path, title: parseNote(body, path).title, body, blob_sha: blobSha, deleted_at: null };
  }

  return { ports, commits, blobs, note };
}
