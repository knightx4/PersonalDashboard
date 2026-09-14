import 'server-only';

import { z } from 'zod';
import { createTodoClient } from '@/lib/todo/auth/server';
import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { decryptToken } from '@/lib/crypto/tokens';
import { TODO_SCHEMA } from '@/lib/todo/db/schema-name';
import { addDays } from '@/lib/todo/tasks/model';
import { wallClockToInstant } from '@/lib/todo/time';
import type { Event } from '@/lib/todo/events/model';

/**
 * Reading your subscriptions, and the appointments they brought.
 *
 * The address never comes back out of here. It is the credential -- anyone
 * holding a private Google link can read the whole calendar -- so what the
 * settings page gets is a hint: the host it points at and the last few
 * characters, which is enough to tell two subscriptions apart and no use to
 * anybody reading over a shoulder.
 */

export interface Feed {
  id: string;
  name: string;
  /** Enough of the address to recognise it. Never the whole thing. */
  hint: string;
  /** Whether its appointments are being drawn. A switched-off calendar keeps
   *  its address and its rows; nothing reads them. */
  shown: boolean;
  /** When it was last read successfully. Null until the first good read. */
  lastReadAt: string | null;
  /** Why the last attempt failed, or null. Set with lastReadAt still standing. */
  lastError: string | null;
  createdAt: string;
}

const keyEnv = z.object({ TOKEN_ENCRYPTION_KEY: z.string().min(1) });

/** Your subscriptions, oldest first, as they were added. */
export async function loadFeeds(userId: string): Promise<Feed[]> {
  const supabase = await createTodoClient();

  const { data, error } = await supabase
    .from('calendar_feeds')
    .select('id, name, address, shown, last_read_at, last_error, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  assertSchemaExposed(error, TODO_SCHEMA);
  if (error) throw new Error(error.message);

  const key = keyEnv.safeParse(process.env);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    hint: key.success ? hintFor(row.address as string, key.data.TOKEN_ENCRYPTION_KEY) : 'a calendar',
    // A row written before the column existed is one that was being drawn.
    shown: (row.shown as boolean | null) ?? true,
    lastReadAt: (row.last_read_at as string | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}

/**
 * As much of an address as is safe to show.
 *
 * The host, which says whose calendar it is, and the last four characters,
 * which tell two calendars on the same host apart. A row that cannot be
 * decrypted says so rather than showing nothing, because that is a thing to
 * act on -- the key changed, and the subscription has to be added again.
 */
export function hintFor(ciphertext: string, key: string): string {
  let address: string;
  try {
    address = decryptToken(ciphertext, key);
  } catch {
    return 'unreadable — add it again';
  }

  try {
    const url = new URL(address.replace(/^webcal:/i, 'https:'));
    return `${url.host} …${address.slice(-4)}`;
  } catch {
    return `…${address.slice(-4)}`;
  }
}

const EVENT_COLUMNS = 'id, title, body, location, starts_on, ends_on, starts_at, ends_at, created_at';

/** PostgREST caps a response; a year of subscribed appointments can reach it. */
const EVENT_LIMIT = 2000;

/**
 * The subscribed appointments that overlap the days a view is showing.
 *
 * The same window question loadEventsInWindow asks of the events you typed,
 * asked of the copy: all-day dates compare against the window's days directly
 * and instants against the moments those days begin and end for this reader.
 * They come back as Events because that is what they are -- everything that
 * draws a calendar can then ask them the same date questions -- and which
 * calendar each came from rides along, since a subscribed appointment is drawn
 * as somebody else's.
 *
 * A subscription that is switched off contributes nothing, and the switch is
 * read here rather than by each page: hiding a calendar has to mean hiding it
 * everywhere, and a caller that forgot would draw it on one page and not the
 * other. The ids are asked for first, because a row's own table does not know
 * which subscription is being drawn.
 */
export interface SubscribedEvent extends Event {
  feedId: string;
}

export async function loadFeedEventsInWindow(
  userId: string,
  window: { from: string; to: string },
  timezone: string,
): Promise<SubscribedEvent[]> {
  const supabase = await createTodoClient();

  const { data: feeds, error: feedError } = await supabase
    .from('calendar_feeds')
    .select('id')
    .eq('user_id', userId)
    .eq('shown', true);

  assertSchemaExposed(feedError, TODO_SCHEMA);
  if (feedError) throw new Error(feedError.message);

  const shown = (feeds ?? []).map((row) => row.id as string);
  // Every calendar switched off is a calendar with nothing to read.
  if (shown.length === 0) return [];

  const opens = wallClockToInstant(window.from, '00:00', timezone);
  const closes = wallClockToInstant(addDays(window.to, 1), '00:00', timezone);

  const { data, error } = await supabase
    .from('feed_events')
    .select(`${EVENT_COLUMNS}, feed_id`)
    .eq('user_id', userId)
    .in('feed_id', shown)
    .or(
      `and(starts_on.lte.${window.to},ends_on.gte.${window.from}),` +
        `and(starts_at.lt.${closes},ends_at.gt.${opens})`,
    )
    .limit(EVENT_LIMIT);

  assertSchemaExposed(error, TODO_SCHEMA);
  if (error) throw new Error(error.message);

  return (data ?? []).map(toSubscribedEvent);
}

function toSubscribedEvent(row: Record<string, unknown>): SubscribedEvent {
  return {
    id: row.id as string,
    title: row.title as string,
    body: (row.body as string | null) ?? null,
    location: (row.location as string | null) ?? null,
    startsOn: (row.starts_on as string | null) ?? null,
    endsOn: (row.ends_on as string | null) ?? null,
    startsAt: (row.starts_at as string | null) ?? null,
    endsAt: (row.ends_at as string | null) ?? null,
    createdAt: row.created_at as string,
    feedId: row.feed_id as string,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One subscribed appointment, and the name of the calendar it came from. */
export interface SubscribedEventDetail {
  event: SubscribedEvent;
  /** What you called the subscription. Never its address, which is a credential. */
  feedName: string;
}

/**
 * One subscribed appointment, if it is yours. Null when it is not, or is gone.
 *
 * The id comes off a query string, so it is checked for being an id before it
 * is asked about, exactly as loadEvent does it next door: a malformed uuid
 * reaches Postgres as an error rather than as the nothing it actually is.
 *
 * A row can also simply vanish -- a refresh replaces the appointments of a
 * subscription rather than editing them, so an occurrence the calendar dropped
 * is no longer there. That is nothing found, not a failure.
 *
 * Two reads rather than an embed: the foreign key to calendar_feeds is over
 * (feed_id, user_id), and asking for the name directly is clearer than naming
 * a composite relationship.
 */
export async function loadFeedEvent(
  userId: string,
  id: string,
): Promise<SubscribedEventDetail | null> {
  if (!UUID.test(id)) return null;

  const supabase = await createTodoClient();

  const { data, error } = await supabase
    .from('feed_events')
    .select(`${EVENT_COLUMNS}, feed_id`)
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();

  assertSchemaExposed(error, TODO_SCHEMA);
  if (error) throw new Error(error.message);
  if (!data) return null;

  const event = toSubscribedEvent(data);

  const { data: feed, error: feedError } = await supabase
    .from('calendar_feeds')
    .select('name')
    .eq('user_id', userId)
    .eq('id', event.feedId)
    .maybeSingle();

  if (feedError) throw new Error(feedError.message);

  return { event, feedName: (feed?.name as string | undefined) ?? 'a calendar you subscribe to' };
}
