import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { TIMELINE_COLUMNS, type TimelineEvent } from '@/lib/timeline/timeline';
import { addDays } from '@/lib/todo/tasks/model';
import {
  WEEK_REVIEW_ZONE,
  weekBounds,
  weekFacts,
  type ChargeRow,
  type GoalItemRow,
  type GoalLinkRow,
  type GoalReviewRow,
  type SuggestionRow,
  type WeekFacts,
} from './facts';

/**
 * Read what one person's week and the week before it hold, and count them
 * (plan #1231). Meant for the Sunday run, which holds the service-role client,
 * so every read names the user rather than leaning on RLS: core.timeline is
 * security_invoker, and under the service role it would return everyone's.
 */
export async function loadWeekFacts(
  db: SupabaseClient,
  userId: string,
  week: string,
  timezone: string = WEEK_REVIEW_ZONE,
): Promise<WeekFacts> {
  const lastWeek = addDays(week, -7);
  const { from } = weekBounds(lastWeek, timezone);
  const { to } = weekBounds(week, timezone);
  // Date columns are compared as days, with a day's slack at each end for the
  // zone; facts.ts keeps only the days inside each week.
  const firstDay = addDays(lastWeek, -1);
  const endDay = addDays(week, 8);

  const [timeline, suggestions, charges, items, links, reviews, previous] = await Promise.all([
    readTimeline(db, userId, from, to),
    db
      .schema('goals')
      .from('suggestions')
      .select('id, item_id, title, happens_on, starts_at, reaction, attended')
      .eq('user_id', userId)
      .eq('kind', 'events')
      .or(`reaction.eq.going,attended.is.true`)
      .then(rowsOf<SuggestionRow>('event suggestions')),
    db
      .from('recurring_charges')
      .select('id, event, amount_cents, previous_amount_cents, currency, occurred_on')
      .eq('user_id', userId)
      .gte('occurred_on', firstDay)
      .lt('occurred_on', endDay)
      .then(rowsOf<ChargeRow>('recurring charges')),
    db
      .schema('goals')
      .from('items')
      .select('id, parent_id, level, status, title')
      .eq('user_id', userId)
      .is('archived_at', null)
      .then(rowsOf<GoalItemRow>('goals')),
    db
      .schema('goals')
      .from('links')
      .select('item_id, kind')
      .eq('user_id', userId)
      .is('archived_at', null)
      .then(rowsOf<GoalLinkRow>('goal links')),
    db
      .schema('goals')
      .from('reviews')
      .select('id, item_id, verdict, reason, created_at')
      .eq('user_id', userId)
      .lt('created_at', to)
      .order('created_at', { ascending: false })
      .limit(1000)
      .then(rowsOf<GoalReviewRow>('goal reviews')),
    db
      .schema('core')
      .from('week_reviews')
      .select('facts')
      .eq('user_id', userId)
      .eq('week', lastWeek)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) throw new Error(`Could not read last week's review: ${error.message}`);
        return (data as { facts: unknown } | null)?.facts ?? null;
      }),
  ]);

  return weekFacts(week, { timeline, suggestions, charges, items, links, reviews }, { timezone, previous });
}

function rowsOf<T>(what: string) {
  return ({ data, error }: { data: unknown; error: { message: string } | null }): T[] => {
    if (error) throw new Error(`Could not read the ${what}: ${error.message}`);
    return (data ?? []) as T[];
  };
}

/** The person's core.timeline rows in [from, to), paged past PostgREST's row cap. */
async function readTimeline(db: SupabaseClient, userId: string, from: string, to: string): Promise<TimelineEvent[]> {
  const pageSize = 1000;
  const events: TimelineEvent[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db
      .schema('core')
      .from('timeline')
      .select(TIMELINE_COLUMNS)
      .eq('user_id', userId)
      .gte('occurred_at', from)
      .lt('occurred_at', to)
      .order('occurred_at', { ascending: true })
      .order('source_id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`Could not read the timeline: ${error.message}`);
    const page = (data ?? []) as unknown as TimelineEvent[];
    events.push(...page);
    if (page.length < pageSize) return events;
  }
}
