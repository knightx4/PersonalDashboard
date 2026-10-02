import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GithubVaultSource } from '@/lib/vault/providers/github';
import {
  VaultAuthError,
  VaultConflictError,
  VaultReadOnlyError,
  VaultSourceError,
} from '@/lib/vault/providers/types';

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
      arrayBuffer: async () => new TextEncoder().encode(text ?? '').buffer,
    } as unknown as Response;
  });
  return calls;
}

let info: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  info = vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

  it('lists exactly the allowed attachments beside the notes, from the same request', async () => {
    const calls = stubFetch(() => ({
      body: {
        sha: 'head',
        tree: [
          { path: 'Ideas.md', type: 'blob', sha: 'sha-ideas', size: 120 },
          { path: 'Attachments/holiday.JPG', type: 'blob', sha: 'sha-jpg', size: 4_000_000 },
          { path: 'Attachments/diagram.png', type: 'blob', sha: 'sha-png', size: 20_000 },
          { path: 'Attachments/lease.pdf', type: 'blob', sha: 'sha-pdf', size: 900_000 },
          { path: 'Attachments/memo.m4a', type: 'blob', sha: 'sha-m4a', size: 2_000_000 },
          { path: 'Attachments/lecture.mp3', type: 'blob', sha: 'sha-big', size: 60_000_000 },
          { path: 'Attachments/logo.svg', type: 'blob', sha: 'sha-svg', size: 3_000 },
          { path: 'Attachments/clip.mp4', type: 'blob', sha: 'sha-mp4', size: 9_000_000 },
          { path: 'Board.canvas', type: 'blob', sha: 'sha-canvas', size: 500 },
          { path: 'Attachments', type: 'tree', sha: 'sha-dir' },
          { path: '.trash/old.png', type: 'blob', sha: 'sha-trash', size: 1_000 },
          { path: '.obsidian/icon.png', type: 'blob', sha: 'sha-icon', size: 1_000 },
        ],
      },
    }));

    const snapshot = await new GithubVaultSource(config).snapshot('head');

    expect(snapshot.entries.map((e) => e.path)).toEqual(['Ideas.md']);
    expect(snapshot.attachments).toEqual([
      { path: 'Attachments/holiday.JPG', blobSha: 'sha-jpg', sizeBytes: 4_000_000, mimeType: 'image/jpeg', tooLarge: false },
      { path: 'Attachments/diagram.png', blobSha: 'sha-png', sizeBytes: 20_000, mimeType: 'image/png', tooLarge: false },
      { path: 'Attachments/lease.pdf', blobSha: 'sha-pdf', sizeBytes: 900_000, mimeType: 'application/pdf', tooLarge: false },
      { path: 'Attachments/memo.m4a', blobSha: 'sha-m4a', sizeBytes: 2_000_000, mimeType: 'audio/mp4', tooLarge: false },
      // Listed so the note page can say it is too large; never copied.
      { path: 'Attachments/lecture.mp3', blobSha: 'sha-big', sizeBytes: 60_000_000, mimeType: 'audio/mpeg', tooLarge: true },
    ]);
    // Listing is all this does: one request and no content fetched.
    expect(calls).toHaveLength(1);
    expect(info).toHaveBeenCalledWith(
      'vault: 5 attachments listed, 6920000 bytes to copy, 1 over the size limit',
    );
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
    expect(diff.attachments).toEqual([]);
    expect(diff.headCommittedAt).toBe('2024-05-02T10:00:00Z');
    expect(diff.changes).toEqual([
      { kind: 'upsert', path: 'New.md', blobSha: 'sha-new', sizeBytes: 10 },
      { kind: 'upsert', path: 'Edited.md', blobSha: 'sha-edit', sizeBytes: 20 },
      { kind: 'delete', path: 'Gone.md' },
      { kind: 'upsert', path: 'After.md', blobSha: 'sha-ren', sizeBytes: 30, previousPath: 'Before.md' },
    ]);
  });

  it('carries attachment adds, deletes and renames, and nothing else', async () => {
    stubFetch(() => ({
      body: {
        files: [
          { filename: 'Note.md', status: 'modified', sha: 'sha-note', size: 10 },
          { filename: 'img/new.webp', status: 'added', sha: 'sha-webp', size: 500 },
          { filename: 'img/gone.gif', status: 'removed' },
          {
            filename: 'img/after.png',
            previous_filename: 'img/before.png',
            status: 'renamed',
            sha: 'sha-png',
            size: 700,
          },
          // Renamed into the allowed types: new to the vault as far as we know.
          { filename: 'rec.ogg', previous_filename: 'rec.tmp', status: 'renamed', sha: 'sha-ogg', size: 80 },
          // Renamed into a hidden folder: the old path leaves the vault.
          { filename: '.trash/scan.pdf', previous_filename: 'scan.pdf', status: 'renamed', sha: 'sha-scan', size: 90 },
          { filename: 'clip.mp4', status: 'added', sha: 'sha-mp4', size: 90 },
        ],
      },
    }));

    const diff = await new GithubVaultSource(config).diff('base', 'head');

    expect(diff.attachments).toEqual([
      { kind: 'upsert', path: 'img/new.webp', blobSha: 'sha-webp', sizeBytes: 500, mimeType: 'image/webp', tooLarge: false },
      { kind: 'delete', path: 'img/gone.gif' },
      {
        kind: 'upsert',
        path: 'img/after.png',
        blobSha: 'sha-png',
        sizeBytes: 700,
        mimeType: 'image/png',
        tooLarge: false,
        previousPath: 'img/before.png',
      },
      { kind: 'upsert', path: 'rec.ogg', blobSha: 'sha-ogg', sizeBytes: 80, mimeType: 'audio/ogg', tooLarge: false },
      { kind: 'delete', path: 'scan.pdf' },
    ]);
  });

  it('gives up on a rewritten history rather than throwing', async () => {
    // A force push makes the stored cursor unreachable. `complete: false` sends
    // the caller to a full tree comparison, which converges on the same state --
    // the same shape as Gmail's expired-historyId catch-up.
    stubFetch(() => ({ status: 404, body: {} }));
    const diff = await new GithubVaultSource(config).diff('missing', 'head');
    expect(diff).toEqual({ changes: [], complete: false, attachments: [], headCommittedAt: null });
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

  it('returns an attachment as bytes, from the same raw endpoint', async () => {
    const calls = stubFetch(() => ({ text: 'PNG' }));
    const bytes = await new GithubVaultSource(config).readBlobBytes('sha-2');
    expect(new TextDecoder().decode(bytes)).toBe('PNG');
    expect(calls[0]).toContain('/git/blobs/sha-2');
  });
});

describe('writeNote', () => {
  type Sent = { url: string; method?: string; body: Record<string, unknown> };

  /** Like stubFetch, but keeps the method and body a write sends. */
  function stubWrite(res: StubResponse) {
    const sent: Sent[] = [];
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      sent.push({
        url: String(input),
        method: init?.method,
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      });
      const { status = 200, body, headers = {} } = res;
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
        json: async () => body,
      } as unknown as Response;
    });
    return sent;
  }

  it('commits the new text on the branch and returns the new SHAs', async () => {
    const sent = stubWrite({ body: { content: { sha: 'new-blob' }, commit: { sha: 'new-commit' } } });

    const source = new GithubVaultSource({ ...config, branch: 'notes' });
    const result = await source.writeNote('Daily/Café notes.md', 'Hello — world\n', 'old-blob', 'Edit Café notes from Dash');

    expect(result).toEqual({ blobSha: 'new-blob', commitSha: 'new-commit' });
    expect(sent).toHaveLength(1);
    expect(sent[0].method).toBe('PUT');
    expect(sent[0].url).toBe('https://api.github.com/repos/knightx4/vault/contents/Daily/Caf%C3%A9%20notes.md');
    expect(sent[0].body).toEqual({
      message: 'Edit Café notes from Dash',
      content: Buffer.from('Hello — world\n', 'utf8').toString('base64'),
      sha: 'old-blob',
      branch: 'notes',
    });
  });

  it("puts the connection's subpath back in front of the note's path", async () => {
    const sent = stubWrite({ body: { content: { sha: 'b' }, commit: { sha: 'c' } } });

    const source = new GithubVaultSource({ ...config, subpath: '/Vault/' });
    await source.writeNote('Ideas.md', 'x', 'old', 'Edit Ideas from Dash');

    expect(sent[0].url).toBe('https://api.github.com/repos/knightx4/vault/contents/Vault/Ideas.md');
  });

  it.each([409, 422])('raises VaultConflictError when the SHA is stale (%i)', async (status) => {
    stubWrite({ status, body: { message: 'does not match' } });

    const source = new GithubVaultSource(config);
    const write = source.writeNote('Ideas.md', 'x', 'stale', 'Edit Ideas from Dash');

    await expect(write).rejects.toBeInstanceOf(VaultConflictError);
    await expect(write).rejects.toMatchObject({ path: 'Ideas.md' });
  });

  it('raises VaultReadOnlyError when the token cannot write', async () => {
    stubWrite({
      status: 403,
      body: { message: 'Resource not accessible by personal access token' },
      headers: { 'x-ratelimit-remaining': '4999' },
    });

    const source = new GithubVaultSource(config);
    const write = source.writeNote('Ideas.md', 'x', 'old', 'Edit Ideas from Dash');

    await expect(write).rejects.toBeInstanceOf(VaultReadOnlyError);
    await expect(write).rejects.not.toBeInstanceOf(VaultAuthError);
  });

  it('keeps a rate limit and a rejected token apart from a read-only one', async () => {
    const source = new GithubVaultSource(config);

    stubWrite({ status: 403, headers: { 'x-ratelimit-remaining': '0' } });
    await expect(source.writeNote('Ideas.md', 'x', 'old', 'm')).rejects.toBeInstanceOf(VaultSourceError);

    stubWrite({ status: 401 });
    await expect(source.writeNote('Ideas.md', 'x', 'old', 'm')).rejects.toBeInstanceOf(VaultAuthError);
  });
});
