import { AskInputError, type AskDb, type AskRow } from '@/lib/ask/db';
import { recordDashAction } from '@/lib/core/dash-actions';
import { refHref, toRef } from '@/lib/core/refs';
import { isModuleId } from '@/lib/modules';
import { insertPlanItem } from '@/lib/plan/insert-item';
import { isProjectScope, type PlanScope } from '@/lib/plan/projects';
import type { ConnectorWriteContext, ConnectorWriteTool } from './writes';

/**
 * What a Claude Code session writes into its thread (plan #2789.5, feature
 * #2789), through the connector, from any repository: this app's or a
 * project's that has no copy of it.
 *
 *   reply_in_thread  a message in the thread: words, a status line, a mockup
 *                    link, or a question with two to four options to press.
 *   read_thread      the thread's messages since a point, and the questions
 *                    answered since then. The person's messages it returns
 *                    are marked delivered (core.session_messages.delivered_at).
 *   propose_feature  a feature with its steps, proposed, in the thread's
 *                    project's section of the plan.
 *   add_plan_step    a step under a feature or step of that project, proposed.
 *   write_decision   a question for the person under one of its rows, with
 *                    lettered options and a recommendation, proposed.
 *
 * A session names its thread by the thread's id, which its prompt carries, or
 * by its own session id once the thread holds it. Every read and write names
 * the verified person, since the service-role clients pass no RLS, so a thread
 * or a plan row that is not theirs is refused as not found.
 *
 * The plan writes are scoped to the thread: a project's thread writes in that
 * project's section and nowhere else, and a thread on this app writes in the
 * app's own sections (a workspace, or the app as a whole), never a project's.
 * Everything they write is proposed, so nothing is built before the person
 * approves it on the plan.
 *
 * Each write but read_thread is recorded in core.dash_actions as a routine's,
 * listed on Home with an Undo. Undoing a proposed feature deletes it and the
 * steps written with it (public.plan_items in lib/core/dash-actions.ts counts
 * only children written after the record).
 */

/** Where a thread opens. The thread screen is #2789.7's, in Chat. */
export function sessionThreadHref(threadId: string): string {
  return `/ask?thread=${encodeURIComponent(threadId)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIZES = ['s', 'm', 'l'] as const;
const LETTERS = ['A', 'B', 'C'] as const;

type Input = Record<string, unknown>;

type Thread = {
  id: string;
  title: string;
  project_id: string | null;
  session_id: string | null;
  state: string;
};

type PlanRow = { id: string; number: number; module: string | null; status: string; kind: string; title: string };

function str(input: Input, key: string, max: number): string | null {
  const value = input[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new AskInputError(`${key} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new AskInputError(`${key} is longer than ${max} characters.`);
  return trimmed || null;
}

function required(input: Input, key: string, max: number): string {
  const value = str(input, key, max);
  if (!value) throw new AskInputError(`${key} is required.`);
  return value;
}

function size(input: Input, key = 'size'): (typeof SIZES)[number] | null {
  const value = str(input, key, 1);
  if (value === null) return null;
  if (!(SIZES as readonly string[]).includes(value)) throw new AskInputError(`${key} is s, m or l.`);
  return value as (typeof SIZES)[number];
}

function texts(input: Input, key: string, min: number, max: number, each: number): string[] {
  const raw = input[key];
  if (!Array.isArray(raw)) throw new AskInputError(`${key} must be a list of ${min} to ${max}.`);
  const list = raw.map((entry, index) => {
    if (typeof entry !== 'string' || !entry.trim()) throw new AskInputError(`${key}[${index}] must be text.`);
    const trimmed = entry.trim();
    if (trimmed.length > each) throw new AskInputError(`${key}[${index}] is longer than ${each} characters.`);
    return trimmed;
  });
  if (list.length < min || list.length > max) throw new AskInputError(`${key} must list ${min} to ${max}.`);
  if (new Set(list.map((entry) => entry.toLowerCase())).size !== list.length) {
    throw new AskInputError(`${key} must not repeat itself.`);
  }
  return list;
}

function clip(text: string, max = 120): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

function needsDb(ctx: ConnectorWriteContext): AskDb {
  if (!ctx.db) throw new AskInputError('That change cannot be made through this connection.');
  return ctx.db;
}

const THREAD_FIELDS = {
  thread_id: {
    type: 'string',
    description: "The thread's id, as your prompt gave it. Give this or session_id.",
  },
  session_id: {
    type: 'string',
    description:
      'Your own session id, once the thread holds it. With thread_id as well, a thread that holds no session id yet takes this one.',
  },
} as const;

/** The thread a call names, read for the verified person. Refuses one that is not theirs. */
async function threadOf(ctx: ConnectorWriteContext, db: AskDb, input: Input): Promise<Thread> {
  const threadId = str(input, 'thread_id', 100);
  const sessionId = str(input, 'session_id', 200);
  if (!threadId && !sessionId) throw new AskInputError('Name the thread: give thread_id or session_id.');
  if (threadId && !UUID.test(threadId)) throw new AskInputError("thread_id must be the thread's id.");
  const core = await db('core');
  const query = core
    .from('session_threads')
    .select('id, title, project_id, session_id, state')
    .eq('user_id', ctx.userId);
  const { data, error } = await (threadId ? query.eq('id', threadId) : query.eq('session_id', sessionId)).maybeSingle();
  if (error) throw new Error(`Reading the thread failed: ${error.message}`);
  const thread = data as Thread | null;
  if (!thread) throw new AskInputError(threadId ? `No thread ${threadId}.` : `No thread holds session ${sessionId}.`);
  if (threadId && sessionId && thread.session_id && thread.session_id !== sessionId) {
    throw new AskInputError('That thread belongs to another session.');
  }
  if (threadId && sessionId && !thread.session_id) {
    const { error: claimError } = await core
      .from('session_threads')
      .update({ session_id: sessionId })
      .eq('id', thread.id)
      .eq('user_id', ctx.userId);
    if (claimError) throw new AskInputError(`The thread could not take session ${sessionId}: ${claimError.message}`);
    thread.session_id = sessionId;
  }
  return thread;
}

function openThread(thread: Thread): void {
  if (thread.state === 'ended') throw new AskInputError('That thread has ended, so nothing more can be written in it.');
}

type MessageRow = {
  id: string;
  author: string;
  kind: string;
  body: string;
  options: unknown;
  artifact_url: string | null;
  attachment_path: string | null;
  delivered_at: string | null;
  answer: string | null;
  answered_at: string | null;
  created_at: string;
};

function messageRow(thread: Thread, message: MessageRow): AskRow {
  const title =
    message.body.trim() || message.artifact_url || (message.attachment_path ? 'A file' : message.kind);
  return {
    table: 'core.session_messages',
    ref: toRef('core.session_messages', message.id),
    title: clip(title),
    href: sessionThreadHref(thread.id),
    detail: {
      author: message.author,
      kind: message.kind,
      body: message.body,
      options: Array.isArray(message.options) ? JSON.stringify(message.options) : null,
      artifact_url: message.artifact_url,
      attachment_path: message.attachment_path,
      answer: message.answer,
      answered_at: message.answered_at,
      created_at: message.created_at,
    },
  };
}

// ---------------------------------------------------------------------------
// The thread
// ---------------------------------------------------------------------------

const KINDS = ['text', 'mockup', 'question', 'status'] as const;

const replyInThread: ConnectorWriteTool = {
  definition: {
    name: 'reply_in_thread',
    description:
      "Write into your session thread in Dash, where the person reads it in Chat: your reply (kind text), a line on what you are doing (status), a mockup or page you published (mockup, with artifact_url), or a question they answer with a tap (question, with two to four options, each a short choice). A question puts the thread waiting on them; read their answer with read_thread. Name the thread by thread_id or session_id. It is listed on Home with an Undo.",
    input_schema: {
      type: 'object',
      properties: {
        ...THREAD_FIELDS,
        kind: { type: 'string', enum: [...KINDS], description: 'text (the default), status, mockup or question.' },
        body: { type: 'string', description: 'The words. A mockup may leave them out; a question is the question.' },
        artifact_url: { type: 'string', description: 'For a mockup, the https link to the published artifact.' },
        options: {
          type: 'array',
          items: { type: 'string' },
          minItems: 2,
          maxItems: 4,
          description: 'For a question, two to four options as the buttons will read.',
        },
      },
    },
  },
  async run(ctx, input) {
    const db = needsDb(ctx);
    const kind = (str(input, 'kind', 20) ?? 'text') as (typeof KINDS)[number];
    if (!(KINDS as readonly string[]).includes(kind)) throw new AskInputError(`kind is one of ${KINDS.join(', ')}.`);
    const body = str(input, 'body', 40000) ?? '';
    const artifactUrl = str(input, 'artifact_url', 2000);
    if (artifactUrl && !/^https:\/\/\S+$/.test(artifactUrl)) throw new AskInputError('artifact_url must be an https link.');
    if (kind === 'mockup' && !artifactUrl) throw new AskInputError('A mockup needs artifact_url.');
    const options = kind === 'question' ? texts(input, 'options', 2, 4, 200) : null;
    if (kind !== 'question' && input.options !== undefined && input.options !== null) {
      throw new AskInputError('Only a question takes options.');
    }
    if (kind === 'question' && !body) throw new AskInputError('A question needs its body: the question itself.');
    if (!body && !artifactUrl) throw new AskInputError('Write a body, or give artifact_url.');

    const thread = await threadOf(ctx, db, input);
    openThread(thread);
    const core = await db('core');
    const { data, error } = await core
      .from('session_messages')
      .insert({
        user_id: ctx.userId,
        thread_id: thread.id,
        author: 'session',
        kind,
        body,
        options,
        artifact_url: artifactUrl,
      })
      .select('id, author, kind, body, options, artifact_url, attachment_path, delivered_at, answer, answered_at, created_at')
      .single();
    if (error) throw new AskInputError(`The message was not written: ${error.message}`);
    const message = data as MessageRow;

    // A question waits on the person; a first word from a queued thread
    // means the session is at work. Either way the thread moves up the list.
    const state = kind === 'question' ? 'waiting' : thread.state === 'queued' ? 'working' : thread.state;
    const { error: touchError } = await core
      .from('session_threads')
      .update({ state })
      .eq('id', thread.id)
      .eq('user_id', ctx.userId);
    if (touchError) console.error('[connector write] thread state', touchError.message);

    const what =
      kind === 'question' ? 'Asked' : kind === 'mockup' ? 'Showed a mockup' : kind === 'status' ? 'Noted' : 'Replied';
    const summary = `${what} in the session thread "${clip(thread.title, 80)}"${body ? `: "${clip(body, 80)}"` : ''}.`;
    const recorded = await recordDashAction(
      { userId: ctx.userId, core: ctx.core, db },
      { surface: 'routine', kind: 'reply_in_thread', subjectRef: toRef('core.session_messages', message.id), op: 'insert', summary },
    );
    return {
      ok: true,
      rows: [messageRow(thread, message)],
      note: recorded ? `${summary} It is listed on Home in Dash with an Undo.` : summary,
    };
  },
};

const READ_LIMIT = 50;

const readThread: ConnectorWriteTool = {
  definition: {
    name: 'read_thread',
    description:
      "Read your session thread in Dash: the messages written after `since`, oldest first, and any of your questions the person answered after it (answer and answered_at). Pass since as the created_at of the last message you have, or leave it out to read from the start. Their messages it returns count as delivered to you. totals carries the thread's title, its project (null for this app), its state and the time to pass as since next time.",
    input_schema: {
      type: 'object',
      properties: {
        ...THREAD_FIELDS,
        since: { type: 'string', description: 'An ISO timestamp: only what was written or answered after it.' },
        limit: { type: 'integer', minimum: 1, maximum: READ_LIMIT, description: `At most ${READ_LIMIT}; the default.` },
      },
    },
  },
  async run(ctx, input) {
    const db = needsDb(ctx);
    const since = str(input, 'since', 40);
    if (since && Number.isNaN(Date.parse(since))) throw new AskInputError('since must be an ISO timestamp.');
    const rawLimit = input.limit;
    const limit = rawLimit === undefined || rawLimit === null ? READ_LIMIT : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > READ_LIMIT) {
      throw new AskInputError(`limit is a whole number from 1 to ${READ_LIMIT}.`);
    }
    const thread = await threadOf(ctx, db, input);
    const core = await db('core');
    const select = 'id, author, kind, body, options, artifact_url, attachment_path, delivered_at, answer, answered_at, created_at';

    const written = core.from('session_messages').select(select).eq('user_id', ctx.userId).eq('thread_id', thread.id);
    const { data, error } = await (since ? written.gt('created_at', since) : written)
      .order('created_at', { ascending: true })
      .limit(limit + 1);
    if (error) throw new Error(`Reading the thread failed: ${error.message}`);
    const all = (data ?? []) as MessageRow[];
    const more = all.length > limit;
    const messages = all.slice(0, limit);

    // A question asked before `since` and answered after it.
    let answered: MessageRow[] = [];
    if (since) {
      const { data: late, error: lateError } = await core
        .from('session_messages')
        .select(select)
        .eq('user_id', ctx.userId)
        .eq('thread_id', thread.id)
        .eq('kind', 'question')
        .gt('answered_at', since)
        .order('answered_at', { ascending: true })
        .limit(READ_LIMIT);
      if (lateError) throw new Error(`Reading the answers failed: ${lateError.message}`);
      const listed = new Set(messages.map((message) => message.id));
      answered = ((late ?? []) as MessageRow[]).filter((message) => !listed.has(message.id));
    }

    const undelivered = messages.filter((message) => message.author === 'person' && !message.delivered_at);
    if (undelivered.length > 0) {
      const now = new Date().toISOString();
      const { error: markError } = await core
        .from('session_messages')
        .update({ delivered_at: now })
        .eq('user_id', ctx.userId)
        .in(
          'id',
          undelivered.map((message) => message.id),
        )
        .is('delivered_at', null);
      if (markError) console.error('[connector write] delivered', markError.message);
      else for (const message of undelivered) message.delivered_at = now;
    }

    const last = [...messages, ...answered]
      .map((message) => (message.answered_at && message.answered_at > message.created_at ? message.answered_at : message.created_at))
      .sort()
      .at(-1);
    return {
      ok: true,
      rows: [...answered, ...messages].map((message) => messageRow(thread, message)),
      totals: {
        thread_id: thread.id,
        title: thread.title,
        project_id: thread.project_id,
        state: thread.state,
        next_since: last ?? since ?? null,
        more,
      },
      note: more
        ? `More messages follow; call again with since set to ${messages.at(-1)!.created_at}.`
        : answered.length > 0
          ? `${answered.length} earlier question${answered.length === 1 ? ' was' : 's were'} answered since then; they come first.`
          : undefined,
    };
  },
};

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/**
 * The section a thread's plan writes go in: its project, or for a thread on
 * this app the workspace named (or the app as a whole).
 */
function scopeOf(thread: Thread, input: Input): PlanScope | null {
  const named = str(input, 'module', 40);
  if (thread.project_id) {
    if (named && named !== thread.project_id) {
      throw new AskInputError(`This thread works on ${thread.project_id}, so its plan rows go in that project.`);
    }
    return thread.project_id;
  }
  if (!named) return null;
  if (!isModuleId(named)) throw new AskInputError(`${named} is not a workspace of this app.`);
  return named;
}

/** A plan row named by its outline ("#2789.5"), its number or its id, in the thread's own section. */
async function planRowOf(ctx: ConnectorWriteContext, db: AskDb, thread: Thread, raw: string): Promise<PlanRow> {
  const pub = await db('public');
  const text = raw.trim().replace(/^#/, '');
  let id: string | null = null;
  let number: number | null = null;
  if (UUID.test(text)) id = text.toLowerCase();
  else if (/^\d+$/.test(text)) number = Number(text);
  else if (/^\d+(?:\.\d+)+$/.test(text)) {
    const { data, error } = await pub
      .from('plan_item_outlines')
      .select('id')
      .eq('user_id', ctx.userId)
      .eq('outline', text)
      .maybeSingle();
    if (error) throw new Error(`Reading the plan failed: ${error.message}`);
    id = (data as { id: string } | null)?.id ?? null;
    if (!id) throw new AskInputError(`#${text} names no step on the plan.`);
  } else {
    throw new AskInputError(`${raw} is neither a step's outline, its number nor its id.`);
  }
  const query = pub.from('plan_items').select('id, number, module, status, kind, title').eq('user_id', ctx.userId);
  const { data, error } = await (id ? query.eq('id', id) : query.eq('number', number)).maybeSingle();
  if (error) throw new Error(`Reading the plan failed: ${error.message}`);
  const row = data as PlanRow | null;
  if (!row) throw new AskInputError(`${raw} names no step on the plan.`);
  const mine = thread.project_id ? row.module === thread.project_id : !isProjectScope(row.module as PlanScope | null);
  if (!mine) {
    throw new AskInputError(
      thread.project_id
        ? `#${text} is not in ${thread.project_id}, the project this thread works on.`
        : `#${text} is in a project's section; this thread works on this app.`,
    );
  }
  if (row.status === 'done' || row.status === 'dropped') {
    throw new AskInputError(`#${text} is ${row.status}, so nothing more goes under it.`);
  }
  if (row.kind !== 'build') throw new AskInputError(`#${text} is a ${row.kind} step; put rows under a feature or a build step.`);
  return row;
}

function planRow(id: string, number: number, title: string, kind: string): AskRow {
  const ref = toRef('public.plan_items', id);
  return { table: 'public.plan_items', ref, title, href: refHref(ref) ?? '/dev/plan', detail: { number, kind, status: 'proposed' } };
}

async function nextPosition(ctx: ConnectorWriteContext, db: AskDb, scope: PlanScope | null, parentId: string | null) {
  let query = (await db('public')).from('plan_items').select('position').eq('user_id', ctx.userId);
  if (parentId) query = query.eq('parent_id', parentId);
  else query = scope ? query.is('parent_id', null).eq('module', scope) : query.is('parent_id', null).is('module', null);
  const { data, error } = await query.order('position', { ascending: false }).limit(1);
  if (error) throw new Error(`Reading the plan failed: ${error.message}`);
  return (((data ?? [])[0] as { position?: number } | undefined)?.position ?? 0) + 10;
}

async function recordPlan(ctx: ConnectorWriteContext, db: AskDb, kind: string, id: string, summary: string) {
  return recordDashAction(
    { userId: ctx.userId, core: ctx.core, db },
    { surface: 'routine', kind, subjectRef: toRef('public.plan_items', id), op: 'insert', summary },
  );
}

function written(summary: string, recorded: string | null): string {
  return recorded ? `${summary} It waits for the person to approve on the plan, and is listed on Home in Dash with an Undo.` : summary;
}

const STEP_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'What has to happen, as a short line.' },
    detail: { type: 'string', description: 'What it involves.' },
    done_when: { type: 'string', description: 'What is true when it is finished.' },
    size: { type: 'string', enum: [...SIZES] },
  },
  required: ['title', 'done_when'],
} as const;

const MODULE_FIELD = {
  type: 'string',
  description:
    "Only on a thread about this app: the workspace it belongs to (jobs, goals, learn, vault, dev and so on), or leave it out for the app as a whole. A project's thread always writes in its project.",
} as const;

const proposeFeature: ConnectorWriteTool = {
  definition: {
    name: 'propose_feature',
    description:
      "Propose a feature with its steps on the person's plan in Dash, in the section of the project your thread works on, when the conversation has shaped one. Everything is written proposed: nothing is built until they approve it on the plan. Give the feature a title, what it involves and its done-when, and one to twenty steps in order, each with a done-when. It is listed on Home with an Undo, which takes the feature and its steps away.",
    input_schema: {
      type: 'object',
      properties: {
        ...THREAD_FIELDS,
        title: { type: 'string', description: "The feature's name, as the plan lists it." },
        detail: { type: 'string', description: 'What it involves and why.' },
        done_when: { type: 'string', description: 'What is true when the whole feature is finished.' },
        size: { type: 'string', enum: [...SIZES] },
        module: MODULE_FIELD,
        steps: { type: 'array', items: STEP_SCHEMA, minItems: 1, maxItems: 20 },
      },
      required: ['title', 'done_when', 'steps'],
    },
  },
  async run(ctx, input) {
    const db = needsDb(ctx);
    const title = required(input, 'title', 200);
    const detail = str(input, 'detail', 8000);
    const doneWhen = required(input, 'done_when', 4000);
    const featureSize = size(input);
    const rawSteps = input.steps;
    if (!Array.isArray(rawSteps) || rawSteps.length < 1 || rawSteps.length > 20) {
      throw new AskInputError('steps must list one to twenty steps.');
    }
    const steps = rawSteps.map((entry, index) => {
      if (!entry || typeof entry !== 'object') throw new AskInputError(`steps[${index}] must be an object.`);
      const step = entry as Input;
      return {
        title: required(step, 'title', 200),
        detail: str(step, 'detail', 8000),
        acceptance: required(step, 'done_when', 4000),
        size: size(step),
      };
    });
    const thread = await threadOf(ctx, db, input);
    openThread(thread);
    const scope = scopeOf(thread, input);
    const pub = await db('public');

    const feature = await insertPlanItem(pub, {
      userId: ctx.userId,
      module: scope,
      parentId: null,
      title,
      detail,
      acceptance: doneWhen,
      status: 'proposed',
      kind: 'build',
      size: featureSize,
      position: await nextPosition(ctx, db, scope, null),
    });
    if ('error' in feature) throw new AskInputError(`The feature was not written: ${feature.error}`);
    const rows = [planRow(feature.id, feature.number, title, 'build')];
    for (const [index, step] of steps.entries()) {
      const made = await insertPlanItem(pub, {
        userId: ctx.userId,
        module: scope,
        parentId: feature.id,
        ...step,
        status: 'proposed',
        kind: 'build',
        position: (index + 1) * 10,
      });
      if ('error' in made) {
        throw new AskInputError(`Step ${index + 1} was not written (the feature #${feature.number} was): ${made.error}`);
      }
      rows.push(planRow(made.id, made.number, step.title, 'build'));
    }
    const summary = `Proposed the feature #${feature.number} "${clip(title, 80)}" with ${steps.length} step${steps.length === 1 ? '' : 's'}${scope ? ` in ${scope}` : ''}.`;
    const recorded = await recordPlan(ctx, db, 'propose_feature', feature.id, summary);
    return { ok: true, rows, note: written(summary, recorded) };
  },
};

const addPlanStep: ConnectorWriteTool = {
  definition: {
    name: 'add_plan_step',
    description:
      "Add a step under a feature or step on the person's plan in Dash, in the project your thread works on. Name the parent by its outline (\"#2789\" or \"#2789.5\"), its number or its id. The step is written proposed, for them to approve. It is listed on Home with an Undo.",
    input_schema: {
      type: 'object',
      properties: {
        ...THREAD_FIELDS,
        parent: { type: 'string', description: 'The feature or step it goes under: "#2789", "#2789.5", a number or an id.' },
        ...STEP_SCHEMA.properties,
      },
      required: ['parent', 'title', 'done_when'],
    },
  },
  async run(ctx, input) {
    const db = needsDb(ctx);
    const parentName = required(input, 'parent', 100);
    const title = required(input, 'title', 200);
    const detail = str(input, 'detail', 8000);
    const acceptance = required(input, 'done_when', 4000);
    const stepSize = size(input);
    const thread = await threadOf(ctx, db, input);
    openThread(thread);
    const parent = await planRowOf(ctx, db, thread, parentName);
    const made = await insertPlanItem(await db('public'), {
      userId: ctx.userId,
      module: parent.module,
      parentId: parent.id,
      title,
      detail,
      acceptance,
      status: 'proposed',
      kind: 'build',
      size: stepSize,
      position: await nextPosition(ctx, db, parent.module as PlanScope | null, parent.id),
    });
    if ('error' in made) throw new AskInputError(`The step was not written: ${made.error}`);
    const summary = `Proposed the step #${made.number} "${clip(title, 80)}" under "${clip(parent.title, 60)}".`;
    const recorded = await recordPlan(ctx, db, 'add_plan_step', made.id, summary);
    return { ok: true, rows: [planRow(made.id, made.number, title, 'build')], note: written(summary, recorded) };
  },
};

const writeDecision: ConnectorWriteTool = {
  definition: {
    name: 'write_decision',
    description:
      "Write a question for the person under a feature or step on their plan in Dash, in the project your thread works on, when something only they should decide stands in the way: hard to undo, could reasonably go either way with nothing settling it, or a change of scope. The question is one sentence ending in a question mark; give two or three options, each opening with its own name in one short sentence and then what it costs, and say which you recommend and why. It is written proposed under the parent named by its outline, number or id. It is listed on Home with an Undo.",
    input_schema: {
      type: 'object',
      properties: {
        ...THREAD_FIELDS,
        parent: { type: 'string', description: 'The feature or step it goes under: "#2789", "#2789.5", a number or an id.' },
        question: { type: 'string', description: 'The question, one sentence ending in "?".' },
        options: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 3 },
        recommend: { type: 'string', description: 'Which option you would choose and why, in a sentence or two.' },
      },
      required: ['parent', 'question', 'options', 'recommend'],
    },
  },
  async run(ctx, input) {
    const db = needsDb(ctx);
    const parentName = required(input, 'parent', 100);
    const question = required(input, 'question', 200);
    if (!question.endsWith('?')) throw new AskInputError('question must be one sentence ending in a question mark.');
    const options = texts(input, 'options', 2, 3, 1200).map((option) => option.replace(/^[A-C]\s*(?:—|-|\.|\))\s*/, ''));
    const recommend = required(input, 'recommend', 1200);
    const thread = await threadOf(ctx, db, input);
    openThread(thread);
    const parent = await planRowOf(ctx, db, thread, parentName);
    const detail = [...options.map((option, index) => `${LETTERS[index]} — ${option}`), `Recommend ${recommend.replace(/^recommend\s*/i, '')}`].join('\n');
    const made = await insertPlanItem(await db('public'), {
      userId: ctx.userId,
      module: parent.module,
      parentId: parent.id,
      title: question,
      detail,
      status: 'proposed',
      kind: 'decision',
      position: await nextPosition(ctx, db, parent.module as PlanScope | null, parent.id),
    });
    if ('error' in made) throw new AskInputError(`The question was not written: ${made.error}`);
    const summary = `Asked #${made.number} "${clip(question, 80)}" under "${clip(parent.title, 60)}".`;
    const recorded = await recordPlan(ctx, db, 'write_decision', made.id, summary);
    return { ok: true, rows: [planRow(made.id, made.number, question, 'decision')], note: written(summary, recorded) };
  },
};

/** The thread and plan tools, in the order clients are sent them. */
export const THREAD_TOOLS: readonly ConnectorWriteTool[] = [
  replyInThread,
  readThread,
  proposeFeature,
  addPlanStep,
  writeDecision,
];
