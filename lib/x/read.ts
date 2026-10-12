import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { freshXAccessToken, loadXAccount, XDisconnectedError } from './account';
import type { XClient } from './oauth';

/**
 * Reading the person's own posts from X into public.x_posts (plan #1819,
 * feature #1815).
 *
 * One read does up to three passes, each a run of requests to X:
 *
 * - history: while `x_accounts.newest_post_id` is null, page back through
 *   GET /2/users/{id}/tweets to the oldest post X returns (X stops at the
 *   latest 3,200). A history read that stops partway resumes from the oldest
 *   post already stored (`until_id`), so nothing is paid for twice, and only
 *   a history read that reaches the end sets newest_post_id.
 * - new: posts newer than newest_post_id (`since_id`), on every later read,
 *   and after a resumed history read to catch what went up meanwhile.
 * - metrics: the posts from the last thirty days this read did not already
 *   fetch, read again by id (GET /2/tweets) for fresh public_metrics.
 *
 * Retweets are left out (`exclude=retweets`). A reply to the person's own
 * post is a `thread_reply`, a reply to anybody else a `reply`; both are kept.
 *
 * Every request is logged to public.x_reads with how many posts X returned,
 * which is what X bills ($0.001 a post read from your own account), so the
 * spend can be checked against X's console.
 *
 * A rate limit or exhausted credit stops the read where it is: no retry,
 * since a retry costs money or waits out a fifteen-minute window. The run
 * returns the line the Posts tab shows (`problem`), and what was stored
 * before the stop stays stored.
 *
 * `fetch` and the store are passed in so the tests can answer for X and the
 * database.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;
type Fetch = typeof fetch;

export const X_API = 'https://api.x.com/2';

/** X's largest page for a user's posts and for a lookup by id. */
export const X_PAGE_SIZE = 100;

/** X returns at most the latest 3,200 posts, so 32 full pages; a margin over it. */
export const X_MAX_PAGES = 40;

/** How far back the metrics pass refreshes the numbers. */
export const X_METRICS_DAYS = 30;

/** A read still marked going after this long is taken to have died. */
export const X_READ_STALE_MS = 10 * 60 * 1000;

export const X_TWEET_FIELDS = [
  'created_at',
  'conversation_id',
  'public_metrics',
  'in_reply_to_user_id',
  'referenced_tweets',
  'note_tweet',
].join(',');

export type XReadTrigger = 'daily' | 'manual' | 'connect';
export type XReadKind = 'history' | 'new' | 'metrics';
export type XReadOutcome = 'ok' | 'rate_limited' | 'out_of_credit' | 'failed';

/** A post as X's v2 API returns it, with the fields asked for. */
export type XTweet = {
  id: string;
  text: string;
  created_at?: string;
  conversation_id?: string;
  in_reply_to_user_id?: string;
  referenced_tweets?: { type: 'retweeted' | 'quoted' | 'replied_to'; id: string }[];
  public_metrics?: Record<string, number>;
  note_tweet?: { text?: string };
};

export type XPostKind = 'post' | 'thread_reply' | 'reply';

/** The kind x_posts stores, or null for a retweet, which is never stored. */
export function xPostKind(tweet: XTweet, ownXUserId: string): XPostKind | null {
  const refs = tweet.referenced_tweets ?? [];
  if (refs.some((r) => r.type === 'retweeted')) return null;
  const isReply = refs.some((r) => r.type === 'replied_to') || Boolean(tweet.in_reply_to_user_id);
  if (!isReply) return 'post';
  return tweet.in_reply_to_user_id === ownXUserId ? 'thread_reply' : 'reply';
}

export type XPostRow = {
  user_id: string;
  x_post_id: string;
  text: string;
  created_at: string;
  url: string;
  conversation_id: string | null;
  kind: XPostKind;
  public_metrics: Record<string, number>;
  metrics_at: string;
};

/** The x_posts row for a post, or null for a retweet or one with no date. */
export function xPostRow(
  tweet: XTweet,
  account: { user_id: string; x_user_id: string; handle: string },
  readAt: string,
): XPostRow | null {
  const kind = xPostKind(tweet, account.x_user_id);
  if (!kind || !tweet.created_at) return null;
  return {
    user_id: account.user_id,
    x_post_id: tweet.id,
    // A post over 280 characters comes back cut short in `text`, whole in
    // `note_tweet`; the whole one is what a draft is matched against.
    text: tweet.note_tweet?.text || tweet.text,
    created_at: tweet.created_at,
    url: `https://x.com/${account.handle}/status/${tweet.id}`,
    conversation_id: tweet.conversation_id ?? null,
    kind,
    public_metrics: tweet.public_metrics ?? {},
    metrics_at: readAt,
  };
}

/** The larger of two X post ids. Ids are 64-bit, past what a number holds. */
export function newerXId(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return BigInt(a) >= BigInt(b) ? a : b;
}

/** Why a request stopped the read, and the line the tab shows for it. */
export type XStop = { outcome: Exclude<XReadOutcome, 'ok'>; problem: string; error: string | null };

/**
 * Read X's refusal. A 402, or any refusal whose words mention credits or the
 * usage cap, means the developer account has run out; any other 429 is the
 * fifteen-minute rate limit.
 */
export function xStopFromResponse(status: number, body: unknown, headers?: Headers): XStop {
  const b = (body ?? {}) as Record<string, unknown>;
  const words = [b.title, b.detail, b.type, b.reason, b.error]
    .filter((w): w is string => typeof w === 'string')
    .join(' - ');
  const error = words || null;

  if (status === 402 || /credit|usagecap|usage cap|billing|payment/i.test(words)) {
    return {
      outcome: 'out_of_credit',
      problem:
        'X said the developer account is out of credit, so the read stopped. Add credit at console.x.com, then press Check X now.',
      error,
    };
  }
  if (status === 429) {
    // X's window is fifteen minutes. The reset time goes in the log rather
    // than on the tab, which may be read hours later and in another zone.
    const reset = Number(headers?.get('x-rate-limit-reset'));
    const resetAt = Number.isFinite(reset) && reset > 0 ? `resets ${new Date(reset * 1000).toISOString()}` : null;
    return {
      outcome: 'rate_limited',
      problem: 'X’s rate limit was reached, so the read stopped. The next read picks up where this one stopped.',
      error: [error, resetAt].filter(Boolean).join(' - ') || null,
    };
  }
  if (status === 401 || status === 403) {
    return {
      outcome: 'failed',
      problem: `X refused the read (${status}). If it happens again, disconnect and connect X again.`,
      error,
    };
  }
  return {
    outcome: 'failed',
    problem: `X answered with an error (${status}), so the read stopped. The next read tries again.`,
    error,
  };
}

/** A request to X stopped the read; carries what the tab shows. */
export class XReadStopped extends Error {
  constructor(readonly stop: XStop) {
    super(stop.problem);
    this.name = 'XReadStopped';
  }
}

/** One request as x_reads logs it. */
export type XReadLog = {
  kind: XReadKind;
  http_status: number | null;
  posts_read: number;
  outcome: XReadOutcome;
  error: string | null;
};

/** What a read needs from the database, so the tests can stand in for it. */
export type XReadStore = {
  /** The oldest and newest x_post_id stored for the person. */
  storedBounds(): Promise<{ oldest: string | null; newest: string | null }>;
  upsertPosts(rows: XPostRow[]): Promise<void>;
  /** Stored posts created since `since` whose numbers were read before `before`. */
  staleRecentIds(since: string, before: string): Promise<string[]>;
  log(entry: XReadLog): Promise<void>;
};

type Page = { tweets: XTweet[]; nextToken: string | null };

async function xGet(
  url: URL,
  token: string,
  kind: XReadKind,
  store: XReadStore,
  fetchImpl: Fetch,
): Promise<{ data: XTweet[]; meta: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetchImpl(url.toString(), {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : 'network error';
    await store.log({ kind, http_status: null, posts_read: 0, outcome: 'failed', error });
    throw new XReadStopped({
      outcome: 'failed',
      problem: 'Could not reach X, so the read stopped. The next read tries again.',
      error,
    });
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const stop = xStopFromResponse(res.status, json, res.headers);
    await store.log({ kind, http_status: res.status, posts_read: 0, outcome: stop.outcome, error: stop.error });
    throw new XReadStopped(stop);
  }
  const data = Array.isArray(json?.data) ? (json.data as XTweet[]) : [];
  await store.log({ kind, http_status: res.status, posts_read: data.length, outcome: 'ok', error: null });
  return { data, meta: (json?.meta ?? {}) as Record<string, unknown> };
}

async function timelinePage(
  xUserId: string,
  opts: { sinceId?: string | null; untilId?: string | null; next?: string | null },
  kind: XReadKind,
  token: string,
  store: XReadStore,
  fetchImpl: Fetch,
): Promise<Page> {
  const url = new URL(`${X_API}/users/${encodeURIComponent(xUserId)}/tweets`);
  url.searchParams.set('max_results', String(X_PAGE_SIZE));
  url.searchParams.set('exclude', 'retweets');
  url.searchParams.set('tweet.fields', X_TWEET_FIELDS);
  if (opts.sinceId) url.searchParams.set('since_id', opts.sinceId);
  if (opts.untilId) url.searchParams.set('until_id', opts.untilId);
  if (opts.next) url.searchParams.set('pagination_token', opts.next);
  const { data, meta } = await xGet(url, token, kind, store, fetchImpl);
  return { tweets: data, nextToken: typeof meta.next_token === 'string' ? meta.next_token : null };
}

export type XReadResult = {
  /** Posts X returned across every request, which is what X bills. */
  postsRead: number;
  /** Posts stored that were not stored before this read. */
  newPosts: number;
  /** The new value for x_accounts.newest_post_id. */
  newestPostId: string | null;
  /** Set when a request stopped the read. */
  stop: XStop | null;
};

/**
 * One read of the account. Never throws for X's refusals: they come back as
 * `stop`, with what was stored before them kept and the newest post id moved
 * on only as far as is safe.
 */
export async function readXPosts(input: {
  account: { user_id: string; x_user_id: string; handle: string; newest_post_id: string | null };
  token: string;
  store: XReadStore;
  fetchImpl?: Fetch;
  now?: number;
}): Promise<XReadResult> {
  const { account, token, store } = input;
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? Date.now();
  const readAt = new Date(now).toISOString();

  let postsRead = 0;
  let newPosts = 0;
  let newestPostId = account.newest_post_id;
  const before = await store.storedBounds();
  let storedNewest = before.newest;

  // Pages through one pass, storing as it goes, and says whether it reached
  // the end. A post whose id is above what was stored before is new.
  const pass = async (kind: XReadKind, opts: { sinceId?: string | null; untilId?: string | null }) => {
    let next: string | null = null;
    for (let page = 0; page < X_MAX_PAGES; page++) {
      const { tweets, nextToken } = await timelinePage(account.x_user_id, { ...opts, next }, kind, token, store, fetchImpl);
      postsRead += tweets.length;
      const rows = tweets.map((t) => xPostRow(t, account, readAt)).filter((r): r is XPostRow => r !== null);
      if (rows.length) await store.upsertPosts(rows);
      for (const row of rows) {
        if (!before.newest || BigInt(row.x_post_id) > BigInt(before.newest)) newPosts++;
        else if (before.oldest && BigInt(row.x_post_id) < BigInt(before.oldest)) newPosts++;
        storedNewest = newerXId(storedNewest, row.x_post_id);
      }
      if (!nextToken) return;
      next = nextToken;
    }
  };

  try {
    if (!account.newest_post_id) {
      // The first read, or one that stopped partway: carry on below the
      // oldest post stored, then pick up anything posted above the newest.
      await pass('history', { untilId: before.oldest });
      if (before.newest) await pass('new', { sinceId: before.newest });
      newestPostId = storedNewest;
    } else {
      await pass('new', { sinceId: account.newest_post_id });
      newestPostId = newerXId(account.newest_post_id, storedNewest);
    }

    const since = new Date(now - X_METRICS_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const stale = await store.staleRecentIds(since, readAt);
    for (let i = 0; i < stale.length; i += X_PAGE_SIZE) {
      const url = new URL(`${X_API}/tweets`);
      url.searchParams.set('ids', stale.slice(i, i + X_PAGE_SIZE).join(','));
      url.searchParams.set('tweet.fields', X_TWEET_FIELDS);
      const { data } = await xGet(url, token, 'metrics', store, fetchImpl);
      postsRead += data.length;
      const rows = data.map((t) => xPostRow(t, account, readAt)).filter((r): r is XPostRow => r !== null);
      if (rows.length) await store.upsertPosts(rows);
    }
    return { postsRead, newPosts, newestPostId, stop: null };
  } catch (err) {
    if (!(err instanceof XReadStopped)) throw err;
    // Stopped partway. A history read keeps newest_post_id null so the next
    // one resumes below the oldest stored post; a later read keeps the old
    // value, since posts between it and what was stored may still be unread.
    return { postsRead, newPosts, newestPostId: account.newest_post_id, stop: err.stop };
  }
}

/** x_posts and x_reads through Supabase, for one person and one read. */
export function supabaseXReadStore(
  db: Db,
  input: { userId: string; runId: string; trigger: XReadTrigger },
): XReadStore {
  const { userId, runId, trigger } = input;
  return {
    async storedBounds() {
      const ends = async (ascending: boolean) => {
        const { data, error } = await db
          .from('x_posts')
          .select('x_post_id')
          .eq('user_id', userId)
          .order('created_at', { ascending })
          .limit(1)
          .maybeSingle();
        if (error) throw new Error(`Could not read stored X posts: ${error.message}`);
        return (data?.x_post_id as string | undefined) ?? null;
      };
      const [oldest, newest] = await Promise.all([ends(true), ends(false)]);
      return { oldest, newest };
    },
    async upsertPosts(rows) {
      const { error } = await db.from('x_posts').upsert(rows, { onConflict: 'user_id,x_post_id' });
      if (error) throw new Error(`Could not store X posts: ${error.message}`);
    },
    async staleRecentIds(since, before) {
      const { data, error } = await db
        .from('x_posts')
        .select('x_post_id')
        .eq('user_id', userId)
        .gte('created_at', since)
        .or(`metrics_at.is.null,metrics_at.lt."${before}"`)
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) throw new Error(`Could not read recent X posts: ${error.message}`);
      return (data ?? []).map((r) => r.x_post_id as string);
    },
    async log(entry) {
      const { error } = await db.from('x_reads').insert({ user_id: userId, run_id: runId, trigger, ...entry });
      // The log is for checking the bill; a read that worked is not undone for it.
      if (error) console.error('x read log', error.message);
    },
  };
}

/** What one press of Check X now, or one account in the daily run, came to. */
export type XRunResult =
  | { state: 'not_connected' }
  | { state: 'busy' }
  | { state: 'disconnected'; problem: string }
  | { state: 'read'; postsRead: number; newPosts: number; problem: string | null };

/**
 * Read one person's connected account and record how it went on their
 * x_accounts row: last_synced_at when it finished, read_problem when it
 * stopped. One read per account at a time (`reading_since`), since two would
 * each refresh the token and X refuses the second refresh.
 */
export async function runXRead(
  db: Db,
  userId: string,
  opts: {
    trigger: XReadTrigger;
    client: XClient;
    encryptionKey: string;
    fetchImpl?: Fetch;
    now?: number;
  },
): Promise<XRunResult> {
  const now = opts.now ?? Date.now();
  const account = await loadXAccount(db, userId);
  if (!account) return { state: 'not_connected' };
  if (account.status === 'disconnected') {
    return { state: 'disconnected', problem: new XDisconnectedError().message };
  }

  const startedAt = new Date(now).toISOString();
  const staleBefore = new Date(now - X_READ_STALE_MS).toISOString();
  const { data: claimed, error: claimError } = await db
    .from('x_accounts')
    .update({ reading_since: startedAt })
    .eq('id', account.id)
    .eq('user_id', userId)
    .or(`reading_since.is.null,reading_since.lt."${staleBefore}"`)
    .select('id');
  if (claimError) throw new Error(`Could not start the X read: ${claimError.message}`);
  if (!claimed?.length) return { state: 'busy' };

  const finish = async (values: Record<string, unknown>) => {
    const { error } = await db
      .from('x_accounts')
      .update({ ...values, reading_since: null })
      .eq('id', account.id)
      .eq('user_id', userId);
    if (error) throw new Error(`Could not record the X read: ${error.message}`);
  };

  try {
    let token: string;
    try {
      token = await freshXAccessToken(db, account, {
        client: opts.client,
        encryptionKey: opts.encryptionKey,
        fetchImpl: opts.fetchImpl,
        now,
      });
    } catch (err) {
      // freshXAccessToken has already marked the row disconnected.
      if (err instanceof XDisconnectedError) {
        await finish({});
        return { state: 'disconnected', problem: err.message };
      }
      throw err;
    }

    const store = supabaseXReadStore(db, { userId, runId: randomUUID(), trigger: opts.trigger });
    const result = await readXPosts({ account, token, store, fetchImpl: opts.fetchImpl, now });

    if (result.stop) {
      await finish({
        newest_post_id: result.newestPostId,
        read_problem: result.stop.problem,
        read_problem_at: new Date(opts.now ?? Date.now()).toISOString(),
      });
    } else {
      await finish({
        newest_post_id: result.newestPostId,
        last_synced_at: new Date(opts.now ?? Date.now()).toISOString(),
        read_problem: null,
        read_problem_at: null,
      });
    }
    return {
      state: 'read',
      postsRead: result.postsRead,
      newPosts: result.newPosts,
      problem: result.stop?.problem ?? null,
    };
  } catch (err) {
    const problem = 'Something went wrong reading X, so the read stopped. The next read tries again.';
    console.error('x read', err);
    await finish({ read_problem: problem, read_problem_at: new Date().toISOString() }).catch(() => {});
    throw err;
  }
}

/** The line Check X now answers with. */
export function xRunMessage(result: XRunResult): { ok: boolean; text: string } {
  switch (result.state) {
    case 'not_connected':
      return { ok: false, text: 'X is not connected.' };
    case 'busy':
      return { ok: false, text: 'A read of X is already going. Give it a minute.' };
    case 'disconnected':
      return { ok: false, text: result.problem };
    case 'read':
      if (result.problem) return { ok: false, text: result.problem };
      if (result.newPosts === 0) return { ok: true, text: 'Nothing new on X.' };
      return {
        ok: true,
        text: result.newPosts === 1 ? 'Read 1 new post.' : `Read ${result.newPosts} new posts.`,
      };
  }
}
