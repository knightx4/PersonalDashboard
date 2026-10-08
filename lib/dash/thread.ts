import type Anthropic from '@anthropic-ai/sdk';
import type { SpendSink } from '@/lib/core/spend/pricing';
import { parseRef } from '@/lib/core/refs';
import type { MadeDashChange, ThreadCause } from '@/lib/talk/changes';
import type { TalkCitation } from '@/lib/talk/talk';
import { MAX_LOOKUPS, runDash, type DashExecutor, type DashSeen, type DashVoice, type DashWriter } from './loop';
import {
  threadDashTools,
  type DashRecordedWrite,
  type DashThreadActs,
  type DashWriteResult,
  type DashWriteTool,
} from './registry';

/**
 * Dash replying to a comment tagged @dash in a thread (plan #1465, feature
 * #1462): on a dev row (lib/comments/ask.ts), a goal or a step
 * (lib/goals/ask.ts), or a role (lib/jobs/role-thread/ask.ts). Each runs the
 * shared loop in lib/dash/loop.ts with surface 'thread' and the row's ref,
 * so a reply on a role can look things up and make changes as Ask Dash can:
 * add the follow-up todo, close a goal step, note something on another role.
 *
 * A thread hands in what only it knows: the row written out with what has
 * been said on it and the comment (`message`), its own rules, and its own
 * acts, the tools in lib/dash/thread-tools.ts that work on its row. The
 * registry's other writes run as the person (`dash.apply`) and are recorded
 * here in core.dash_actions with surface 'thread', in the same shape as Ask's,
 * so Home lists each with its Undo and Ask's per-kind undo puts it back
 * (lib/core/dash-actions.ts, undoneByAsk). A thread's own acts record
 * themselves as they write.
 *
 * What comes back is the reply as the thread shows it: Dash's answer, then
 * what each of the thread's own acts said it did, in its own words (the idea
 * filed, the letter replaced), so nothing the old replies showed is lost.
 */

/** What every thread is told, ahead of its own rules. */
export const THREAD_RULES = `You are Dash, the assistant inside somebody's personal dashboard. They have
written a comment tagged to you on one row of it, and you are replying in that
row's thread. The message gives you the row written out, what has been said
on it so far, and their comment.

THE ROW COMES FIRST, THEN LOOK IT UP. Answer from the row when it holds the
answer. When the comment needs something it does not hold (a todo, an order,
a note, an application, an email, what they said elsewhere), use the lookup
tools: they reach everything in the app that Ask Dash reaches. Never answer
from memory or a guess about what they probably have. You have at most
${MAX_LOOKUPS} lookups, so choose them well.

YOU MAKE THE CHANGES THEY ASK FOR, AND ONLY WHEN ASKED. Adding, renaming,
moving or ticking off a todo, adding a goal or a step, closing a step, marking
an item returned and noting something on a role are the tools add_todo,
change_todo, close_todo, add_goal, add_goal_step, close_goal_step,
mark_returned and add_role_note. This row's own tools are described below.
A change is made when you call the tool, and they can undo it from Home. A
row is named by the ref a lookup returned for it, or the row this thread is
on, by the table and ref the message gives. When you cannot tell which row
they mean, ask rather than guess. Never change something they only asked
about.

ANSWER THROUGH THE answer TOOL. That is your reply in the thread, in plain
words, as you would say it to them on their phone. Match its length to the
comment. A comment that needs nothing back (a status update, a thanks, "looks
good") gets one short sentence, such as "Glad it works.", or no reply at all:
call acknowledge instead, which marks their comment as seen and writes
nothing. Choose each time; the mark is for a comment where a sentence back
would only be noise. A simple question gets its answer in a sentence or two.
Keep several sentences for when there is a lot to say. Do not restate the row
back to them or pad the reply. Whatever the length,
a change you made is said in words and the rows you used or changed are
cited. When a tool says its words are added under your reply, do not repeat
them.

WHEN A MARK IS ENOUGH. acknowledge is for a comment that asks nothing and
wants nothing done. A question is never only marked seen, however short, and
neither is a request: once you have changed anything or handed it on, you
answer in words. For example:
- "pushed the fix, all good now": acknowledge.
- "thanks, that's what I needed": acknowledge, or "Glad it helped."
- "looks good": acknowledge.
- "looks good, can you move it to Friday?": move it, then answer saying so.
- "done with this one?": answer; it is a question.
- "fixed it, but is the old row still there?": answer the question.

Write plainly: no dashes as punctuation, and do not open by agreeing with them
("You're right").`;

/**
 * How Dash speaks in a thread on a row of `table`: the model, the shared
 * rules then the thread's own, and the tools that thread offers.
 */
export function threadVoice(model: string, rules: string, table: string): DashVoice {
  return { model, system: `${THREAD_RULES}\n\n${rules.trim()}`, tools: threadDashTools(table), acknowledge: true };
}

/** Said to the model when it tries to mark the comment seen after changing something. */
export const CHANGED_SO_ANSWER =
  'You changed something in this turn, so it is said in words. Nothing was marked. Answer saying what you did.';

/**
 * The person's own Dash, bound to a request (lib/talk/ask-request.ts,
 * threadDashInRequest): what a thread needs from outside itself to run the
 * shared loop. Tests hand in stubs.
 */
export type ThreadDash = {
  /** YYYY-MM-DD in the person's timezone. */
  today: string;
  /** Runs one lookup as the person. */
  execute: DashExecutor;
  /**
   * Runs a registry write as the person: the tool's `apply` with their
   * clients, the rows Dash has seen, and the thread's own acts bound.
   */
  apply: (
    tool: DashWriteTool,
    input: unknown,
    seen: DashSeen,
    acts: DashThreadActs,
  ) => Promise<DashWriteResult | DashRecordedWrite | { ok: false; error: string }>;
  /**
   * Keeps a registry write's record in core.dash_actions, with surface
   * 'thread', under the comment that asked for it when there is one.
   */
  saveChange: (made: MadeDashChange, cause: ThreadCause | null) => Promise<unknown>;
};

/** What a thread's hand-off did: started something, or why not. */
export type ThreadHandOff =
  | {
      ok: true;
      /** What to tell the model. */
      note: string;
      /** Words to show under the reply as they are. */
      said?: string;
      /**
       * A session or routine now has the comment and replies in the thread
       * itself, so Dash's own reply is not written unless it changed something.
       */
      passedOn?: boolean;
    }
  | { ok: false; error: string };

export type ThreadReply =
  | {
      ok: true;
      /** The reply as the thread shows it: the answer, then what each act said. */
      body: string;
      citations: TalkCitation[];
      /** The kinds of change made, in order. */
      made: string[];
      /** Whether the comment was passed to a session or routine that replies itself. */
      passedOn: boolean;
      /**
       * The comment was marked seen and needs no reply (plan #1649): `body`
       * is empty and the caller writes nothing into the thread.
       */
      acknowledged: boolean;
    }
  | { ok: false; detail: string };

/** The reply when a change was made and the answer saying so never came. */
const UNFINISHED = 'I made the change you asked for, but could not finish writing this reply. It is listed on Home, with its Undo.';

/** What the model is told once a registry write is made and kept. */
function madeNote(summary: string, kept: boolean): string {
  return kept
    ? `Done: ${summary} They can undo it from Home. Say what you did, and cite the row this returned.`
    : `Done: ${summary} Its Undo could not be kept, so tell them it is done and can be changed back on its page.`;
}

/** What the model is told once one of the thread's own acts is made. */
function saidNote(said: string): string {
  return `Done. These words are added under your reply as they are, so do not repeat them: "${said}" Say in a sentence what you did.`;
}

/**
 * Dash's reply to the comment at the end of `message`. Never throws: a reply
 * that could not be produced comes back as why.
 */
export async function replyInThread(input: {
  voice: DashVoice;
  /** The row the thread hangs from, as `schema.table:id`, and its title. */
  subject: { ref: string; title?: string | null };
  /** The row written out, the thread so far, and the comment, as one turn. */
  message: string;
  dash: ThreadDash;
  /** The thread's own write tools, bound to its row. */
  acts: DashThreadActs;
  /**
   * The comment being answered, which every registry write is recorded
   * under (plan #1518). Absent: the writes are recorded with no comment.
   */
  cause?: ThreadCause | null;
  /** The thread's own hand-offs, by tool name. Absent: every hand-off is refused. */
  handOff?: (name: string, input: unknown) => Promise<ThreadHandOff>;
  /**
   * Marks the comment being answered as seen (acknowledgeThreadTurn, bound to
   * it), for a comment that needs nothing back (plan #1649). Absent: Dash
   * always answers in words.
   */
  acknowledge?: () => Promise<unknown>;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
  now?: () => number;
}): Promise<ThreadReply> {
  const { dash, acts } = input;
  const made: string[] = [];
  const said: string[] = [];
  let passedOn = false;
  // Hand-offs that started something: a change too, so said in words.
  let started = 0;

  const write: DashWriter = async (tool, args, seen) => {
    const result = await dash.apply(tool, args, seen, acts);
    if (!result.ok) return { ok: false, error: result.error };
    made.push(result.kind);
    if ('recorded' in result) {
      said.push(result.said);
      return { ok: true, rows: [], note: saidNote(result.said) };
    }
    let kept = true;
    try {
      await dash.saveChange({
        kind: result.kind,
        input: result.input,
        subjectRef: result.subjectRef,
        op: result.op,
        before: result.before,
        after: result.after,
        summary: result.summary,
        undo: result.undo ?? null,
      } as MadeDashChange, input.cause ?? null);
    } catch (error) {
      console.error(`thread write ${tool.name} was made but not kept`, error);
      kept = false;
    }
    return { ok: true, rows: [result.row], note: madeNote(result.summary, kept) };
  };

  const { handOff, acknowledge } = input;
  const answer = await runDash({
    voice: input.voice,
    context: { surface: 'thread', subject: input.subject, page: null },
    turns: [{ role: 'user', body: input.message }],
    today: dash.today,
    execute: dash.execute,
    write,
    handOff: handOff
      ? async (args, _seen, tool) => {
          const outcome = await handOff(tool.name, args);
          if (!outcome.ok) return { ok: false, error: outcome.error };
          started += 1;
          if (outcome.said) said.push(outcome.said);
          if (outcome.passedOn) passedOn = true;
          return { ok: true, rows: [], note: outcome.said ? `${outcome.note} ${saidNote(outcome.said)}` : outcome.note };
        }
      : undefined,
    acknowledge: acknowledge
      ? async () => {
          // A change is always reported in words, so the mark is refused once
          // one is made; the database cannot tell (plan #1648).
          if (made.length > 0 || started > 0) return { ok: false, error: CHANGED_SO_ANSWER };
          await acknowledge();
          return { ok: true };
        }
      : undefined,
    anthropicApiKey: input.anthropicApiKey,
    client: input.client,
    onSpend: input.onSpend,
    now: input.now,
  });
  if (!answer.ok) {
    // Whatever was made stands, and the thread still says so.
    if (made.length > 0) {
      const body = said.length > 0 ? said.join('\n\n') : UNFINISHED;
      return { ok: true, body, citations: [], made, passedOn, acknowledged: false };
    }
    return { ok: false, detail: answer.detail };
  }
  if (answer.acknowledged) return { ok: true, body: '', citations: [], made, passedOn, acknowledged: true };
  return {
    ok: true,
    body: [answer.body, ...said].join('\n\n'),
    citations: answer.citations,
    made,
    passedOn,
    acknowledged: false,
  };
}

/** The row a thread hangs from, as the message names it so a tool can take its ref. */
export function subjectLine(ref: string): string {
  const parsed = parseRef(ref);
  return parsed ? `This thread is on ${parsed.table}, ref ${parsed.id}.` : '';
}
