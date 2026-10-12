/**
 * Your answer to a question a goal run asked partway through (plan #1824),
 * the goals half of lib/plan/run-answer.ts. The rules are in
 * lib/core/run-questions.ts: the answer is written as a response line, then
 * the run is woken if its session is still waiting, or continued as a new run
 * through recordAndFire with the answer in its brief if the session set
 * ended_at and left.
 */
import 'server-only';

import { goalsRoutine } from '@/lib/feedback/routine';
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
import type { GoalsSupabaseClient } from './db/schema-name';
import { JOB_LABELS, type RunJob } from './runs';
import { recordAndFire } from './shaping-store';

type WaitingRunRow = {
  id: string;
  status: string;
  ended_at: string | null;
  job: string;
  item_id: string | null;
  area_id: string | null;
};

export type GoalAnswerOutcome = { ok: true; continued: boolean } | { ok: false; error: string };

/** Answer the question a goal run is waiting on. */
export async function answerGoalRun(input: {
  client: GoalsSupabaseClient;
  userId: string;
  runId: string;
  answer: string;
}): Promise<GoalAnswerOutcome> {
  const { client, userId, runId, answer } = input;
  const { data, error } = await client
    .from('runs')
    .select('id, status, ended_at, job, item_id, area_id')
    .eq('id', runId)
    .maybeSingle();
  if (error) return { ok: false, error: 'The run could not be read. Try again.' };
  const run = data as WaitingRunRow | null;
  if (!run || run.status !== 'awaiting_input') return { ok: false, error: NOT_WAITING };

  const lines = await loadRunActivities(client, runId);
  const question = openQuestion(lines);
  if (!question && alreadyAnswered(lines)) return { ok: false, error: ANSWERED };

  const written = await writeResponse(client, { userId, runTable: 'goals.runs', runId, answer });
  if (!written.ok) return written;

  if (!sessionHasLeft('goals.runs', run)) {
    await client
      .from('runs')
      .update({ status: 'started' })
      .eq('id', runId)
      .eq('status', 'awaiting_input');
    return { ok: true, continued: false };
  }

  const { data: closed } = await client
    .from('runs')
    .update({ status: 'done', summary: 'Stopped to ask you a question; carried on in a new run.' })
    .eq('id', runId)
    .eq('status', 'awaiting_input')
    .select('id');
  if (!closed || closed.length === 0) return { ok: true, continued: false };

  const opening = continuationText({
    runId,
    question: question?.body ?? 'The question was not written as a line.',
    answer,
    lines,
  });
  const job = run.job as RunJob;
  const fired = await recordAndFire({
    client,
    userId,
    job,
    itemId: run.item_id,
    areaId: run.area_id,
    routine: goalsRoutine(),
    text: (newRunId) =>
      [
        opening,
        '',
        `Carry on the ${job} job following .claude/skills/goals/SKILL.md` +
          (run.item_id ? `, on goals.items id ${run.item_id}` : '') +
          (run.area_id ? `, on goals.areas id ${run.area_id}` : '') +
          '.',
        '',
        `The goals belong to user_id ${userId}. This run is goals.runs id ${newRunId},`,
        'already written as started. Set goals.run_id to it on every write, and close that row',
        'with a summary (or as failed, with the reason) before you stop.',
      ].join('\n'),
  });
  if (!fired.ok) {
    return { ok: false, error: `Your answer is saved, but the run could not be started again: ${fired.error}` };
  }
  return { ok: true, continued: true };
}

/** Every goal run waiting on your answer, newest first, as the Goals inbox lists them. */
export async function loadGoalRunQuestions(client: GoalsSupabaseClient): Promise<RunQuestion[]> {
  const { data, error } = await client
    .from('runs')
    .select('id, job, created_at, item:items!runs_item_fk(title), area:areas!runs_area_fk(name)')
    .eq('status', 'awaiting_input')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    console.error(`Could not read the goal runs waiting on you: ${error.message}`);
    return [];
  }
  const rows = (data ?? []) as unknown as {
    id: string;
    job: string;
    created_at: string;
    item: { title: string } | null;
    area: { name: string } | null;
  }[];
  const questions = await latestQuestions(client, rows.map((row) => row.id));
  return rows.map((row) => {
    const line = questions[row.id];
    return {
      runTable: 'goals.runs' as const,
      runId: row.id,
      about: row.item?.title ?? row.area?.name ?? JOB_LABELS[row.job as RunJob] ?? 'A goals run',
      href: `/goals/runs/${row.id}`,
      body: line?.body ?? null,
      options: line?.options ?? null,
      askedAt: line?.created_at ?? row.created_at,
    };
  });
}
