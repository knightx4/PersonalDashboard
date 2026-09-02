import { afterEach, describe, expect, it, vi } from 'vitest';
import { GithubVaultSource } from '@/lib/vault/providers/github';
import { VaultAuthError, VaultSourceError } from '@/lib/vault/providers/types';

const config = { owner: 'knightx4', repo: 'vault', branch: 'main', token: 'ghp_test' };

type StubResponse = { status?: number; body?: unknown; text?: string; headers?: Record<string, string> };

/** Records every URL fetched, which is what the .md assertions are about. */
function stubFetch(handler: (url: string) => StubResponse) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    const { status = 200, body, text, headers = {} } = handler(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
      json: async () => body,
      text: async () => text ?? '',
    } as unknown as Response;
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('snapshot', () => {
  it('returns only markdown blobs, and never asks for anything else', async () => {
    // The assertion that makes "no attachments" a property rather than a
    // promise: one listing request, and not a single content request for the
    // photo or the PDF.
    const calls = stubFetch(() => ({
      body: {
        sha: 'head',
        tree: [
          { path: 'Ideas.md', type: 'blob', sha: 'sha-ideas', size: 120 },
          { path: 'Attachments/holiday.jpg', type: 'blob', sha: 'sha-jpg', size: 4_000_000 },
          { path: 'Attachments/lease.pdf', type: 'blob', sha: 'sha-pdf', size: 900_000 },
          { path: 'Daily', type: 'tree', sha: 'sha-dir' },
          { path: 'Daily/2024-01-01.md', type: 'blob', sha: 'sha-daily', size: 80 },
          { path: '.obsidian/workspace.json', type: 'blob', sha: 'sha-cfg', size: 10 },
        ],
      },
    }));

    const source = new GithubVaultSource(config);
    const snapshot = await source.snapshot('head');

    expect(snapshot.entries.map((e) => e.path)).toEqual(['Ideas.md', 'Daily/2024-01-01.md']);
    expect(snapshot.truncated).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/git/trees/head?recursive=1');
    expect(calls.join(' ')).not.toContain('sha-jpg');
    expect(calls.join(' ')).not.toContain('sha-pdf');
  });

  it('reports a truncated tree rather than pretending the vault is small', async () => {
    // Acting on this would delete every note it failed to mention.
    stubFetch(() => ({ body: { sha: 'head', truncated: true, tree: [] } }));
    const snapshot = await new GithubVaultSource(config).snapshot('head');
    expect(snapshot.truncated).toBe(true);
  });
});

describe('diff', () => {
  it('turns a compare response into changes, renames included', async () => {
    stubFetch(() => ({
      body: {
        files: [
          { filename: 'New.md', status: 'added', sha: 'sha-new', size: 10 },
          { filename: 'Edited.md', status: 'modified', sha: 'sha-edit', size: 20 },
          { filename: 'Gone.md', status: 'removed' },
          {
            filename: 'After.md',
            previous_filename: 'Before.md',
            status: 'renamed',
            sha: 'sha-ren',
            size: 30,
          },
        ],
        commits: [
          { commit: { committer: { date: '2024-05-01T00:00:00Z' } } },
          { commit: { committer: { date: '2024-05-02T10:00:00Z' } } },
        ],
      },
    }));

    const diff = await new GithubVaultSource(config).diff('base', 'head');

    expect(diff.complete).toBe(true);
    expect(diff.headCommittedAt).toBe('2024-05-02T10:00:00Z');
    expect(diff.changes).toEqual([
      { kind: 'upsert', path: 'New.md', blobSha: 'sha-new', sizeBytes: 10 },
      { kind: 'upsert', path: 'Edited.md', blobSha: 'sha-edit', sizeBytes: 20 },
      { kind: 'delete', path: 'Gone.md' },
      { kind: 'upsert', path: 'After.md', blobSha: 'sha-ren', sizeBytes: 30, previousPath: 'Before.md' },
    ]);
  });

  it('gives up on a rewritten history rather than throwing', async () => {
    // A force push makes the stored cursor unreachable. `complete: false` sends
    // the caller to a full tree comparison, which converges on the same state --
    // the same shape as Gmail's expired-historyId catch-up.
    stubFetch(() => ({ status: 404, body: {} }));
    const diff = await new GithubVaultSource(config).diff('missing', 'head');
    expect(diff).toEqual({ changes: [], complete: false, headCommittedAt: null });
  });

  it('gives up when the diff is too large for one response', async () => {
    stubFetch(() => ({
      body: {
        files: Array.from({ length: 300 }, (_, i) => ({
          filename: `Note-${i}.md`,
          status: 'modified',
          sha: `sha-${i}`,
          size: 10,
        })),
      },
    }));
    const diff = await new GithubVaultSource(config).diff('base', 'head');
    expect(diff.complete).toBe(false);
  });
});

describe('errors', () => {
  it('treats an expired token as needing reconnection, not as a bug', async () => {
    stubFetch(() => ({ status: 401, body: {} }));
    await expect(new GithubVaultSource(config).headCommit()).rejects.toBeInstanceOf(VaultAuthError);
  });

  it('tells a rate limit apart from a rejected token', async () => {
    // Both are 403. One wants a new token, the other wants patience, and
    // marking a healthy vault "needs reauth" because GitHub was busy would
    // send the human off to regenerate a token that was never the problem.
    stubFetch(() => ({ status: 403, body: {}, headers: { 'x-ratelimit-remaining': '0' } }));
    const error = await new GithubVaultSource(config).headCommit().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VaultSourceError);
    expect((error as Error).message).toMatch(/rate limit/i);
  });

  it('fails loudly when the branch has no commits', async () => {
    stubFetch(() => ({ body: {} }));
    await expect(new GithubVaultSource(config).headCommit()).rejects.toThrow(/No commit found/);
  });
});

describe('readBlob', () => {
  it('asks for raw bytes rather than the base64 JSON representation', async () => {
    // The JSON form caps out at 1MB; raw does not, and it saves decoding.
    const calls = stubFetch(() => ({ text: '# Hello' }));
    const body = await new GithubVaultSource(config).readBlob('sha-1');
    expect(body).toBe('# Hello');
    expect(calls[0]).toContain('/git/blobs/sha-1');
  });
});
