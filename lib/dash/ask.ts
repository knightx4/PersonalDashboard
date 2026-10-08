import type Anthropic from '@anthropic-ai/sdk';
import type { SpendSink } from '@/lib/core/spend/pricing';
import type { AskToolResult } from '@/lib/ask/db';
import type { PageContext } from '@/lib/ask/page';
import type { DashChange, MadeDashChange, NewDashChange } from '@/lib/talk/changes';
import { HANDED_OFF, handoffRequest, type DashHandoff } from '@/lib/talk/handoff';
import { DASH_MODELS } from './models';
import { askTitle, MAX_TURN, type NewTalkTurn, type TalkSubject, type TalkTurn } from '@/lib/talk/talk';
import {
  MAX_LOOKUPS,
  runDash,
  type DashAnswer,
  type DashExecutor,
  type DashLookupEvent,
  type DashProposer,
  type DashSeen,
  type DashStop,
  type DashVoice,
  type DashWriter,
} from './loop';
import { ASK_DASH_TOOLS, type DashRecordedWrite, type DashWriteResult, type DashWriteTool } from './registry';

/**
 * Ask Dash: Dash answering a question about anything in the app (plan
 * #1089), on the shared loop in lib/dash/loop.ts since plan #1463.
 *
 * Ask's voice offers every tool in the registry (lib/dash/registry.ts): the
 * lookups, the writes (lib/dash/writes.ts, plan #1440: a todo added,
 * renamed, moved or ticked off, a goal or a step added, a step closed, an
 * item marked returned, a note on a role), the one proposal left (a watch
 * on a price, plan #1296), and `hand_off` (lib/talk/handoff.ts, plan #1402).
 * A write happens when Dash makes it and is kept as a done row in
 * core.dash_actions, which the answer's card offers to Undo. A proposal is
 * kept as a proposed row and nothing else is written until the person
 * confirms it. A hand-off keeps the request, the answer says it was passed
 * on, and the backup routine is started once the answer is kept.
 *
 * `answerQuestion` is the loop with Ask's voice. `askDash` below it keeps the
 * turns and the spend through the stores it is handed;
 * lib/talk/ask-request.ts hands it the real ones inside a request.
 */

export const ASK_MODEL = DASH_MODELS.ask;

const SYSTEM = `You are Dash, the assistant inside somebody's personal dashboard. It holds their
shopping orders, job applications, notes, todos, reading, videos, newsletters,
Learn cards, goals and build plan, and much more, and can search the email in
the Gmail they connected. They ask you about their own things, ask you to
choose or suggest from them, and ask you to change them.

THEIR THINGS REACH FURTHER THAN THAT LIST. list_rows reads any table that
holds what they wrote, saved, did or have, including tables no other lookup
covers, such as the videos on their watch list. When the other lookups do not
fit what they asked about, list_rows does.

LOOK IT UP. Answer from what the lookup tools return, never from memory or a
guess about what they probably have. Work out which lookups the question needs
and make them; where two are independent, make them in the same turn. You
have at most ${MAX_LOOKUPS} lookups for one answer, so choose them well.
When they ask what they said, wrote or think about something, start with
recall, and keep their own words apart from anything Dash wrote for them.

WHEN THEY ASK YOU TO PICK, SUGGEST OR RECOMMEND, CHOOSE FROM WHAT THEY HAVE.
"Give me a good video to watch", "what should I read next", "which role
should I chase first" are answered by looking up the rows they already have
and choosing one, or a few, saying why from what the rows say: a verdict, a
summary, a date, what they wrote. Prefer what they have not finished or
watched yet. You cannot browse the web, and you do not need to: what they
saved is what they are asking about.

WHEN THE DATA CANNOT ANSWER IT, SAY SO, BUT ONLY AFTER LOOKING. Never say you
cannot see or do something before you have made a lookup for it. If the
lookups do not hold what the question needs, or a workspace is switched off,
answer "I cannot see that" and say in a sentence what you could see instead.
Do not fill the gap with a likely answer. Whenever an answer does not do what
they asked, say what was missing in the answer tool's could_not, so the
ability gets built.

ANSWER THROUGH THE answer TOOL. Match the length to what they said. A remark
that needs nothing back ("thanks", "looks good") gets one short sentence, such
as "Glad that helped." A simple question gets its answer in a sentence or two.
Use more, or a short list when they asked for a list, only when there is a
lot to say, and never pad. A change you made is always said in words. Give figures exactly as the lookups gave
them, with their currency. Name each order, application, note, step or other
row you used by its title, and list each in cited by the table and ref the
lookup returned for it. Cite only rows a lookup returned. For an email, say
who sent it, the day it arrived and its subject, and cite it the same way:
the person opens it in Gmail from there. When the question is about what an
email says, find it with search_mail, then open it with read_mail and answer
from its text. Open only the messages the question is about, and quote no
more of the text than the answer needs.

A BREAKDOWN CAN BE DRAWN. When they ask how something splits or changes over
time, such as where their money went, spending by shop or month, or where
their applications are stuck, and a lookup gives three or more figures to
compare, call show_chart with those figures exactly as the lookup gave them,
then answer. It is drawn under your answer, so say in a sentence or two what
it shows (the largest row, the change) rather than listing every figure.

YOU MAKE THE CHANGES THEY ASK FOR, AND ONLY WHEN ASKED. When they ask you to
add, rename, move or tick off a todo, add a goal under one of their areas,
add a step under a goal or mark one done, say they sent an item back, or note
something on a role, call the tool for it: add_todo, change_todo, close_todo,
add_goal, add_goal_step, close_goal_step, mark_returned or add_role_note. The
change is made when you call it, and shows as a card under your answer with
an Undo. A todo, a goal, a step, an item or a role is named by the ref a
lookup returned for it, so look it up first; an area is named by its name.
A goal goes under the area it plainly belongs to; when none of theirs fits,
make one for it with add_goal's new_area and say you did, rather than asking.
When you cannot tell which row they mean, ask rather than guess. Say in your
answer what you did, and cite the row the tool returned so they can open it.
Never change something they only asked about.

A WATCH IS PROPOSED, NOT STARTED. When they ask you to watch a price on a page
outside the app, or to tell them when it drops, call propose_watch. Nothing is
written: it shows as a card under your answer and they confirm or decline it.
Say what it will do and when it stops.

ANYTHING ELSE THEY ASK YOU TO DO, HAND ON. When they ask you to create or
change something none of your tools can (a job application, a contact, a
vault note, a goal's done-when), or to do work your lookups cannot finish
(drafting something long, sorting or tidying many rows), call hand_off with the request written out
in full, including every detail they gave and the refs of rows you looked up
for it. A routine does it within a few minutes and its reply appears in this
conversation. Then say in a sentence that you have passed it on; do not say
it is done, and do not propose something near it instead. Never hand on a
question you can answer by looking things up, and never a request to delete
something, send an email or spend money: for those, say you cannot. Those
three are the only requests you turn down; anything else is looked up, done
with a tool, or handed on.

THE PAGE THEY ASKED FROM IS CONTEXT FOR "THIS". A line after these rules may say
which page of the app they asked from, and the row it shows. When the question
points at that row, by "this", "here", "it" or by its subject, look the row up
first with the tool the line names, and answer about it. When the question is
about anything else, ignore the page and answer as if it had not been said.`;

/** How Dash speaks on Ask: Sonnet, the rules above, and every registered tool but a thread's own. */
export const ASK_VOICE: DashVoice = { model: ASK_MODEL, system: SYSTEM, tools: ASK_DASH_TOOLS };

export type AskStop = DashStop;
export type AskAnswer = DashAnswer;
export type AskLookupEvent = DashLookupEvent;
export type AskExecutor = DashExecutor;
export type AskProposer = DashProposer;

/**
 * Dash's answer to the last of the turns, which is the person's question:
 * the shared loop with Ask's voice and no subject row. Never throws.
 */
export async function answerQuestion(input: {
  /** The conversation so far, oldest first, ending with the question. */
  turns: readonly Pick<TalkTurn, 'role' | 'body' | 'citations'>[];
  /** YYYY-MM-DD in the person's timezone. */
  today: string;
  /** The page the question was asked from; null or absent when none is told. */
  page?: PageContext | null;
  execute: AskExecutor;
  /** Absent: every proposal is refused. */
  propose?: AskProposer;
  /** Absent: every write is refused. */
  write?: DashWriter;
  /**
   * Keeps a hand-off and returns what to tell the model. Absent: every
   * hand-off is refused. `seen` says whether Dash has seen the row it names.
   */
  handOff?: (input: unknown, seen: DashSeen) => Promise<AskToolResult>;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
  /** For tests: the clock the time budget reads. */
  now?: () => number;
  /** Hears each lookup start and finish. Whatever it throws is ignored. */
  onLookup?: (event: AskLookupEvent) => void;
}): Promise<AskAnswer> {
  const { page, ...rest } = input;
  return runDash({ ...rest, voice: ASK_VOICE, context: { surface: 'ask', subject: null, page: page ?? null } });
}

// ---------------------------------------------------------------------------
// Keeping the question, the answer and the spend
// ---------------------------------------------------------------------------

/** Where askDash reads and writes the conversation; store.ts bound to a client and a user. */
export type AskStores = {
  start: (question: string) => Promise<TalkSubject & { kind: 'ask' }>;
  load: (ref: string) => Promise<TalkTurn[]>;
  append: (subject: TalkSubject, turns: readonly NewTalkTurn[]) => Promise<TalkTurn[]>;
  /** Writes what the calls cost, under the operation 'ask-dash'. Never throws. */
  recordSpend: (reports: Parameters<SpendSink>[0][]) => Promise<void>;
  /** Keeps a proposal in the conversation (changes.ts insertProposal). */
  saveProposal: (conversationId: string, change: NewDashChange) => Promise<DashChange>;
  /** Keeps a change Dash made as done (changes.ts insertMadeChange). Absent: every write is refused. */
  saveChange?: (conversationId: string, made: MadeDashChange) => Promise<DashChange>;
  /** Ties the answer's proposals to its turn once that is written. */
  attachProposals: (ids: readonly string[], turnId: string) => Promise<void>;
  /** Removes the proposals of an answer that was not kept. */
  discardProposals: (ids: readonly string[]) => Promise<void>;
  /** Keeps a hand-off as pending (handoffs.ts insertHandoff). Absent with no fireHandoff. */
  saveHandoff?: (conversationId: string, request: string, subjectRef: string | null) => Promise<DashHandoff>;
  /** Ties the answer's hand-offs to its turn once that is written. */
  attachHandoffs?: (ids: readonly string[], turnId: string) => Promise<void>;
  /** Removes the hand-offs of an answer that was not kept. */
  discardHandoffs?: (ids: readonly string[]) => Promise<void>;
  /** Starts the backup routine on one hand-off and records the outcome; returns its new status. */
  fireHandoff?: (handoff: DashHandoff) => Promise<{ status: DashHandoff['status']; error?: string }>;
  /**
   * Files what an answer could not do as a note in the Dev notes queue, so
   * the missing ability is built (gapNote). Never throws. Absent: not filed.
   */
  noteGap?: (body: string, conversationRef: string) => Promise<void>;
};

/**
 * The note filed when an answer could not do what was asked: the model's
 * sentence for what was missing, then the question as asked.
 */
export function gapNote(couldNot: string, question: string): string {
  const asked = question.length > 600 ? `${question.slice(0, 600)}…` : question;
  return `Ask Dash could not do this: ${couldNot}\n\nAsked: "${asked}"`;
}

/** Checks a proposal against the person's rows and keeps it; lib/ask/propose.ts bound to a request. */
export type AskProposalRunner = (
  name: string,
  input: unknown,
  seen: (table: string, ref: string) => boolean,
  save: (change: NewDashChange) => Promise<DashChange>,
) => Promise<AskToolResult>;

/** A write tool run as the person: the tool's apply with their context bound. */
export type AskWriteRunner = (
  tool: DashWriteTool,
  input: unknown,
  seen: DashSeen,
) => Promise<DashWriteResult | DashRecordedWrite | { ok: false; error: string }>;

/** What the model is told once a change is made and kept. */
function madeNote(summary: string): string {
  return `Done: ${summary} It shows under your answer with an Undo. Say what you did, and cite the row this returned.`;
}

export type AskDashResult = {
  /** The conversation, to reopen or continue; absent only when nothing was kept. */
  conversation?: { ref: string; title: string | null };
  /** The turns written by this call, oldest first: the question, then the answer when there is one. */
  turns: TalkTurn[];
  /** Why there is no answer, in a sentence for the person. */
  error?: string;
  /** Why the answer stopped: 'answered', or the limit it was written under. */
  stop?: AskStop;
  /** The changes the answer made or proposed, each tied to its turn, in the order made. */
  changes?: DashChange[];
  /** The requests the answer handed to the backup routine, with what starting it did. */
  handoffs?: DashHandoff[];
};

/**
 * Ask Dash a question, starting a conversation or continuing one. The
 * question is kept before the model is called, so a failed answer still
 * leaves it in the list of past questions. What the calls cost is recorded
 * whether or not an answer came of them.
 */
export async function askDash(
  input: {
    question: string;
    /** An `ask` conversation's ref, to continue it; absent to start a new one. */
    conversationRef?: string | null;
    today: string;
    /**
     * The page it was asked from, resolved (lib/ask/page.ts). Not kept with
     * the conversation: each question carries the page it was asked on.
     */
    page?: PageContext | null;
    execute: AskExecutor;
    /** Absent: every proposal is refused. */
    propose?: AskProposalRunner;
    /**
     * Runs a write tool's `apply` with the person's context bound (the
     * request's clients and the rows Dash has seen). Absent, or with no
     * `saveChange` store: every write is refused.
     */
    write?: AskWriteRunner;
    anthropicApiKey: string | null | undefined;
    client?: Anthropic;
    now?: () => number;
    /** Hears each lookup start and finish (AskLookupEvent). */
    onLookup?: (event: AskLookupEvent) => void;
  },
  stores: AskStores,
): Promise<AskDashResult> {
  const question = input.question.trim();
  if (!question) return { turns: [], error: 'Write a question first.' };
  if (question.length > MAX_TURN) {
    return { turns: [], error: `That is ${question.length} characters; the most is ${MAX_TURN}.` };
  }

  let subject: TalkSubject & { kind: 'ask' };
  let earlier: TalkTurn[] = [];
  let asked: TalkTurn[];
  try {
    if (input.conversationRef) {
      earlier = await stores.load(input.conversationRef);
      if (earlier.length === 0) return { turns: [], error: 'That conversation is not there any more.' };
      subject = { kind: 'ask', ref: input.conversationRef, title: askTitle(earlier[0].body) || null };
    } else {
      subject = await stores.start(question);
    }
    asked = await stores.append(subject, [{ role: 'user', body: question }]);
  } catch {
    return { turns: [], error: 'Your question was not kept. Try again.' };
  }
  const conversation = { ref: subject.ref, title: subject.title ?? null };

  if (!input.anthropicApiKey) {
    return { conversation, turns: asked, error: 'This deployment has no ANTHROPIC_API_KEY, so Dash cannot answer.' };
  }

  const spent: Parameters<SpendSink>[0][] = [];
  // An ask conversation's id is its ref (conversations_ask_ref_ck).
  const proposed: DashChange[] = [];
  const propose = input.propose;
  const save = async (change: NewDashChange) => {
    const kept = await stores.saveProposal(subject.ref, change);
    proposed.push(kept);
    return kept;
  };
  // A write is made at once and kept as done; it joins the proposals so its
  // card hangs from the answer the same way. A write is not taken back when
  // the answer fails: the person asked for it, and it shows in Ask's list.
  const apply = input.write;
  const saveChange = stores.saveChange;
  const write: DashWriter | undefined =
    apply && saveChange
      ? async (tool, args, seen) => {
          const result = await apply(tool, args, seen);
          if (!result.ok) return { ok: false, error: result.error };
          // A thread's own tool, which Ask never offers.
          if ('recorded' in result) return { ok: false, error: 'That cannot be done from Ask. Answer in words.' };
          const { row } = result;
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
            proposed.push(await saveChange(subject.ref, made));
          } catch (error) {
            console.error(`ask write ${tool.name} was made but not kept`, error);
            return {
              ok: true,
              rows: [row],
              note: `Done: ${result.summary} Its Undo could not be kept, so tell them it is done and can be changed back on its page.`,
            };
          }
          return { ok: true, rows: [row], note: madeNote(result.summary) };
        }
      : undefined;
  const handed: DashHandoff[] = [];
  const saveHandoff = stores.saveHandoff;
  const handOff =
    saveHandoff && stores.fireHandoff
      ? async (args: unknown, seen: (table: string, ref: string) => boolean) => {
          const parsed = handoffRequest(args, seen);
          if (!parsed.ok) return { ok: false as const, error: parsed.error };
          try {
            handed.push(await saveHandoff(subject.ref, parsed.request, parsed.subjectRef));
          } catch {
            return { ok: false as const, error: 'The request could not be kept. Tell them it was not passed on.' };
          }
          return { ok: true as const, rows: [], note: HANDED_OFF };
        }
      : undefined;
  const discard = async () => {
    try {
      await stores.discardProposals(proposed.map((c) => c.id));
    } catch (error) {
      console.error('ask proposals were not removed', error);
    }
    try {
      if (handed.length > 0) await stores.discardHandoffs?.(handed.map((h) => h.id));
    } catch (error) {
      console.error('ask hand-offs were not removed', error);
    }
  };
  const answer = await answerQuestion({
    turns: [...earlier, ...asked],
    today: input.today,
    page: input.page,
    execute: input.execute,
    propose: propose ? (name, args, seen) => propose(name, args, seen, save) : undefined,
    write,
    handOff,
    anthropicApiKey: input.anthropicApiKey,
    client: input.client,
    now: input.now,
    onLookup: input.onLookup,
    onSpend: (report) => spent.push(report),
  });
  await stores.recordSpend(spent);
  // Filed whether or not the answer is kept: the gap is real either way.
  if (answer.ok && answer.couldNot && handed.length === 0) {
    await stores.noteGap?.(gapNote(answer.couldNot, question), subject.ref);
  }
  if (!answer.ok) {
    await discard();
    return { conversation, turns: asked, error: `Dash could not answer: ${answer.detail}` };
  }

  let answered: TalkTurn[];
  try {
    answered = await stores.append(subject, [
      { role: 'assistant', body: answer.body, toolCalls: answer.toolCalls, citations: answer.citations },
    ]);
  } catch {
    await discard();
    return { conversation, turns: asked, error: 'Dash answered, but the answer was not kept. Try again.' };
  }
  const turnId = answered[answered.length - 1].id;
  const handoffs = handed.length > 0 ? await startHandoffs(handed, turnId, subject, stores) : undefined;
  const turns = [...asked, ...answered, ...(handoffs?.failedTurns ?? [])];
  if (proposed.length === 0) return { conversation, turns, stop: answer.stop, handoffs: handoffs?.handoffs };

  // The answer is kept; its proposals now hang from it. Should tying them
  // fail, they stay in the conversation with no turn, and the answer's
  // tool calls still name each by id.
  let changes = proposed;
  try {
    await stores.attachProposals(proposed.map((c) => c.id), turnId);
    changes = proposed.map((c) => ({ ...c, turnId }));
  } catch (error) {
    console.error('ask proposals were not tied to the answer', error);
  }
  return { conversation, turns, stop: answer.stop, changes, handoffs: handoffs?.handoffs };
}

/**
 * Ties the answer's hand-offs to it and starts the routine on each, now that
 * the answer saying so is kept. A hand-off that could not be started gets a
 * turn of its own saying so, so the thread does not wait on a reply that
 * will not come.
 */
async function startHandoffs(
  handed: readonly DashHandoff[],
  turnId: string,
  subject: TalkSubject,
  stores: AskStores,
): Promise<{ handoffs: DashHandoff[]; failedTurns: TalkTurn[] }> {
  try {
    await stores.attachHandoffs?.(handed.map((h) => h.id), turnId);
  } catch (error) {
    console.error('ask hand-offs were not tied to the answer', error);
  }
  const handoffs: DashHandoff[] = [];
  const failures: string[] = [];
  for (const handoff of handed) {
    const fired = stores.fireHandoff
      ? await stores.fireHandoff(handoff)
      : { status: 'failed' as const, error: 'nothing is set up to take it' };
    handoffs.push({ ...handoff, turnId, status: fired.status, error: fired.error ?? null });
    if (fired.status === 'failed') failures.push(fired.error ?? 'it could not be started');
  }
  if (failures.length === 0) return { handoffs, failedTurns: [] };
  try {
    const failedTurns = await stores.append(subject, [
      {
        role: 'assistant',
        body: `That did not get passed on after all: ${failures[0]} Ask again later, or do it on the page.`,
      },
    ]);
    return { handoffs, failedTurns };
  } catch {
    return { handoffs, failedTurns: [] };
  }
}
