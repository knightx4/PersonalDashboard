import type Anthropic from '@anthropic-ai/sdk';
import type { AskToolResult } from '@/lib/ask/db';
import { ASK_ACTION_RULES } from '@/lib/dash/ask';
import type { DashProposer, DashQueuer, DashSeen, DashWriter } from '@/lib/dash/loop';
import type { PaidQueued } from '@/lib/dash/paid';
import {
  ASK_DASH_TOOLS,
  type DashPaidTool,
  type DashRecordedWrite,
  type DashTool,
  type DashWriteResult,
  type DashWriteTool,
} from '@/lib/dash/registry';
import { CHART_TOOL } from '@/lib/talk/chart';
import { dashWebSearch, WEB_RULES } from '@/lib/dash/web-search';
import type { DashChange, MadeDashChange, NewDashChange, PeopleCause } from '@/lib/talk/changes';
import type { DashSlip } from '@/lib/dash/slips';

/**
 * The people on People acting, not only looking things up (plan #2854.2).
 *
 * A mentor, a council member or the builder replies through Dash's loop with
 * Ask Dash's own tools and Ask's own rules for using them, so there is one set
 * of actions however many people there are. What differs is only where a
 * change is kept: in core.dash_actions with surface 'thread', like any thread
 * write, plus the person who made it and the text in their thread that asked
 * for it (core.dash_actions.advisor_id, advisor_chat_id, advisor_message_id;
 * you migration 0041). Home lists each with its Undo, as it does Dash's, and
 * Ask's per-kind undo takes it back.
 *
 * The safety is Ask's. A write is made when the tool is called and can be
 * undone. A build, a delete and a watch are proposals, and a paid press is
 * queued: each is kept as a proposed row and nothing else happens until the
 * person confirms it (confirmChange in lib/ask/changes.ts, which takes a
 * People proposal by the text it hangs from).
 *
 * Not the hand-off from the registry list: a person on People is handed it
 * only with a session starter (plan #3005.2, lib/talk/session-handoff.ts),
 * whose session replies in their own thread. And not the chart, which only
 * an Ask answer draws.
 *
 * No clients here: lib/talk/ask-request.ts binds a PeopleDash to the request,
 * and the tests hand in stubs.
 */

/** Every tool Ask Dash offers, but the hand-off and the chart. */
export const PEOPLE_TOOLS: readonly DashTool[] = ASK_DASH_TOOLS.filter(
  (tool) => tool.kind !== 'handoff' && tool.name !== CHART_TOOL,
);

/**
 * The tools run on Anthropic's side that every person on People has beside
 * PEOPLE_TOOLS (plan #2861): web search, so the builder or the CFO can look
 * something up mid-chat. Ask's search, for the model they answer with.
 */
export function peopleServerTools(model: string): Anthropic.ToolUnion[] {
  return [dashWebSearch(model)];
}

/**
 * What a person on People is told about the web: Ask's rules, and that a
 * text names its source, since a thread shows no citations under it.
 */
export const PEOPLE_WEB_RULES = `${WEB_RULES} In a text, also name the site a fact came
from and give its link, since nothing is shown under a text.`;

/**
 * What a person on People is told about acting, after their own card and
 * the texting rules: their focus is a lean, not a wall, and then Ask's rules
 * for every change, word for word.
 */
const ACTING_OPENING = `YOU CAN DO THINGS, NOT ONLY TALK. You have the same tools Dash has in Ask
Dash, and the same rules for them, below. When they ask you to do something
("add a todo to call the bank Friday", "add a step for X", "note that on the
role"), do it with the tool, whatever your own focus is: your focus is what
you notice and bring up, never a reason to refuse or to send them elsewhere.
Only act when they ask, or when they plainly agree to something you offered.
Then say in one short text what you did, in your own voice, and nothing about
tools. Each change shows in the thread with its Undo.`;

const NO_HAND_OFF = `There is no hand_off here. When they ask for something none of your tools can
do, say so in a sentence and that Ask Dash can pass it on.`;

/**
 * The acting rules, for a person who can hand work to a session (plan
 * #3005.2, SESSION_RULES in lib/talk/session-handoff.ts) or cannot.
 */
export function peopleActionRules(canHandOn: boolean): string {
  return [ACTING_OPENING, ...(canHandOn ? [] : [NO_HAND_OFF]), ASK_ACTION_RULES].join('\n\n');
}

export const PEOPLE_ACTION_RULES = peopleActionRules(false);

/** What acting on People needs from the request: Ask's writes, proposals and paid presses, bound to the person. */
export type PeopleDash = {
  /** Runs a registry write as the person: the tool's `apply` with their clients and the rows seen. */
  apply: (
    tool: DashWriteTool,
    input: unknown,
    seen: DashSeen,
    /** The thread and text that asked, so a refusal kept as a slip names them (plan #2999). */
    cause?: PeopleCause,
  ) => Promise<DashWriteResult | DashRecordedWrite | { ok: false; error: string }>;
  /** Keeps a slip, such as a reply that ran out of its turn (plan #2999). Never throws. Absent: not kept. */
  recordSlip?: (slip: DashSlip) => Promise<void>;
  /** Keeps a write's record, naming who made it and where (insertPeopleChange). */
  saveChange: (made: MadeDashChange, cause: PeopleCause) => Promise<DashChange>;
  /** Checks a proposal against the person's rows and keeps it with `save` (executeProposal). */
  propose: (
    name: string,
    input: unknown,
    seen: DashSeen,
    save: (change: NewDashChange) => Promise<DashChange>,
  ) => Promise<AskToolResult>;
  /** Checks and prices a paid press as the person, without keeping it (queuePaidPress). */
  queue: (tool: DashPaidTool, input: unknown, seen: DashSeen) => Promise<PaidQueued>;
  /** Keeps a proposal or a queued press as proposed, under the text that asked (insertPeopleProposal). */
  saveProposal: (change: NewDashChange, cause: PeopleCause) => Promise<DashChange>;
};

/** The loop's hooks for one reply, and what the reply did through them. */
export type PeopleActing = {
  write: DashWriter;
  propose: DashProposer;
  queue: DashQueuer;
  /** Every change made or proposed in this reply, as kept, in order. */
  changes: DashChange[];
};

/** What the model is told once a write is made and kept. */
export function madeNote(summary: string, kept: boolean): string {
  return kept
    ? `Done: ${summary} It shows in the thread with its Undo, and on Home. Say in a short text what you did.`
    : `Done: ${summary} Its Undo could not be kept, so tell them it is done and can be changed back on its page.`;
}

/**
 * The write, proposal and paid hooks for one reply by the person in `cause`.
 * Never throw: a refusal or a failure comes back as what to tell the model.
 */
export function peopleActing(dash: PeopleDash, cause: PeopleCause): PeopleActing {
  const changes: DashChange[] = [];

  const save = async (change: NewDashChange) => {
    const kept = await dash.saveProposal(change, cause);
    changes.push(kept);
    return kept;
  };

  const write: DashWriter = async (tool, args, seen) => {
    let result: Awaited<ReturnType<PeopleDash['apply']>>;
    try {
      result = await dash.apply(tool, args, seen, cause);
    } catch (error) {
      console.error(`people write ${tool.name} failed`, error);
      return { ok: false, error: 'That change could not be made. Tell them nothing was changed.' };
    }
    if (!result.ok) return { ok: false, error: result.error };
    // A row thread's own tool, which People never offers.
    if ('recorded' in result) return { ok: false, error: 'That cannot be done from here. Answer in words.' };
    const made = {
      kind: result.kind,
      input: result.input,
      subjectRef: result.subjectRef,
      op: result.op,
      before: result.before,
      after: result.after,
      summary: result.summary,
      undo: result.undo ?? null,
    } as MadeDashChange;
    try {
      changes.push(await dash.saveChange(made, cause));
    } catch (error) {
      console.error(`people write ${tool.name} was made but not kept`, error);
      return { ok: true, rows: [result.row], note: madeNote(result.summary, false) };
    }
    return { ok: true, rows: [result.row], note: madeNote(result.summary, true) };
  };

  const propose: DashProposer = async (name, args, seen) => {
    try {
      return await dash.propose(name, args, seen, save);
    } catch (error) {
      console.error(`people proposal ${name} failed`, error);
      return { ok: false, error: 'That could not be proposed. Tell them nothing was changed.' };
    }
  };

  const queue: DashQueuer = async (tool, args, seen) => {
    let queued: PaidQueued;
    try {
      queued = await dash.queue(tool, args, seen);
    } catch (error) {
      console.error(`people paid tool ${tool.name} was not checked`, error);
      return { ok: false, error: 'That could not be queued. Tell them nothing was run.' };
    }
    if (!queued.ok) return { ok: false, error: queued.error };
    let kept: DashChange;
    try {
      kept = await save(queued.change);
    } catch (error) {
      console.error(`people paid tool ${tool.name} was not queued`, error);
      return { ok: false, error: 'That could not be queued. Tell them nothing was run.' };
    }
    return { ok: true, rows: [], totals: { queued: { id: kept.id, kind: kept.kind, input: kept.input } }, note: queued.note };
  };

  return { write, propose, queue, changes };
}
