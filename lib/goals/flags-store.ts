import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { COMMENT_COLUMNS, threadFrom } from '@/lib/comments/load';
import { resolveRoutineId, type RoutineTarget } from '@/lib/feedback/routine';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { flagRunText, type FlagStatus, type GoalFlag } from '@/lib/goals/flags';
import { goalRunText, runInFlight } from '@/lib/goals/shaping';
import { loadShaping, recordAndFire } from '@/lib/goals/shaping-store';

/**
 * Reads and writes for what a goals run flagged on a goal (plan #1015). The
 * rows are in public.raised_items, so these take the ordinary signed-in client
 * for them and the goals client only for the run an answer starts. Row level
 * security on both decides whose rows they are.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public'>;

const FLAG_COLUMNS =
  'id, goal_id, title, detail, ask, status, created_at, ' +
  `thread:dev_comments(${COMMENT_COLUMNS})`;

function flagFrom(row: Record<string, unknown>): GoalFlag {
  return {
    id: row.id as string,
    goalId: row.goal_id as string,
    title: row.title as string,
    detail: (row.detail as string | null) ?? null,
    ask: (row.ask as string | null) ?? null,
    status: row.status as FlagStatus,
    createdAt: row.created_at as string,
    thread: threadFrom(row.thread),
  };
}

/**
 * The flags still wanting something, oldest first: open ones wait on you and
 * answered ones on the run your answer started. `goalId` narrows it to one
 * goal's page. A failed read is an empty list, so a goal page or the home
 * still draws without them.
 */
export async function loadGoalFlags(
  supabase: Db,
  input: { userId: string; goalId?: string },
): Promise<GoalFlag[]> {
  let query = supabase
    .from('raised_items')
    .select(FLAG_COLUMNS)
    .eq('user_id', input.userId)
    .not('goal_id', 'is', null)
    .in('status', ['open', 'answered']);
  if (input.goalId) query = query.eq('goal_id', input.goalId);
  const { data, error } = await query.order('created_at', { ascending: true }).limit(100);
  if (error) {
    console.error(`Flags on goals could not be read: ${error.message}`);
    return [];
  }
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(flagFrom);
}

/** The title of each live goal among `goalIds`, for naming a flag's goal. */
export async function loadGoalTitles(
  client: GoalsSupabaseClient,
  goalIds: readonly string[],
): Promise<Map<string, string>> {
  if (goalIds.length === 0) return new Map();
  const { data, error } = await client
    .from('items')
    .select('id, title')
    .in('id', [...new Set(goalIds)])
    .eq('level', 'goal')
    .is('archived_at', null);
  if (error) throw new Error(`Could not read goals: ${error.message}`);
  return new Map((data ?? []).map((row) => [row.id as string, row.title as string]));
}

export type AnswerFlagOutcome = { ok: true; message: string } | { ok: false; error: string };

/**
 * Write the answer into the flag's thread, then start a goal run with it.
 *
 * The answer is kept whatever happens next. The flag moves to answered only
 * once a run has started, so a flag whose run could not start stays under
 * Waiting on you with your answer on it, and the next answer carries the
 * whole thread. A run already going on the goal refuses a second one, as a
 * comment on the goal does (lib/goals/ask.ts): it would not see the answer.
 */
export async function answerGoalFlag(input: {
  supabase: Db;
  client: GoalsSupabaseClient;
  userId: string;
  id: string;
  answer: string;
  /** Only the owner's account can start a run: it spends the owner's routine. */
  canRun: boolean;
  routine: RoutineTarget;
  fetch?: typeof globalThis.fetch;
}): Promise<AnswerFlagOutcome> {
  const { supabase, userId } = input;
  const { data } = await supabase
    .from('raised_items')
    .select(FLAG_COLUMNS)
    .eq('user_id', userId)
    .eq('id', input.id)
    .not('goal_id', 'is', null)
    .maybeSingle();
  if (!data) return { ok: false, error: 'That flag is no longer on the page.' };
  const flag = flagFrom(data as unknown as Record<string, unknown>);
  if (flag.status !== 'open' && flag.status !== 'answered') {
    return { ok: false, error: 'That flag is already closed.' };
  }

  const written = await supabase
    .from('dev_comments')
    .insert({ user_id: userId, raised_item_id: flag.id, author: 'me', body: input.answer })
    .select('id')
    .single();
  if (written.error) return { ok: false, error: 'Your answer could not be saved. Try again.' };

  const unsaid = (why: string): AnswerFlagOutcome => ({
    ok: false,
    error: `Your answer is saved, but no run started: ${why}`,
  });
  if (!input.canRun) return unsaid('only the account that owns this app can start a Claude run.');
  if (!resolveRoutineId(input.routine.id)) {
    return unsaid(
      'no goals routine is set on this deployment (CLAUDE_GOALS_ROUTINE_ID and CLAUDE_GOALS_ROUTINE_TOKEN).',
    );
  }

  const [{ lastRun }, goal] = await Promise.all([
    loadShaping(input.client, flag.goalId),
    input.client.from('items').select('title').eq('id', flag.goalId).maybeSingle(),
  ]);
  if (runInFlight(lastRun, Date.now())) {
    return unsaid('Claude is already working on this goal. Say more once that run finishes.');
  }
  const goalTitle = (goal.data?.title as string | undefined) ?? flag.title;

  const started = await recordAndFire({
    client: input.client,
    userId,
    job: 'raise',
    itemId: flag.goalId,
    routine: input.routine,
    fetch: input.fetch,
    text: (runId) =>
      flagRunText({
        runText: goalRunText({ goalId: flag.goalId, goalTitle, userId, runId }),
        userId,
        flag,
        history: flag.thread,
        answer: input.answer,
      }),
  });
  if (!started.ok) return unsaid(started.error);

  if (flag.status === 'open') {
    const moved = await supabase
      .from('raised_items')
      .update({ status: 'answered', answered_at: new Date().toISOString() })
      .eq('id', flag.id)
      .eq('user_id', userId);
    if (moved.error) console.error(`Flag ${flag.id} could not be marked answered: ${moved.error.message}`);
  }
  return { ok: true, message: 'Claude is working on your answer. What it did lands in this thread.' };
}

/** Take one of your answers back out of a flag's thread. False when it was already gone. */
export async function deleteFlagComment(supabase: Db, userId: string, id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('dev_comments')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .not('raised_item_id', 'is', null)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** Put a flag aside without answering it. False when it was not open. */
export async function dismissGoalFlag(supabase: Db, userId: string, id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('raised_items')
    .update({ status: 'dismissed' })
    .eq('id', id)
    .eq('user_id', userId)
    .eq('status', 'open')
    .not('goal_id', 'is', null)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}
