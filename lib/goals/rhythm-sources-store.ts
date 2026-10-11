import 'server-only';

import { normalizeTimeZone } from '@/lib/core/timezone';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import {
  calendarDays,
  countIn,
  spanOf,
  type CountSource,
  type SourceEvent,
} from '@/lib/goals/rhythm-sources';
import { countKey, type LiveRhythm, type PeriodSpan } from '@/lib/goals/rhythms';
import { dayIn } from '@/lib/todo/time';
import { addDays } from '@/lib/todo/tasks/model';

/**
 * The reads behind rhythms that count themselves (lib/goals/rhythm-sources.ts).
 * One read per source a sync needs, ranged over every period it counts, and
 * then each period's count worked out from the days that came back.
 *
 * Every read filters by `userId`, because the daily cron passes the
 * service-role client (inngest/goals/rhythms.ts); under the signed-in client
 * row level security gives the same rows.
 */

/** The account's zone, for the day a timed event or an application falls on. UTC when unknown. */
async function accountZone(client: GoalsSupabaseClient, userId: string): Promise<string> {
  try {
    const { data } = await client
      .schema('core')
      .from('account_settings')
      .select('timezone')
      .eq('user_id', userId)
      .maybeSingle();
    return normalizeTimeZone((data?.timezone as string | undefined) ?? null) ?? 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * The instants to ask for so every day of `span` is covered in any zone: a
 * day either side, with the exact days settled by dayIn afterwards.
 */
const instants = (span: PeriodSpan) => ({
  from: `${addDays(span.startsOn, -1)}T00:00:00Z`,
  to: `${addDays(span.endsOn, 1)}T00:00:00Z`,
});

/** The day each application was sent on, in the person's zone. */
async function applicationDays(
  client: GoalsSupabaseClient,
  userId: string,
  span: PeriodSpan,
  zone: string,
): Promise<string[]> {
  const { from, to } = instants(span);
  const { data, error } = await client
    .schema('job_search')
    .from('applications')
    .select('submitted_at')
    .eq('user_id', userId)
    .gte('submitted_at', from)
    .lt('submitted_at', to)
    .limit(5000);
  if (error) throw new Error(`Could not count applications: ${error.message}`);
  return ((data ?? []) as { submitted_at: string }[]).map((row) => dayIn(row.submitted_at, zone));
}

type EventRow = { title: string; starts_on: string | null; starts_at: string | null };

/**
 * Every event on the person's calendar starting in the span, with the day it
 * starts: the ones typed in Todo and the ones read from subscribed feeds.
 */
async function calendarEvents(
  client: GoalsSupabaseClient,
  userId: string,
  span: PeriodSpan,
  zone: string,
): Promise<SourceEvent[]> {
  const { from, to } = instants(span);
  // The instants are quoted because PostgREST reads a bare colon in an or
  // filter as syntax.
  const within =
    `and(starts_on.gte.${span.startsOn},starts_on.lt.${span.endsOn}),` +
    `and(starts_at.gte."${from}",starts_at.lt."${to}")`;
  const todo = client.schema('todo');
  const [own, feeds] = await Promise.all([
    todo.from('events').select('title, starts_on, starts_at').eq('user_id', userId).or(within).limit(5000),
    todo
      .from('feed_events')
      .select('title, starts_on, starts_at')
      .eq('user_id', userId)
      .or(within)
      .limit(5000),
  ]);
  if (own.error) throw new Error(`Could not read calendar events: ${own.error.message}`);
  if (feeds.error) throw new Error(`Could not read calendar events: ${feeds.error.message}`);
  return [...((own.data ?? []) as EventRow[]), ...((feeds.data ?? []) as EventRow[])].flatMap(
    (row) => {
      const day = row.starts_on ?? (row.starts_at ? dayIn(row.starts_at, zone) : null);
      return day ? [{ title: row.title, day }] : [];
    },
  );
}

/**
 * What each sourced rhythm's source counts in the periods asked for, keyed
 * by countKey. `spans` is sourcedSpans' answer. Nothing is read when no
 * rhythm counts itself.
 */
export async function readSourceCounts(
  client: GoalsSupabaseClient,
  userId: string,
  rhythms: LiveRhythm[],
  spans: Map<string, PeriodSpan[]>,
  today: string,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const sourced = rhythms.filter((r) => r.source && (spans.get(r.id) ?? []).length > 0);
  if (sourced.length === 0) return counts;

  const zone = await accountZone(client, userId);
  const kinds = [...new Set(sourced.map((r) => r.source!.kind))];
  const read = await Promise.all(
    kinds.map(async (kind): Promise<[CountSource, string[] | SourceEvent[]]> => {
      const range = spanOf(
        sourced.filter((r) => r.source!.kind === kind).flatMap((r) => spans.get(r.id) ?? []),
      )!;
      return kind === 'applications'
        ? [kind, await applicationDays(client, userId, range, zone)]
        : [kind, await calendarEvents(client, userId, range, zone)];
    }),
  );
  const bySource = new Map(read);

  for (const rhythm of sourced) {
    const { kind, match } = rhythm.source!;
    const days =
      kind === 'applications'
        ? (bySource.get(kind) as string[])
        : calendarDays(bySource.get(kind) as SourceEvent[], match);
    for (const span of spans.get(rhythm.id) ?? []) {
      counts.set(countKey(rhythm.id, span.startsOn), countIn(span, days, today));
    }
  }
  return counts;
}
