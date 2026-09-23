import { beforeEach, describe, expect, it, vi } from 'vitest';

// A plain stub rather than vi.fn: under vitest 4 a vi.fn whose call rejected
// fails later tests in the file even after the rejection was caught.
type Input = { userId: string; issueId: string; anthropicApiKey: string };
const replies: (() => Promise<unknown>)[] = [];
const called: Input[] = [];
vi.mock('./digest', () => ({
  digestIssue: (input: Input) => {
    called.push(input);
    const next = replies.shift();
    if (!next) throw new Error('digestIssue called more often than the test expected');
    return next();
  },
}));
const reply = (value: unknown) => replies.push(async () => value);

const { digestOnArrival, digestPending } = await import('./summarise');

/**
 * When a newsletter is summarised. digestIssue is stubbed: its own tests cover
 * what it sends and saves. These check that arrival never throws and skips
 * cleanly without a key, and that the catch-up takes only the unattempted
 * issues and passes each one's own account.
 */

const spend = { from: vi.fn() } as never;

function pendingClient(rows: { id: string; user_id: string }[]) {
  const calls: unknown[][] = [];
  const query = {
    select: (...args: unknown[]) => (calls.push(['select', ...args]), query),
    is: (...args: unknown[]) => (calls.push(['is', ...args]), query),
    order: (...args: unknown[]) => (calls.push(['order', ...args]), query),
    limit: async (...args: unknown[]) => (
      calls.push(['limit', ...args]),
      { data: rows, error: null }
    ),
  };
  return { client: { from: vi.fn(() => query) } as never, calls };
}

beforeEach(() => {
  replies.length = 0;
  called.length = 0;
});

describe('digestOnArrival', () => {
  const base = { news: {} as never, spend, userId: 'user-1', issueId: 'issue-1' };

  it('summarises the new issue under its account', async () => {
    reply({ status: 'digested', summary: 'S', stories: [] });
    expect(await digestOnArrival({ ...base, anthropicApiKey: 'key' })).toBe('digested');
    expect(called).toEqual([
      expect.objectContaining({ userId: 'user-1', issueId: 'issue-1', anthropicApiKey: 'key' }),
    ]);
  });

  it('leaves the issue for the catch-up when there is no key', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await digestOnArrival({ ...base, anthropicApiKey: undefined })).toBe('no-key');
    expect(called).toEqual([]);
  });

  it('reports a failed call without throwing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    reply({ status: 'failed', error: 'overloaded' });
    expect(await digestOnArrival({ ...base, anthropicApiKey: 'key' })).toBe('failed');
  });

  it('swallows a row that could not be saved', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    replies.push(async () => {
      throw new Error('news: saving the summary failed (down)');
    });
    expect(await digestOnArrival({ ...base, anthropicApiKey: 'key' })).toBe('error');
  });
});

describe('digestPending', () => {
  it('takes only unattempted issues, oldest first, each under its own account', async () => {
    const { client, calls } = pendingClient([
      { id: 'a', user_id: 'user-1' },
      { id: 'b', user_id: 'user-2' },
      { id: 'c', user_id: 'user-1' },
    ]);
    reply({ status: 'digested', summary: 'S', stories: [] });
    reply({ status: 'failed', error: 'cut off' });
    reply({ status: 'digested', summary: 'S', stories: [] });
    const seen: string[] = [];

    const tally = await digestPending({
      news: client,
      spend,
      anthropicApiKey: 'key',
      limit: 3,
      onIssue: (id, outcome) => seen.push(`${id}:${outcome.status}`),
    });

    expect(calls).toEqual([
      ['select', 'id, user_id'],
      ['is', 'digested_at', null],
      ['order', 'received_at', { ascending: true }],
      ['limit', 3],
    ]);
    expect(called.map((input) => [input.issueId, input.userId])).toEqual([
      ['a', 'user-1'],
      ['b', 'user-2'],
      ['c', 'user-1'],
    ]);
    expect(tally).toEqual({ digested: 2, failed: 1, missing: 0 });
    expect(seen).toEqual(['a:digested', 'b:failed', 'c:digested']);
  });

  it('does nothing when every issue has been attempted', async () => {
    const { client } = pendingClient([]);
    expect(await digestPending({ news: client, spend, anthropicApiKey: 'key' })).toEqual({
      digested: 0,
      failed: 0,
      missing: 0,
    });
    expect(called).toEqual([]);
  });
});
