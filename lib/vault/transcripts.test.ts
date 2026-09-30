import { describe, expect, it } from 'vitest';
import {
  deleteTranscript,
  transcriptStoragePath,
  VAULT_TRANSCRIPTS_BUCKET,
  type TranscriptStore,
} from '@/lib/vault/transcripts';

describe('transcriptStoragePath', () => {
  it('puts the file in the account folder behind a fresh id', () => {
    expect(transcriptStoragePath('user-1', 'Fall 2019 (final).pdf', 'abc')).toBe(
      'user-1/abc-Fall_2019_final_.pdf',
    );
  });

  it('refuses an empty user id, which would name the bucket root', () => {
    expect(() => transcriptStoragePath('', 'a.pdf', 'abc')).toThrow();
  });
});

function fakeStore(rows: Array<{ id: string; user_id: string; storage_path: string }>) {
  const removed: Array<{ bucket: string; paths: string[] }> = [];
  const client: TranscriptStore = {
    from: () => ({
      delete: () => ({
        eq: (_c, id) => ({
          eq: (_c2, userId) => ({
            select: async () => {
              const hit = rows.filter((r) => r.id === id && r.user_id === userId);
              for (const row of hit) rows.splice(rows.indexOf(row), 1);
              return { data: hit.map((r) => ({ storage_path: r.storage_path })), error: null };
            },
          }),
        }),
      }),
    }),
    storage: {
      from: (bucket) => ({
        remove: async (paths) => {
          removed.push({ bucket, paths });
          return { error: null };
        },
      }),
    },
  };
  return { client, rows, removed };
}

describe('deleteTranscript', () => {
  it('removes the row and then its file from the transcripts bucket', async () => {
    const store = fakeStore([{ id: 't1', user_id: 'u1', storage_path: 'u1/x-a.pdf' }]);
    expect(await deleteTranscript(store.client, 'u1', 't1')).toBe(true);
    expect(store.rows).toEqual([]);
    expect(store.removed).toEqual([{ bucket: VAULT_TRANSCRIPTS_BUCKET, paths: ['u1/x-a.pdf'] }]);
  });

  it("touches nothing for another account's transcript", async () => {
    const store = fakeStore([{ id: 't1', user_id: 'u1', storage_path: 'u1/x-a.pdf' }]);
    expect(await deleteTranscript(store.client, 'u2', 't1')).toBe(false);
    expect(store.rows).toHaveLength(1);
    expect(store.removed).toEqual([]);
  });
});
