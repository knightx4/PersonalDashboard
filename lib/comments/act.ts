/**
 * Doing what a comment asked for, rather than writing back about it.
 *
 * A comment tagged `@dash` used to have one outcome: a sentence in the thread.
 * Half of what gets written on these rows is not a question — "file that as
 * its own idea", "reword this one" — and an answer explaining that it could be
 * done is the least useful thing to say to somebody who has just said to do it.
 * #359 settled that it is carried out and reported afterwards, with what it
 * changed written into the thread so it can be put back by hand.
 *
 * Every write here goes through the caller's own client, so the row's policies
 * check the ownership: an action aimed at somebody else's row matches nothing
 * and fails, and nothing in this file has to remember to filter by user.
 *
 * What it may do is the list in `ACTIONS` and nothing else. The moves left out
 * are left out on purpose: approving a proposal, answering a question,
 * starting or assigning a step, dismissing or deleting anything are the
 * person's, made on the page, and an assistant that can make them on its own
 * word has taken them away.
 *
 * Writing a row is not one of those, and for a while it was treated as though
 * it were: an idea could be filed here, but "write this up as a bug" and "add a
 * step under this" were handed to a session that read the repository to make
 * one row, minutes later. A note in the queue asked for the four things the dev
 * pages hold -- ideas, plan steps, features and bug notes -- to be addable and
 * changeable from a comment, so they are, and each lands in the state the
 * person still has the say over: a step arrives as a proposal, a note arrives
 * open, and neither is approved, assigned or prioritised by anything here.
 *
 * `build_step` is the one exception, and it is one the person makes rather
 * than this file: told on a raise to do the work itself, the raise is the
 * description of it and the comment is the approval, so #605 settled that the
 * step is written ready to be worked and handed to a session in the same
 * press. It is still not approved on this file's own judgement -- nothing
 * here decides that a raise deserves a session; the instruction did.
 */
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { isModuleId, MODULES, type ModuleId } from '@/lib/modules';
import { handStepToClaude } from '@/lib/plan/handover';
import { nextPlanPosition } from '@/lib/plan/position';
import { TARGET_PATH, type CommentTarget } from './load';
import type { DashAction } from './reply-payload';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public'>;

/**
 * What the thread is told: what was done, or why nothing was.
 *
 * `redraw` is the page the action changed, when it is not the page the comment
 * was written on -- filing an idea from a plan step leaves /dev/ideas showing
 * a list the new row is missing from until something says otherwise.
 */
export type ActOutcome =
  | { ok: true; said: string; redraw?: string }
  /**
   * `route` marks a refusal that is only this call's. The thing asked for is
   * not one of the three below and is not the person's either -- "add a step
   * under this", "write this up as a note" -- so saying no to it is a dead end
   * rather than an answer. The caller hands those to a session that can read
   * the code and do it, instead of writing the refusal into the thread.
   */
  | { ok: false; why: string; route?: true };

export type ActInput = {
  supabase: Db;
  userId: string;
  /** Which kind of row the comment sits on. */
  target: CommentTarget;
  /** The row itself, not the comment. */
  id: string;
  action: DashAction;
};

/** The ideas column takes 4000 characters. */
const MAX_IDEA = 4000;

/** What a bug note's body holds, from migration 0026. */
const MAX_NOTE = 4000;

/**
 * The parts of a plan row that may be rewritten, and what each is called.
 *
 * A whitelist rather than a check against a list of forbidden columns, because
 * the forbidden ones are the point: a step's status, its assignee, whether it
 * has been approved and a decision's answer are the person's, made on the page,
 * and a column that is not named here cannot be written from a comment however
 * the instruction was phrased. The aliases are what an instruction actually
 * calls them -- "the done-when", "the acceptance criteria" -- so a reword does
 * not fail on the name it was given.
 */
const STEP_FIELDS: Record<string, { column: 'title' | 'detail' | 'acceptance'; word: string }> = {
  title: { column: 'title', word: 'the title' },
  detail: { column: 'detail', word: 'the detail' },
  done_when: { column: 'acceptance', word: 'the done-when' },
  acceptance: { column: 'acceptance', word: 'the done-when' },
  acceptance_criteria: { column: 'acceptance', word: 'the done-when' },
};

/** "the done-when", "Done When", "acceptance criteria" — all the same field. */
function fieldNamed(named: string | null): (typeof STEP_FIELDS)[string] | undefined {
  const key = (named ?? '')
    .trim()
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[\s-]+/g, '_');
  return STEP_FIELDS[key];
}

/** What a title and the two long columns hold, from migration 0051. */
const MAX_TITLE = 200;
const MAX_DETAIL = 4000;

/**
 * The words that mark a move as the person's own.
 *
 * Matched against the name an instruction came back under, because the names
 * outside `ACTIONS` are not a fixed set -- they are whatever the instruction
 * was. Two kinds arrive here and they end very differently: approving,
 * answering, assigning, setting a status, dismissing and deleting are refused,
 * because doing them on an assistant's own word takes them away from the
 * person. Everything else -- adding a step, splitting a feature, writing a note
 * up -- is refused only by *this* call, which has one message and no
 * repository, and is handed to a session that has both.
 */
const RESERVED = [
  'approve',
  'answer',
  'assign',
  'status',
  'dismiss',
  'delete',
  'remove',
  'reject',
  'decline',
  'priority',
  'complete',
  'close',
];

/** Whether the instruction names a move that stays the person's. */
function isReserved(name: string): boolean {
  const words = name.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return words.some((word) => RESERVED.some((held) => word.startsWith(held)));
}

/**
 * Carry out one instruction, or say why it was not carried out.
 *
 * Nothing is done twice and nothing is done part way: every action but one is
 * a single write, so a failure leaves the row as it was and the thread says
 * so. `build_step` is the one with two halves -- the row, then the session --
 * and it says which of them happened rather than pretending both did.
 */
export async function carryOut(input: ActInput): Promise<ActOutcome> {
  switch (input.action.name) {
    case 'file_idea':
      return fileIdea(input);
    case 'file_note':
      return fileNote(input);
    case 'add_step':
      return addStep(input);
    case 'reword':
      return reword(input);
    case 'send_step':
      return sendStep(input);
    case 'build_step':
      return buildStep(input);
    default:
      if (isReserved(input.action.name)) {
        return {
          ok: false,
          why:
            `I did not do that: "${input.action.name}" is yours to make on the page. Approving a ` +
            'proposal, answering a question, starting or assigning a step, setting a status, and ' +
            'dismissing or deleting a row are the moves I leave alone on purpose — the buttons ' +
            'for them are on the row itself.',
        };
      }
      return {
        ok: false,
        route: true,
        why: `"${input.action.name}" needs the code read before it can be done.`,
      };
  }
}

/**
 * Write a new idea on the ideas page.
 *
 * Filed as a suggestion, the same as one `scripts/plan.ts idea` writes: it
 * lands under the person's own ideas rather than among them, so a thought that
 * came out of a comment is never mistaken for one they had. A comment on a
 * plan step stamps the idea with that step, which is what the ideas page shows
 * as where a suggestion came from.
 */
async function fileIdea(input: ActInput): Promise<ActOutcome> {
  const body = input.action.text?.trim();
  if (!body) {
    return { ok: false, why: 'I could not tell what to file, so nothing was written down.' };
  }
  if (body.length > MAX_IDEA) {
    return { ok: false, why: `That is longer than an idea can be (${MAX_IDEA} characters), so nothing was filed.` };
  }

  // Named `scope` rather than `module`, which Next reserves.
  const scope = scopeOf(input.action);
  const { error } = await input.supabase.from('ideas').insert({
    user_id: input.userId,
    body,
    module: scope,
    source: 'claude',
    // Only a plan step is a row `ideas.from_plan_item_id` can point at.
    from_plan_item_id: input.target === 'step' ? input.id : null,
  });
  if (error) return { ok: false, why: `I could not file that idea: ${error.message}` };

  return {
    ok: true,
    said: `Filed on the ideas page, about ${labelOf(scope)}, marked as my suggestion:\n\n${body}`,
    redraw: '/dev/ideas',
  };
}

/** The workspace an action named, if it named one this app has. */
function scopeOf(action: DashAction): ModuleId | null {
  return action.module && isModuleId(action.module) ? action.module : null;
}

/** What a workspace is called on the page, or what null means. */
function labelOf(scope: ModuleId | null): string {
  return scope ? (MODULES.find((m) => m.id === scope)?.label ?? scope) : 'the app as a whole';
}

/**
 * Write a bug report or a feature request into the notes queue.
 *
 * Filed open at the middle priority, which is where the header button files
 * one: what a note is worth is read off the queue with the others in front of
 * it, and a priority set from a sentence is a guess that outranks the ones the
 * person made. The page path is the dev page the comment was written on, so a
 * note that came out of a plan step says so rather than looking like it was
 * filed from nowhere.
 *
 * Anything not explicitly a feature request is filed as a bug. Both are in the
 * same queue and the kind is a dropdown away from right; a note refused over
 * which heading it belongs under is a note that does not exist.
 */
async function fileNote(input: ActInput): Promise<ActOutcome> {
  const body = input.action.text?.trim();
  if (!body) {
    return { ok: false, why: 'I could not tell what to write up, so no note was filed.' };
  }
  if (body.length > MAX_NOTE) {
    return { ok: false, why: `That is longer than a note can be (${MAX_NOTE} characters), so nothing was filed.` };
  }

  const kind = input.action.kind?.trim().toLowerCase() === 'feature' ? 'feature' : 'bug';
  const { error } = await input.supabase.from('feedback_items').insert({
    user_id: input.userId,
    kind,
    body,
    page_path: TARGET_PATH[input.target],
  });
  if (error) return { ok: false, why: `I could not file that note: ${error.message}` };

  const what = kind === 'bug' ? 'a bug' : 'a feature request';
  return {
    ok: true,
    said: `Filed on the notes queue as ${what}, open:\n\n${body}`,
    redraw: '/dev/bugs',
  };
}

/**
 * Where a new plan row goes and what it says, before anything is written.
 *
 * Shared by the two actions that write one -- `add_step`, which stops there,
 * and `build_step`, which hands what it wrote to a session -- because the
 * three rules underneath it are the kind that are right in one copy and
 * quietly wrong in the other: which row it hangs under, which workspace it
 * lands in, and what the columns hold.
 *
 * A comment on a step means a step beneath that step, and it takes that step's
 * module -- a sub-step that claimed a different workspace would show up in
 * neither place anyone looked for it, the same rule the add form on the plan
 * page follows. A comment anywhere else has no step to hang one under, so what
 * it writes is a top-level row in whichever workspace was named.
 *
 * On a raise, the workspace the raise is filed under is the fallback when the
 * instruction named none. `carryOut` is handed the raise's id and nothing
 * else, so this is a read rather than a field -- worth it, because a raise
 * about the Dev pages whose step lands under "the app as a whole" is a step
 * nobody finds. A module the action named wins: the comment is more specific
 * than the row it was written on.
 */
type PlannedRow = {
  title: string;
  detail: string | null;
  scope: ModuleId | null;
  parentId: string | null;
  position: number;
};

async function plannedRow(input: ActInput): Promise<{ ok: true; row: PlannedRow } | { ok: false; why: string }> {
  const title = input.action.text?.trim();
  if (!title) {
    return { ok: false, why: 'I could not tell what to call it, so no step was added.' };
  }
  if (title.length > MAX_TITLE) {
    return {
      ok: false,
      why: `That is longer than a step's name can be (${MAX_TITLE} characters), so nothing was added. Put the rest in its detail.`,
    };
  }
  const detail = input.action.detail?.trim() || null;
  if (detail && detail.length > MAX_DETAIL) {
    return { ok: false, why: `That detail is longer than a step's can be (${MAX_DETAIL} characters), so nothing was added.` };
  }

  const parentId = input.target === 'step' ? input.id : null;
  let scope = scopeOf(input.action);
  if (parentId) {
    const { data } = await input.supabase
      .from('plan_items')
      .select('module')
      .eq('id', parentId)
      .maybeSingle();
    if (!data) return { ok: false, why: 'That step is not there any more, so nothing was added.' };
    const parent = (data as { module: string | null }).module;
    scope = parent && isModuleId(parent) ? parent : null;
  } else if (!scope && input.target === 'raise') {
    scope = await raiseModule(input);
  }

  const position = await nextPlanPosition(input.supabase, input.userId, scope, parentId);
  return { ok: true, row: { title, detail, scope, parentId, position } };
}

/** The workspace a raise is filed under, when it is one this app has. */
async function raiseModule(input: ActInput): Promise<ModuleId | null> {
  const { data } = await input.supabase
    .from('raised_items')
    .select('module')
    .eq('id', input.id)
    .maybeSingle();
  const named = (data as { module: string | null } | null)?.module ?? null;
  return named && isModuleId(named) ? named : null;
}

/** Where a new row landed, in the words the thread uses. */
function placeOf(row: PlannedRow): string {
  return row.parentId ? 'under this one' : `at the top of ${labelOf(row.scope)}`;
}

/** The row's name and its paragraph, as the thread shows them back. */
function wordingOf(row: PlannedRow): string {
  return row.detail ? `${row.title}\n\n${row.detail}` : row.title;
}

/**
 * Add a plan row: a step under the one this comment is on, or a feature.
 *
 * It arrives `proposed`, which is the whole of why this is safe to do on an
 * instruction. A proposal is not work: it is not sent to a session, it does not
 * count against the plan, and approving it is the person's move on the page.
 * Nothing here sets a status, an assignee or a priority for the same reason.
 */
async function addStep(input: ActInput): Promise<ActOutcome> {
  const planned = await plannedRow(input);
  if (!planned.ok) return planned;
  const row = planned.row;

  const { error } = await input.supabase.from('plan_items').insert({
    user_id: input.userId,
    module: row.scope,
    parent_id: row.parentId,
    title: row.title,
    detail: row.detail,
    status: 'proposed',
    kind: 'build',
    position: row.position,
  });
  if (error) return { ok: false, why: `I could not add that step: ${error.message}` };

  return {
    ok: true,
    said: `Added ${placeOf(row)}, as a proposal for you to approve:\n\n${wordingOf(row)}`,
    redraw: '/dev/plan',
  };
}

/**
 * Rewrite the wording of the row the comment is on.
 *
 * An idea's text, a bug note's report, or a step's title, detail or done-when,
 * and nothing else. The old wording goes back into the thread with the new:
 * that is what makes this reversible by hand, and it is the whole of why
 * acting straight away is safe -- a misread instruction costs a copy and paste
 * rather than a row nobody can reconstruct.
 *
 * A raise is the one target with no wording to rewrite, and it falls through
 * to `addStep` rather than to a refusal -- see the comment at the end.
 */
async function reword(input: ActInput): Promise<ActOutcome> {
  const text = input.action.text?.trim();
  if (!text) {
    return { ok: false, why: 'I could not tell what to write instead, so nothing was changed.' };
  }

  if (input.target === 'idea') {
    if (text.length > MAX_IDEA) {
      return { ok: false, why: `That is longer than an idea can be (${MAX_IDEA} characters), so nothing was changed.` };
    }
    const { data } = await input.supabase
      .from('ideas')
      .select('body')
      .eq('id', input.id)
      .maybeSingle();
    const was = (data as { body: string } | null)?.body ?? null;
    if (was === null) return { ok: false, why: 'That idea is not there any more, so nothing was changed.' };

    const { error } = await input.supabase.from('ideas').update({ body: text }).eq('id', input.id);
    if (error) return { ok: false, why: `I could not change it: ${error.message}` };
    return { ok: true, said: rewritten('the idea', text, was) };
  }

  if (input.target === 'step') {
    const field = fieldNamed(input.action.field);
    if (!field) {
      return {
        ok: false,
        why:
          `I did not change anything: "${input.action.field ?? 'that'}" is not a part of a step I ` +
          'can rewrite. The title, the detail and the done-when are; the status, who it is ' +
          'assigned to, whether it is approved and a question\'s answer are yours on the page.',
      };
    }
    const limit = field.column === 'title' ? MAX_TITLE : MAX_DETAIL;
    if (text.length > limit) {
      return { ok: false, why: `That is longer than ${field.word} can be (${limit} characters), so nothing was changed.` };
    }

    const { data } = await input.supabase
      .from('plan_items')
      .select(field.column)
      .eq('id', input.id)
      .maybeSingle();
    if (!data) return { ok: false, why: 'That step is not there any more, so nothing was changed.' };
    const was = (data as Record<string, string | null>)[field.column];

    const { error } = await input.supabase
      .from('plan_items')
      .update({ [field.column]: text })
      .eq('id', input.id);
    if (error) return { ok: false, why: `I could not change it: ${error.message}` };
    return { ok: true, said: rewritten(field.word, text, was) };
  }

  if (input.target === 'note') {
    if (text.length > MAX_NOTE) {
      return { ok: false, why: `That is longer than a note can be (${MAX_NOTE} characters), so nothing was changed.` };
    }
    const { data } = await input.supabase
      .from('feedback_items')
      .select('body')
      .eq('id', input.id)
      .maybeSingle();
    const was = (data as { body: string } | null)?.body ?? null;
    if (was === null) return { ok: false, why: 'That note is not there any more, so nothing was changed.' };

    // The body and nothing else. A note's status, its priority and its
    // resolution are worked in the queue, and the run that closes one writes
    // what closed it -- a reword reaching those would rewrite the record of
    // work rather than the report of the problem.
    const { error } = await input.supabase
      .from('feedback_items')
      .update({ body: text })
      .eq('id', input.id);
    if (error) return { ok: false, why: `I could not change it: ${error.message}` };
    return { ok: true, said: rewritten('the note', text, was) };
  }

  // A raise is a message, not a row with wording of its own, so there is
  // nothing on it to rewrite -- and what "put this in the plan" arrives as,
  // when the fast reply reads it as a rewording, is this. Refusing it was a
  // dead end over a name: the thing asked for is a row this file can write, so
  // it writes it and the thread says the rewording became a step (#604).
  const added = await addStep(input);
  if (!added.ok) return added;
  return {
    ...added,
    said: `A raise has no wording of its own to rewrite, so I put it on the plan instead.\n\n${added.said}`,
  };
}

/** What was written, and what was there before it. */
function rewritten(what: string, now: string, was: string | null): string {
  return [`Rewrote ${what}:`, '', now, '', 'It said:', '', was ?? '(nothing)'].join('\n');
}

/**
 * Which step to send, when the row this is on is not itself a step.
 *
 * A comment on a step means that step. A raise means whichever step its
 * consequence named, because a raise whose answer is "build #342" has no step
 * of its own to point at. The number is looked up under the caller's own id,
 * so a number belonging to somebody else finds nothing.
 */
async function stepNamed(input: ActInput): Promise<string | null> {
  const number = Number(input.action.text?.trim().replace(/^#/, ''));
  if (!Number.isInteger(number) || number <= 0) return null;

  const { data } = await input.supabase
    .from('plan_items')
    .select('id')
    .eq('user_id', input.userId)
    .eq('number', number)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Hand a plan step to a session, and start it now.
 *
 * The same rules as the button on the plan page, because they are the same
 * function: a proposal is not work yet, a question and a blocked step are
 * waiting on the person rather than on a session, and a feature already being
 * worked takes one session and not two. Which of those refused it is what the
 * thread says, so a comment that started nothing says why.
 */
async function sendStep(input: ActInput): Promise<ActOutcome> {
  const id = input.target === 'step' ? input.id : await stepNamed(input);
  if (!id) {
    return {
      ok: false,
      why:
        'This is not a plan step and nothing here names one by number, so nothing was started.',
    };
  }

  const sent = await handStepToClaude({
    supabase: input.supabase,
    userId: input.userId,
    id,
  });
  if (!sent.ok) return { ok: false, why: `I did not send it: ${sent.error}` };

  const withThem =
    sent.beneath === 0
      ? ''
      : `, with the ${sent.beneath === 1 ? 'step' : `${sent.beneath} steps`} beneath it`;
  return {
    ok: true,
    said: `Sent #${sent.number} ${sent.title} to be built${withThem}. ${sent.detail}`,
  };
}

/**
 * Write a step and put a session on it, in the one press.
 *
 * This is "just do it", said on a raise that already describes the work. The
 * other way round it -- add_step, then approve, then send -- is three moves
 * across two pages for something that was already decided when the raise was
 * answered, and #605 settled that the comment is the approval: the raise names
 * the work and the person said to do it, so the row is written ready to be
 * worked rather than as a proposal. Taking it back is setting the row to not
 * started, on the plan page, which is a move of theirs like any other.
 *
 * Two halves, and they can end differently. The row is written first and it
 * stays written: the hand-over refuses a feature already being worked and a
 * re-shape rewriting it, and both of those are about timing rather than about
 * the step, so the step waits on the plan for a press instead of being rolled
 * back. Which of the two happened is the sentence, with the number either way
 * -- a thread saying a session is on it when nothing is would be worse than
 * one saying nothing at all.
 */
async function buildStep(input: ActInput): Promise<ActOutcome> {
  const planned = await plannedRow(input);
  if (!planned.ok) return planned;
  const row = planned.row;

  // `not_started` rather than `proposed`, because `handStepToClaude` refuses a
  // proposal -- rightly, since approving one is the person's move -- and a row
  // written proposed here would be refused by the very next line of its own
  // action. `assignee` is left empty, which is the only thing a step written
  // here could say: the column marks what you kept for yourself, and nobody
  // has kept a step that has just been written.
  const { data, error } = await input.supabase
    .from('plan_items')
    .insert({
      user_id: input.userId,
      module: row.scope,
      parent_id: row.parentId,
      title: row.title,
      detail: row.detail,
      status: 'not_started',
      kind: 'build',
      position: row.position,
    })
    .select('id, number')
    .maybeSingle();
  if (error) return { ok: false, why: `I could not add that step: ${error.message}` };

  const written = data as { id: string; number: number } | null;
  if (!written) return { ok: false, why: 'I could not add that step, so nothing was started.' };

  const opening = `Added #${written.number} ${placeOf(row)}`;
  const sent = await handStepToClaude({
    supabase: input.supabase,
    userId: input.userId,
    id: written.id,
  });
  if (!sent.ok) {
    return {
      ok: true,
      said:
        `${opening}, but I did not start it: ${sent.error} It is on the plan, not started, to ` +
        `send when that clears.\n\n${wordingOf(row)}`,
      redraw: '/dev/plan',
    };
  }

  return {
    ok: true,
    said: `${opening} and sent it to be built. ${sent.detail}\n\n${wordingOf(row)}`,
    redraw: '/dev/plan',
  };
}
