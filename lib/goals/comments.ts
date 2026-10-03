/**
 * Comments on goals and steps, and Dash's replies to them (plan #957;
 * docs/GOALS-SPEC.md, "Taken from the dev plan", and "Four ways to fill a
 * form", the fourth way).
 *
 * The thread is the dev plan's: the same component, the same `@dash` tag, the
 * same two authors. What differs is what the reply is handed. On the dev plan
 * it is the plan step's brief; here it is the goal written out whole, with its
 * steps and the collections it fills, so a question about a step can be
 * answered from the rest of the map. And the reply can do one thing a dev
 * reply cannot: file the facts a comment gives ("the Navient loan is $12,450
 * at 6.8%") into a collection, as a draft you confirm on the step.
 *
 * Anything the reply cannot do from the message and its lookups goes to the
 * goals routine, whose reply lands in the same thread.
 *
 * This file holds what needs no database and no model: the message, reading
 * what a filing or a date asks for, and what the reply says about what it
 * filed. The reads and writes are lib/goals/comments-store.ts, and the whole
 * round, on Dash's shared loop since plan #1465, lib/goals/ask.ts.
 */
import type { DevComment } from '@/lib/comments/load';
import { askMessage } from '@/lib/comments/context';
import {
  FIELD_TYPE_LABELS,
  liveFields,
  type CollectionField,
  type CollectionShape,
  type FieldValue,
  type RecordValues,
} from '@/lib/goals/collections';
import { isDate } from '@/lib/ask/db';
import { displayValue } from '@/lib/goals/information';
import { STEP_KIND_LABELS, STEP_STATUS_LABELS, type StepNode } from '@/lib/goals/steps';
import type { Goal } from '@/lib/goals/tree';

/** The column takes 4000 characters. */
export const COMMENT_MAX = 4000;

/** The most records one reply files, so a runaway answer cannot fill a table. */
export const FILINGS_MAX = 20;

/** Records shown per collection in the message, newest last. */
const RECORDS_SHOWN = 30;

/** A collection as the reply sees it: the definition and what is in it. */
export type ReplyCollection = {
  id: string;
  name: string;
  shape: CollectionShape;
  fields: CollectionField[];
  records: { data: RecordValues; draft: boolean }[];
};

/** Everything the message is written from. */
export type GoalReplyContext = {
  goal: Goal & { detail?: string | null };
  steps: StepNode[];
  collections: ReplyCollection[];
  /** The goal or step the comment was written on. */
  itemId: string;
  /** YYYY-MM-DD, so "Oct 4" and "next Friday" can be turned into a date. */
  today?: string;
};

/**
 * A change of date or of Todo the comment asks for, on the step it is on.
 * Either part may be absent; `dueOn: null` clears the date.
 */
export type Schedule = { dueOn?: string | null; onTodo?: boolean };

/** Refs the model answers with, so it never handles an id. */
export type ReplyRefs = { collections: Map<string, ReplyCollection> };

/** How a stored value is written for the model: in its stored form. */
const STORED_FORM: Record<CollectionField['type'], string> = {
  text: 'one line of text',
  long_text: 'text',
  number: 'a number',
  money: 'an amount as a plain number, 12450.37',
  percent: 'a percentage as the number shown, 6.8 for 6.8%',
  date: 'YYYY-MM-DD',
  day_of_month: 'a whole number from 1 to 31',
  yes_no: 'true or false',
  choice: 'one of the listed options exactly',
  link: 'a web address',
};

function stepLines(nodes: StepNode[], itemId: string, depth: number, out: string[]): void {
  for (const node of nodes) {
    const pad = '  '.repeat(depth);
    const here = node.id === itemId ? ' ← the comment is on this step' : '';
    out.push(
      `${pad}- ${node.title} (${STEP_KIND_LABELS[node.kind]}, ${STEP_STATUS_LABELS[node.status].toLowerCase()})${here}`,
    );
    if (node.dueOn || node.onTodo) {
      out.push(
        `${pad}  ${[node.dueOn ? `Due ${node.dueOn}` : 'No due date', node.onTodo ? 'on Todo' : 'not on Todo'].join(', ')}`,
      );
    }
    if (node.acceptance) out.push(`${pad}  Done when: ${node.acceptance}`);
    if (node.detail) out.push(`${pad}  Detail: ${node.detail.replace(/\s+/g, ' ').slice(0, 600)}`);
    if (node.resolution) out.push(`${pad}  Answered: ${node.resolution}`);
    if (node.result)
      out.push(`${pad}  Claude produced: ${node.result.replace(/\s+/g, ' ').slice(0, 400)}`);
    stepLines(node.children, itemId, depth + 1, out);
  }
}

function findStep(nodes: StepNode[], id: string): StepNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findStep(node.children, id);
    if (found) return found;
  }
  return null;
}

/** The collections written out, each under a ref (c1, c2) the reply files by. */
function collectionLines(collections: ReplyCollection[]): string[] {
  const out: string[] = [];
  collections.forEach((collection, index) => {
    out.push(
      '',
      `### c${index + 1}: ${collection.name}`,
      collection.shape === 'one'
        ? 'Holds a single record.'
        : 'A list, one record per item (for example one per loan).',
      'Fields (key: label, type, stored as):',
    );
    for (const field of liveFields(collection.fields)) {
      const options =
        field.type === 'choice' ? ` Options: ${(field.options ?? []).join(' | ')}.` : '';
      out.push(
        `- ${field.key}: ${field.label}, ${FIELD_TYPE_LABELS[field.type].toLowerCase()}, ${STORED_FORM[field.type]}.${options}`,
      );
    }
    const records = collection.records.slice(-RECORDS_SHOWN);
    if (records.length === 0) {
      out.push('Nothing filled in yet.');
    } else {
      out.push('Filled in so far:');
      for (const record of records) {
        const values = liveFields(collection.fields)
          .map((field) => [field.label, displayValue(field, record.data[field.key] as FieldValue)])
          .filter(([, shown]) => shown !== '')
          .map(([label, shown]) => `${label} ${shown}`)
          .join('; ');
        out.push(`- ${values || '(empty)'}${record.draft ? ' (a draft, not confirmed yet)' : ''}`);
      }
    }
  });
  return out;
}

/** The goal, its steps and its collections, written out for the reply. */
export function goalContext(context: GoalReplyContext): { text: string; refs: ReplyRefs } {
  const { goal } = context;
  const onStep = context.itemId === goal.id ? null : findStep(context.steps, context.itemId);
  const out = [
    `# A goal: ${goal.title}`,
    '',
    ...(context.today ? [`Today is ${context.today}.`, ''] : []),
    `Status: ${goal.status === 'parked' ? 'parked' : STEP_STATUS_LABELS[goal.status].toLowerCase()}`,
  ];
  if (goal.acceptance) out.push(`Done when: ${goal.acceptance}`);
  if (goal.fog) out.push(`Not known yet: ${goal.fog}`);
  if (goal.unit) {
    out.push(
      `Measured in: ${goal.unit}${goal.target !== null ? `, aiming for ${goal.target}` : ''}`,
    );
  }
  out.push(
    '',
    onStep
      ? `The comment is on the step "${onStep.title}", marked below.`
      : 'The comment is on the goal itself.',
  );

  out.push('', '## Steps');
  if (context.steps.length === 0) out.push('No steps yet.');
  else stepLines(context.steps, context.itemId, 0, out);

  const refs: ReplyRefs = { collections: new Map() };
  context.collections.forEach((collection, index) =>
    refs.collections.set(`c${index + 1}`, collection),
  );
  out.push('', '## Collections this goal fills');
  if (context.collections.length === 0) out.push('None yet, so there is nowhere to file facts.');
  else out.push(...collectionLines(context.collections));

  return { text: out.join('\n') + '\n', refs };
}

/** The whole message: the goal, the thread so far, and the comment. */
export function goalReplyMessage(
  context: GoalReplyContext,
  thread: readonly DevComment[],
  question: string,
): { message: string; refs: ReplyRefs } {
  const { text, refs } = goalContext(context);
  return { message: askMessage({ context: text, thread, question }), refs };
}

/** One record the reply asks to file, by collection ref. */
export type Filing = { collection: ReplyCollection; values: Record<string, unknown> };

export type GoalReply =
  /** Answered, and possibly with facts to file. `body` may be empty when all it did was file. */
  | { kind: 'answer'; body: string; filings: Filing[]; schedule: Schedule | null }
  /** Needs the goals routine: research, several steps changed, anything beyond one reply. */
  | { kind: 'routine'; why: string }
  /** Hand the step the comment is on to Claude, to work or to prepare (plan #1003). */
  | { kind: 'send' }
  | { kind: 'error'; error: string };

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The model's answer as one of the four outcomes. `send_step` wins, since the
 * person told Claude to take the step and the run it starts does the rest.
 * Then `needs_routine`, as `needs_repo` does for a dev reply: an answer given
 * beside it is a guess. A filing that names no known collection, or fills
 * nothing, is dropped.
 */
export function parseGoalReply(raw: unknown, refs: ReplyRefs): GoalReply {
  if (!raw || typeof raw !== 'object') return { kind: 'error', error: 'Nothing usable came back.' };
  const input = raw as Record<string, unknown>;

  if (input.send_step === true) return { kind: 'send' };

  if (input.needs_routine === true) {
    return {
      kind: 'routine',
      why: asText(input.why) || 'This needs a longer look than one reply.',
    };
  }

  const filings: Filing[] = [];
  const file = Array.isArray(input.file) ? input.file : [];
  for (const entry of file) {
    if (filings.length >= FILINGS_MAX) break;
    if (!entry || typeof entry !== 'object') continue;
    const { collection: ref, values } = entry as { collection?: unknown; values?: unknown };
    const collection = typeof ref === 'string' ? refs.collections.get(ref.trim()) : undefined;
    if (!collection || !values || typeof values !== 'object' || Array.isArray(values)) continue;
    const kept = Object.fromEntries(
      Object.entries(values as Record<string, unknown>).filter(
        ([, value]) => value !== null && value !== undefined && value !== '',
      ),
    );
    if (Object.keys(kept).length > 0) filings.push({ collection, values: kept });
  }

  const schedule = readSchedule(input.schedule);
  const body = asText(input.answer);
  if (!body && filings.length === 0 && !schedule) {
    return { kind: 'error', error: 'Nothing usable came back.' };
  }
  return { kind: 'answer', body: fit(body), filings, schedule };
}

/** The date and Todo change the model asked for, or null when it asked for none that is usable. */
function readSchedule(raw: unknown): Schedule | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { due_on: due, on_todo: todo } = raw as Record<string, unknown>;
  const schedule: Schedule = {};
  if (due === null) schedule.dueOn = null;
  else if (isDate(due)) schedule.dueOn = due;
  if (typeof todo === 'boolean') schedule.onTodo = todo;
  return Object.keys(schedule).length > 0 ? schedule : null;
}

/** What happened to one filing, for the reply to say. */
export type FilingOutcome =
  | { ok: true; collection: ReplyCollection; data: RecordValues }
  | { ok: false; collection: ReplyCollection; error: string };

/** One filed record, as the thread says it: "Balance $12,450.37, Rate 6.8%". */
function filedValues(collection: ReplyCollection, data: RecordValues): string {
  return liveFields(collection.fields)
    .map((field) => [field.label, displayValue(field, data[field.key])] as const)
    .filter(([, shown]) => shown !== '')
    .map(([label, shown]) => `${label} ${shown}`)
    .join(', ');
}

/**
 * The reply as it goes into the thread: the answer, then a line for each
 * record filed or refused. Filed records are drafts, so the line says where to
 * confirm them.
 */
export function replyBody(answer: string, outcomes: FilingOutcome[], scheduled?: string): string {
  const lines: string[] = [];
  if (answer) lines.push(answer);
  if (scheduled) lines.push(scheduled);
  const filed = outcomes.filter((o) => o.ok);
  if (filed.length > 0) {
    lines.push(
      filed.length === 1
        ? `Filed into ${filed[0].collection.name} as a draft: ${filedValues(filed[0].collection, filed[0].data)}. Confirm it on the step.`
        : [
            `Filed ${filed.length} records as drafts. Confirm them on the step:`,
            ...filed.map((o) => `- ${o.collection.name}: ${filedValues(o.collection, o.data)}`),
          ].join('\n'),
    );
  }
  for (const refused of outcomes.filter((o) => !o.ok)) {
    lines.push(`Not filed into ${refused.collection.name}: ${refused.error}`);
  }
  return fit(lines.join('\n\n'));
}

/** "Mon 5 Oct" for 2026-10-05, with the weekday so a wrong year shows. */
function dateWords(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * What a date and Todo change did, for the thread. `dated` and `todo` are what
 * the writes reported: true when the row changed, false when it did not (the
 * step already said so, or cannot), null when that part was not asked for.
 */
export function scheduleSaid(
  schedule: Schedule,
  done: { dated: boolean | null; todo: boolean | null },
): string {
  const parts: string[] = [];
  if (schedule.dueOn !== undefined && done.dated !== null) {
    if (!done.dated) parts.push('I could not change the date, the step is not open to change.');
    else parts.push(schedule.dueOn ? `Set the due date to ${dateWords(schedule.dueOn)}.` : 'Cleared the due date.');
  }
  if (schedule.onTodo !== undefined && done.todo !== null) {
    if (done.todo) parts.push(schedule.onTodo ? 'Put it on your Todo.' : 'Took it off your Todo.');
    else if (schedule.onTodo) {
      parts.push('It did not go on Todo: only an open step of yours can, and it is either already there or not that.');
    } else parts.push('It was not on your Todo.');
  }
  return parts.join(' ');
}

/** Trimmed to what the column holds, marked so a cut reply does not read as a finished one. */
function fit(body: string): string {
  return body.length <= COMMENT_MAX ? body : `${body.slice(0, COMMENT_MAX - 1)}…`;
}

/**
 * The turn the goals routine is fired with when a comment needs more than one
 * reply. It extends goalRunText (lib/goals/shaping.ts): the same goal and run,
 * plus the comment, the thread so far, and where the reply goes.
 */
export function commentRunText(input: {
  runText: string;
  userId: string;
  itemId: string;
  itemTitle: string;
  onGoal: boolean;
  thread: readonly DevComment[];
  question: string;
  why: string;
}): string {
  const said = input.thread.map(
    (c) => `${c.author === 'claude' ? 'Claude' : 'The person'}: ${c.body}`,
  );
  return [
    input.runText,
    '',
    `This run answers a comment written on ${input.onGoal ? 'the goal' : `the step "${input.itemTitle}"`}`,
    `(goals.items id ${input.itemId}). Follow "Replying to a comment" in the skill.`,
    `The quick reply passed it on because: ${input.why}`,
    '',
    ...(said.length > 0 ? ['Said so far on it:', ...said, ''] : []),
    'The comment:',
    input.question,
    '',
    'Write your reply into the thread, in the same call as the actor and run settings:',
    `insert into goals.comments (user_id, item_id, author, body) values ('${input.userId}', '${input.itemId}', 'claude', '<your reply>');`,
  ].join('\n');
}
