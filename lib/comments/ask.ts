/**
 * What happens when a comment is addressed to Dash.
 *
 * A comment tagged `@dash` is answered here: read the row it was asked on,
 * reply through the shared loop (lib/dash/thread.ts, plan #1465) with Ask
 * Dash's lookups and writes and the dev row's own tools, and write what comes
 * back into the same thread as `claude`. When the question needs the code,
 * Dash passes it to a session (pass_to_session), the plan routine is started
 * on it, and the page says so, so the person is not left watching a box that
 * never fills in.
 *
 * A comment that asks for something to be done is carried out instead, by
 * the dev row's own tools (lib/dash/thread-tools.ts), which run the fixed list
 * in lib/comments/act.ts, and the thread says what was done. Everything left
 * off that list stays the person's: a question asked on a decision leaves that
 * decision open, a question asked on an idea leaves it unshaped, and nothing
 * here approves, answers, starts, assigns or dismisses anything. Asking is not
 * deciding, and those moves are made on the page.
 */
import { SEEN_MESSAGE } from '@/lib/comments/awaiting';
import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DASH_MODELS } from '@/lib/dash/models';
import type { DashThreadActs } from '@/lib/dash/registry';
import { replyInThread, subjectLine, threadVoice, type ThreadDash, type ThreadHandOff } from '@/lib/dash/thread';
import { DEV_THREAD_TABLES } from '@/lib/dash/thread-tools';
import { toRef } from '@/lib/core/refs';
import { MODULE_IDS } from '@/lib/modules';
import { loadVisionBodies } from '@/lib/specs/vision';
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
import type { DashActionDeps } from '@/lib/core/dash-actions';
import {
  askMessage,
  ideaContext,
  noteContext,
  raiseContext,
  specChangeContext,
  specContext,
  takeawayContext,
  threadText,
} from './context';
import { type CommentTarget, type DevComment } from './load';
import { acknowledgeThreadTurn, addThreadTurn, loadThread, threadReplySql } from '@/lib/thread/store';
import { threadRef } from '@/lib/thread/subjects';
import { readSpec, specBySlug } from '@/lib/specs/registry';
import { splitSections } from '@/lib/specs/sections';
import { SPEC_CHANGE_COLUMNS, sectionsTouched, specChangeFrom } from '@/lib/specs/changes';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSessionSpend } from '@/lib/core/spend/session';
import { actionSchema } from './reply-payload';
import { checkReplyAfterResponse } from '@/lib/writing/reply-check';

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
  /** The person's clients, for recording what an instruction writes (plan #1459). */
  dash: DashActionDeps;
  /** The person's lookups and writes, for the shared loop (threadDashInRequest). */
  dashThread: ThreadDash;
  /** For tests: the model client. */
  anthropic?: Anthropic;
};

/** The model a reply on a dev row is written with (Sonnet since plan #1465). */
export const DEV_REPLY_MODEL = DASH_MODELS.devThread;

/** What a reply on a dev row is told, after the rules every thread shares. */
const DEV_RULES = `THIS THREAD IS ON ONE ROW OF THEIR DEVELOPMENT PAGES: a plan step, a
question under a plan feature, an idea, a bug report they filed, something a
previous session raised with them, a spec section, an inspiration takeaway, or
a proposed change to one of their specs. The message names which. Most
comments are questions about what is written on the row; some are
instructions. You are talking to the person who owns the app, so no file paths
unless they asked about one.

Do not decide anything. A question asked on a plan decision is a question
about the options, not an answer to it: explain what the options mean and what
each would cost, and say which you would pick if they ask, but the choice
stays theirs.

Do not guess at what the code currently does. When answering properly means
reading a file, a table or the state of the repository, call pass_to_session
with the one sentence saying what would have to be read. A session that can
read the code takes it from there and writes into this thread. The same goes
for an instruction none of your tools can carry out without reading the code
first ("fix this", "change how this works"): pass_to_session with instruction
true. Never reply that you cannot do something they told you to do.

When the comment tells you to do something, do it with this row's tools rather
than describing it:

- file_idea writes a new idea on the ideas page. The module is one of
  ${MODULE_IDS.join(', ')}, or left out for the app as a whole.
- file_note writes a bug report or a feature request into the notes queue,
  which is what "write this up as a bug" and "file that as a request" mean.
- add_step adds a row to the plan as a proposal: on a plan step, a step beneath
  it ("add a step under this", "break this in two"); anywhere else a feature
  at the top of the workspace named. On a raise, "put this in the plan" is
  add_step.
- reword rewrites the row the comment is on: an idea or a bug note whole, a
  plan step's title, detail or done-when, a proposed spec change's diff, title
  or why. A raise has no wording of its own to rewrite.
- send_step starts a session building the plan step the comment is on now; on
  a raise, the step it names by number.
- build_step writes a new step ready to be worked and starts a session on it,
  for "do it", "just do this", "go ahead and build that", most often on a
  raise that already describes the work. Pick add_step when they are adding
  something to the plan for later, and build_step when they are telling you
  to do the work now.

Six moves are theirs and stay theirs however the comment was phrased:
approving a proposal, answering a question put to them, answering or
dismissing a raise, setting a status, assigning a step, and deleting
anything. Asked for one of those, change nothing and say in one sentence that
it is theirs to make, and where on the page it is made.`;

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
 * The step, idea, raise, bug note or spec section written out.
 *
 * A step goes through `planBrief`, which is the same text a session building
 * it would be handed: its done-when, where the feature is going, and every
 * question already settled beneath it. The other three are shorter and are
 * assembled in lib/comments/context.ts.
 */
async function subjectOf(input: AskInput): Promise<Subject | null> {
  const subject = await subjectRowOf(input);
  if (!subject) return null;
  // The thread comes from the shared store (plan #1470), whichever row it is.
  const thread = await loadThread(input.supabase, threadRef(input.target, input.id), { userId: input.userId });
  return { ...subject, thread };
}

/** The row written out, before its thread is read. */
async function subjectRowOf(input: AskInput): Promise<Subject | null> {
  const { supabase, userId, target, id } = input;

  if (target === 'step') {
    const sections = buildPlanTree(await loadPlan(supabase, userId));
    const node = findNode(sections, id);
    if (!node) return null;
    return {
      context: planBrief(sections, node, { visions: await loadVisionBodies(supabase, userId) }),
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

  if (target === 'takeaway') {
    const { data } = await supabase
      .from('inspiration_takeaways')
      .select(
        'title, body, module, status, inspiration_takeaway_videos (inspiration_videos (title))',
      )
      .eq('user_id', userId)
      .eq('id', id)
      .maybeSingle();
    if (!data) return null;
    const row = data as unknown as Record<string, unknown>;
    const links = (row.inspiration_takeaway_videos ?? []) as Array<{ inspiration_videos: { title: string | null } | null }>;
    return {
      context: takeawayContext({
        title: String(row.title),
        body: String(row.body),
        module: typeof row.module === 'string' ? row.module : null,
        status: String(row.status),
        videos: links.map((link) => link.inspiration_videos?.title).filter((title): title is string => !!title),
      }),
      thread: [],
      label: `the inspiration takeaway "${String(row.title)}"`,
    };
  }

  // A proposed change to a spec (plan #1507): the diff, and the sections of
  // the spec it touches, so a question about it and a request to reword it
  // both see the wording it changes.
  if (target === 'change') {
    const { data } = await supabase
      .from('spec_changes')
      .select(SPEC_CHANGE_COLUMNS)
      .eq('user_id', userId)
      .eq('id', id)
      .maybeSingle();
    if (!data) return null;
    const change = specChangeFrom(data as unknown as Parameters<typeof specChangeFrom>[0]);
    const doc = specBySlug(change.spec);
    const markdown = doc ? await readSpec(doc) : null;
    return {
      context: specChangeContext({
        title: change.title,
        why: change.why,
        diff: change.diff,
        status: change.status,
        madeBy: change.madeBy,
        spec: doc ? { title: doc.title, file: doc.file } : null,
        slug: change.spec,
        sections: sectionsTouched(markdown, change.diff),
      }),
      thread: change.thread,
      label: `the spec change "${change.title}"`,
    };
  }

  if (target === 'spec') {
    const { data } = await supabase
      .from('spec_sections')
      .select('slug, anchor, heading')
      .eq('user_id', userId)
      .eq('id', id)
      .maybeSingle();
    if (!data) return null;

    const row = data as unknown as Record<string, unknown>;
    const doc = specBySlug(String(row.slug));
    if (!doc) return null;

    const markdown = await readSpec(doc);
    const section = markdown
      ? splitSections(markdown).find((s) => s.anchor === row.anchor)
      : undefined;

    return {
      context: specContext({
        title: doc.title,
        file: doc.file,
        heading: String(row.heading),
        // The heading may have been rewritten since the comment was filed, in
        // which case the prose is gone and saying so beats answering from the
        // heading alone.
        body: section?.body ?? '(This section is no longer in the document.)',
      }),
      thread: [],
      label: `${doc.title} — ${row.heading}`,
    };
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
  await addThreadTurn(input.supabase, {
    userId: input.userId,
    ref: threadRef(input.target, input.id),
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
  'step over to be built, writing a step for work they have told you to do and starting it. ' +
  'Use them. Six moves are theirs and stay theirs however it was ' +
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
    `${threadReplySql(input.userId, threadRef(input.target, input.id), `<${instruction ? 'what you did' : 'your answer'}>`)}\n\n` +
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

  // The row's own tools: the fixed list in act.ts, each recorded as it writes.
  let redraw: string | undefined;
  const acts: DashThreadActs = async (name, args) => {
    const parsed = actionSchema.safeParse({ ...(args && typeof args === 'object' ? args : {}), name });
    if (!parsed.success) return { ok: false, error: 'That was not something I could read, so nothing was done.' };
    const outcome = await carryOut({
      supabase: input.supabase,
      userId: input.userId,
      dash: input.dash,
      target: input.target,
      id: input.id,
      action: parsed.data,
    });
    if (!outcome.ok) return { ok: false, error: outcome.why };
    redraw = outcome.redraw ?? redraw;
    return { ok: true, recorded: true, kind: name, said: outcome.said };
  };

  let session: string | null = null;
  const handOff = async (name: string, args: unknown): Promise<ThreadHandOff> => {
    const raw = args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
    if (name === 'send_step') {
      const parsed = actionSchema.safeParse({ ...raw, name });
      if (!parsed.success) return { ok: false, error: 'That named no step I could read, so nothing was started.' };
      const outcome = await carryOut({
        supabase: input.supabase,
        userId: input.userId,
        dash: input.dash,
        target: input.target,
        id: input.id,
        action: parsed.data,
      });
      if (!outcome.ok) return { ok: false, error: outcome.why };
      redraw = outcome.redraw ?? redraw;
      return { ok: true, note: 'Started.', said: outcome.said };
    }
    if (name === 'pass_to_session') {
      const why = typeof raw.why === 'string' && raw.why.trim() ? raw.why.trim() : 'This needs the code read.';
      const started = await handToSession(input, subject, history, raw.instruction === true);
      if (!started.ok) return { ok: false, error: `${why} The session could not be started: ${started.error}` };
      session = started.message;
      return {
        ok: true,
        passedOn: true,
        note: 'A session that can read the code has it and writes into this thread. Say in one sentence that you passed it on.',
      };
    }
    return { ok: false, error: 'That cannot be done on this row.' };
  };

  const spend: SpendReport[] = [];
  const subjectRef = toRef(DEV_THREAD_TABLES[input.target], input.id);
  const reply = await replyInThread({
    voice: threadVoice(DEV_REPLY_MODEL, DEV_RULES, DEV_THREAD_TABLES[input.target]),
    subject: { ref: subjectRef, title: subject.label },
    message: `${subjectLine(subjectRef)}\n\n${message}`,
    dash: input.dashThread,
    acts,
    handOff,
    acknowledge: () =>
      acknowledgeThreadTurn(input.supabase, { userId: input.userId, ref: subjectRef, turnId: input.commentId }),
    anthropicApiKey: key,
    client: input.anthropic,
    onSpend: (report) => spend.push(report),
  });
  await recordSessionSpend(input.userId, { module: 'core', operation: 'reply-to-comment' }, spend);

  if (!reply.ok) {
    const why = `I could not produce a reply: ${reply.detail} Your comment is saved.`;
    await say(input, why);
    return { ok: false, error: why };
  }

  // A session has it and its answer is the next thing in the thread. Which
  // route a question took is not part of the conversation, so Dash's sentence
  // saying so is only written when it changed something as well.
  if (session && reply.made.length === 0) return { ok: true, message: session };
  if (reply.acknowledged) return { ok: true, message: SEEN_MESSAGE };

  await say(input, reply.body);
  checkReplyAfterResponse(input.userId, reply.body, `${input.target} ${input.id}`);
  return reply.made.length > 0
    ? { ok: true, message: 'Done, and said in the thread.', redraw }
    : { ok: true, message: 'Answered in the thread.' };
}

/**
 * Start the session that can read the code, and say which of the two is coming.
 *
 * Dash calls pass_to_session when it cannot answer or do it from the row and
 * its lookups, and the thing that can is a session. It used to say so
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
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
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

  // A failure goes back to Dash, whose reply says so: nothing else is coming,
  // and a thread that went quiet is the one outcome the person cannot tell
  // from working.
  if (!started.ok) return { ok: false, error: started.error };

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
