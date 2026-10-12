import { describe, expect, it } from 'vitest';
import {
  newerXId,
  readXPosts,
  xPostKind,
  xPostRow,
  xRunMessage,
  xStopFromResponse,
  type XPostRow,
  type XReadLog,
  type XReadStore,
  type XTweet,
} from './read';

/** Import posts already on X and read new ones daily (plan #1819). */

const NOW = Date.parse('2026-10-12T12:00:00Z');
const ME = { user_id: 'u1', x_user_id: '42', handle: 'selveybuilds' };

function tweet(id: string, over: Partial<XTweet> = {}): XTweet {
  return {
    id,
    text: `post ${id}`,
    created_at: new Date(NOW - Number(id) * 60_000).toISOString(),
    conversation_id: id,
    public_metrics: { like_count: 1, impression_count: 10 },
    ...over,
  };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** An in-memory x_posts and x_reads. */
function memoryStore(seed: XPostRow[] = []) {
  const posts = new Map(seed.map((p) => [p.x_post_id, p]));
  const logs: XReadLog[] = [];
  const store: XReadStore = {
    async storedBounds() {
      const ids = [...posts.keys()].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
      return { oldest: ids[0] ?? null, newest: ids.at(-1) ?? null };
    },
    async upsertPosts(rows) {
      for (const r of rows) posts.set(r.x_post_id, r);
    },
    async staleRecentIds(since, before) {
      return [...posts.values()]
        .filter((p) => p.created_at >= since && p.metrics_at < before)
        .map((p) => p.x_post_id);
    },
    async log(entry) {
      logs.push(entry);
    },
  };
  return { store, posts, logs };
}

/** X, answering each request with the next response in the list. */
function fakeX(responses: Response[]) {
  const urls: URL[] = [];
  const fetchImpl = (async (input: string) => {
    urls.push(new URL(input));
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request ${input}`);
    return next;
  }) as unknown as typeof fetch;
  return { fetchImpl, urls };
}

describe('what kind of post it is', () => {
  it('skips retweets, and tells a thread of your own from a reply to someone else', () => {
    expect(xPostKind(tweet('1'), '42')).toBe('post');
    expect(xPostKind(tweet('1', { referenced_tweets: [{ type: 'retweeted', id: '9' }] }), '42')).toBeNull();
    expect(xPostKind(tweet('1', { referenced_tweets: [{ type: 'quoted', id: '9' }] }), '42')).toBe('post');
    expect(
      xPostKind(tweet('1', { in_reply_to_user_id: '42', referenced_tweets: [{ type: 'replied_to', id: '9' }] }), '42'),
    ).toBe('thread_reply');
    expect(
      xPostKind(tweet('1', { in_reply_to_user_id: '7', referenced_tweets: [{ type: 'replied_to', id: '9' }] }), '42'),
    ).toBe('reply');
  });

  it('stores the whole text of a long post and links it under the handle', () => {
    const row = xPostRow(tweet('5', { text: 'cut short…', note_tweet: { text: 'the whole thing' } }), ME, 'now');
    expect(row?.text).toBe('the whole thing');
    expect(row?.url).toBe('https://x.com/selveybuilds/status/5');
  });

  it('compares ids past what a number holds', () => {
    expect(newerXId('1846000000000000001', '1846000000000000000')).toBe('1846000000000000001');
    expect(newerXId(null, '3')).toBe('3');
  });
});

describe('the first read', () => {
  it('pages back through every post, skipping retweets, and logs each request with its count', async () => {
    const { store, posts, logs } = memoryStore();
    const { fetchImpl, urls } = fakeX([
      json(200, { data: [tweet('30'), tweet('29')], meta: { next_token: 'p2' } }),
      json(200, { data: [tweet('28', { referenced_tweets: [{ type: 'retweeted', id: '1' }] }), tweet('27')], meta: {} }),
    ]);
    const result = await readXPosts({ account: { ...ME, newest_post_id: null }, token: 't', store, fetchImpl, now: NOW });

    expect(result.stop).toBeNull();
    expect([...posts.keys()].sort()).toEqual(['27', '29', '30']);
    expect(result.newestPostId).toBe('30');
    expect(result.newPosts).toBe(3);
    expect(result.postsRead).toBe(4);
    expect(urls[0]!.pathname).toBe('/2/users/42/tweets');
    expect(urls[0]!.searchParams.get('exclude')).toBe('retweets');
    expect(urls[0]!.searchParams.get('max_results')).toBe('100');
    expect(urls[0]!.searchParams.get('tweet.fields')).toContain('public_metrics');
    expect(urls[1]!.searchParams.get('pagination_token')).toBe('p2');
    expect(logs).toEqual([
      { kind: 'history', http_status: 200, posts_read: 2, outcome: 'ok', error: null },
      { kind: 'history', http_status: 200, posts_read: 2, outcome: 'ok', error: null },
    ]);
  });

  it('stops at a rate limit, keeps what it stored, and resumes below the oldest post next time', async () => {
    const { store, posts, logs } = memoryStore();
    const reset = Math.floor(NOW / 1000) + 900;
    const first = fakeX([
      json(200, { data: [tweet('30'), tweet('29')], meta: { next_token: 'p2' } }),
      json(429, { title: 'Too Many Requests' }, { 'x-rate-limit-reset': String(reset) }),
    ]);
    const stopped = await readXPosts({
      account: { ...ME, newest_post_id: null },
      token: 't',
      store,
      fetchImpl: first.fetchImpl,
      now: NOW,
    });
    expect(stopped.stop?.outcome).toBe('rate_limited');
    expect(stopped.stop?.problem).toContain('picks up where this one stopped');
    expect(stopped.newestPostId).toBeNull();
    expect(posts.size).toBe(2);
    expect(logs.at(-1)).toMatchObject({ http_status: 429, outcome: 'rate_limited', posts_read: 0 });
    expect(logs.at(-1)!.error).toContain('resets 2026-10-12T12:15:00.000Z');

    const second = fakeX([
      json(200, { data: [tweet('28')], meta: {} }),
      json(200, { data: [tweet('31')], meta: {} }),
    ]);
    const resumed = await readXPosts({
      account: { ...ME, newest_post_id: null },
      token: 't',
      store,
      fetchImpl: second.fetchImpl,
      now: NOW,
    });
    expect(second.urls[0]!.searchParams.get('until_id')).toBe('29');
    expect(second.urls[1]!.searchParams.get('since_id')).toBe('30');
    expect(resumed.stop).toBeNull();
    expect(resumed.newestPostId).toBe('31');
    expect(resumed.newPosts).toBe(2);
  });
});

describe('a later read', () => {
  it('asks only for newer posts, then refreshes the numbers on the last thirty days', async () => {
    const old = (id: string, daysAgo: number): XPostRow => ({
      user_id: 'u1',
      x_post_id: id,
      text: 't',
      created_at: new Date(NOW - daysAgo * 86_400_000).toISOString(),
      url: `https://x.com/selveybuilds/status/${id}`,
      conversation_id: id,
      kind: 'post',
      public_metrics: {},
      metrics_at: new Date(NOW - 86_400_000).toISOString(),
    });
    const { store, posts } = memoryStore([old('10', 2), old('5', 45)]);
    const { fetchImpl, urls } = fakeX([
      json(200, { data: [tweet('11')], meta: {} }),
      json(200, { data: [tweet('10', { public_metrics: { like_count: 9 } })] }),
    ]);
    const result = await readXPosts({ account: { ...ME, newest_post_id: '10' }, token: 't', store, fetchImpl, now: NOW });

    expect(urls[0]!.searchParams.get('since_id')).toBe('10');
    expect(urls[1]!.pathname).toBe('/2/tweets');
    // Post 11 was just read and post 5 is older than thirty days.
    expect(urls[1]!.searchParams.get('ids')).toBe('10');
    expect(posts.get('10')!.public_metrics).toEqual({ like_count: 9 });
    expect(result).toMatchObject({ newestPostId: '11', newPosts: 1, postsRead: 2, stop: null });
  });

  it('keeps the newest id where it was when the read stops, so nothing between is skipped', async () => {
    const { store } = memoryStore();
    const { fetchImpl } = fakeX([json(402, { title: 'CreditsDepleted' })]);
    const result = await readXPosts({ account: { ...ME, newest_post_id: '10' }, token: 't', store, fetchImpl, now: NOW });
    expect(result.stop?.outcome).toBe('out_of_credit');
    expect(result.newestPostId).toBe('10');
  });
});

describe('what the tab says', () => {
  it('tells running out of credit from the rate limit', () => {
    expect(xStopFromResponse(402, {}).outcome).toBe('out_of_credit');
    expect(xStopFromResponse(429, { title: 'UsageCapExceeded' }).outcome).toBe('out_of_credit');
    expect(xStopFromResponse(429, { title: 'Too Many Requests' }).outcome).toBe('rate_limited');
    expect(xStopFromResponse(500, null).outcome).toBe('failed');
    expect(xStopFromResponse(402, {}).problem).toContain('console.x.com');
  });

  it('answers Check X now in a line', () => {
    expect(xRunMessage({ state: 'read', postsRead: 3, newPosts: 0, problem: null })).toEqual({
      ok: true,
      text: 'Nothing new on X.',
    });
    expect(xRunMessage({ state: 'read', postsRead: 3, newPosts: 1, problem: null }).text).toBe('Read 1 new post.');
    expect(xRunMessage({ state: 'read', postsRead: 0, newPosts: 0, problem: 'stopped' })).toEqual({
      ok: false,
      text: 'stopped',
    });
    expect(xRunMessage({ state: 'busy' }).ok).toBe(false);
  });

  it('says what the match did after the read (plan #1820)', () => {
    expect(
      xRunMessage({ state: 'read', postsRead: 4, newPosts: 2, problem: null, matched: { posted: 1, asking: 2 } }).text,
    ).toBe('Read 2 new posts. Marked 1 draft posted. 2 drafts ask whether a post is them.');
    expect(
      xRunMessage({ state: 'read', postsRead: 1, newPosts: 0, problem: null, matched: { posted: 0, asking: 1 } }).text,
    ).toBe('Nothing new on X. 1 draft asks whether a post is it.');
    expect(
      xRunMessage({ state: 'read', postsRead: 1, newPosts: 1, problem: null, matched: { posted: 0, asking: 0 } }).text,
    ).toBe('Read 1 new post.');
  });
});
