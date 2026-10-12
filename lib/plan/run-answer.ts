/**
 * Your answer to a question a plan run asked partway through (plan #1824).
 * The rules are in lib/core/run-questions.ts: the answer is written as a
 * response line, then the run is woken if its session is still waiting, or
 * continued as a new run with the answer in its brief if the session has
 * stopped.
 */
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { notesRoutine, planRoutine, type RoutineTarget } from '@/lib/feedback/routine';
import { loadRunActivities } from '@/lib/core/run-activities-store';
import {
  ANSWERED,
  NOT_WAITING,
  alreadyAnswered,
  continuationText,
  openQuestion,
  sessionHasLeft,
  type RunQuestion,
} from '@/lib/core/run-questions';
import { latestQuestions, writeResponse } from '@/lib/core/run-questions-store';
import { loadVisionBodies } from '@/lib/specs/vision';
import { QUESTION_RULE, planBrief } from './brief';
import { builderFor, projectPreamble } from './handover';
import { loadPlan } from './load';
import { refFor, stepRef } from './ref';
import type { RunJob } from './run-end';
import { startRoutineRun } from './runs';
import { buildPlanTree, findNode, flatten } from './tree';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public'>;

type WaitingRunRow = {
  id: string;
  status: string;
  stopped_at: string | null;
  plan_item_id: string | null;
  job: string;
  routine_id: string | null;
  created_at: string;
};

export type AnswerOutcome =
  | { ok: true; continued: boolean }
  | { ok: false; error: string };

/** Answer the question a plan run is waiting on. */
export async function answerPlanRun(input: {
  supabase: Db;
  userId: string;
  runId: string;
  answer: string;
}): Promise<AnswerOutcome> {
  const { supabase, userId, runId, answer } = input;
  const { data, error } = await supabase
    .from('plan_runs')
    .select('id, status, stopped_at, plan_item_id, job, routine_id, created_at')
    .eq('id', runId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return { ok: false, error: 'The run could not be read. Try again.' };
  const run = data as WaitingRunRow | null;
  if (!run || run.status !== 'awaiting_input') return { ok: false, error: NOT_WAITING };

  const lines = await loadRunActivities(supabase, runId);
  const question = openQuestion(lines);
  if (!question && alreadyAnswered(lines)) return { ok: false, error: ANSWERED };

  const written = await writeResponse(supabase, { userId, runTable: 'plan_runs', runId, answer });
  if (!written.ok) return written;

  // The session is still there: wake the run, and it reads the answer back.
  if (!sessionHasLeft('plan_runs', run)) {
    await supabase
      .from('plan_runs')
      .update({ status: 'started' })
      .eq('id', runId)
      .eq('user_id', userId)
      .eq('status', 'awaiting_input');
    return { ok: true, continued: false };
  }

  // The session has gone. This run's part is over -- it asked -- so it is
  // closed before the new one starts, and only one press gets to close it.
  const { data: closed } = await supabase
    .from('plan_runs')
    .update({ status: 'finished' })
    .eq('id', runId)
    .eq('user_id', userId)
    .eq('status', 'awaiting_input')
    .select('id');
  if (!closed || closed.length === 0) return { ok: true, continued: false };

  const opening = continuationText({
    runId,
    question: question?.body ?? 'The question was not written as a line.',
    answer,
    lines,
  });
  const fired = await fireContinuation({ supabase, userId, run, opening });
  if (!fired.ok) return { ok: false, error: `Your answer is saved, but the run could not be started again: ${fired.error}` };
  return { ok: true, continued: true };
}

/** The routines a plan run can have been fired on, matched by id. */
function routineOf(routineId: string | null): RoutineTarget {
  for (const routine of [planRoutine(), notesRoutine()]) {
    if (routine.id && routine.id === routineId) return routine;
  }
  return planRoutine();
}

async function fireContinuation(input: {
  supabase: Db;
  userId: string;
  run: WaitingRunRow;
  opening: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, userId, run, opening } = input;
  const job = run.job as RunJob;
  let routine = routineOf(run.routine_id);
  let text = `${opening}\n\nCarry on the ${job} run following .claude/skills/plan/SKILL.md.`;

  if (run.plan_item_id) {
    const sections = buildPlanTree(await loadPlan(supabase, userId));
    const node = findNode(sections, run.plan_item_id);
    if (node) {
      const builder = builderFor(sections, node);
      if (!builder.ok) return { ok: false, error: builder.error };
      routine = builder.routine;
      const alone = flatten([node]).length === 1;
      const how =
        job === 'step' && alone
          ? '.claude/skills/plan/reference/building.md'
          : '.claude/skills/plan/SKILL.md';
      const visions = await loadVisionBodies(supabase, userId);
      text =
        (builder.project ? projectPreamble(builder.project) : '') +
        `${opening}\n\n` +
        `Carry on the ${job} run on plan ${stepRef(node)}, "${node.title}", following ${how}. ` +
        'The brief below is the plan as the app holds it right now, and the plan is the source ' +
        'of truth.\n\n' +
        `${QUESTION_RULE}\n\n` +
        planBrief(sections, node, { thread: true, visions });
    }
  }

  const result = await startRoutineRun({
    supabase,
    userId,
    job,
    routine,
    planItemId: run.plan_item_id,
    text,
  });
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/** How many plan runs are waiting on your answer, for the Inbox tab's badge. Zero on a failed read. */
export async function countPlanRunQuestions(supabase: Db, userId: string): Promise<number> {
  // Never throws: the badge is drawn by the layout of every Dev page, and a
  // read that fails leaves the count out rather than the page.
  try {
    const { count, error } = await supabase
      .from('plan_runs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'awaiting_input');
    return error ? 0 : Math.min(count ?? 0, 50);
  } catch {
    return 0;
  }
}

/** The outlines of these steps by number; empty when the view cannot be read, so they read by number. */
async function outlinesOf(supabase: Db, userId: string, numbers: number[]): Promise<Map<number, string>> {
  if (numbers.length === 0) return new Map();
  try {
    const { data, error } = await supabase
      .from('plan_item_outlines')
      .select('number, outline')
      .eq('user_id', userId)
      .in('number', numbers);
    if (error) return new Map();
    return new Map(((data ?? []) as { number: number; outline: string }[]).map((row) => [row.number, row.outline]));
  } catch {
    return new Map();
  }
}

/** Every plan run waiting on your answer, newest first, as the Dev inbox lists them. */
export async function loadPlanRunQuestions(supabase: Db, userId: string): Promise<RunQuestion[]> {
  const { data, error } = await supabase
    .from('plan_runs')
    .select('id, created_at, job, plan_item:plan_items(number, title)')
    .eq('user_id', userId)
    .eq('status', 'awaiting_input')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    console.error(`Could not read the plan runs waiting on you: ${error.message}`);
    return [];
  }
  const rows = (data ?? []) as unknown as {
    id: string;
    created_at: string;
    job: string;
    plan_item: { number: number; title: string } | null;
  }[];
  const questions = await latestQuestions(supabase, rows.map((row) => row.id));
  const outlines = await outlinesOf(
    supabase,
    userId,
    rows.flatMap((row) => (row.plan_item ? [row.plan_item.number] : [])),
  );
  return rows.map((row) => {
    const line = questions[row.id];
    return {
      runTable: 'plan_runs' as const,
      runId: row.id,
      about: row.plan_item ? `${refFor(row.plan_item.number, outlines)} ${row.plan_item.title}` : `A ${row.job} run`,
      href: row.plan_item ? `/dev/plan/${row.plan_item.number}` : '/dev/raised',
      body: line?.body ?? null,
      options: line?.options ?? null,
      askedAt: line?.created_at ?? row.created_at,
    };
  });
}
