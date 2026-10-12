import 'server-only';

import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { periodOf } from '@/lib/goals/rhythms';
import { countTowards } from '@/lib/goals/rhythms-store';
import { RHYTHM_PERIODS, type RhythmPeriod } from '@/lib/goals/steps';
import { insertStep, setStepArchived } from '@/lib/goals/steps-store';
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
export async function loadGoingSuggestions(
  client: GoalsSupabaseClient,
  userId?: string,
): Promise<Suggestion[]> {
  // RLS narrows a session's read; a service-role client (the morning brief)
  // has to name the person instead.
  let query = client
    .from('suggestions')
    .select(SUGGESTION_COLUMNS)
    .eq('reaction', 'going')
    .is('attended', null);
  if (userId) query = query.eq('user_id', userId);
  const { data, error } = await query.order('happens_on', { ascending: true, nullsFirst: false });
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
  let query = client
    .from('suggestions')
    .update({ reaction, reacted_at: new Date().toISOString() })
    .eq('id', id)
    .is('accepted_step_id', null);
  // Going puts a suggestion on Todo, and a suggested step only reaches Todo
  // once it is a step and sent there (plan #1739).
  if (reaction === 'going') query = query.neq('kind', 'step');
  const { data, error } = await query.select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/**
 * The suggestions made for a goal or one of its steps, for the goal's
 * Suggestions section (plan #1739). goalSuggestions in lib/goals/suggestions.ts
 * picks what shows; this narrows the read to the rows that could.
 */
export async function loadGoalSuggestions(
  client: GoalsSupabaseClient,
  itemIds: readonly string[],
): Promise<Suggestion[]> {
  if (itemIds.length === 0) return [];
  const { data, error } = await client
    .from('suggestions')
    .select(SUGGESTION_COLUMNS)
    .in('item_id', [...itemIds])
    .is('accepted_step_id', null)
    .is('attended', null)
    .or('reaction.is.null,reaction.eq.going')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(`Could not read suggestions: ${error.message}`);
  return rows(data);
}

/**
 * Add as step (plan #1739): a suggested step becomes a step of yours under
 * what it was suggested for, and the suggestion records the step. The step
 * is not put on Todo; it gets there only when it is sent. Returns the new
 * step's id, or null when there is no such suggested step still open, or
 * what it was for is gone.
 */
export async function acceptStepSuggestion(
  client: GoalsSupabaseClient,
  userId: string,
  id: string,
): Promise<string | null> {
  const { data: found, error: readError } = await client
    .from('suggestions')
    .select('item_id, title, detail')
    .eq('id', id)
    .eq('kind', 'step')
    .is('accepted_step_id', null)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  const row = found as { item_id: string | null; title: string; detail: string | null } | null;
  if (!row?.item_id) return null;

  const stepId = await insertStep(client, userId, row.item_id, {
    title: row.title.slice(0, 500),
    detail: row.detail,
    kind: 'mine',
  });
  if (!stepId) return null;

  const { data: claimed, error } = await client
    .from('suggestions')
    .update({ accepted_step_id: stepId })
    .eq('id', id)
    .is('accepted_step_id', null)
    .select('id');
  if (error || (claimed ?? []).length === 0) {
    // Added twice at once: keep the first, put this step away.
    await setStepArchived(client, stepId, true);
    if (error) throw new Error(error.message);
    return null;
  }

  return stepId;
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
    // A suggested step added as a step was answered, though not with a reaction.
    .is('accepted_step_id', null)
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
