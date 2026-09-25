import 'server-only';

import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { periodOf } from '@/lib/goals/rhythms';
import { countTowards } from '@/lib/goals/rhythms-store';
import { RHYTHM_PERIODS, type RhythmPeriod } from '@/lib/goals/steps';
import {
  PAST_LIMIT,
  SHOWN_FOR_MS,
  SUGGESTION_COLUMNS,
  toSuggestion,
  type Suggestion,
  type SuggestionRow,
  type YourReaction,
} from '@/lib/goals/suggestions';

/**
 * Reads and writes for the weekly suggestions (plan #934). The rules are in
 * lib/goals/suggestions.ts.
 *
 * The home and Todo pass the signed-in client, so row level security decides
 * whose rows these are and the history records a reaction as yours. The
 * weekly cron stage passes the service-role client with `userId`, and its
 * writes are recorded as Claude's, which the guard in goals 0008 holds to
 * marking unanswered suggestions ignored.
 */

function rows(data: unknown): Suggestion[] {
  return ((data ?? []) as SuggestionRow[]).map(toSuggestion);
}

/** This fortnight's suggestions, for the home to pick from. */
export async function loadRecentSuggestions(
  client: GoalsSupabaseClient,
  now: number = Date.now(),
): Promise<Suggestion[]> {
  const { data, error } = await client
    .from('suggestions')
    .select(SUGGESTION_COLUMNS)
    .gte('created_at', new Date(now - SHOWN_FOR_MS).toISOString())
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Could not read suggestions: ${error.message}`);
  return rows(data);
}

/** Every suggestion you said you are going to and have not ticked, for Todo. */
export async function loadGoingSuggestions(client: GoalsSupabaseClient): Promise<Suggestion[]> {
  const { data, error } = await client
    .from('suggestions')
    .select(SUGGESTION_COLUMNS)
    .eq('reaction', 'going')
    .is('attended', null)
    .order('happens_on', { ascending: true, nullsFirst: false });
  if (error) throw new Error(`Could not read suggestions: ${error.message}`);
  return rows(data);
}

/**
 * Going or not for me, pressed on the home. Changing your mind is allowed,
 * including on one already marked ignored. False when there is no such
 * suggestion of yours.
 */
export async function reactToSuggestion(
  client: GoalsSupabaseClient,
  id: string,
  reaction: YourReaction,
): Promise<boolean> {
  const { data, error } = await client
    .from('suggestions')
    .update({ reaction, reacted_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/**
 * Record whether you went: yes from the tick on Todo or the home's "Did you
 * go?", no from the home (plan #1020). Only on a suggestion you said you are
 * going to and have not answered for. A yes on one suggested for a rhythm
 * counts one towards the rhythm's period holding the event's date (today's
 * for an undated one), when that period is still open. False when nothing
 * changed.
 */
export async function recordAttended(
  client: GoalsSupabaseClient,
  id: string,
  went: boolean,
  today: string,
): Promise<boolean> {
  const { data, error } = await client
    .from('suggestions')
    .update({ attended: went })
    .eq('id', id)
    .eq('reaction', 'going')
    .is('attended', null)
    .select('item_id, happens_on');
  if (error) throw new Error(error.message);
  const row = (data ?? [])[0] as { item_id: string | null; happens_on: string | null } | undefined;
  if (!row) return false;
  if (!went || !row.item_id) return true;

  const { data: item } = await client
    .from('items')
    .select('kind, rhythm_period')
    .eq('id', row.item_id)
    .maybeSingle();
  const period = item?.rhythm_period as RhythmPeriod | null | undefined;
  if (item?.kind !== 'rhythm' || !period || !RHYTHM_PERIODS.includes(period)) return true;
  await countTowards(client, row.item_id, periodOf(period, row.happens_on ?? today).startsOn, 1);
  return true;
}

/**
 * Close the week: every suggestion of `userId` written before `before` that
 * nobody reacted to is marked ignored. Returns how many.
 */
export async function ignoreUnanswered(
  client: GoalsSupabaseClient,
  userId: string,
  before: string,
): Promise<number> {
  const { data, error } = await client
    .from('suggestions')
    .update({ reaction: 'ignored', reacted_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('reaction', null)
    .lt('created_at', before)
    .select('id');
  if (error) throw new Error(`Could not mark suggestions ignored: ${error.message}`);
  return (data ?? []).length;
}

/** The suggestions the next brief reads, newest first. */
export async function loadPastSuggestions(
  client: GoalsSupabaseClient,
  userId: string,
  since: string,
): Promise<Suggestion[]> {
  const { data, error } = await client
    .from('suggestions')
    .select(SUGGESTION_COLUMNS)
    .eq('user_id', userId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(PAST_LIMIT);
  if (error) throw new Error(`Could not read suggestions: ${error.message}`);
  return rows(data);
}
