/**
 * What happens when a comment is addressed to Claude.
 *
 * A comment tagged `@dash` is a question, and this is the whole of answering
 * it: read the row it was asked on, try the fast reply, and write what comes
 * back into the same thread as `claude`. When the fast reply says the question
 * needs the code, the plan routine is started on it and the thread says so, so
 * the person is not left watching a box that never fills in.
 *
 * A comment that asks for something to be done is carried out instead, inside
 * the fixed list in lib/comments/act.ts, and the thread says what was done.
 * Everything left off that list stays the person's: a question asked on a
 * decision leaves that decision open, a question asked on an idea leaves it
 * unshaped, and nothing here approves, answers, starts, assigns or dismisses
 * anything — asking is not deciding, and those moves are made on the page.
 */
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { serverEnv } from '@/lib/env';
import { FEEDBACK_COLUMNS, feedbackRowFrom } from '@/lib/feedback/load';
import { planRoutine } from '@/lib/feedback/routine';
import { ideaRowFrom, IDEA_COLUMNS } from '@/lib/ideas/load';
import { planBrief } from '@/lib/plan/brief';
import { loadPlan } from '@/lib/plan/load';
import { startRoutineRun } from '@/lib/plan/runs';
import { buildPlanTree, findNode } from '@/lib/plan/tree';
import { raisedRowFrom, RAISED_COLUMNS } from '@/lib/raised/load';
import { carryOut } from './act';
import { askMessage, ideaContext, noteContext, raiseContext, threadText } from './context';
import { TARGET_COLUMN, type CommentTarget, type DevComment } from './load';
import { replyToComment } from './reply';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public'>;

export type AskOutcome =
  /** `redraw` is a second page an action changed, when there was one. */
  | { ok: true; message: string; redraw?: string }
  | { ok: false; error: string };

export type AskInput = {
  supabase: Db;
  userId: string;
  target: CommentTarget;
  /** The row the question was asked on, not the comment. */
  id: string;
  /** The comment carrying the question, left out of the history. */
  commentId: string;
  question: string;
};

/** What the row says, and what has already been said about it. */
type Subject = { context: string; thread: DevComment[]; label: string };

function apiKey(): string | null {
  try {
    return serverEnv().ANTHROPIC_API_KEY ?? null;
  } catch {
    return process.env.ANTHROPIC_API_KEY ?? null;
  }
}

/**
 * The step, idea, raise or bug note written out.
 *
 * A step goes through `planBrief`, which is the same text a session building
 * it would be handed: its done-when, where the feature is going, and every
 * question already settled beneath it. The other three are shorter and are
 * assembled in lib/comments/context.ts.
 */
async function subjectOf(input: AskInput): Promise<Subject | null> {
  const { supabase, userId, target, id } = input;

  if (target === 'step') {
    const sections = buildPlanTree(await loadPlan(supabase, userId));
    const node = findNode(sections, id);
    if (!node) return null;
    return {
      context: planBrief(sections, node),
      thread: node.thread,
      label: `#${node.number} ${node.title}`,
    };
  }

  if (target === 'idea') {
    const { data } = await supabase
      .from('ideas')
      .select(IDEA_COLUMNS)
      .eq('user_id', userId)
      .eq('id', id)
      .maybeSingle();
    if (!data) return null;
    const idea = ideaRowFrom(data as unknown as Record<string, unknown>);
    return { context: ideaContext(idea), thread: idea.thread, label: 'an idea' };
  }

  if (target === 'raise') {
    const { data } = await supabase
      .from('raised_items')
      .select(RAISED_COLUMNS)
      .eq('user_id', userId)
      .eq('id', id)
      .maybeSingle();
    if (!data) return null;
    const row = raisedRowFrom(data as unknown as Record<string, unknown>);
    return { context: raiseContext(row), thread: row.thread, label: row.title };
  }

  const { data } = await supabase
    .from('feedback_items')
    .select(FEEDBACK_COLUMNS)
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  const note = feedbackRowFrom(data as unknown as Record<string, unknown>);
  return {
    context: noteContext(note),
    thread: note.thread,
    label: note.kind === 'bug' ? 'a bug report' : 'a feature request',
  };
}

/** A reply in the thread, under the same account and marked as Claude's. */
async function say(input: AskInput, body: string): Promise<void> {
  await input.supabase.from('dev_comments').insert({
    user_id: input.userId,
    [TARGET_COLUMN[input.target]]: input.id,
    author: 'claude',
    body,
  });
}

/**
 * What a session started from a comment may do, in each of the two cases.
 *
 * A question and an instruction are answered differently and the difference is
 * the whole of it: answering a question by settling it takes the decision away
 * from the person, and replying to an instruction with a description of what
 * could be done is the thing #356 exists to stop. The list an instruction may
 * work inside is the same one lib/comments/act.ts holds, and the moves left out
 * are left out in both places.
 */
const QUESTION_RULE =
  'This is a question. Answer it and nothing else. Do not answer a decision, do not change ' +
  'the status, the detail or the done-when of any plan row, do not shape an idea, do not ' +
  'close or dismiss a raise, and do not commit anything. The person asked what something ' +
  'means, not for it to be settled or built.';

const INSTRUCTION_RULE =
  'This is an instruction, so do it rather than describe it, and then say in the thread what ' +
  'you did. Do not write back that you cannot: you have the repository, the plan and the notes ' +
  'queue in front of you, and what a comment asks for is nearly always something your skills ' +
  'already cover -- adding or re-shaping steps under a feature, writing something up as a bug ' +
  'note or an idea, rewording a row (put the old wording in the thread with the new), handing a ' +
  'step over to be built. Use them. Six moves are theirs and stay theirs however it was ' +
  'phrased: approving a proposal, answering a question put to them, answering or dismissing a ' +
  'raise, setting a status, assigning a step, and deleting anything. Asked for one of those, ' +
  'change nothing and say in the thread that it is theirs and where on the page it is made. If ' +
  'what they asked for is real but too large to finish in this run, it still does not come back ' +
  'as a refusal: file it as a note or raise it, and say in the thread where it now lives and ' +
  'what it is waiting on. Do not commit anything either way.';

/**
 * The turn the slow path is started with.
 *
 * It carries the row, what has already been said on it, the question and where
 * the answer goes, and it says what the session must not do: this is a
 * question, and answering a question is not settling it. The SQL is spelled
 * out because `scripts/plan.ts` needs a direct database connection that Claude
 * Code on the web does not have.
 *
 * The history is what the fast reply already gets. A second question on a row
 * is almost always about the first answer, and a session handed the row alone
 * starts again from the top and writes back what the thread already says.
 */
function sessionTurn(
  input: AskInput,
  subject: Subject,
  /** The thread with the comment carrying the question taken out. */
  history: readonly DevComment[],
  /** Whether the comment told it to do something rather than asked it something. */
  instruction: boolean,
): string {
  const said = threadText(history);
  const opening = instruction
    ? `Carry out an instruction left on ${subject.label}, in the app. Read the code it is ` +
      'about, do what it asks inside the list below, and write into the thread on that row ' +
      'what you did.'
    : `Answer a question asked on ${subject.label}, in the app. Read the code it is about, ` +
      'write the answer into the thread on that row, and then stop.';

  return (
    `${opening}\n\n` +
    `${subject.context.trimEnd()}\n\n` +
    (said ? `${said.trimEnd()}\n\n` : '') +
    `## ${instruction ? 'What they asked for' : 'The question'}\n\n${input.question}\n\n` +
    `## Where ${instruction ? 'what you did goes' : 'the answer goes'}\n\n` +
    'insert into dev_comments (user_id, ' +
    `${TARGET_COLUMN[input.target]}, author, body) values ('${input.userId}', '${input.id}', ` +
    `'claude', '<${instruction ? 'what you did' : 'your answer'}>');\n\n` +
    (instruction ? INSTRUCTION_RULE : QUESTION_RULE)
  );
}

/**
 * Reply to a tagged comment, and say what happened.
 *
 * Every outcome the person can see is written into the thread, including the
 * ones where no answer could be produced: a question that silently went
 * nowhere is worse than one answered with "I could not".
 *
 * Including the ones nothing here models. The reply and the routine both turn
 * their failures into a sentence, so what is left to throw is the database
 * under all of it -- and a throw here would reject the action that wrote the
 * comment, which takes the comment off the screen it was just posted on and
 * leaves nothing to say why. The comment is already written by the time any of
 * this runs; the catch is what keeps that true on screen as well.
 */
export async function askDash(input: AskInput): Promise<AskOutcome> {
  try {
    return await produceReply(input);
  } catch (error) {
    const why =
      'Something went wrong on the way to a reply: ' +
      `${error instanceof Error ? error.message : 'no reason given'}. Your comment is saved.`;
    // The thread is where the reason belongs, and writing to it is one of the
    // things that may have just failed. A second failure leaves the action's
    // own message as the only copy, which is better than throwing on top of a
    // throw.
    try {
      await say(input, why);
    } catch {
      /* nothing further to try */
    }
    return { ok: false, error: why };
  }
}

async function produceReply(input: AskInput): Promise<AskOutcome> {
  const subject = await subjectOf(input);
  if (!subject) return { ok: false, error: 'That row no longer exists, so nothing was asked.' };

  const history = subject.thread.filter((comment) => comment.id !== input.commentId);
  const message = askMessage({
    context: subject.context,
    thread: history,
    question: input.question,
  });

  const key = apiKey();
  if (!key) {
    const why = 'No ANTHROPIC_API_KEY on the deployment, so I cannot answer. Your comment is saved.';
    await say(input, why);
    return { ok: false, error: why };
  }

  const reply = await replyToComment({ apiKey: key }, message);

  if (reply.kind === 'answer') {
    await say(input, reply.body);
    return { ok: true, message: 'Answered in the thread.' };
  }

  // An instruction, which #359 settled is carried out rather than offered back
  // for a second press. The thread is told either way: what was done, or why
  // nothing was, so a comment never disappears into a box that fills in with
  // nothing.
  if (reply.kind === 'action') {
    const outcome = await carryOut({
      supabase: input.supabase,
      userId: input.userId,
      target: input.target,
      id: input.id,
      action: reply.action,
    });

    // Told to do something this call has no way to do, and that is not the
    // person's own move either. Refusing it here is the dead end the note in
    // this batch was about: "I asked it to update my plan and it said it
    // couldn't." A session can read the code and do it, so it goes there
    // instead of into the thread as a no.
    if (!outcome.ok && outcome.route) {
      return handToSession(input, subject, history, true, outcome.why);
    }

    await say(input, outcome.ok ? outcome.said : outcome.why);
    return outcome.ok
      ? { ok: true, message: 'Done, and said in the thread.', redraw: outcome.redraw }
      : { ok: false, error: outcome.why };
  }

  if (reply.kind === 'error') {
    const why = `I could not produce a reply: ${reply.error} Your comment is saved.`;
    await say(input, why);
    return { ok: false, error: why };
  }

  // Needs the repository, so the session that can read the code is started and
  // its answer is the next thing in the thread.
  return handToSession(input, subject, history, reply.instruction, reply.why);
}

/**
 * Start the session that can read the code, and say which of the two is coming.
 *
 * Both ways of arriving here end the same: the fast reply could not do it from
 * the message alone, and the thing that can is a session. It used to say so
 * first -- a `claude` comment reading "I have started a session on it; the
 * answer will land here", and then the real answer under it. That is a thing
 * nobody wrote, standing above every answer that ever took the slow path, and
 * it is still there a week later when the only question is what the answer was.
 * The thread keeps what was said, not the machinery that said it -- which route
 * a question took is not part of the conversation. The page says something is
 * coming while it is coming, and that line goes away when it arrives.
 */
async function handToSession(
  input: AskInput,
  subject: Subject,
  history: readonly DevComment[],
  instruction: boolean,
  why: string,
): Promise<AskOutcome> {
  const started = await startRoutineRun({
    supabase: input.supabase,
    userId: input.userId,
    job: 'comment',
    routine: planRoutine(),
    // The step, when the question was asked on one. An idea, a raise and a bug
    // note are rows the plan does not number.
    planItemId: input.target === 'step' ? input.id : null,
    text: sessionTurn(input, subject, history, instruction),
  });

  // A failure is different, and it is still written down. This is the end of
  // the question: nothing else is coming, and a thread that went quiet is the
  // one outcome the person cannot tell from working.
  if (!started.ok) {
    const said = `${why} I could not start a session to look: ${started.error}`;
    await say(input, said);
    return { ok: false, error: said };
  }

  // The page is told which of the two is coming, because "what it did" and
  // "its answer" are different things to be waiting for. It is said as the
  // action's message, which is gone once the reply arrives -- not written into
  // the thread, where it would outlive the wait it was describing.
  return {
    ok: true,
    message: instruction
      ? 'A session is reading the code. What it did lands in this thread.'
      : 'A session is reading the code. Its answer lands in this thread.',
  };
}
