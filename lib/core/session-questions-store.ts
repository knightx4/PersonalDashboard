import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { RUN_ACTIVITY_COLUMNS, runActivityFrom, type RunActivity } from '@/lib/core/run-activities';
import { RUN_ANSWER_MAX } from '@/lib/core/run-questions';
import { writeResponse } from '@/lib/core/run-questions-store';
import {
  LISTED_DAYS,
  answeredSince,
  optionsOf,
  routeOf,
  type SessionQuestion,
  type SessionRoute,
} from '@/lib/core/session-questions';
import { refFor } from '@/lib/plan/ref';
import { answerPlanRun } from '@/lib/plan/run-answer';

/**
 * The reads and writes behind a session's question in the Goals Inbox (plan
 * #2800.4). The rules are in lib/core/session-questions.ts. Every call goes
 * through the signed-in client, so the progress, thread and run rows are the
 * person's own by their policies, and each query names the person as well.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the plan's loaders take the untyped client
type Db = SupabaseClient<any, 'public'>;

type ProgressRow = {
  id: string;
  plan_item_id: string | null;
  plan_run_id: string | null;
  thread_id: string | null;
  project: string | null;
  action: string;
  needs: string | null;
  updated_at: string;
};

type MessageRow = {
  thread_id: string;
  author: string;
  kind: string;
  body: string;
  options: unknown;
  answer: string | null;
  answered_at: string | null;
  created_at: string;
};

const PROGRESS_COLUMNS = 'id, plan_item_id, plan_run_id, thread_id, project, action, needs, updated_at';
const MESSAGE_COLUMNS = 'thread_id, author, kind, body, options, answer, answered_at, created_at';

/** Every question a session is waiting on you for, newest first. Never throws: the Inbox is worth reading without them. */
export async function loadSessionQuestions(
  supabase: Db,
  userId: string,
  now: number = Date.now(),
): Promise<SessionQuestion[]> {
  try {
    const since = new Date(now - LISTED_DAYS * 86_400_000).toISOString();
    const { data, error } = await supabase
      .schema('core')
      .from('session_progress')
      .select(PROGRESS_COLUMNS)
      .eq('user_id', userId)
      .eq('state', 'waiting')
      .gte('updated_at', since)
      .order('updated_at', { ascending: false })
      .limit(30);
    if (error) {
      console.error(`Could not read the sessions waiting on you: ${error.message}`);
      return [];
    }
    const rows = (data ?? []) as ProgressRow[];
    if (rows.length === 0) return [];

    const itemIds = [...new Set(rows.flatMap((row) => (row.plan_item_id ? [row.plan_item_id] : [])))];
    const runIds = [...new Set(rows.flatMap((row) => (row.plan_run_id && !row.thread_id ? [row.plan_run_id] : [])))];
    const threadIds = [...new Set(rows.flatMap((row) => (row.thread_id ? [row.thread_id] : [])))];
    const [steps, lines, threads, messages] = await Promise.all([
      stepNames(supabase, userId, itemIds),
      runLines(supabase, runIds),
      threadTitles(supabase, userId, threadIds),
      threadMessages(supabase, userId, threadIds),
    ]);

    const questions: SessionQuestion[] = [];
    for (const row of rows) {
      const route = routeOf({ threadId: row.thread_id, planRunId: row.plan_run_id });
      const step = row.plan_item_id ? steps.get(row.plan_item_id) : undefined;
      let body = row.needs ?? row.action;
      let options: string[] | null = null;

      if (route === 'thread' && row.thread_id) {
        const written = messages.get(row.thread_id) ?? [];
        // Anything the person wrote since the report has answered it.
        if (answeredSince(row.updated_at, written.flatMap((m) => (m.author === 'person' ? [m.created_at, m.answered_at] : [m.answered_at])))) {
          continue;
        }
        const open = [...written].reverse().find((m) => m.kind === 'question' && m.answer === null);
        if (open) {
          body = open.body.trim() || body;
          options = optionsOf(open.options);
        }
      } else if (route === 'plan_run' && row.plan_run_id) {
        const run = lines.get(row.plan_run_id) ?? [];
        if (answeredSince(row.updated_at, run.filter((l) => l.kind === 'response').map((l) => l.created_at))) continue;
        const question = [...run].reverse().find((l) => l.kind === 'question');
        // A question line older than the report is an earlier ask.
        if (question && Date.parse(question.created_at) >= Date.parse(row.updated_at) - 120_000) {
          body = question.body.trim() || body;
          options = question.options && question.options.length > 0 ? question.options : null;
        }
      }

      questions.push({
        id: row.id,
        about:
          step?.name ??
          (row.thread_id ? threads.get(row.thread_id) : undefined) ??
          (row.project ? `Project ${row.project}` : 'A session'),
        href: step ? step.href : row.thread_id ? `/ask?thread=${encodeURIComponent(row.thread_id)}` : row.project ? `/dev/projects/${row.project}` : '/dev/plan',
        body,
        options,
        askedAt: row.updated_at,
        route,
      });
    }
    return questions;
  } catch (error) {
    console.error('Could not read the sessions waiting on you', error);
    return [];
  }
}

/** How many sessions wait on you, for the Inbox badge. */
export async function countSessionQuestions(supabase: Db, userId: string): Promise<number> {
  return (await loadSessionQuestions(supabase, userId)).length;
}

export async function stepNames(supabase: Db, userId: string, ids: string[]): Promise<Map<string, { name: string; href: string }>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase.from('plan_items').select('id, number, title').eq('user_id', userId).in('id', ids);
  const items = (data ?? []) as { id: string; number: number; title: string }[];
  const outlines = new Map<number, string>();
  if (items.length > 0) {
    const { data: rows } = await supabase
      .from('plan_item_outlines')
      .select('number, outline')
      .eq('user_id', userId)
      .in('number', items.map((item) => item.number));
    for (const row of (rows ?? []) as { number: number; outline: string }[]) outlines.set(row.number, row.outline);
  }
  return new Map(
    items.map((item) => [
      item.id,
      { name: `${refFor(item.number, outlines)} ${item.title}`, href: `/dev/plan/${item.number}` },
    ]),
  );
}

async function runLines(supabase: Db, runIds: string[]): Promise<Map<string, RunActivity[]>> {
  const out = new Map<string, RunActivity[]>();
  if (runIds.length === 0) return out;
  const { data } = await supabase
    .schema('core')
    .from('run_activities')
    .select(RUN_ACTIVITY_COLUMNS)
    .in('run_id', runIds)
    .in('kind', ['question', 'response'])
    .order('created_at', { ascending: true });
  for (const raw of (data ?? []) as Record<string, unknown>[]) {
    const line = runActivityFrom(raw);
    if (line) out.set(line.run_id, [...(out.get(line.run_id) ?? []), line]);
  }
  return out;
}

async function threadTitles(supabase: Db, userId: string, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase.schema('core').from('session_threads').select('id, title').eq('user_id', userId).in('id', ids);
  return new Map(((data ?? []) as { id: string; title: string }[]).map((row) => [row.id, row.title]));
}

async function threadMessages(supabase: Db, userId: string, ids: string[]): Promise<Map<string, MessageRow[]>> {
  const out = new Map<string, MessageRow[]>();
  if (ids.length === 0) return out;
  const { data } = await supabase
    .schema('core')
    .from('session_messages')
    .select(MESSAGE_COLUMNS)
    .eq('user_id', userId)
    .in('thread_id', ids)
    .order('created_at', { ascending: true })
    .limit(500);
  for (const row of (data ?? []) as MessageRow[]) out.set(row.thread_id, [...(out.get(row.thread_id) ?? []), row]);
  return out;
}

export type SessionAnswerOutcome = { ok: true; route: SessionRoute; continued: boolean } | { ok: false; error: string };

export const NOT_REACHABLE = 'This session left no way to answer it from here. Open its work and answer there.';

/**
 * Send your answer back to the session that is waiting, the way its report
 * says it can be reached (see lib/core/session-questions.ts).
 */
export async function answerSessionQuestion(input: {
  supabase: Db;
  userId: string;
  progressId: string;
  answer: string;
}): Promise<SessionAnswerOutcome> {
  const { supabase, userId, progressId } = input;
  const answer = input.answer.trim();
  if (!answer) return { ok: false, error: 'Pick a choice or write an answer.' };
  if (answer.length > RUN_ANSWER_MAX) return { ok: false, error: `Keep the answer under ${RUN_ANSWER_MAX} characters.` };

  const { data, error } = await supabase
    .schema('core')
    .from('session_progress')
    .select(PROGRESS_COLUMNS + ', state')
    .eq('id', progressId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return { ok: false, error: 'The question could not be read. Try again.' };
  const row = data as (ProgressRow & { state: string }) | null;
  if (!row || row.state !== 'waiting') {
    return { ok: false, error: 'This session is not waiting on you any more. Reload to see where it stands.' };
  }
  const route = routeOf({ threadId: row.thread_id, planRunId: row.plan_run_id });

  if (route === 'thread' && row.thread_id) return answerInThread(supabase, userId, row, answer);
  if (route === 'plan_run' && row.plan_run_id) return answerOnRun(supabase, userId, row, answer);
  return { ok: false, error: NOT_REACHABLE };
}

async function answerInThread(
  supabase: Db,
  userId: string,
  row: ProgressRow,
  answer: string,
): Promise<SessionAnswerOutcome> {
  const core = supabase.schema('core');
  const threadId = row.thread_id as string;
  const { data: thread } = await core
    .from('session_threads')
    .select('id, state')
    .eq('id', threadId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!thread) return { ok: false, error: 'Its thread could not be found.' };

  const { data: open } = await core
    .from('session_messages')
    .select('id')
    .eq('user_id', userId)
    .eq('thread_id', threadId)
    .eq('kind', 'question')
    .is('answer', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const question = open as { id: string } | null;

  if (question) {
    // Only an unanswered question takes the answer, so a second press does not overwrite the first.
    const { data: updated, error } = await core
      .from('session_messages')
      .update({ answer, answered_at: new Date().toISOString() })
      .eq('id', question.id)
      .eq('user_id', userId)
      .is('answer', null)
      .select('id');
    if (error) return { ok: false, error: 'Your answer could not be saved. Try again.' };
    if (!updated || updated.length === 0) return { ok: false, error: 'This question already has your answer. Reload to see where it stands.' };
  } else {
    const { error } = await core
      .from('session_messages')
      .insert({ user_id: userId, thread_id: threadId, author: 'person', kind: 'text', body: answer });
    if (error) return { ok: false, error: 'Your answer could not be saved. Try again.' };
  }
  await core.from('session_threads').update({ state: 'working' }).eq('id', threadId).eq('user_id', userId).eq('state', 'waiting');
  return { ok: true, route: 'thread', continued: false };
}

async function answerOnRun(supabase: Db, userId: string, row: ProgressRow, answer: string): Promise<SessionAnswerOutcome> {
  const runId = row.plan_run_id as string;
  const { data: run } = await supabase.from('plan_runs').select('id, status').eq('id', runId).eq('user_id', userId).maybeSingle();
  if (!run) return { ok: false, error: 'Its run could not be found.' };

  // A run parked on a question is answered as every run question is.
  if ((run as { status: string }).status === 'awaiting_input') {
    const outcome = await answerPlanRun({ supabase, userId, runId, answer });
    return outcome.ok ? { ok: true, route: 'plan_run', continued: outcome.continued } : outcome;
  }

  // The session reported it was waiting without parking the run. The run
  // holds the question as a line, so `plan.ts response` finds the answer.
  const lines = await runLines(supabase, [runId]);
  const mine = lines.get(runId) ?? [];
  const last = [...mine].reverse().find((l) => l.kind === 'question');
  if (!last || Date.parse(last.created_at) < Date.parse(row.updated_at) - 120_000) {
    const { error } = await supabase.schema('core').from('run_activities').insert({
      user_id: userId,
      run_table: 'plan_runs',
      run_id: runId,
      kind: 'question',
      body: (row.needs ?? row.action).slice(0, 4000),
    });
    if (error) return { ok: false, error: 'Your answer could not be saved. Try again.' };
  }
  const written = await writeResponse(supabase, { userId, runTable: 'plan_runs', runId, answer });
  return written.ok ? { ok: true, route: 'plan_run', continued: false } : written;
}
