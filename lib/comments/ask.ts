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
import { fireFeatureRoutine, planRoutine } from '@/lib/feedback/routine';
import { ideaRowFrom, IDEA_COLUMNS } from '@/lib/ideas/load';
import { planBrief } from '@/lib/plan/brief';
import { loadPlan } from '@/lib/plan/load';
import { buildPlanTree, findNode } from '@/lib/plan/tree';
import { raisedRowFrom, RAISED_COLUMNS } from '@/lib/raised/load';
import { carryOut } from './act';
import { askMessage, ideaContext, raiseContext, threadText } from './context';
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
 * The step, idea or raise written out.
 *
 * A step goes through `planBrief`, which is the same text a session building
 * it would be handed: its done-when, where the feature is going, and every
 * question already settled beneath it. The other two are shorter and are
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
  'you did. Three things are yours to do: file an idea on the ideas page (it lands as a ' +
  'suggestion, under their own), reword the row this was written on (an idea\'s text, or a ' +
  'plan step\'s title, detail or done-when -- put the old wording in the thread with the new), ' +
  'and hand a plan step over to be built. Anything else is theirs, made on the page: never ' +
  'approve a proposal, never answer a decision, never set a status or an assignee by hand, ' +
  'and never dismiss or delete anything. Asked for one of those, change nothing and say in ' +
  'the thread that it was not done and why. Do not commit anything either way.';

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
 */
export async function askDash(input: AskInput): Promise<AskOutcome> {
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

  // Needs the repository. The person hears why now and the answer lands here
  // when the session that can read the code has written it.
  const routine = planRoutine();
  const started = await fireFeatureRoutine({
    apiKey: routine.token,
    routineId: routine.id,
    text: sessionTurn(input, subject, history, reply.instruction),
  });

  if (!started.ok) {
    const why = `${reply.why} I could not start a session to look: ${started.error}`;
    await say(input, why);
    return { ok: false, error: why };
  }

  await say(
    input,
    reply.instruction
      ? `${reply.why} I have started a session on it; it will say here what it did.`
      : `${reply.why} I have started a session on it; the answer will land here.`,
  );
  return {
    ok: true,
    message: reply.instruction
      ? 'A session is reading the code. What it did lands in this thread.'
      : 'A session is reading the code. Its answer lands in this thread.',
  };
}
