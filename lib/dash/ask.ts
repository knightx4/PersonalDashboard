import type Anthropic from '@anthropic-ai/sdk';
import type { SpendSink } from '@/lib/core/spend/pricing';
import type { AskToolResult } from '@/lib/ask/db';
import type { PageContext } from '@/lib/ask/page';
import type { DashChange, MadeDashChange, NewDashChange } from '@/lib/talk/changes';
import { HANDED_OFF, handoffRequest, type DashHandoff } from '@/lib/talk/handoff';
import { DASH_MODELS } from './models';
import type { DashFile } from './files';
import { askTitle, bodyWithFileNames, MAX_TURN, type NewTalkTurn, type TalkCitation, type TalkSubject, type TalkTurn } from '@/lib/talk/talk';
import type { UploadedAttachment } from '@/lib/attachments/rules';
import {
  MAX_LOOKUPS,
  runDash,
  type DashAnswer,
  type DashExecutor,
  type DashLookupEvent,
  type DashProposer,
  type DashQueuer,
  type DashSeen,
  type DashStop,
  type DashVoice,
  type DashWriter,
} from './loop';
import { lookupInScope } from '@/lib/ask/tools';
import { moduleById, type ModuleId } from '@/lib/modules';
import { ASK_DASH_TOOLS, type DashPaidTool, type DashRecordedWrite, type DashWriteResult, type DashWriteTool } from './registry';
import type { PaidQueued } from './paid';

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
fit what they asked about, list_rows does. table_info gives a table's columns
and the tables it links to. query_rows answers a precise question about one
table in a single call: the rows where a column is empty, equals or passes a
value, how many there are, or how many at each value of a column. Its linked
conditions keep the rows that have, or have none of, a row of another table
linked to them, so "which applications have no answers" is one call too.
When a question is about many rows and what is linked to each, use
query_rows before looking each row up in turn. Check the column names and
links with table_info first when you are not sure of them. Every
lookup says how many rows matched and how many it showed; when it showed
fewer, say so rather than counting the rows you were given.

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
lookup returned for it. Cite only rows a lookup returned. Name a plan step by
its outline, such as #1073.4, the way the plan page heads it, never by the
stored number. For an email, say
who sent it, the day it arrived and its subject, and cite it the same way:
the person opens it in Gmail from there. When the question is about what an
email says, find it with search_mail, then open it with read_mail and answer
from its text. Open only the messages the question is about, and quote no
more of the text than the answer needs. When they give a company's careers
page or site and ask about its roles, read them with read_job_board, and give
the link with each role you suggest.

A NUMBER CAN BE DRAWN, AND SO CAN WHAT IT IS MADE OF. Call show_chart with
figures exactly as a lookup gave them, then answer; the chart is drawn under
your answer, so say in a sentence or two what it shows (the change, the
largest row) rather than listing every figure again.
- When they ask for one amount for a period, such as what they spent in
  September or how many applications they sent this month, draw it as a
  figure with the usual amount as its reference. For spending, ask
  spend_by_merchant from three months before the period to its end: its
  months give both the amount and the usual one, the average of the three
  months before. Where a note or goal of theirs sets a target, such as a
  monthly budget, use the target instead and name it.
- When they ask how an amount changes over time, draw columns, oldest
  first, with the target as the reference when there is one.
- When they ask how something splits, such as spending by shop or
  applications by status, and a lookup gives three or more figures, draw a
  bar. A figure for the total and a bar for the shops behind it is a good
  pair; never draw more than two.

YOU MAKE THE CHANGES THEY ASK FOR, AND ONLY WHEN ASKED. When they ask you to
add, rename, move or tick off a todo, add a goal under one of their areas,
add a step under a goal or mark one done, set or change a goal's done-when,
say they sent an item back, note something on a role, save a job to their
leads, add an interview round to a role, write the prep note for a round (only when they ask to be prepared, since it can cost a model run, and never as part of adding a round), file an idea for the app, save a
quick thought as a note in their vault, change many of their shopping items
at once, or move or archive many job roles at once, call the tool for it:
add_todo, change_todo, close_todo, add_goal, add_goal_step, close_goal_step,
set_goal_done_when, mark_returned, add_role_note, add_job_lead,
add_interview_round, link_round_email, write_prep_note, add_idea, add_quick_note, change_items or move_roles. A
job is saved from its posting link when they give one. In Learn, when they ask to change a reading (its status, the Read
now shelf, their note, its text or its link), start a reading list, add
something to one, reword an idea, note on an idea or a card, or mark or move
a video, call change_reading, add_learn_track, add_track_reading,
reword_concept, add_concept_note or change_video. In Todo, when they ask to
write a todo's notes, pin it, put it off or bring it back, drop or reopen it,
add an item to its list, say what it is about, or add or change an event on
their calendar, call edit_todo, add_todo_item, link_todo, add_event or
change_event. To finish, put off or dismiss a row another workspace put on
their agenda, find it with agenda and call change_agenda_row. In News, when they ask to mark a newsletter unread, save or
unsave a story, send one to Learn or make a todo from one, call
mark_issue_unread, save_story, send_story_to_learn or make_todo_from_story;
when they ask to stop a price watch, call stop_watch. In Goals, when they ask
to add, rename, reorder or archive an area or write what they want from it,
call change_goal_area; to reword a goal, date it, move it to another area,
reorder, archive, close, park or reopen it, call change_goal; to edit, drop,
reopen, block, move or archive a step, count it towards another goal or make
it wait on another step, or set it aside until a later day or bring it back, call change_goal_step; to set a goal's measure, its
links or an information step's form, call change_goal_number, change_goal_link
or change_goal_form; to snooze a row on the Goals Inbox or record whether they went to an event, call change_goals_inbox. In Shopping, to
change one item's name, variant, notes, group name or sell price, call
change_item; to put items on a list, take them off or rename a list, call
item_lists; to add books, games or other things they own, call add_items; to save a product for later, edit it, mark it bought, put it aside or bring it back, call change_saved_item. To enter an order they describe or show on a receipt, call add_order; to tag an order line or untag it, call order_item_tags; to confirm, put back, discard or restore orders in the review queue, dismiss or undismiss a waiting email, or attach one to its order, call review_orders. In Jobs, to change a role's title, location, pay, posting or company, call
 item_lists; to add books, games or other things they own, call add_items; to save a product for later, edit it, mark it bought, put it aside or bring it back, call change_saved_item. To rename a recurring payment, leave it out of the monthly total or count it again, merge two or move some of its charges to another, call change_recurring; to set how long a shop gives them to return things, call return_window; to add someone they shop for or rename one, call change_person. In Jobs, to change a role's title, location, pay, posting or company, call
change_role; to set how excited they are about one, how they applied, whether it is ready to apply or whether it has a cover letter, call
change_application; to add the questions an application asks, call add_application_questions; to save an answer to one, keep a drafted answer with what it rests on, approve it or mark it submitted, call save_answer, and to write or rewrite one from their evidence, write it yourself from list_rows on job_search.evidence_items and the role's description, then call save_answer; to make an answer the default reused for a question on every application, call set_default_answer; to rename a company or correct its details, call change_company; to fold duplicate roles into one, call merge_roles; to finish, put off, reword, move or link a reminder to an email, call change_reminder; to finish or put off a row waiting on them, call change_waiting; to link an email to a role, turn a suggested one down or take one off a role, call change_role_email; in Jobs review, to confirm or reopen an application, call review_application, and to clear the flag on events that conflict with a pursuit or flag them again, call review_events, and to dismiss emails waiting there or bring dismissed ones back, call review_emails, and to make a new role from an email waiting there, call add_role_from_email; to add or correct a contact, call change_contact; to log that they reached out to someone, correct that entry or mark it answered, call change_touch; when they have messaged a person Dash suggested, call mark_suggestion_sent. From Material, Settings and Find, to add a story to their evidence bank, call add_evidence; to add a resume version, call add_resume_version; to keep a PDF they sent you as a version's file, call attach_resume_pdf; to write or reword a career goals entry, call change_career_thought; to add a startup Find discovered to their companies, call add_discovered_company. On a role's interviews, to correct an interview's kind, status, date or notes, call change_interview; to name who interviewed them or take someone off, call change_interviewer; to rename, renumber or write notes on a round, gather rounds into one, split an interview into a round of its own or take an email off a round, call change_interview_round. In the Vault, to write
a note, change or rename one, file a quick note, or rename a theme or a
thread with Maya, call write_vault_note, edit_vault_note, rename_vault_note,
file_quick_note, rename_theme or rename_maya_question; to keep a transcript
or correct a course, call save_transcript or change_course. When they tell you about a place they have lived, or ask to
change one, call add_place or change_place; when they tell you about a job
or ask to correct one, call save_job. When they ask for one of their X post
drafts on the Posts tab in Dev to be shortened or reworded, call rewrite_post
with the whole new text. When they state a rule for many items or
roles ("everything from the March Amazon order", "every role I applied to
before August with no reply"), find the rows with your lookups and make it
one change_items or move_roles call, never one call per row. The
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

A BUILD IS PROPOSED, NOT STARTED. When they ask you to build, start, send or
restart a step on the plan, look the step up with read_dev_row and call
propose_build, never hand_off. Nothing starts until they confirm the card,
which names the step and says the start cannot be undone, so your sentence
need not repeat either: say only what the card does not, such as how long a
quiet run has gone without pushing.
When it is refused, say why in plain words and do not propose anything else.

A DELETE IS PROPOSED, NOT DONE. When they ask you to remove rows, call propose_delete
with the refs a lookup returned; nothing is deleted until they confirm the card,
and a confirmed delete can be undone. For repeated application answers ("remove
my duplicate answers"), call duplicate_answers first and propose only the rows
with remove true, naming in your answer the copy that stays. Where the copies
are worded differently, propose nothing: show each wording and ask which to
keep, then propose the others. A submitted answer is never proposed. Say which
answers you proposed removing and why, and that nothing is gone until they
confirm.

ANYTHING ELSE THEY ASK YOU TO DO, HAND ON. When they ask you to create or
change something none of your tools can (a job application, a contact, a
vault note, a goal's done-when), or to do work your lookups cannot finish
(drafting something long, sorting or tidying many rows), call hand_off with the request written out
in full, including every detail they gave and the refs of rows you looked up
for it. A routine does it within a few minutes and its reply appears in this
conversation. Then say in a sentence that you have passed it on; do not say
it is done, and do not propose something near it instead. Never hand on a
question you can answer by looking things up, and never a request to delete
something (application answers are the exception, above: propose_delete), send an email or spend money: for those, say you cannot. Those
three are the only requests you turn down; anything else is looked up, done
with a tool, or handed on.

THE PAGE THEY ASKED FROM IS CONTEXT FOR "THIS". A line after these rules may say
which page of the app they asked from, and the row it shows. When the question
points at that row, by "this", "here", "it" or by its subject, look the row up
first with the tool the line names, and answer about it. When the question is
about anything else, ignore the page and answer as if it had not been said.`;

/** How Dash speaks on Ask: Sonnet, the rules above, and every registered tool but a thread's own. */
export const ASK_VOICE: DashVoice = { model: ASK_MODEL, system: SYSTEM, tools: ASK_DASH_TOOLS };

/**
 * Ask's voice for a question kept to one workspace (plan #1899.5): every
 * tool but the lookups outside it (lookupInScope). Writes stay, since a
 * change the person asks for is not a lookup.
 */
export function scopedVoice(scope: ModuleId | null | undefined): DashVoice {
  if (!scope) return ASK_VOICE;
  return { ...ASK_VOICE, tools: ASK_VOICE.tools.filter((tool) => tool.kind !== 'lookup' || lookupInScope(tool.name, scope)) };
}

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
  /** The files sent with the question, read, for the model to read (plan #1716). */
  files?: readonly DashFile[];
  /** YYYY-MM-DD in the person's timezone. */
  today: string;
  /** The page the question was asked from; null or absent when none is told. */
  page?: PageContext | null;
  execute: AskExecutor;
  /** Absent: every proposal is refused. */
  propose?: AskProposer;
  /** Absent: every write is refused. */
  write?: DashWriter;
  /** Absent: every paid tool is refused (plan #2228.1). */
  queue?: DashQueuer;
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
  /** Hears the answer's text as it is written (plan #1902); present, the calls stream. */
  onText?: (piece: string) => void;
  /** Stops the answer, keeping what was written (plan #1899.5). */
  signal?: AbortSignal;
  /** The workspace the question is kept to (plan #1899.5); null or absent for every one. */
  scope?: ModuleId | null;
}): Promise<AskAnswer> {
  const { page, scope, ...rest } = input;
  return runDash({
    ...rest,
    voice: scopedVoice(scope),
    context: {
      surface: 'ask',
      subject: null,
      page: page ?? null,
      scope: scope ? (moduleById(scope)?.label ?? scope) : null,
    },
  });
}

// ---------------------------------------------------------------------------
// Keeping the question, the answer and the spend
// ---------------------------------------------------------------------------

/** Where askDash reads and writes the conversation; store.ts bound to a client and a user. */
export type AskStores = {
  start: (question: string) => Promise<TalkSubject & { kind: 'ask' }>;
  load: (ref: string) => Promise<TalkTurn[]>;
  append: (subject: TalkSubject, turns: readonly NewTalkTurn[]) => Promise<TalkTurn[]>;
  /**
   * The files a question was sent with, downloaded and read (plan #1716).
   * Absent, or when it throws: Dash is told their names only.
   */
  readFiles?: (turnId: string) => Promise<DashFile[]>;
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

/**
 * Checks and prices a paid press as the person (queuePaidPress in
 * lib/dash/paid.ts, bound to a request), without keeping it (plan #2228.1).
 */
export type AskQueueRunner = (tool: DashPaidTool, input: unknown, seen: DashSeen) => Promise<PaidQueued>;

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
    /** Files uploaded with this question; kept against its turn (plan #1715). */
    files?: readonly UploadedAttachment[];
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
    /**
     * Checks and prices a paid press (plan #2228.1); the press is kept as a
     * proposal with the answer's others, and runs only on an approval.
     * Absent: every paid tool is refused.
     */
    queue?: AskQueueRunner;
    anthropicApiKey: string | null | undefined;
    client?: Anthropic;
    now?: () => number;
    /** Hears each lookup start and finish (AskLookupEvent). */
    onLookup?: (event: AskLookupEvent) => void;
    /** Hears the answer's text as it is written (plan #1902). */
    onText?: (piece: string) => void;
    /**
     * Hears the question once it is kept, before Dash is asked (plan
     * #1899.5): the streaming route tells the browser, so a question stopped
     * mid-answer can be found again.
     */
    onAsked?: (asked: { conversation: { ref: string; title: string | null }; turns: TalkTurn[] }) => void;
    /** Stops the answer; what was written by then is kept as it (plan #1899.5). */
    signal?: AbortSignal;
    /** Rows the person added with @, kept on the question as its citations (plan #1899.5). */
    mentions?: readonly TalkCitation[];
    /** The workspace the question is kept to (plan #1899.5). */
    scope?: ModuleId | null;
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
    asked = await stores.append(subject, [
      {
        role: 'user',
        body: question,
        files: input.files,
        ...(input.mentions?.length ? { citations: input.mentions } : {}),
      },
    ]);
  } catch {
    return { turns: [], error: 'Your question was not kept. Try again.' };
  }
  const conversation = { ref: subject.ref, title: subject.title ?? null };
  try {
    input.onAsked?.({ conversation, turns: asked });
  } catch (error) {
    console.error('ask question listener failed', error);
  }

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
  // A paid press is checked and priced, then kept as a proposal like any
  // other: nothing runs until the person approves it (plan #2228.1).
  const queueRun = input.queue;
  const queue: DashQueuer | undefined = queueRun
    ? async (tool, args, seen) => {
        const queued = await queueRun(tool, args, seen);
        if (!queued.ok) return { ok: false, error: queued.error };
        let kept: DashChange;
        try {
          kept = await save(queued.change);
        } catch (error) {
          console.error(`ask paid tool ${tool.name} was not queued`, error);
          return { ok: false, error: 'That could not be queued. Tell them nothing was run.' };
        }
        return { ok: true, rows: [], totals: { queued: { id: kept.id, kind: kept.kind, input: kept.input } }, note: queued.note };
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
  // The newest question's files are read and sent to the model (plan #1716);
  // earlier questions' files are named in the history and not sent again.
  const conversationSoFar = [...earlier, ...asked];
  const newest = conversationSoFar.findLastIndex((turn) => turn.role === 'user');
  let files: DashFile[] | undefined;
  const sentNow = conversationSoFar[newest];
  if (sentNow?.files?.length && stores.readFiles) {
    try {
      files = await stores.readFiles(sentNow.id);
    } catch (error) {
      console.error('the files sent with a question were not read', error);
    }
  }
  const answer = await answerQuestion({
    turns: conversationSoFar.map((turn, index) =>
      index === newest && files?.length ? turn : { ...turn, body: bodyWithFileNames(turn) },
    ),
    files,
    today: input.today,
    page: input.page,
    execute: input.execute,
    propose: propose ? (name, args, seen) => propose(name, args, seen, save) : undefined,
    write,
    queue,
    handOff,
    anthropicApiKey: input.anthropicApiKey,
    client: input.client,
    now: input.now,
    onLookup: input.onLookup,
    onText: input.onText,
    signal: input.signal,
    scope: input.scope,
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
