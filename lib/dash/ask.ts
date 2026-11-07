import { SESSION_OFFER } from '@/lib/talk/chat-to-session';
import Anthropic from '@anthropic-ai/sdk';
import type { SpendSink } from '@/lib/core/spend/pricing';
import type { AskToolResult } from '@/lib/ask/db';
import type { PageContext } from '@/lib/ask/page';
import type { DashChange, MadeDashChange, NewDashChange } from '@/lib/talk/changes';
import type { DashHandoff, SessionHandoffInput } from '@/lib/talk/handoff';
import { startSessionHandoff } from '@/lib/talk/session-handoff';
import { BOT_HANDOFF_RULES, HAND_TO_BOT, HAND_TO_BOT_TOOL_NAME, type BotPasser } from '@/lib/talk/hand-to-bot';
import { claimSlip, falseAttachment, NOTHING_ATTACHED_ASK, NOTHING_ATTACHED_ASK_CHART_ONLY } from '@/lib/talk/attachment-claim';
import { dashCodeExecution, fetchMadeFiles, madeFilesNote, type MadeFile, type UnkeptFile } from '@/lib/talk/made-files';
import { turnCharts } from '@/lib/talk/chart';
import { SAVED_RULES, turnAttached } from '@/lib/talk/attached';
import { DASH_MODELS } from './models';
import { dashWebSearch, WEB_RULES } from './web-search';
import type { DashChoiceId } from '@/lib/core/models';
import type { DashFile } from './files';
import { UNFINISHED_REASON, type DashFailure } from './failures';
import { budgetSlip, type DashSlip } from './slips';
import { askTitle, bodyWithFileNames, MAX_TURN, type NewTalkTurn, type TalkCitation, type TalkFile, type TalkSubject, type TalkTurn } from '@/lib/talk/talk';
import type { UploadedAttachment } from '@/lib/attachments/rules';
import {
  MAX_LOOKUPS,
  runDash,
  type DashAnswer,
  type DashCall,
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
import {
  THINK_EFFORT,
  THINK_MAX_TOKENS,
  THINK_MODEL,
  THINK_RULES,
  THINK_TIME_BUDGET_MS,
  THINK_TOOLS,
  THINK_WEB_SEARCH,
  isThinkTool,
  runThinkTool,
  thoughtCall,
  thoughtCost,
  type ThinkDeps,
} from './think';
import { SESSION_SENT_BODY, THINK_FALLBACK, sessionSentCall } from '@/lib/talk/thought';

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

/** What Ask is told about files where nothing it makes can be kept: a chart is the one thing sent. */
export const ASK_CHART_ONLY = `The chart is the one thing that can go with an answer: you cannot send an
image, a PDF or any other file, so never write that you attached or sent one.`;

/**
 * What Ask is told about files when its code's are kept under the answer
 * (plan #3050.3.2), in place of ASK_CHART_ONLY.
 */
export const ASK_MAKES_FILES = `Beside a chart, you can send a file your code makes. When they ask for an
image, a PDF or another file, rather than a chart, make it with
code_execution: write the file in your code (a PNG with matplotlib, a PDF, a
CSV) and it is kept under your answer, up to four files, each up to 20 MB, as
an image, a PDF, a Word file, text or CSV. Put the figures from a lookup or a
search into the code yourself; the code cannot reach their rows or the web.
Say in a sentence what you sent. Never write that you attached or sent a file
your code did not make.`;

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
When you describe them, as in a summary, a bio or a cover letter, read their
schools and jobs with their dates (you.profile_entries, you.work_history) and
set each one's tense from today's date: one that ended before today is over,
however an older résumé or note words it.

WHAT THEY HAVE ON COMES FROM schedule. For any question about a day or a
range of days ("what's my plan this weekend", "am I free on Thursday", "what
do I have tomorrow"), call schedule with from and to covering every day
asked about, evenings included. It holds their own events, every calendar
they subscribe to, appointments from booking emails, interviews and what is
due, each once. Never say a day is free from their own events alone. When a
row has a conflict, ask them which time is right instead of choosing one.

WHEN THEY ASK YOU TO PICK, SUGGEST OR RECOMMEND, CHOOSE FROM WHAT THEY HAVE.
"Give me a good video to watch", "what should I read next", "which role
should I chase first" are answered by looking up the rows they already have
and choosing one, or a few, saying why from what the rows say: a verdict, a
summary, a date, what they wrote. Prefer what they have not finished or
watched yet. Never search the web for these: what they saved is what they
are asking about.

WHEN THE DATA CANNOT ANSWER IT, SAY SO, BUT ONLY AFTER LOOKING. Never say you
cannot see or do something before you have made a lookup for it. If the
lookups do not hold what the question needs, or a workspace is switched off,
answer "I cannot see that" and say in a sentence what you could see instead.
Do not fill the gap with a likely answer. Whenever an answer does not do what
they asked, say what was missing in the answer tool's could_not, so the
ability gets built.

${WEB_RULES}

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
the link with each role you suggest. When they ask for a place nearby, such
as somewhere to eat near home, look it up with find_places and give the Maps
link with each place you name.

A NUMBER CAN BE DRAWN, AND SO CAN WHAT IT IS MADE OF. Call show_chart with
figures exactly as a lookup gave them, then answer; the chart is drawn under
your answer, so say in a sentence or two what it shows (the change, the
largest row) rather than listing every figure again.
${ASK_CHART_ONLY}
- When they ask for one amount for a period, such as what they spent in
  September or how many applications they sent this month, draw it as a
  figure with the usual amount as its reference. For spending, ask
  spend_by_merchant from three months before the period to its end: its
  months give both the amount and the usual one, the average of the three
  months before. Where a note or goal of theirs sets a target, such as a
  monthly budget, use the target instead and name it.
- When they ask how an amount changes over time, draw columns, oldest
  first, with the target as the reference when there is one. For a balance
  or their net worth, balance_history gives the points. When they ask how
  two to four amounts move together over time, such as market indexes over
  a week, draw a line with a series for each.
- When they ask how something splits, such as spending by shop or
  applications by status, and a lookup gives three or more figures, draw a
  bar. A figure for the total and a bar for the shops behind it is a good
  pair; never draw more than two.

${SAVED_RULES}

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
something to one, reword an idea, note on an idea or a card, mark or move
a video, add a finding to a research brief, or attach a vault note to an
essay's notes, call change_reading, add_learn_track, add_track_reading,
reword_concept, add_concept_note, change_video, add_to_brief or
attach_vault_note. In Todo, when they ask to
write a todo's notes, pin it, put it off or bring it back, drop or reopen it,
add an item to its list, say what it is about, or add or change an event on
their calendar, call edit_todo, add_todo_item, link_todo, add_event or
change_event. To finish, put off or dismiss a row another workspace put on
their agenda, find it with agenda and call change_agenda_row. For a todo on each
row a lookup found ("add a todo for each of those leads"), call add_todos once
with the set query_rows named. In News, when they ask to mark a newsletter unread, save or
unsave a story, send one to Learn or make a todo from one, call
mark_issue_unread, save_story, send_story_to_learn or make_todo_from_story;
when they ask to stop a price watch, call stop_watch. In Goals, when they ask
to add, rename, reorder or archive an area or write what they want from it,
call change_goal_area; to reword a goal, date it, move it to another area,
reorder, archive, close, park or reopen it, call change_goal; to edit, drop,
reopen, block, move or archive a step, count it towards another goal or make
it wait on another step, or set it aside until a later day or bring it back, call change_goal_step; to set a goal's measure, its
links or an information step's form, call change_goal_number, change_goal_link
or change_goal_form; to snooze a row on the Goals Inbox or record whether they went to an event, call change_goals_inbox; to keep a list of its own on a goal, such as pantries to compare or groups to try, or add, change, confirm or archive its rows, call change_goal_list; to add a tile to a goal's dashboard when they ask for one in their own words ('add a chart of my balance'), move one, take one off or lay the whole dashboard out, call change_goal_dashboard. To log hours they spent on a goal or step on a day ('log 2 hours on the thesis for yesterday'), look the goal or step up and call log_hours. In Shopping, to
change one item's name, variant, notes, group name or sell price, call
change_item; to put items on a list, take them off or rename a list, call
item_lists; to add books, games or other things they own, call add_items; to save a product for later, edit it, mark it bought, put it aside or bring it back, call change_saved_item. To enter an order they describe or show on a receipt, call add_order; to tag an order line or untag it, call order_item_tags; to confirm, put back, discard or restore orders in the review queue, dismiss or undismiss a waiting email, or attach one to its order, call review_orders. In Jobs, to change a role's title, location, pay, posting or company, call
 item_lists; to add books, games or other things they own, call add_items; to save a product for later, edit it, mark it bought, put it aside or bring it back, call change_saved_item. To rename a recurring payment, leave it out of the monthly total or count it again, merge two or move some of its charges to another, call change_recurring; to set how long a shop gives them to return things, call return_window; to add someone they shop for or rename one, call change_person. In Jobs, to change a role's title, location, pay, posting or company, call
change_role; to set how excited they are about one, how they applied, whether it is ready to apply or whether it has a cover letter, call
change_application; to add the questions an application asks, call add_application_questions; to save an answer to one, keep a drafted answer with what it rests on, approve it or mark it submitted, call save_answer, and to write or rewrite one from their evidence, write it yourself from list_rows on job_search.evidence_items and the role's description, then call save_answer; to make an answer the default reused for a question on every application, call set_default_answer; to rename a company or correct its details, call change_company; to fold duplicate roles into one, call merge_roles; to finish, put off, reword, move or link a reminder to an email, call change_reminder; to finish or put off a row waiting on them, call change_waiting; to link an email to a role, turn a suggested one down or take one off a role, call change_role_email; in Jobs review, to confirm or reopen an application, call review_application, and to clear the flag on events that conflict with a pursuit or flag them again, call review_events, and to dismiss emails waiting there or bring dismissed ones back, call review_emails, and to make a new role from an email waiting there, call add_role_from_email; to add or correct a contact, call change_contact; to log that they reached out to someone, correct that entry or mark it answered, call change_touch; when they have messaged a person Dash suggested, call mark_suggestion_sent. From Material, Settings and Find, to add a story to their evidence bank, call add_evidence; to add a resume version, call add_resume_version; to keep a PDF they sent you as a version's file, call attach_resume_pdf; to write or reword a career goals entry, call change_career_thought; to change the target titles or excluded industries on Find (such as to allow accounting jobs), call change_search_aim yourself and never hand it on; to add a startup Find discovered to their companies, call add_discovered_company. On a role's interviews, to correct an interview's kind, status, date or notes, call change_interview; to name who interviewed them or take someone off, call change_interviewer; to rename, renumber or write notes on a round, gather rounds into one, split an interview into a round of its own or take an email off a round, call change_interview_round. In the Vault, to write
a note, change or rename one, file a quick note, or rename a theme or a
thread with Maya, call write_vault_note, edit_vault_note, rename_vault_note,
file_quick_note, rename_theme or rename_maya_question; to keep a transcript
or correct a course, call save_transcript or change_course. When they tell you about a place they have lived, or ask to
change one, call add_place or change_place; when they tell you about a job
or ask to correct one, call save_job; when they ask what is in one of their own fields on Details, read custom_fields from list_rows on you.details, and when they ask to set one, call set_detail. When they ask you to put a question to their council or board ("ask the council whether ..."), call ask_board with the question, the options they gave, the numbers and limits from the conversation as context, and their lean if they said one; it queues the question for the Sunday meeting, and pass when 'now' only if they asked for a meeting now. Answer with the question and the link to the Council tab. When they ask someone on People to text them about something, on a schedule or not (\"have the hiring manager tell me about good-fit jobs every Monday\"), call set_reach_out with that person's name and their sentence, and repeat the summary it returns. When they ask you to remember something they said about themselves for their insights, call save_about_me with their words. When they ask for one of their X post
drafts on the Posts tab in Dev to be shortened or reworded, call rewrite_post
with the whole new text. When they ask for a post about the app or how
they build it, read what it rests on, call post_pictures for a picture of that screen,
and call suggest_post with the angle, the posts and the picture where one
fits; it saves the draft to the Posts tab and never posts it. Never hand_off a request for a post. When they ask
to add one of their GitHub repositories as a project in Dev, call add_project with
its name as they said it. When they state a rule for many items or
roles ("everything from the March Amazon order", "every role I applied to
before August with no reply"), find the rows with your lookups and make it
one change_items or move_roles call, never one call per row. When a
query_rows lookup names the rows it matched as a set ("set 1"), pass that set
to change_items rather than copying its refs. The
change is made when you call it, and shows as a card under your answer with
an Undo. A todo, a goal, a step, an item or a role is named by the ref a
lookup returned for it, so look it up first; an area is named by its name.
A goal goes under the area it plainly belongs to; when none of theirs fits,
make one for it with add_goal's new_area and say you did, rather than asking.
When they ask for a goal to be mapped, planned, broken down or researched,
call start_goal_run on it, straight after add_goal for a new one, and pass
what they asked for beyond the map as its instruction; never hand_off it.
When they ask Dash to do or get ready one step, call work_goal_step.
When they ask Dash to figure something out for a goal they have ("should I
consolidate my loans", "work out which program fits me"), call
take_on_for_goal with the question in their words: it works on that goal and
tells them when it is done, so do not answer it yourself first.
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
keep, then propose the others. A submitted answer is never proposed. A note on
a job, company or contact (job_search.notes) is found with list_rows or recall
and proposed the same way, as is a job role (job_search.roles), found with search, which is refused when it has
applications, notes or anything else attached; and a task (todo.tasks), found with search,
todos or list_rows, which is refused when it has subtasks. When propose_delete refuses a row because something
is attached to it, tell them what is attached and propose nothing for it. Say
which rows you proposed removing and why, and that nothing is gone until they
confirm.

ANYTHING ELSE THEY ASK YOU TO DO, HAND ON. When they ask you to create or
change something none of your tools can (a job application, a contact, a
vault note, a goal's done-when), or for work that needs more than one answer
(long writing such as a plan step with its full detail, a prep doc or a cover
letter; building something; research; sorting or tidying many rows), call
hand_off with the request written out in full, including every detail they
gave, a short summary of the conversation so far and the refs of rows you
looked up for it. A Claude Code session does it within a few minutes and its
reply appears in this conversation. Do the same as soon as you see this
answer will not fit what they asked: hand it on rather than stop part-way.
Then say in a sentence that you are on it; do not say it is done, do not
propose something near it instead, and never end by asking them to try again. Never hand on a
question you can answer by looking things up, and never a request to delete
something (application answers, job notes, job roles and tasks are the exception, above: propose_delete), send an email or spend money: for those, say you cannot. Those
three are the only requests you turn down; anything else is looked up, done
with a tool, or handed on.

WHEN THE REQUEST NEEDS A CODE CHANGE, OFFER A SESSION. When what they ask can only
be done by changing the code of this app or of one of their projects (a new
page, a fix to how something works, a feature), say so plainly in a sentence or
two and end the answer with this sentence, word for word: ${SESSION_OFFER}
The button under the answer then carries the chat to a session on that code.
Do not use the sentence for anything your tools or hand_off can do, and never
call a change done that you have only offered.

THE PAGE THEY ASKED FROM IS CONTEXT FOR "THIS". A line after these rules may say
which page of the app they asked from, and the row it shows. When the question
points at that row, by "this", "here", "it" or by its subject, look the row up
first with the tool the line names, and answer about it. When the question is
about anything else, ignore the page and answer as if it had not been said.`;

/**
 * Ask's rules for making changes, from "YOU MAKE THE CHANGES" through the
 * delete proposal, word for word: what the people on People act by (plan
 * #2854.2, lib/you/people-actions.ts), so a change has one set of rules
 * wherever it is asked for. Read out of SYSTEM so the two cannot drift.
 */
export const ASK_ACTION_RULES = SYSTEM.slice(
  SYSTEM.indexOf('YOU MAKE THE CHANGES THEY ASK FOR'),
  SYSTEM.indexOf('ANYTHING ELSE THEY ASK YOU TO DO, HAND ON'),
).trim();

/**
 * How Dash speaks on Ask by default: Sonnet, the rules above, every
 * registered tool but a thread's own, and web search (plan #2861).
 */
export const ASK_VOICE: DashVoice = {
  model: ASK_MODEL,
  system: SYSTEM,
  tools: ASK_DASH_TOOLS,
  serverTools: [dashWebSearch(ASK_MODEL)],
};

/**
 * Ask's voice for a question kept to one workspace (plan #1899.5): every
 * tool but the lookups outside it (lookupInScope). Writes stay, since a
 * change the person asks for is not a lookup, and not the web, since the
 * question is kept to their own rows. `model` is the one the person chose to
 * be answered with (plan #2458.2, lib/dash/model-choice.ts); absent, Sonnet.
 * The web search is the one that model takes (dashWebSearch).
 */
export function scopedVoice(scope: ModuleId | null | undefined, model: string = ASK_MODEL): DashVoice {
  const voice = model === ASK_VOICE.model ? ASK_VOICE : { ...ASK_VOICE, model, serverTools: [dashWebSearch(model)] };
  if (!scope) return voice;
  return {
    ...voice,
    tools: voice.tools.filter((tool) => tool.kind !== 'lookup' || lookupInScope(tool.name, scope)),
    serverTools: [],
  };
}

/**
 * Ask's voice with "Think it through" on (plan #2789.10; lib/dash/think.ts):
 * Opus at high effort, Ask's rules with the thinking rules after them, web
 * search, and the code lookups and the mockup on top of Ask's tools. The
 * model the person chose for ordinary questions does not apply.
 */
export function thinkVoice(scope: ModuleId | null | undefined): DashVoice {
  const ask = scopedVoice(scope, THINK_MODEL);
  return {
    ...ask,
    system: `${SYSTEM}\n\n${THINK_RULES}`,
    tools: [...ask.tools, ...THINK_TOOLS],
    serverTools: [THINK_WEB_SEARCH],
    effort: THINK_EFFORT,
    maxTokens: THINK_MAX_TOKENS,
    timeBudgetMs: THINK_TIME_BUDGET_MS,
    // A question the person asked to be thought through reads code and plan
    // rows past twelve lookups; it gets one more stretch, not a cut-off.
    extend: true,
  };
}

/**
 * A voice that can send what its code makes (plan #3050.3.2): code execution
 * beside its server tools, and the file rules in place of the chart-only
 * ones. Without `on`, the voice as it was.
 */
export function withMadeFiles(voice: DashVoice, on: boolean): DashVoice {
  if (!on) return voice;
  return {
    ...voice,
    system: voice.system.replace(ASK_CHART_ONLY, ASK_MAKES_FILES),
    serverTools: [...(voice.serverTools ?? []), dashCodeExecution()],
  };
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
  handOff?: (input: unknown, seen: DashSeen, tool: { name: string }) => Promise<AskToolResult>;
  /**
   * Offers hand_to_bot (plan #3003.2), with its rules after Ask's: passing a
   * request to a bot on People, sent to `handOff` by its name.
   */
  passToBot?: boolean;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
  /** Hears each model call as it came back (plan #2937.2). */
  onCall?: (call: DashCall) => void;
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
  /** The model the person chose to be answered with (plan #2458.2); absent, Sonnet. */
  model?: DashChoiceId;
  /**
   * "Think it through" (plan #2789.10): answered with thinkVoice, and the
   * think lookups run with these. Absent: an ordinary answer.
   */
  think?: ThinkDeps | null;
  /**
   * Offers code execution and tells Dash it can send the files its code
   * makes (plan #3050.3.2): set only where the answer's files are kept.
   * Absent: a chart is the one thing it can send.
   */
  makeFiles?: boolean;
}): Promise<AskAnswer> {
  const { page, scope, model, think, execute, passToBot, makeFiles, ...rest } = input;
  const voice = withMadeFiles(think ? thinkVoice(scope) : scopedVoice(scope, model), Boolean(makeFiles));
  return runDash({
    ...rest,
    execute: think ? (name, args) => (isThinkTool(name) ? runThinkTool(name, args, think) : execute(name, args)) : execute,
    voice: passToBot
      ? { ...voice, system: `${voice.system}\n\n${BOT_HANDOFF_RULES}`, tools: [...voice.tools, HAND_TO_BOT] }
      : voice,
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
  /**
   * Keeps a hand-off as a pending session row, once per question
   * (handoffs.ts keepSessionHandoff, plan #3005.2): `created` is false when
   * this question's request was kept before, as on a retry, and nothing is
   * started for it again. Absent with no fireHandoff.
   */
  saveHandoff?: (
    input: SessionHandoffInput,
  ) => Promise<{ ok: true; handoff: DashHandoff; created: boolean } | { ok: false; error: string }>;
  /** Ties the answer's hand-offs to its turn once that is written. */
  attachHandoffs?: (ids: readonly string[], turnId: string) => Promise<void>;
  /** Removes the hand-offs of an answer that was not kept. */
  discardHandoffs?: (ids: readonly string[]) => Promise<void>;
  /**
   * Passes a request to a bot on People (plan #3003.2), offered as
   * hand_to_bot. Absent: Ask Dash cannot pass things to a bot.
   */
  passToBot?: BotPasser;
  /** Starts the backup routine on one hand-off and records the outcome; returns its new status. */
  fireHandoff?: (handoff: DashHandoff) => Promise<{ status: DashHandoff['status']; error?: string }>;
  /**
   * Files what an answer could not do as a note in the Dev notes queue, so
   * the missing ability is built (gapNote). Never throws. Absent: not filed.
   */
  noteGap?: (body: string, conversationRef: string) => Promise<void>;
  /**
   * Keeps an answer that failed or came back unfinished, with its reason and
   * each model call (plan #2937.2, lib/dash/failures.ts). Never throws.
   * Absent: not kept.
   */
  recordFailure?: (failure: DashFailure) => Promise<void>;
  /**
   * Keeps an answer that reached a limit as a slip, for Dev Home's count
   * (plan #2999, lib/dash/slips.ts). Never throws. Absent: not kept.
   */
  recordSlip?: (slip: DashSlip) => Promise<void>;
  /**
   * Think it through in a session thread (plan #2789.11): starts a thread on
   * this app whose first message is the conversation so far, ending with the
   * question, and wakes the broker. Present only when the broker is set up;
   * absent, a thought-through question is answered here.
   */
  toSession?: (conversation: readonly TalkTurn[]) => Promise<{ ok: true; threadId: string } | { ok: false; error: string }>;
  /**
   * Keeps the files the answer's code made against its turn (plan
   * #3050.3.2, turn-files.ts keepTurnMadeFiles), and says which could not
   * be kept. Present, Dash is offered code execution; absent, it can draw a
   * chart and send nothing else.
   */
  keepFiles?: (turnId: string, files: readonly MadeFile[]) => Promise<{ kept: TalkFile[]; unkept: UnkeptFile[] }>;
  /** Rewrites a kept answer's words, for the sentence on files that were not kept (store.ts amendAnswerBody). */
  amendAnswer?: (turnId: string, body: string) => Promise<void>;
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
  /** The conversation's id, which a question handed to a goal reports back into (plan #2778.8). */
  conversationId: string,
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
    /**
     * Try again (plan #2854.4): answer the chat's last question, which has no
     * answer, instead of adding `question` to it. Needs `conversationRef`.
     */
    retry?: boolean;
    /** Rows the person added with @, kept on the question as its citations (plan #1899.5). */
    mentions?: readonly TalkCitation[];
    /** The workspace the question is kept to (plan #1899.5). */
    scope?: ModuleId | null;
    /**
     * The model the person chose (plan #2458.2, dashModelFor); absent,
     * Sonnet. The spend is recorded under the model that answered.
     */
    model?: DashChoiceId;
    /**
     * "Think it through" was on (plan #2789.10): answered on Opus at high
     * effort with web search, the code and the mockup, and the answer keeps
     * what it cost. Absent: an ordinary answer.
     */
    think?: ThinkDeps | null;
    /**
     * Why a thought-through question is answered here rather than in a
     * session thread (plan #2789.11), kept on the answer's mark for the line
     * under it. Absent: nothing is said.
     */
    thinkFallback?: string | null;
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
      if (input.retry) return { turns: [], error: 'That conversation is not there any more.' };
      subject = await stores.start(question);
    }
    // Try again (plan #2854.4): the chat's last question is answered as it
    // was kept, and nothing new is added for it.
    if (input.retry) {
      const last = earlier[earlier.length - 1];
      if (last.role !== 'user') return { turns: [], error: 'That question already has its answer.' };
      earlier = earlier.slice(0, -1);
      asked = [last];
    } else asked = await stores.append(subject, [
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

  // Every answer that fails, or comes back unfinished, is kept with why and
  // what each model call returned (plan #2937.2).
  const calls: DashCall[] = [];
  const failed = async (outcome: DashFailure['outcome'], reason: string) => {
    try {
      await stores.recordFailure?.({
        surface: 'ask',
        outcome,
        reason,
        model: input.think ? THINK_MODEL : (input.model ?? ASK_MODEL),
        effort: input.think ? THINK_EFFORT : null,
        think: Boolean(input.think),
        scope: input.scope ?? null,
        conversationId: subject.ref,
        turnId: asked[asked.length - 1]?.id ?? null,
        calls,
      });
    } catch (error) {
      console.error('the failed answer was not recorded', error);
    }
  };

  // Think it through goes to a session thread when one can be started (plan
  // #2789.11): Dash says so at once, and the session answers in the thread.
  // A thread that could not be started falls back to the answer here.
  let thinkFallback = input.think ? (input.thinkFallback ?? null) : null;
  if (input.think && stores.toSession) {
    let sent: Awaited<ReturnType<NonNullable<AskStores['toSession']>>>;
    try {
      sent = await stores.toSession([...earlier, ...asked]);
    } catch (error) {
      sent = { ok: false, error: error instanceof Error ? error.message : 'no reason given' };
    }
    if (sent.ok) {
      try {
        const answered = await stores.append(subject, [
          { role: 'assistant', body: SESSION_SENT_BODY, toolCalls: [sessionSentCall({ threadId: sent.threadId })] },
        ]);
        return { conversation, turns: [...asked, ...answered] };
      } catch (error) {
        await failed('failed', `The question went to a session but the reply saying so was not kept: ${error instanceof Error ? error.message : 'no reason given'}`);
        return { conversation, turns: asked, error: `Sent to a session, but this chat could not say so. Its answer will be in Chat, under Sessions.` };
      }
    }
    console.error('the thought-through question did not reach a session', sent.error);
    thinkFallback = THINK_FALLBACK.notStarted;
  }

  if (!input.anthropicApiKey) {
    const error = 'This deployment has no ANTHROPIC_API_KEY, so Dash cannot answer.';
    await failed('failed', error);
    return { conversation, turns: asked, error };
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
          const result = await apply(tool, args, seen, subject.ref);
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
  // The shared hand-to-a-session action (plan #3005.2), keyed by the
  // question: a session starts once the answer is kept (startHandoffs), and
  // only for a row this answer made.
  const askedTurn = asked[asked.length - 1];
  const sessionHandOff =
    saveHandoff && stores.fireHandoff && askedTurn
      ? async (args: unknown, seen: (table: string, ref: string) => boolean) => {
          const result = await startSessionHandoff(
            { keep: saveHandoff },
            {
              thread: { kind: 'ask', conversationId: subject.ref },
              messageId: askedTurn.id,
              asked: askedTurn.body,
              botName: 'Ask Dash',
              href: `/chat/dash/${subject.ref}`,
            },
            args,
            seen,
          );
          if (result.kept?.created) handed.push(result.kept.handoff);
          return result.told;
        }
      : undefined;
  // A request for a bot on People is kept for that bot (plan #3003.2), keyed by the question's words.
  const passBot = askedTurn ? stores.passToBot : undefined;
  const handOff =
    sessionHandOff || passBot
      ? (args: unknown, seen: (table: string, ref: string) => boolean, tool: { name: string }): Promise<AskToolResult> => {
          if (tool.name === HAND_TO_BOT_TOOL_NAME && passBot && askedTurn) {
            return passBot(
              {
                fromBot: null,
                source: { kind: 'ask', conversationId: subject.ref },
                messageId: askedTurn.id,
                asked: askedTurn.body,
              },
              args,
              seen,
            );
          }
          if (!sessionHandOff) return Promise.resolve({ ok: false, error: `There is no tool called ${tool.name}.` });
          return sessionHandOff(args, seen);
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
    passToBot: Boolean(passBot),
    anthropicApiKey: input.anthropicApiKey,
    client: input.client,
    now: input.now,
    onLookup: input.onLookup,
    onText: input.onText,
    signal: input.signal,
    scope: input.scope,
    model: input.model,
    think: input.think,
    makeFiles: Boolean(stores.keepFiles),
    onSpend: (report) => spent.push(report),
    onCall: (call) => calls.push(call),
  });
  await stores.recordSpend(spent);
  // Filed whether or not the answer is kept: the gap is real either way.
  if (answer.ok && answer.couldNot && handed.length === 0) {
    await stores.noteGap?.(gapNote(answer.couldNot, asked[0]?.body ?? question), subject.ref);
  }
  if (!answer.ok) {
    await discard();
    await failed('failed', answer.detail);
    return { conversation, turns: asked, error: `Dash could not answer: ${answer.detail}` };
  }
  if (answer.stop === 'unfinished') await failed('unfinished', UNFINISHED_REASON);
  const slip = budgetSlip(answer, 'Ask Dash');
  if (slip) {
    await stores.recordSlip?.({ ...slip, surface: 'ask', conversation: `ask:${subject.ref}`, href: `/chat/dash/${subject.ref}` });
  }

  // An answer that says a file is attached when none was sent says so after all (plan #3050.1).
  // A file its code made is said for once the answer is kept (plan #3050.3.2).
  const made = stores.keepFiles ? (answer.madeFiles ?? []) : [];
  // A saved page or file it attached by reference counts as sent (plan #3050.4).
  const claim = falseAttachment(answer.body, turnCharts(answer.toolCalls).length, made.length + turnAttached(answer.toolCalls).length);
  const nothing = stores.keepFiles ? NOTHING_ATTACHED_ASK : NOTHING_ATTACHED_ASK_CHART_ONLY;
  const body = claim ? `${answer.body.trimEnd()}\n\n${nothing}` : answer.body;
  if (claim) {
    await stores.recordSlip?.({ ...claimSlip('Ask Dash', claim), surface: 'ask', conversation: `ask:${subject.ref}`, href: `/chat/dash/${subject.ref}` });
  }

  let answered: TalkTurn[];
  try {
    // A thought-through answer keeps its mark and its cost, read by the line under it.
    const toolCalls = input.think
      ? [
          ...answer.toolCalls,
          thoughtCall({ model: THINK_MODEL, effort: THINK_EFFORT, costMicros: thoughtCost(spent), fallback: thinkFallback }),
        ]
      : answer.toolCalls;
    answered = await stores.append(subject, [
      { role: 'assistant', body, toolCalls, citations: answer.citations },
    ]);
  } catch (error) {
    await discard();
    await failed('failed', `The answer was written but not kept: ${error instanceof Error ? error.message : 'no reason given'}`);
    return { conversation, turns: asked, error: 'Dash answered, but the answer was not kept. Try again.' };
  }
  const turnId = answered[answered.length - 1].id;
  if (made.length > 0 && stores.keepFiles) {
    answered = await keepAnswerFiles(answered, made, stores, input.client ?? new Anthropic({ apiKey: input.anthropicApiKey }));
  }
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
 * Keeps the files the answer's code made under it (plan #3050.3.2): each is
 * read through the Files API and kept against the answer's turn. Any that
 * could not be kept are named, with why, at the end of the answer's words,
 * which are rewritten to say so. Returns the answer's turns with the kept
 * files on the last. Never throws.
 */
async function keepAnswerFiles(
  answered: TalkTurn[],
  made: readonly string[],
  stores: AskStores,
  client: Pick<Anthropic, 'get'>,
): Promise<TalkTurn[]> {
  const last = answered[answered.length - 1];
  let kept: TalkFile[] = [];
  let notKept: UnkeptFile[] = [];
  try {
    const { files, unkept } = await fetchMadeFiles(client, made);
    notKept = unkept;
    if (files.length > 0 && stores.keepFiles) {
      try {
        const outcome = await stores.keepFiles(last.id, files);
        kept = outcome.kept;
        notKept = [...unkept, ...outcome.unkept];
      } catch (error) {
        console.error('the files an answer made were not kept', error);
        notKept = [...unkept, ...files.map((file) => ({ name: file.name, why: 'it could not be kept with the answer' }))];
      }
    }
  } catch (error) {
    console.error('the files an answer made were not read', error);
  }
  const note = madeFilesNote(notKept);
  let body = last.body;
  if (note) {
    const tail = `\n\n${note}`;
    const amended = `${last.body.trimEnd().slice(0, MAX_TURN - tail.length)}${tail}`;
    try {
      await stores.amendAnswer?.(last.id, amended);
      body = amended;
    } catch (error) {
      console.error('the answer was not told which files were not kept', error);
    }
  }
  const files = [...(last.files ?? []), ...kept];
  return [...answered.slice(0, -1), { ...last, body, ...(files.length > 0 ? { files } : {}) }];
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
