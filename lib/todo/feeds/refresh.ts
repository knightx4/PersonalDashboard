import 'server-only';

import { z } from 'zod';
import { createTodoClient } from '@/lib/todo/auth/server';
import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { decryptToken } from '@/lib/crypto/tokens';
import { TODO_SCHEMA } from '@/lib/todo/db/schema-name';
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
): Promise<RefreshResult> {
  const supabase = await createTodoClient();

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
    return record(userId, feedId, 0, 'That address could not be read. Add the calendar again.');
  }

  const fetched = await fetchCalendar(address);
  if (!fetched.ok) return record(userId, feedId, 0, fetched.detail);

  const today = todayIn(timezone, now);
  let events: FeedEvent[];
  try {
    events = parseCalendar(fetched.text, {
      from: addDays(today, -WINDOW_DAYS),
      to: addDays(today, WINDOW_DAYS),
    });
  } catch {
    return record(userId, feedId, 0, 'That calendar could not be read.');
  }

  const replaced = await replaceEvents(userId, feedId, events);
  if (replaced) return record(userId, feedId, 0, replaced);

  return record(userId, feedId, events.length, null);
}

/**
 * Put this subscription's appointments in place of its last ones.
 *
 * Delete and insert rather than a diff: every row here is a copy, nothing else
 * in the app may point at one, and a diff over occurrences of a repeat is
 * work that buys nothing.
 */
async function replaceEvents(
  userId: string,
  feedId: string,
  events: FeedEvent[],
): Promise<string | null> {
  const supabase = await createTodoClient();

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
  userId: string,
  feedId: string,
  stored: number,
  error: string | null,
): Promise<RefreshResult> {
  const supabase = await createTodoClient();

  await supabase
    .from('calendar_feeds')
    .update({
      last_error: error?.slice(0, 2000) ?? null,
      ...(error ? {} : { last_read_at: new Date().toISOString() }),
    })
    .eq('user_id', userId)
    .eq('id', feedId);

  return { stored, error };
}
