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

const { digestOnArrival, digestPending, LINE_SINCE, PENDING_FILTER } = await import('./summarise');

/**
 * When a newsletter is summarised. digestIssue is stubbed: its own tests cover
 * what it sends and saves. These check that arrival never throws and skips
 * cleanly without a key, and that the catch-up takes the unattempted issues
 * and the ones summarised without a line, and passes each one's own account.
 */

const spend = { from: vi.fn() } as never;

function pendingClient(rows: { id: string; user_id: string }[]) {
  const calls: unknown[][] = [];
  const query = {
    select: (...args: unknown[]) => (calls.push(['select', ...args]), query),
    or: (...args: unknown[]) => (calls.push(['or', ...args]), query),
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
  it('takes unattempted issues first, then ones to redo, each under its own account', async () => {
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
      ['or', PENDING_FILTER],
      ['order', 'digested_at', { ascending: true, nullsFirst: true }],
      ['order', 'received_at', { ascending: true }],
      ['limit', 3],
    ]);
    expect(called.map((input) => [input.issueId, input.userId])).toEqual([
      ['a', 'user-1'],
      ['b', 'user-2'],
      ['c', 'user-1'],
    ]);
    expect(tally).toEqual({ digested: 2, failed: 1, missing: 0, left: 0 });
    expect(seen).toEqual(['a:digested', 'b:failed', 'c:digested']);
  });

  it('redoes issues summarised without a line before it existed, or without topics', () => {
    expect(PENDING_FILTER).toBe(
      `digested_at.is.null,and(summary.not.is.null,summary_line.is.null,digested_at.lt."${LINE_SINCE}"),` +
        'and(summary.not.is.null,stories->0.not.is.null,stories->0->>topic.is.null)',
    );
    // After the last summary written without a line, before the first with one.
    expect(Date.parse(LINE_SINCE)).toBeGreaterThan(Date.parse('2026-09-23T06:13:28Z'));
    expect(Date.parse(LINE_SINCE)).toBeLessThan(Date.parse('2026-09-23T10:57:47Z'));
  });

  it('does nothing when every issue has been attempted', async () => {
    const { client } = pendingClient([]);
    expect(await digestPending({ news: client, spend, anthropicApiKey: 'key' })).toEqual({
      digested: 0,
      failed: 0,
      missing: 0,
      left: 0,
    });
    expect(called).toEqual([]);
  });

  it('starts no issue once its deadline has passed', async () => {
    const { client } = pendingClient([
      { id: 'a', user_id: 'user-1' },
      { id: 'b', user_id: 'user-1' },
      { id: 'c', user_id: 'user-1' },
    ]);
    reply({ status: 'digested', summary: 'S', stories: [] });
    const clock = [0, 100];
    const tally = await digestPending({
      news: client,
      spend,
      anthropicApiKey: 'key',
      deadline: 50,
      now: () => clock.shift() ?? 100,
    });
    expect(called.map((input) => input.issueId)).toEqual(['a']);
    expect(tally).toEqual({ digested: 1, failed: 0, missing: 0, left: 2 });
  });
});
