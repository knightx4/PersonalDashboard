import 'server-only';

import { createTodoClient } from '@/lib/todo/auth/server';
import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { TODO_SCHEMA } from '@/lib/todo/db/schema-name';
import { addDays } from '@/lib/todo/tasks/model';
import { wallClockToInstant } from '@/lib/todo/time';
import type { Event } from '@/lib/todo/events/model';

/**
 * Reading events. Which days they land on is decided next door in model.ts.
 */

const COLUMNS = 'id, title, body, location, starts_on, ends_on, starts_at, ends_at, created_at';

/** PostgREST caps a response; a personal calendar will not reach this, but say it. */
const LIMIT = 500;

type Row = Record<string, unknown>;

function toEvent(row: Row): Event {
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
  };
}

/**
 * Everything that overlaps the days a view is showing.
 *
 * Overlapping, not starting inside: a holiday that began last Thursday is
 * still on today, and a week that only showed what began in it would be a
 * calendar with holes where the long things are.
 *
 * The two pairs of columns are asked two different questions. All-day dates
 * compare against the window's days directly. Instants compare against the
 * moments those days begin and end for this reader, which is why the timezone
 * is an argument: midnight is not the same event everywhere. An event ending
 * exactly as the window opens is over, hence `gt` rather than `gte`.
 */
export async function loadEventsInWindow(
  userId: string,
  window: { from: string; to: string },
  timezone: string,
): Promise<Event[]> {
  const supabase = await createTodoClient();

  const opens = wallClockToInstant(window.from, '00:00', timezone);
  const closes = wallClockToInstant(addDays(window.to, 1), '00:00', timezone);

  const { data, error } = await supabase
    .from('events')
    .select(COLUMNS)
    .eq('user_id', userId)
    .or(
      `and(starts_on.lte.${window.to},ends_on.gte.${window.from}),` +
        `and(starts_at.lt.${closes},ends_at.gt.${opens})`,
    )
    .limit(LIMIT);

  assertSchemaExposed(error, TODO_SCHEMA);
  if (error) throw new Error(error.message);

  return (data ?? []).map(toEvent);
}
