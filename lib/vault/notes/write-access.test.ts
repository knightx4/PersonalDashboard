import { describe, expect, it, vi } from 'vitest';
import { checkWriteAccess } from '@/lib/vault/notes/write-access';
import { VaultAuthError, VaultSourceError, type VaultSource } from '@/lib/vault/providers/types';

function source(canWrite: () => Promise<boolean>): VaultSource {
  return {
    provider: 'github',
    headCommit: vi.fn(),
    snapshot: vi.fn(),
    diff: vi.fn(),
    readBlob: vi.fn(),
    readBlobBytes: vi.fn(),
    writeNote: vi.fn(),
    createNote: vi.fn(),
    deleteNote: vi.fn(),
    canWrite,
  };
}

describe('checkWriteAccess', () => {
  it('says yes or no from what the source answers', async () => {
    expect(await checkWriteAccess(async () => source(async () => true))).toBe('yes');
    expect(await checkWriteAccess(async () => source(async () => false))).toBe('no');
  });

  it('leaves a connection without a usable token to its own status', async () => {
    expect(await checkWriteAccess(async () => 'none')).toBe('reconnect');
    expect(await checkWriteAccess(async () => 'reauth')).toBe('reconnect');
    const rejected = source(async () => {
      throw new VaultAuthError('expired');
    });
    expect(await checkWriteAccess(async () => rejected)).toBe('reconnect');
  });

  it('says it could not tell when GitHub or the database fails', async () => {
    const limited = source(async () => {
      throw new VaultSourceError('rate limit', 403);
    });
    expect(await checkWriteAccess(async () => limited)).toBe('unknown');
    expect(
      await checkWriteAccess(async () => {
        throw new Error('database down');
      }),
    ).toBe('unknown');
  });
});
