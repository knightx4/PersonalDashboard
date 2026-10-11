/**
 * What happens when a comment on a goal or a step is addressed to Dash
 * (plan #957).
 *
 * Read the goal, reply through the shared loop (lib/dash/thread.ts, plan
 * #1465) with Ask Dash's lookups and writes and the goal's own tools, and
 * write the reply into the same thread as `claude`. The goal's own tools file
 * facts into its collections as drafts (file_goal_record), date a step or put
 * it on Todo (schedule_goal_step), take the step (take_step), or pass the
 * comment to the goals routine when it needs more, research, email or
 * changing the steps (pass_to_routine), whose reply lands in the thread later.
 *
 * A comment on a step telling Claude to take it ("@dash draft this for me")
 * hands that step over (plan #1003) through the same hand-over as the row's
 * Ask Dash, lib/goals/handover-store.ts, with the job askDash picks, so it
 * refuses what the row refuses and the thread says why. A phase with nothing of Claude's in it goes
 * to the goals routine instead, which adds the step the comment asks for.
 *
 * The same shape as lib/comments/ask.ts for the dev pages, and the same rule:
 * every outcome the person can see is written into the thread, including the
 * ones where nothing could be done, because a question that went nowhere
 * silently looks the same as one being worked on.
 *
 * Each draft filed and each change to a step's date or Todo is recorded in
 * core.dash_actions alongside the write (plan #1459), so it can be undone
 * while nobody has changed the row since.
 */
import { SEEN_MESSAGE } from '@/lib/comments/awaiting';
import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import type { Schedule } from '@/lib/goals/comments';
import { DASH_MODELS } from '@/lib/dash/models';
import type { DashThreadActs } from '@/lib/dash/registry';
import { replyInThread, subjectLine, threadVoice, type ThreadDash, type ThreadHandOff } from '@/lib/dash/thread';
import { GOAL_THREAD_TABLE } from '@/lib/dash/thread-tools';
import { readSubjectOrNull, recordDashAction, type DashActionDeps } from '@/lib/core/dash-actions';
import { toRef } from '@/lib/core/refs';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSessionSpend } from '@/lib/core/spend/session';
import { resolveRoutineId, type RoutineTarget } from '@/lib/feedback/routine';
import { checkRecord } from '@/lib/goals/collections';
import { addRecord, loadCollectionsForGoal, loadInformation } from '@/lib/goals/collections-store';
import {
  commentRunText,
  FILINGS_MAX,
  goalReplyMessage,
  parseGoalReply,
  replyBody,
  scheduleSaid,
  type ReplyCollection,
} from '@/lib/goals/comments';
import { loadThreads, writeComment } from '@/lib/goals/comments-store';
import { acknowledgeThreadTurn } from '@/lib/thread/store';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { commentMode, hasClaudeWork, jobFor, locateStep } from '@/lib/goals/handover';
import { sendGoalStep } from '@/lib/goals/handover-store';
import { goalRunText, runInFlight } from '@/lib/goals/shaping';
import { loadShaping, recordAndFire } from '@/lib/goals/shaping-store';
import { loadGoalMap, setStepOnTodo, updateStep } from '@/lib/goals/steps-store';

export type GoalAskInput = {
  /** Your own client: reads, and the run row. */
  client: GoalsSupabaseClient;
  /** The same session made as the `claude` actor: the reply and the drafts it files. */
  claude: GoalsSupabaseClient;
  userId: string;
  today: string;
  goalId: string;
  /** The goal or step the comment is on. */
  itemId: string;
  itemTitle: string;
  /** The comment carrying the question, left out of the history. */
  commentId: string;
  question: string;
  apiKey: string | null;
  /** Whether this account may spend the owner's routine allowance. */
  canRun: boolean;
  routine: RoutineTarget;
  /** The person's clients, for recording what the reply files in core.dash_actions. */
  dash: DashActionDeps;
  /** The person's lookups and writes, for the shared loop (threadDashInRequest). */
  dashThread: ThreadDash;
  /** For tests: the model client. */
  anthropic?: Anthropic;
};

/** The model a goal reply is written with (Sonnet since plan #1465). */
export const GOAL_REPLY_MODEL = DASH_MODELS.goalThread;

/** What a reply on a goal is told, after the rules every thread shares. */
const GOAL_RULES = `THIS THREAD IS ON A GOAL, or on a step under one, in their goals tracker.
The message gives the goal written out: its steps, the collections of facts it
fills (each with a ref like c1, its fields and what is filled in so far), and
the conversation on the row so far. A question about the goal, a step, an
option or what to do next is answered from that.

The goal's own tools:

- file_goal_record. When the comment gives values that belong in one of the
  collections listed (a loan's balance, rate or servicer, for example), file
  them: one call per record, with the collection ref and the values keyed by
  the field keys listed, each in the stored form given. File only what the
  comment states. A collection that holds a single record and already has one
  cannot take another. What you filed is added under your reply.
- schedule_goal_step. A comment on a step that gives it a due date, or asks
  for it on their todo list, is done by you now: due_on as YYYY-MM-DD (work the
  year out from today's date, and pick the next occurrence of a date with no
  year), on_todo true or false. Putting a step on Todo works only for an open
  step of theirs. Do not tell them to set a date or a Todo flag themselves. On
  the goal itself there is no step to date, so say so.
- take_step. When a comment on a step tells you to do that step or get it
  ready ("do this", "draft this for me", "write the email for this", "review
  my resume", "you do it"), take it. A step of Claude's is worked and closed; a
  step of theirs gets what they need and stays theirs. On the goal itself
  there is no one step to take, so asking you to work on the whole goal is
  pass_to_routine instead.
- pass_to_routine. When the comment needs more than one reply from what is
  here and the lookups: research on the web, reading their email at length,
  changing the steps (adding, splitting, dropping, rewording), or watching a
  price on a page outside the app. The goals routine picks it up and replies in
  the same thread, so say in one sentence that you have passed it on.

What stays theirs, however the comment is phrased: answering a question
Claude asked them, approving a goal or a proposal, marking a step of theirs
done or dropping it, and deleting anything. Asked for one of those, say in one
sentence that it is theirs, and where on the goal's page it is done. Doing the
work a step asks for is never on that list.`;

export type GoalAskOutcome = { ok: true; message: string } | { ok: false; error: string };

async function say(input: GoalAskInput, body: string): Promise<void> {
  await writeComment(input.claude, {
    userId: input.userId,
    itemId: input.itemId,
    author: 'claude',
    body,
  });
}

export async function askDashOnGoal(input: GoalAskInput): Promise<GoalAskOutcome> {
  try {
    return await produceReply(input);
  } catch (error) {
    const why =
      'Something went wrong on the way to a reply: ' +
      `${error instanceof Error ? error.message : 'no reason given'}. Your comment is saved.`;
    try {
      await say(input, why);
    } catch {
      /* the action's own message is the only copy left */
    }
    return { ok: false, error: why };
  }
}

async function produceReply(input: GoalAskInput): Promise<GoalAskOutcome> {
  const map = await loadGoalMap(input.client, input.goalId, {
    userId: input.userId,
    today: input.today,
  });
  if (!map)
    return { ok: false, error: 'That goal is no longer on the page, so nothing was asked.' };

  // The collections the goal serves and the ones its information steps fill,
  // which are usually the same ones.
  const served = await loadCollectionsForGoal(input.client, input.goalId);
  const extra = served.filter((c) => !map.information[c.id]).map((c) => c.id);
  const information = { ...map.information, ...(await loadInformation(input.client, extra)) };
  const collections: ReplyCollection[] = Object.values(information).map(
    ({ collection, records }) => ({
      id: collection.id,
      name: collection.name,
      shape: collection.shape,
      fields: collection.fields,
      records: records.map((r) => ({ data: r.data, draft: r.draft })),
    }),
  );

  const threads = await loadThreads(input.client, [input.itemId]);
  const history = (threads[input.itemId] ?? []).filter((c) => c.id !== input.commentId);
  const { message, refs } = goalReplyMessage(
    { goal: map.goal, steps: map.steps, collections, itemId: input.itemId, today: input.today },
    history,
    input.question,
  );

  if (!input.apiKey) {
    const why =
      'No ANTHROPIC_API_KEY on the deployment, so I cannot answer. Your comment is saved.';
    await say(input, why);
    return { ok: false, error: why };
  }

  let filed = 0;
  let scheduled = false;
  const fileRecord = async (args: unknown): ReturnType<DashThreadActs> => {
    if (filed >= FILINGS_MAX) return { ok: false, error: `One reply files at most ${FILINGS_MAX} records.` };
    const parsed = parseGoalReply({ needs_routine: false, file: [args] }, refs);
    const filing = parsed.kind === 'answer' ? parsed.filings[0] : undefined;
    if (!filing) {
      return { ok: false, error: 'That names no collection listed, or fills none of its fields, so nothing was filed.' };
    }
    const { collection } = filing;
    if (collection.shape === 'one' && collection.records.length > 0) {
      return { ok: false, error: `${collection.name} holds one record and already has it. Say it can be corrected on the step.` };
    }
    const written = await addRecord(
      input.claude,
      input.userId,
      collection.id,
      filing.values,
      { kind: 'comment', ref: input.commentId, draft: true },
      collection.records.length,
    );
    if (!written.ok) return { ok: false, error: `Not filed into ${collection.name}: ${written.error}` };
    await recordDashAction(input.dash, {
      surface: 'thread',
      kind: 'file_goal_record',
      subjectRef: toRef('goals.records', written.value),
      op: 'insert',
      summary: `Filed a draft in ${collection.name}, from a comment on "${input.itemTitle}".`,
    });
    // The values in the stored form addRecord kept them in, so the reply
    // shows $12,450.37 rather than whatever the model wrote.
    const stored = checkRecord(collection.fields, filing.values, null);
    collection.records.push({ data: {}, draft: true });
    filed += 1;
    return {
      ok: true,
      recorded: true,
      kind: 'file_goal_record',
      said: replyBody('', [{ ok: true, collection, data: stored.ok ? stored.data : {} }]),
    };
  };

  const schedule = async (args: unknown): ReturnType<DashThreadActs> => {
    const parsed = parseGoalReply({ needs_routine: false, schedule: args }, refs);
    const asked = parsed.kind === 'answer' ? parsed.schedule : null;
    if (!asked) return { ok: false, error: 'That gives no date and no Todo change, so nothing was changed.' };
    const done = await applySchedule(input, asked);
    if (!done.changed) return { ok: false, error: done.said };
    scheduled = true;
    return { ok: true, recorded: true, kind: 'schedule_goal_step', said: done.said };
  };

  const handOff = async (name: string, args: unknown): Promise<ThreadHandOff> => {
    if (name === 'pass_to_routine') {
      const raw = args && typeof args === 'object' ? (args as { why?: unknown }) : {};
      const why = typeof raw.why === 'string' && raw.why.trim() ? raw.why.trim() : 'This needs a longer look than one reply.';
      return handToRoutine(input, history, why);
    }
    if (name === 'take_step') return takeStep(input, map, history);
    return { ok: false, error: 'That cannot be done on a goal.' };
  };

  const spend: SpendReport[] = [];
  const subjectRef = toRef(GOAL_THREAD_TABLE, input.itemId);
  const reply = await replyInThread({
    voice: threadVoice(GOAL_REPLY_MODEL, GOAL_RULES, GOAL_THREAD_TABLE),
    subject: { ref: subjectRef, title: input.itemTitle },
    message: `${subjectLine(subjectRef)} The goal is goals.items ref ${input.goalId}.\n\n${message}`,
    dash: input.dashThread,
    acts: async (name, args) =>
      name === 'file_goal_record'
        ? fileRecord(args)
        : name === 'schedule_goal_step'
          ? schedule(args)
          : { ok: false, error: 'That cannot be done on a goal.' },
    handOff,
    acknowledge: () =>
      acknowledgeThreadTurn(input.claude, { userId: input.userId, ref: subjectRef, turnId: input.commentId }),
    anthropicApiKey: input.apiKey,
    client: input.anthropic,
    onSpend: (report) => spend.push(report),
  });
  await recordSessionSpend(
    input.userId,
    { module: 'goals', operation: 'reply-to-goal-comment' },
    spend,
  );

  if (!reply.ok) {
    const why = `I could not produce a reply: ${reply.detail} Your comment is saved.`;
    await say(input, why);
    return { ok: false, error: why };
  }
  // The routine has it and its reply is the next thing in the thread; Dash's
  // own sentence saying so is not written unless it changed something too.
  if (reply.passedOn && reply.made.length === 0) {
    return { ok: true, message: 'Dash is working on this goal. Its reply lands in this thread.' };
  }
  if (reply.acknowledged) return { ok: true, message: SEEN_MESSAGE };

  await say(input, reply.body);
  return {
    ok: true,
    message:
      filed > 0 || scheduled
        ? 'Answered, and filed as drafts.'
        : reply.made.length > 0
          ? 'Done, and said in the thread.'
          : 'Answered in the thread.',
  };
}

/**
 * Take the step the comment is on (plan #1003): a step of yours to prepare,
 * anything else to work. On the goal itself, or a phase of only your own
 * steps, it is new work for the goals routine instead.
 */
async function takeStep(
  input: GoalAskInput,
  map: NonNullable<Awaited<ReturnType<typeof loadGoalMap>>>,
  history: Parameters<typeof commentRunText>[0]['thread'],
): Promise<ThreadHandOff> {
  const located =
    input.itemId === input.goalId
      ? null
      : locateStep(
          { id: map.goal.id, title: map.goal.title, acceptance: null, status: map.goal.status, approvedAt: null },
          map.steps,
          input.itemId,
        );
  // On the goal itself there is no one step to take: that is a goal run, as
  // Ask Dash on the goal starts. commentMode reads askDash for a step, so a
  // comment and the row's Ask Dash choose the same job.
  if (!located) return handToRoutine(input, history, 'You asked Dash to work on the goal.');
  const mode = commentMode(located.step);
  // A phase of only your own steps gives a phase run nothing to do, so
  // "review it for me" there is new work: a Dash step the routine adds.
  if (jobFor(located.step, mode) === 'phase' && !hasClaudeWork(located.step)) {
    return handToRoutine(
      input,
      history,
      'You asked Dash to do work in a phase that holds only your own steps, so it needs a Dash step added for it.',
    );
  }
  return sendFromComment(input, mode, history);
}

/**
 * Date the step the comment is on, and put it on Todo or take it off.
 *
 * Both are the person's own settings on their own step, one write each through
 * the same functions the row's date field and Show on Todo use, so a step that
 * cannot go on Todo (it is Dash's, or closed) is refused here as it is there.
 * The sentence says what changed, and what did not.
 */
async function applySchedule(
  input: GoalAskInput,
  schedule: Schedule,
): Promise<{ said: string; changed: boolean }> {
  if (input.itemId === input.goalId) {
    return {
      said: 'Dates and Todo belong to a step, and this comment is on the goal. Write it on the step.',
      changed: false,
    };
  }
  let dated: boolean | null = null;
  let todo: boolean | null = null;
  const ref = toRef('goals.items', input.itemId);
  const before = await readSubjectOrNull(input.dash, ref);
  try {
    if (schedule.dueOn !== undefined) {
      dated = await updateStep(input.client, input.itemId, { due_on: schedule.dueOn });
    }
    if (schedule.onTodo !== undefined) {
      todo = await setStepOnTodo(input.client, input.itemId, schedule.onTodo);
    }
  } catch (error) {
    return {
      said: `I could not change it: ${error instanceof Error ? error.message : 'no reason given'}.`,
      changed: false,
    };
  } finally {
    // Whatever landed, even when the second write failed after the first.
    if (dated || todo) {
      const did = [
        dated ? `set the due date on "${input.itemTitle}"` : null,
        todo
          ? `${schedule.onTodo ? 'put' : 'took'} ${dated ? 'it' : `"${input.itemTitle}"`} ${schedule.onTodo ? 'on' : 'off'} Todo`
          : null,
      ].filter(Boolean);
      const sentence = did.join(' and ');
      await recordDashAction(input.dash, {
        surface: 'thread',
        kind: 'schedule_goal_step',
        subjectRef: ref,
        op: 'update',
        beforeValues: before,
        summary: `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`,
      });
    }
  }
  return { said: scheduleSaid(schedule, { dated, todo }), changed: dated === true || todo === true };
}

/** Why the goals routine cannot be started from here, or null when it can. */
function routineUnavailable(input: GoalAskInput): string | null {
  if (!input.canRun) {
    return 'That needs the goals routine, and only the account that owns this app can start one.';
  }
  if (!resolveRoutineId(input.routine.id)) {
    return (
      'That needs the goals routine, and none is set on this deployment ' +
      '(CLAUDE_GOALS_ROUTINE_ID and CLAUDE_GOALS_ROUTINE_TOKEN).'
    );
  }
  return null;
}

/**
 * Hand the step the comment is on to Claude (plan #1003): a step of yours to
 * prepare, anything else to work. The hand-over refuses what the row's
 * buttons refuse, and Dash's reply says which; what was started is said
 * under the reply in these words.
 */
async function sendFromComment(
  input: GoalAskInput,
  mode: ReturnType<typeof commentMode>,
  history: readonly { author: string; body: string }[],
): Promise<ThreadHandOff> {
  const cannot = routineUnavailable(input);
  if (cannot) return { ok: false, error: `It was not started. ${cannot}` };

  const sent = await sendGoalStep({
    client: input.client,
    userId: input.userId,
    stepId: input.itemId,
    routine: input.routine,
    surface: 'thread',
    mode,
    asked: input.question,
    thread: history.map(({ author, body }) => ({ author, body })),
  });
  if (!sent.ok) return { ok: false, error: `It was not started: ${sent.error}` };

  const said =
    sent.job === 'prepare'
      ? `Dash is preparing "${sent.title}" for you. What it writes will show on the step, which stays yours.`
      : sent.job === 'phase'
        ? `Dash is working on the phase "${sent.title}". What it produces will show on its steps.`
        : `Dash is working on "${sent.title}". What it produces will show on the step when it is done.`;
  return { ok: true, note: 'Started.', said };
}

/**
 * Fire the goals routine on the goal, with the comment in its brief. When it
 * could not be started, Dash's reply says why. When it was, the page says
 * Dash is working on the goal, and the routine's reply is the next thing in
 * the thread.
 */
async function handToRoutine(
  input: GoalAskInput,
  history: Parameters<typeof commentRunText>[0]['thread'],
  why: string,
): Promise<ThreadHandOff> {
  const refuse = (said: string): ThreadHandOff => ({ ok: false, error: said });

  const cannot = routineUnavailable(input);
  if (cannot) return refuse(`${why} ${cannot}`);
  const { lastRun } = await loadShaping(input.client, input.goalId);
  if (runInFlight(lastRun, Date.now())) {
    return refuse(
      `${why} Dash is already working on this goal, and that run will not see this comment. ` +
        'Ask again once it finishes.',
    );
  }

  const { data: goal } = await input.client
    .from('items')
    .select('title, errand, due_on')
    .eq('id', input.goalId)
    .maybeSingle();
  const goalTitle = (goal?.title as string | undefined) ?? input.itemTitle;
  // An errand is briefed as one on every run, a comment's included (plan #1263).
  const errandDueOn = goal?.errand ? (goal.due_on as string | null) : null;

  const started = await recordAndFire({
    client: input.client,
    userId: input.userId,
    job: 'goal',
    itemId: input.goalId,
    routine: input.routine,
    text: (runId) =>
      commentRunText({
        runText: goalRunText({
          goalId: input.goalId,
          goalTitle,
          userId: input.userId,
          runId,
          errandDueOn,
        }),
        userId: input.userId,
        itemId: input.itemId,
        itemTitle: input.itemTitle,
        onGoal: input.itemId === input.goalId,
        thread: history,
        question: input.question,
        why,
      }),
  });
  if (!started.ok) return refuse(`${why} I could not start the goals routine: ${started.error}`);

  return {
    ok: true,
    passedOn: true,
    note: 'The goals routine has it and replies in this thread. Say in one sentence that you passed it on.',
  };
}
