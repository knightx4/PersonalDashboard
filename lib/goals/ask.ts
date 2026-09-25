/**
 * What happens when a comment on a goal or a step is addressed to Dash
 * (plan #957).
 *
 * Read the goal, try the fast reply, file any facts it found, and write the
 * reply into the same thread as `claude`. When the fast reply says the comment
 * needs more (research, email, changing the steps), the goals routine is fired
 * on the goal and its reply lands in the thread later.
 *
 * A comment on a step telling Claude to take it ("@dash draft this for me")
 * hands that step over (plan #1003) through the same hand-over as the row's
 * Send and Prepare, lib/goals/handover-store.ts, so it refuses what they
 * refuse and the thread says why.
 *
 * The same shape as lib/comments/ask.ts for the dev pages, and the same rule:
 * every outcome the person can see is written into the thread, including the
 * ones where nothing could be done, because a question that went nowhere
 * silently looks the same as one being worked on.
 */
import 'server-only';

import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSessionSpend } from '@/lib/core/spend/session';
import { resolveRoutineId, type RoutineTarget } from '@/lib/feedback/routine';
import { checkRecord } from '@/lib/goals/collections';
import { addRecord, loadCollectionsForGoal, loadInformation } from '@/lib/goals/collections-store';
import {
  commentRunText,
  goalReplyMessage,
  parseGoalReply,
  replyBody,
  type FilingOutcome,
  type ReplyCollection,
} from '@/lib/goals/comments';
import { askGoalReplyModel } from '@/lib/goals/comment-model';
import { loadThreads, writeComment } from '@/lib/goals/comments-store';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { commentMode, locateStep } from '@/lib/goals/handover';
import { sendGoalStep } from '@/lib/goals/handover-store';
import { goalRunText, runInFlight } from '@/lib/goals/shaping';
import { loadShaping, recordAndFire } from '@/lib/goals/shaping-store';
import { loadGoalMap } from '@/lib/goals/steps-store';

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
};

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
    { goal: map.goal, steps: map.steps, collections, itemId: input.itemId },
    history,
    input.question,
  );

  if (!input.apiKey) {
    const why =
      'No ANTHROPIC_API_KEY on the deployment, so I cannot answer. Your comment is saved.';
    await say(input, why);
    return { ok: false, error: why };
  }

  const spend: SpendReport[] = [];
  const asked = await askGoalReplyModel(
    { apiKey: input.apiKey, onSpend: (report) => spend.push(report) },
    message,
  );
  await recordSessionSpend(
    input.userId,
    { module: 'goals', operation: 'reply-to-goal-comment' },
    spend,
  );

  if (!asked.ok) {
    const why = `I could not produce a reply: ${asked.error} Your comment is saved.`;
    await say(input, why);
    return { ok: false, error: why };
  }

  const reply = parseGoalReply(asked.input, refs);
  if (reply.kind === 'error') {
    const why = `I could not produce a reply: ${reply.error} Your comment is saved.`;
    await say(input, why);
    return { ok: false, error: why };
  }
  if (reply.kind === 'routine') return handToRoutine(input, history, reply.why);
  if (reply.kind === 'send') {
    const located =
      input.itemId === input.goalId
        ? null
        : locateStep(
            { id: map.goal.id, title: map.goal.title, acceptance: null, status: map.goal.status, approvedAt: null },
            map.steps,
            input.itemId,
          );
    // On the goal itself there is no one step to take: that is Work on this.
    if (!located) return handToRoutine(input, history, 'You asked Claude to work on the goal.');
    return sendFromComment(input, commentMode(located.step));
  }

  const outcomes: FilingOutcome[] = [];
  for (const filing of reply.filings) {
    const { collection } = filing;
    if (collection.shape === 'one' && collection.records.length > 0) {
      outcomes.push({
        ok: false,
        collection,
        error: 'it holds one record and already has it. Correct it on the step instead.',
      });
      continue;
    }
    const written = await addRecord(
      input.claude,
      input.userId,
      collection.id,
      filing.values,
      { kind: 'comment', ref: input.commentId, draft: true },
      collection.records.length,
    );
    if (written.ok) {
      // The values in the stored form addRecord kept them in, so the reply
      // shows $12,450.37 rather than whatever the model wrote.
      const stored = checkRecord(collection.fields, filing.values, null);
      outcomes.push({ ok: true, collection, data: stored.ok ? stored.data : {} });
      collection.records.push({ data: {}, draft: true });
    } else {
      outcomes.push({ ok: false, collection, error: written.error });
    }
  }

  await say(input, replyBody(reply.body, outcomes));
  return {
    ok: true,
    message: outcomes.some((o) => o.ok)
      ? 'Answered, and filed as drafts.'
      : 'Answered in the thread.',
  };
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
 * buttons refuse, and either way the thread says what happened.
 */
async function sendFromComment(
  input: GoalAskInput,
  mode: ReturnType<typeof commentMode>,
): Promise<GoalAskOutcome> {
  const refuse = async (said: string): Promise<GoalAskOutcome> => {
    await say(input, said);
    return { ok: false, error: said };
  };

  const cannot = routineUnavailable(input);
  if (cannot) return refuse(`I did not start it. ${cannot}`);

  const sent = await sendGoalStep({
    client: input.client,
    userId: input.userId,
    stepId: input.itemId,
    routine: input.routine,
    mode,
    asked: input.question,
  });
  if (!sent.ok) return refuse(`I did not start it: ${sent.error}`);

  const said =
    sent.job === 'prepare'
      ? `Claude is preparing "${sent.title}" for you. What it writes will show on the step, which stays yours.`
      : sent.job === 'phase'
        ? `Claude is working on the phase "${sent.title}". What it produces will show on its steps.`
        : `Claude is working on "${sent.title}". What it produces will show on the step when it is done.`;
  await say(input, said);
  return { ok: true, message: said };
}

/**
 * Fire the goals routine on the goal, with the comment in its brief, and say
 * in the thread when that could not happen. When it did, nothing is written:
 * the page says Claude is working on the goal, and the routine's reply is the
 * next thing in the thread.
 */
async function handToRoutine(
  input: GoalAskInput,
  history: Parameters<typeof commentRunText>[0]['thread'],
  why: string,
): Promise<GoalAskOutcome> {
  const refuse = async (said: string): Promise<GoalAskOutcome> => {
    await say(input, said);
    return { ok: false, error: said };
  };

  const cannot = routineUnavailable(input);
  if (cannot) return refuse(`${why} ${cannot}`);
  const { lastRun } = await loadShaping(input.client, input.goalId);
  if (runInFlight(lastRun, Date.now())) {
    return refuse(
      `${why} Claude is already working on this goal, and that run will not see this comment. ` +
        'Ask again once it finishes.',
    );
  }

  const { data: goal } = await input.client
    .from('items')
    .select('title')
    .eq('id', input.goalId)
    .maybeSingle();
  const goalTitle = (goal?.title as string | undefined) ?? input.itemTitle;

  const started = await recordAndFire({
    client: input.client,
    userId: input.userId,
    job: 'goal',
    itemId: input.goalId,
    routine: input.routine,
    text: (runId) =>
      commentRunText({
        runText: goalRunText({ goalId: input.goalId, goalTitle, userId: input.userId, runId }),
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

  return { ok: true, message: 'Claude is working on this goal. Its reply lands in this thread.' };
}
