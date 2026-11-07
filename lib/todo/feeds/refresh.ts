import 'server-only';

import { z } from 'zod';
import { createTodoClient } from '@/lib/todo/auth/server';
import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { decryptToken } from '@/lib/crypto/tokens';
import { TODO_SCHEMA, type TodoSupabaseClient } from '@/lib/todo/db/schema-name';
import { addDays, todayIn } from '@/lib/todo/tasks/model';
import { fetchCalendar } from '@/lib/todo/feeds/fetch';
import { parseCalendar, type FeedEvent } from '@/lib/todo/feeds/parse';

/**
 * Re-reading a subscription.
 *
 * Fetch, parse, and put what came back in place of whatever that subscription
 * held last time. A refresh replaces rather than merges, because the file is
 * the truth and an appointment deleted in Google has to disappear here too.
 *
 * A failed read is recorded on the subscription and changes nothing else. The
 * appointments from the last good read stay on the page: a calendar that has
 * quietly gone empty is a worse lie than one that is a day stale, and the pair
 * of columns says both that it is stale and why.
 */

/**
 * How far either side of today a subscription is stored.
 *
 * Backwards as well as forwards, because the agenda reaches a year back for
 * anything late and the calendar can be paged into last month. Beyond this a
 * copy is not worth keeping: the next refresh will fetch it again long before
 * anybody scrolls there.
 */
export const WINDOW_DAYS = 365;

/** Rows written per insert. A year of a busy calendar runs to a few thousand. */
const CHUNK = 500;

export interface RefreshResult {
  /** How many occurrences the subscription now contributes. */
  stored: number;
  /** Why the read failed, or null. The appointments are unchanged when set. */
  error: string | null;
}

interface FeedRow {
  id: string;
  address: string;
}

const keyEnv = z.object({ TOKEN_ENCRYPTION_KEY: z.string().min(1) });

/**
 * Read one subscription and store what it holds.
 *
 * The user id is the caller's session, never a request's word for it, and
 * every read and write below is scoped by it as well as by RLS.
 */
export async function refreshFeed(
  userId: string,
  feedId: string,
  now: Date = new Date(),
  timezone = 'UTC',
  timeoutMs?: number,
  client?: TodoSupabaseClient,
): Promise<RefreshResult> {
  const supabase = client ?? (await createTodoClient());

  const { data, error } = await supabase
    .from('calendar_feeds')
    .select('id, address')
    .eq('user_id', userId)
    .eq('id', feedId)
    .maybeSingle();

  assertSchemaExposed(error, TODO_SCHEMA);
  if (error) throw new Error(error.message);
  if (!data) return { stored: 0, error: 'That subscription is gone.' };

  const feed = data as unknown as FeedRow;

  let address: string;
  try {
    address = decryptToken(feed.address, keyEnv.parse(process.env).TOKEN_ENCRYPTION_KEY);
  } catch {
    // The row cannot be read back, so there is nothing to fetch and nothing to
    // tell the person to do except add it again.
    return record(supabase, userId, feedId, 0, 'That address could not be read. Add the calendar again.');
  }

  const fetched = await fetchCalendar(address, timeoutMs);
  if (!fetched.ok) return record(supabase, userId, feedId, 0, fetched.detail);

  const today = todayIn(timezone, now);
  let events: FeedEvent[];
  try {
    events = parseCalendar(fetched.text, {
      from: addDays(today, -WINDOW_DAYS),
      to: addDays(today, WINDOW_DAYS),
    });
  } catch {
    return record(supabase, userId, feedId, 0, 'That calendar could not be read.');
  }

  const replaced = await replaceEvents(supabase, userId, feedId, events);
  if (replaced) return record(supabase, userId, feedId, 0, replaced);

  return record(supabase, userId, feedId, events.length, null);
}

/**
 * Put this subscription's appointments in place of its last ones.
 *
 * Delete and insert rather than a diff: every row here is a copy, and a diff
 * over occurrences of a repeat is work that buys nothing. A task about one of
 * these appointments does not point at its row: todo.task_links names it by
 * (feed_id, uid, occurrence) and finds the new copy each time a page draws
 * (lib/todo/links/appointment.ts, plan #1373), so rewriting the rows leaves
 * those links whole.
 */
async function replaceEvents(
  supabase: TodoSupabaseClient,
  userId: string,
  feedId: string,
  events: FeedEvent[],
): Promise<string | null> {
  const { error: cleared } = await supabase
    .from('feed_events')
    .delete()
    .eq('user_id', userId)
    .eq('feed_id', feedId);

  if (cleared) return cleared.message;

  for (let at = 0; at < events.length; at += CHUNK) {
    const { error } = await supabase.from('feed_events').insert(
      events.slice(at, at + CHUNK).map((event) => ({
        user_id: userId,
        feed_id: feedId,
        uid: event.uid.slice(0, 500),
        title: event.title.slice(0, 500),
        body: event.body,
        location: event.location?.slice(0, 500) ?? null,
        starts_on: event.startsOn,
        ends_on: event.endsOn,
        starts_at: event.startsAt,
        ends_at: event.endsAt,
        occurrence: event.occurrence,
      })),
    );

    if (error) return error.message;
  }

  return null;
}

/**
 * Say when this subscription was last read, and what went wrong if anything.
 *
 * `last_read_at` moves only on a good read, so the pair reads as "these
 * appointments are from Tuesday, and here is why there is nothing newer".
 */
async function record(
  supabase: TodoSupabaseClient,
  userId: string,
  feedId: string,
  stored: number,
  error: string | null,
): Promise<RefreshResult> {
  await supabase
    .from('calendar_feeds')
    .update({
      last_error: error?.slice(0, 2000) ?? null,
      // The claim is released here whichever way the read went, so a failure
      // does not leave the subscription looking busy until the stamp ages out.
      refreshing_since: null,
      ...(error ? {} : { last_read_at: new Date().toISOString() }),
    })
    .eq('user_id', userId)
    .eq('id', feedId);

  return { stored, error };
}

/**
 * How old a copy may be before a read of the day re-reads it: opening the
 * calendar, or anything that reads the combined schedule (plan #3045).
 *
 * #277 settled on an hour: a calendar that can be a day behind is one you
 * check your phone to confirm, which is the thing this exists to stop.
 */
export const STALE_MS = 60 * 60 * 1000;

/**
 * How long a claim stands before another reader takes it over.
 *
 * Longer than a read can take -- the fetch timeout plus the writing -- so a
 * live reader is never cut in on, and short enough that a process that died
 * holding the claim costs one refresh rather than the subscription.
 */
const CLAIM_MS = 5 * 60 * 1000;

/** A page render waits for this, so it gets less patience than a button does. */
const PAGE_TIMEOUT_MS = 8_000;

/**
 * How long a schedule read waits on one stale subscription (plan #3045).
 *
 * A chat answer or the morning brief is waiting, so a slow host gets a few
 * seconds and then the answer goes ahead on the rows already stored.
 */
export const SCHEDULE_TIMEOUT_MS = 4_000;

/**
 * Time on top of the fetch's own timeout for the writing that follows it.
 * Past this the read is given up on for this answer and finishes on its own.
 */
const WRITE_GRACE_MS = 2_000;

/**
 * How long a finished read is reused instead of starting another.
 *
 * A good read moves last_read_at and is not stale for an hour anyway; this is
 * for the one that failed, so a broken host is not asked again by every
 * lookup in the same conversation.
 */
const REUSE_MS = 60 * 1000;

/** Reads of one subscription under way in this process, or just finished, by user and feed. */
const attempts = new Map<string, { promise: Promise<boolean>; settledAt: number | null }>();

export interface StaleFeedOptions {
  /** The caller's client. The session's when absent; a service-role one must come with the person's id. */
  client?: TodoSupabaseClient;
  now?: Date;
  timezone?: string;
  /** How long the fetch of one subscription may take. */
  timeoutMs?: number;
}

/**
 * Re-read the subscriptions whose copy is more than STALE_MS old, all at
 * once, and say which of them could not be re-read.
 *
 * The answer is the names of the subscriptions still stale: the read failed,
 * timed out, or another reader holds it. Their stored rows are still the ones
 * a caller reads, so it can say those calendars may be out of date. A
 * subscription read under an hour ago is not asked for, and one being read
 * already, here or in another tab, is waited on or skipped rather than read
 * twice.
 */
export async function syncStaleFeeds(userId: string, options: StaleFeedOptions = {}): Promise<string[]> {
  const supabase = options.client ?? (await createTodoClient());
  const now = options.now ?? new Date();
  const timezone = options.timezone ?? 'UTC';
  const timeoutMs = options.timeoutMs ?? SCHEDULE_TIMEOUT_MS;

  const staleBefore = new Date(now.getTime() - STALE_MS).toISOString();

  const { data, error } = await supabase
    .from('calendar_feeds')
    .select('id, name')
    .eq('user_id', userId)
    // A subscription nobody is drawing is not worth somebody else's server: it
    // is re-read the moment it is switched back on, by this same call.
    .eq('shown', true)
    .or(`last_read_at.is.null,last_read_at.lt.${staleBefore}`);

  if (error || !data || data.length === 0) return [];

  const read = await Promise.all(
    data.map((row) =>
      attemptOnce(`${userId}:${row.id as string}`, () =>
        withinTime(readIfFree(supabase, userId, row.id as string, now, timezone, timeoutMs), timeoutMs + WRITE_GRACE_MS),
      ),
    ),
  );

  return data.filter((_, index) => !read[index]).map((row) => (row.name as string | null) ?? 'Subscribed');
}

/** One read of a subscription, shared by every caller asking while it runs or just after. */
function attemptOnce(key: string, start: () => Promise<boolean>): Promise<boolean> {
  const held = attempts.get(key);
  if (held && (held.settledAt === null || Date.now() - held.settledAt < REUSE_MS)) return held.promise;

  const entry: { promise: Promise<boolean>; settledAt: number | null } = { promise: Promise.resolve(false), settledAt: null };
  entry.promise = start()
    .catch(() => false)
    .finally(() => {
      entry.settledAt = Date.now();
    });
  attempts.set(key, entry);
  return entry.promise;
}

/** Claim the subscription and read it. False when another reader has it or the read failed. */
async function readIfFree(
  supabase: TodoSupabaseClient,
  userId: string,
  feedId: string,
  now: Date,
  timezone: string,
  timeoutMs: number,
): Promise<boolean> {
  if (!(await claim(supabase, userId, feedId, now))) return false;
  const result = await refreshFeed(userId, feedId, now, timezone, timeoutMs, supabase);
  return result.error === null;
}

/** False once `ms` has passed; the read itself carries on and records what it finds. */
function withinTime(read: Promise<boolean>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  return Promise.race([read, late]).finally(() => clearTimeout(timer));
}

/** Forget the reads under way. For tests. */
export function resetFeedAttempts(): void {
  attempts.clear();
}

/**
 * Re-read the subscriptions whose copy has gone stale.
 *
 * Called when the calendar is opened. Every other reader of the day reaches
 * the same reads through the combined schedule (lib/todo/schedule/load.ts,
 * plan #3045), which calls syncStaleFeeds with a shorter wait.
 */
export async function refreshStaleFeeds(
  userId: string,
  now: Date = new Date(),
  timezone = 'UTC',
): Promise<void> {
  await syncStaleFeeds(userId, { now, timezone, timeoutMs: PAGE_TIMEOUT_MS });
}

/**
 * Take this subscription, if nobody else has it.
 *
 * The condition is part of the update rather than a read followed by a write,
 * because two tabs opened together would both pass a check written that way.
 */
async function claim(supabase: TodoSupabaseClient, userId: string, feedId: string, now: Date): Promise<boolean> {
  const expired = new Date(now.getTime() - CLAIM_MS).toISOString();

  const { data, error } = await supabase
    .from('calendar_feeds')
    .update({ refreshing_since: now.toISOString() })
    .eq('user_id', userId)
    .eq('id', feedId)
    .or(`refreshing_since.is.null,refreshing_since.lt.${expired}`)
    .select('id');

  return !error && (data?.length ?? 0) > 0;
}
