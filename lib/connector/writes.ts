import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { AskInputError, type AskDb, type AskRow, type AskToolResult, type SchemaClient } from '@/lib/ask/db';
import { recordDashAction } from '@/lib/core/dash-actions';
import type { DashWriteContext } from '@/lib/dash/registry';
import { WRITE_TOOLS } from '@/lib/dash/writes';
import type { ModuleId } from '@/lib/modules';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import {
  MAX_CHAT_ITEMS,
  addChatReadings,
  findChatLinks,
  findReadings,
  logChatSession,
  markChatReadingRead,
  type ChatIdea,
  type ChatItem,
} from '@/lib/learn/chat/readings';
import { cleanSubjectNames, resolveChatSubjects } from '@/lib/learn/chat/subjects';
import { LEARN_WRITES, runLearnWrite, type LearnMade } from '@/lib/dash/learn-writes';
import { briefStarter } from '@/lib/learn/briefs/start';
import { TODO_WRITES, runTodoWrite } from '@/lib/dash/todo-writes';
import { NEWS_WRITES, runNewsWrite, switchedOff } from '@/lib/dash/news-writes';
import { GOALS_WRITES, runGoalsWrite } from '@/lib/dash/goals-writes';
import { YOU_WRITES, runYouWrite } from '@/lib/dash/you-writes';
import { SHOPPING_OFF, SHOPPING_WRITES, runShoppingWrite, shoppingOn } from '@/lib/dash/shopping-writes';
import { VAULT_WRITES, runVaultWrite, vaultNotePorts, vaultSwitchedOff } from '@/lib/dash/vault-writes';
import { JOBS_OFF, JOBS_WRITES, jobsEnv, runJobsWrite } from '@/lib/dash/jobs-writes';
import { insertTask } from '@/lib/todo/tasks/write';
import { ProgressInputError, progressRpcArgs, readProgress } from '@/lib/plan/session-progress';
import type { TodoSupabaseClient } from '@/lib/todo/db/schema-name';

/**
 * The connector's write tools (plan #1808, under #1805): the few changes a
 * Claude app may make for the person it is signed in as. Three change Learn;
 * three more (plan #1894.2) save a quick note, file an idea and save a job
 * lead, by running Ask Dash's own write tools (lib/dash/writes.ts) on the
 * service-role clients, so each writes the row the page would.
 *
 * The token stays read-only. 0134_connector_read_only.sql makes every
 * database request carrying a connector token read-only, because the token
 * works against the REST API directly and could otherwise change anything.
 * These tools do not use the token to write. The MCP server runs each one
 * itself, with a service-role learn client, for the user id the verified
 * token names, so a client can make exactly these changes and no others.
 * The service role passes no RLS, so every query in lib/learn/chat names that
 * person.
 *
 * Four more (plan #1894.3) add a goal, add a step under one, close a step and
 * set a goal's done-when, by the same route. So do the rest of Ask Dash's
 * plain writes: adding, renaming and ticking off a todo, marking an item
 * returned, a note on a role, moving many roles, a round's prep note, post
 * drafts and a Dev project. Ask Dash keeps the writes the connector cannot
 * serve: add_todos and link_round_email name rows by an answer's sets and
 * its mail lookups, which a connector client never has; set_dash_model is
 * the app's own setting; the goals routine starts and the paid presses wait
 * on an approval card, which another client does not draw.
 *
 * Each change is recorded in core.dash_actions as Dash's, so it is listed on
 * Home with an Undo, and logged in core.connector_calls like a lookup.
 */

/** What a write runs with: the verified person, and the service-role clients. */
export type ConnectorWriteContext = {
  userId: string;
  /** Service-role learn client. */
  learn: LearnSupabaseClient;
  /** Service-role core client, for recording each change as Dash's. */
  core: SchemaClient;
  /** Runs work once the reply has gone: `after` from next/server. */
  later: (work: () => Promise<void>) => void;
  /** Records model spend against the person. */
  recordSpend: (
    userId: string,
    operation: 'match-subjects' | 'resolve-reference' | 'research-topic',
    reports: SpendReport[],
  ) => Promise<void>;
  anthropicApiKey: string | undefined;
  /** How long the lookups after the reply may run, as a Date.now() value. */
  lookupDeadline: number;
  /**
   * The service-role client per schema, for the writes Ask Dash's tools make
   * (add_quick_note, add_idea, add_job_lead). Absent: those are refused.
   */
  db?: AskDb;
  /**
   * A service-role goals client recording its writes in goals.history as the
   * history options say, for the goal writes (plan #1894.3). Absent: those
   * are refused.
   */
  goals?: DashWriteContext['goals'];
  /** The note-create ports on the person's vault, for add_quick_note. Absent: it is refused. */
  quickNotePorts?: DashWriteContext['quickNotePorts'];
  /**
   * The person's workspaces and day, from the token's lookup context
   * (connectorAccess): a write into a workspace that is off is refused.
   */
  account?: { enabledModules: readonly ModuleId[]; today: string; timezone?: string };
};

export type ConnectorWriteTool = {
  definition: Anthropic.Tool;
  run: (ctx: ConnectorWriteContext, input: Record<string, unknown>) => Promise<AskToolResult>;
};

const SUBJECTS_FIELD = {
  type: 'array',
  items: { type: 'string' },
  maxItems: 3,
  description:
    'One to three subjects this belongs to, in a few words each, such as "AI agents" or "Evals". Matched to the subjects the person already has in Learn; a name that matches none becomes a new subject.',
} as const;

function str(input: Record<string, unknown>, key: string, max: number): string | null {
  const value = input[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new AskInputError(`${key} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new AskInputError(`${key} is longer than ${max} characters.`);
  return trimmed || null;
}

function required(input: Record<string, unknown>, key: string, max: number): string {
  const value = str(input, key, max);
  if (!value) throw new AskInputError(`${key} is required.`);
  return value;
}

function items(input: Record<string, unknown>): ChatItem[] {
  const raw = input.items;
  if (!Array.isArray(raw) || raw.length === 0) throw new AskInputError('items must list at least one work.');
  if (raw.length > MAX_CHAT_ITEMS) throw new AskInputError(`items takes at most ${MAX_CHAT_ITEMS} works.`);
  return raw.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new AskInputError(`items[${index}] must be an object.`);
    const item = entry as Record<string, unknown>;
    return {
      title: required(item, 'title', 500),
      author: str(item, 'author', 300),
      url: str(item, 'url', 2000),
      why: str(item, 'why', 500),
    };
  });
}

function ideas(input: Record<string, unknown>): ChatIdea[] {
  const raw = input.ideas;
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new AskInputError('ideas must be a list.');
  if (raw.length > 12) throw new AskInputError('ideas takes at most 12.');
  return raw.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new AskInputError(`ideas[${index}] must be an object.`);
    const idea = entry as Record<string, unknown>;
    return { name: required(idea, 'name', 120), claim: required(idea, 'claim', 600) };
  });
}

function subjectNames(input: Record<string, unknown>): string[] {
  const raw = input.subjects;
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new AskInputError('subjects must be a list of names.');
  return cleanSubjectNames(raw);
}

/** Record one change as Dash's. A failure is logged and the change kept: it already happened. */
async function record(
  ctx: ConnectorWriteContext,
  ref: string,
  op: 'insert' | 'update' | 'delete',
  kind: string,
  summary: string,
  before?: Record<string, unknown>,
): Promise<void> {
  const { error } = await ctx.core.rpc('record_dash_action', {
    p_user_id: ctx.userId,
    p_subject_ref: ref,
    p_op: op,
    p_kind: kind,
    p_summary: summary,
    ...(before ? { p_before: before } : {}),
  });
  if (error) console.error('[connector write] record', error.message);
}

function quoted(title: string): string {
  return title.length > 120 ? `"${title.slice(0, 119)}…"` : `"${title}"`;
}

async function subjectsFor(ctx: ConnectorWriteContext, names: string[], note: string | null) {
  const spend: SpendReport[] = [];
  const subjects = await resolveChatSubjects(ctx.learn, ctx.userId, names, {
    note,
    anthropicApiKey: ctx.anthropicApiKey,
    onSpend: (report) => spend.push(report),
  });
  await ctx.recordSpend(ctx.userId, 'match-subjects', spend);
  return subjects;
}

const addToReadingList: ConnectorWriteTool = {
  definition: {
    name: 'add_to_reading_list',
    description:
      'Add works to the person\'s Learn reading list in Dash. Use it when they say "add this to my reading list", "save these to read", or "put that on Dash". Pass every work named, each with its title, author when given, a link only if one was actually given, and the reason it was recommended, close to the words used. Name the subjects the list belongs to and the question the person was trying to answer. Each work is added once: one already on any of their lists is related to the subjects and reported as already there. Where to read each one is looked up after this returns, so the rows link to the reading pages, where the link appears within a few minutes.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_CHAT_ITEMS,
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'The work itself, with no commentary: "Building Effective Agents".' },
              author: { type: 'string', description: 'The author or publisher as given, such as "Anthropic". Never guessed.' },
              url: { type: 'string', description: 'A https link, only when one was given.' },
              why: { type: 'string', description: 'Why it was recommended, close to the words used.' },
            },
            required: ['title'],
            additionalProperties: false,
          },
        },
        subjects: SUBJECTS_FIELD,
        question: {
          type: 'string',
          description: 'What the person was trying to understand when these were recommended, in a sentence.',
        },
      },
      required: ['items', 'subjects'],
      additionalProperties: false,
    },
  },
  async run(ctx, input) {
    const works = items(input);
    const question = str(input, 'question', 2000);
    const names = subjectNames(input);
    if (names.length === 0) throw new AskInputError('subjects must name at least one subject.');

    const subjects = await subjectsFor(ctx, names, question);
    const added = await addChatReadings(ctx.learn, ctx.userId, { items: works, question, subjects });
    const fresh = added.readings.filter((row) => row.added);

    const under = subjects.map((subject) => subject.name).join(', ');
    for (const row of fresh) {
      await record(
        ctx,
        `learn.readings:${row.id}`,
        'insert',
        'add_reading',
        `Dash added ${quoted(row.title)} to your reading list from a chat, under ${under}.`,
      );
    }

    if (fresh.length > 0) {
      const ids = fresh.map((row) => row.id);
      ctx.later(async () => {
        await findChatLinks(ctx.learn, {
          readingIds: ids,
          userId: ctx.userId,
          question,
          anthropicApiKey: ctx.anthropicApiKey,
          deadline: ctx.lookupDeadline,
          onSpend: (userId, reports) => ctx.recordSpend(userId, 'resolve-reference', reports),
        }).catch((error) => console.error('[connector write] links', error instanceof Error ? error.message : error));
      });
    }

    const rows: AskRow[] = [
      ...added.readings.map((row) => ({
        table: 'learn.readings',
        ref: row.id,
        title: row.title,
        href: `/learn/r/${row.id}`,
        detail: { added: row.added },
      })),
      ...subjects.map((subject) => ({
        table: 'learn.subjects',
        ref: subject.id,
        title: subject.name,
        href: `/learn/s/${subject.id}`,
        detail: { new_subject: subject.created },
      })),
    ];
    const kept = added.readings.length - fresh.length;
    return {
      ok: true,
      rows,
      totals: { added: fresh.length, already_there: kept },
      note: `Added ${fresh.length} of ${added.readings.length} to the "From your conversations" list${kept ? `; ${kept} ${kept === 1 ? 'was' : 'were'} already on a list` : ''}, related to ${under}. Links are being looked up now.`,
    };
  },
};

const logLearning: ConnectorWriteTool = {
  definition: {
    name: 'log_learning',
    description:
      'Record in Dash what this conversation covered, so Learn knows the person has met these ideas. Use it when they ask to save or log what they learned, or say "remember this on Dash". Give the topic, a summary of what was covered in a few sentences, the subject it belongs to, and up to twelve ideas, each a short name and a one or two sentence claim that could be right or wrong. This credits no knowledge: each idea is added to the subject as untested, and Learn asks about it later.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'What it was about, in a few words.' },
        summary: { type: 'string', description: 'What was covered, in a few sentences.' },
        question: { type: 'string', description: 'What the person was trying to understand, in a sentence.' },
        subject: {
          type: 'string',
          description: 'The one subject it belongs to, matched to their existing subjects; a new one is made when none matches.',
        },
        ideas: {
          type: 'array',
          maxItems: 12,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Short, such as "Eval-driven iteration".' },
              claim: { type: 'string', description: 'The idea as a claim, in one or two sentences.' },
            },
            required: ['name', 'claim'],
            additionalProperties: false,
          },
        },
      },
      required: ['topic', 'summary', 'subject'],
      additionalProperties: false,
    },
  },
  async run(ctx, input) {
    const topic = required(input, 'topic', 200);
    const summary = required(input, 'summary', 4000);
    const question = str(input, 'question', 2000);
    const named = ideas(input);
    const subjectName = cleanSubjectNames([required(input, 'subject', 120)]);

    const [subject] = await subjectsFor(ctx, subjectName, question ?? topic);
    const logged = await logChatSession(ctx.learn, ctx.userId, { topic, question, summary, ideas: named, subject });
    await record(
      ctx,
      `learn.learning_log:${logged.id}`,
      'insert',
      'log_learning',
      `Dash recorded a chat about ${topic} under ${subject.name}, with ${logged.conceptsAdded} new ${logged.conceptsAdded === 1 ? 'idea' : 'ideas'} to test.`,
    );

    return {
      ok: true,
      rows: [
        { table: 'learn.subjects', ref: subject.id, title: subject.name, href: `/learn/s/${subject.id}`, detail: { new_subject: subject.created } },
      ],
      totals: { ideas_added: logged.conceptsAdded, ideas_already_there: logged.conceptsKnown },
      note: `Logged under ${subject.name}. ${logged.conceptsAdded} ${logged.conceptsAdded === 1 ? 'idea was' : 'ideas were'} added as untested${logged.conceptsKnown ? `; ${logged.conceptsKnown} the subject already had` : ''}.`,
    };
  },
};

const markRead: ConnectorWriteTool = {
  definition: {
    name: 'mark_read',
    description:
      'Mark something on the person\'s Learn reading list as read, with what they took from it as a note. Use it when they say they finished, read or watched something. Give reading_id when a reading_list or add_to_reading_list row named it; otherwise give words of its title. When the words fit several readings, nothing is changed and the candidates come back to choose from.',
    input_schema: {
      type: 'object',
      properties: {
        reading_id: { type: 'string', description: 'The reading\'s id, from an earlier row.' },
        title: { type: 'string', description: 'Words of its title, when there is no id.' },
        note: { type: 'string', description: 'What they took from it, in their words. Optional.' },
      },
      additionalProperties: false,
    },
  },
  async run(ctx, input) {
    const note = str(input, 'note', 2000);
    let readingId = str(input, 'reading_id', 64);
    if (!readingId) {
      const phrase = required(input, 'title', 300);
      const matches = await findReadings(ctx.learn, ctx.userId, phrase);
      const open = matches.filter((row) => row.status !== 'read');
      const pick = open.length === 1 ? open : matches.length === 1 ? matches : null;
      if (!pick) {
        return {
          ok: true,
          rows: matches.slice(0, 10).map((row) => ({
            table: 'learn.readings',
            ref: row.id,
            title: row.title,
            href: `/learn/r/${row.id}`,
            detail: { status: row.status },
          })),
          note:
            matches.length === 0
              ? `Nothing on the reading list matches "${phrase}". Nothing was changed.`
              : `${matches.length} readings match "${phrase}", so nothing was changed. Call again with the reading_id of the one they meant.`,
        };
      }
      readingId = pick[0].id;
    }
    if (!/^[0-9a-f-]{36}$/i.test(readingId)) throw new AskInputError('reading_id must be a reading\'s id.');

    const { before, after } = await markChatReadingRead(ctx.learn, ctx.userId, readingId, note);
    const title = (after.title as string | null) ?? 'a reading';
    await record(ctx, `learn.readings:${readingId}`, 'update', 'mark_read', `Dash marked ${quoted(title)} read from a chat.`, before);
    return {
      ok: true,
      rows: [{ table: 'learn.readings', ref: readingId, title, href: `/learn/r/${readingId}`, detail: { status: 'read', note_added: Boolean(note) } }],
      note: note ? 'Marked read, with their note.' : 'Marked read.',
    };
  },
};

/**
 * The rest of Learn's changes (plan #1894.8, lib/dash/learn-writes.ts), the
 * same tools Ask has, run here on the service-role client for the verified
 * person and recorded as Dash's like the three above.
 */
const LEARN_TOOLS: readonly ConnectorWriteTool[] = LEARN_WRITES.map((write) => ({
  definition: {
    name: write.name,
    description: `${write.description} The change is listed on the person's Home page with an Undo.`,
    input_schema: write.input_schema,
  },
  async run(ctx, input) {
    // research_topic's run goes on after the reply, on this service-role
    // client, with its spend recorded against the person (plan #2023.3).
    const research = briefStarter({
      learn: ctx.learn,
      userId: ctx.userId,
      recordSpend: (userId, reports) => ctx.recordSpend(userId, 'research-topic', reports),
      later: ctx.later,
      apiKey: ctx.anthropicApiKey,
    });
    // attach_vault_note finds the note in their vault, while that workspace is on.
    const vaultOn = !ctx.account || ctx.account.enabledModules.includes('vault');
    const vault = write.name === 'attach_vault_note' && ctx.db && vaultOn ? await ctx.db('obsidian') : undefined;
    const made = await runLearnWrite(write, { userId: ctx.userId, learn: ctx.learn, research, vault }, input);
    if ('ok' in made) throw new AskInputError(made.error);
    await recordMade(ctx, made);
    return { ok: true, rows: [made.row], note: made.summary };
  },
}));

/**
 * Record a Learn or Todo change as Dash's. One whose Undo needs more than the
 * row (research_topic's, which archives; a todo Dash tagged) keeps that in
 * `undo`, which core.record_dash_action does not take, so it is written from here.
 */
async function recordMade(
  ctx: ConnectorWriteContext,
  made: Pick<LearnMade, 'subjectRef' | 'op' | 'summary' | 'before' | 'undo'> & { kind: string },
): Promise<void> {
  if (!made.undo || !ctx.db) {
    await record(ctx, made.subjectRef, made.op, made.kind, made.summary, made.before ?? undefined);
    return;
  }
  await recordDashAction(
    { userId: ctx.userId, core: ctx.core, db: ctx.db },
    {
      surface: 'routine',
      kind: made.kind,
      subjectRef: made.subjectRef,
      op: made.op,
      summary: made.summary,
      beforeValues: made.before,
      undo: made.undo,
    },
  );
}

/**
 * Todo's changes beyond add, rename and tick off (plan #1894.9.1,
 * lib/dash/todo-writes.ts), the same tools Ask has, run here on the
 * service-role todo client for the verified person and recorded as Dash's.
 */
const TODO_TOOLS: readonly ConnectorWriteTool[] = TODO_WRITES.map((write) => ({
  definition: {
    name: write.name,
    description: `${write.description} The change is listed on the person's Home page with an Undo.`,
    input_schema: write.input_schema,
  },
  async run(ctx, input) {
    if (!ctx.db || !ctx.account) refuse();
    if (!ctx.account.enabledModules.includes('todo')) {
      throw new AskInputError('The Todo workspace is switched off, so nothing can be changed there.');
    }
    const env = { userId: ctx.userId, todo: await ctx.db('todo'), timezone: ctx.account.timezone ?? 'UTC', db: ctx.db };
    const made = await runTodoWrite(write, env, input);
    if ('ok' in made) throw new AskInputError(made.error);
    // A todo Dash tagged keeps the tags in `undo`, which the generic rule takes off (plan #2340.4).
    await recordMade(ctx, made);
    return { ok: true, rows: [made.row], note: made.summary };
  },
}));

/**
 * You's places (plan #1991.5, lib/dash/you-writes.ts), the same tools Ask
 * has, run here on the service-role you client for the verified person and
 * recorded as Dash's.
 */
const YOU_TOOLS: readonly ConnectorWriteTool[] = YOU_WRITES.map((write) => ({
  definition: {
    name: write.name,
    description: `${write.description} The change is listed on the person's Home page with an Undo.`,
    input_schema: write.input_schema,
  },
  async run(ctx, input) {
    if (!ctx.db || !ctx.account) refuse();
    if (!ctx.account.enabledModules.includes('you')) {
      throw new AskInputError('The You workspace is switched off, so nothing can be changed there.');
    }
    const made = await runYouWrite(write, { userId: ctx.userId, you: await ctx.db('you') }, input);
    if ('ok' in made) throw new AskInputError(made.error);
    await record(ctx, made.subjectRef, made.op, made.kind, made.summary, made.before ?? undefined);
    return { ok: true, rows: [made.row], note: made.summary };
  },
}));

/**
 * News's changes and stopping a watch (plan #1894.9.4, lib/dash/news-writes.ts),
 * the same tools Ask has, run here on the service-role clients for the
 * verified person and recorded as Dash's.
 */
const NEWS_TOOLS: readonly ConnectorWriteTool[] = NEWS_WRITES.map((write) => ({
  definition: {
    name: write.name,
    description: `${write.description} The change is listed on the person's Home page with an Undo.`,
    input_schema: write.input_schema,
  },
  async run(ctx, input) {
    if (!ctx.db || !ctx.account) refuse();
    const off = switchedOff(write, ctx.account.enabledModules);
    if (off) throw new AskInputError(`The ${off} workspace is switched off, so nothing can be changed there.`);
    const env = {
      userId: ctx.userId,
      news: await ctx.db('news'),
      learn: await ctx.db('learn'),
      todo: await ctx.db('todo'),
      core: await ctx.db('core'),
    };
    const made = await runNewsWrite(write, env, input);
    if ('ok' in made) throw new AskInputError(made.error);
    await record(ctx, made.subjectRef, made.op, made.kind, made.summary, made.before ?? undefined);
    return { ok: true, rows: [made.row], note: made.summary };
  },
}));

/**
 * Goals' area and goal changes (plan #1894.7.1, lib/dash/goals-writes.ts), the
 * same tools Ask has, run here on the service-role goals clients for the
 * verified person. Each is recorded with recordDashAction rather than the
 * bare record above, since a move or an area's archive keeps the sentence
 * saying why it has no Undo.
 */
const GOALS_TOOLS: readonly ConnectorWriteTool[] = GOALS_WRITES.map((write) => ({
  definition: {
    name: write.name,
    description: `${write.description} The change is listed on the person's Home page with an Undo.`,
    input_schema: write.input_schema,
  },
  async run(ctx, input) {
    if (!ctx.db || !ctx.account || !ctx.goals) refuse();
    if (!ctx.account.enabledModules.includes('goals')) {
      throw new AskInputError('The Goals workspace is switched off, so nothing can be changed there.');
    }
    const made = await runGoalsWrite(
      write,
      {
        userId: ctx.userId,
        goals: await ctx.db('goals'),
        write: ctx.goals,
        core: await ctx.db('core'),
        today: ctx.account.today,
        timezone: ctx.account.timezone,
      },
      input,
    );
    if ('ok' in made) throw new AskInputError(made.error);
    const recorded = await recordDashAction(
      { userId: ctx.userId, core: ctx.core, db: ctx.db },
      {
        surface: 'routine',
        kind: made.kind,
        subjectRef: made.subjectRef,
        op: made.op,
        summary: made.summary,
        beforeValues: made.before,
        undo: made.undo,
      },
    );
    if (!recorded) console.error('[connector write] record', made.kind);
    return { ok: true, rows: [made.row], note: made.summary };
  },
}));

/**
 * Shopping's one-item and list changes (plan #1894.5.1,
 * lib/dash/shopping-writes.ts), the same tools Ask has, run here on the
 * service-role public client for the verified person. Each can touch several
 * rows, so the record keeps them all in `undo`, and Home's Undo puts them
 * back by Ask's rule (MANY_ROW_KINDS in lib/core/dash-actions.ts).
 */
const SHOPPING_TOOLS: readonly ConnectorWriteTool[] = SHOPPING_WRITES.map((write) => ({
  definition: {
    name: write.name,
    description: `${write.description} The change is listed on the person's Home page with an Undo.`,
    input_schema: write.input_schema,
  },
  async run(ctx, input) {
    if (!ctx.db || !ctx.account) refuse();
    if (!shoppingOn(ctx.account.enabledModules)) throw new AskInputError(SHOPPING_OFF);
    const made = await runShoppingWrite(write, { userId: ctx.userId, shop: await ctx.db('public'), db: ctx.db }, input);
    if ('ok' in made) throw new AskInputError(made.error);
    await recordDashAction(
      { userId: ctx.userId, core: ctx.core, db: ctx.db },
      {
        surface: 'routine',
        kind: made.kind,
        subjectRef: made.subjectRef,
        op: made.op,
        summary: made.summary,
        beforeValues: made.before,
        undo: made.undo as unknown as Record<string, unknown>,
      },
    );
    return { ok: true, rows: [made.row], note: made.summary };
  },
}));

/**
 * The Vault's changes and correcting a course (plan #1894.9.3,
 * lib/dash/vault-writes.ts), the same tools Ask has, run here on the
 * service-role clients for the verified person. A note change keeps in `undo`
 * what taking its commit back needs, which core.record_dash_action has no
 * argument for, so these are recorded with recordDashAction, as a shared
 * write is, and Home's Undo takes the file back (undoneByVault).
 */
const VAULT_TOOLS: readonly ConnectorWriteTool[] = VAULT_WRITES.map((write) => ({
  definition: {
    name: write.name,
    description: `${write.description} The change is listed on the person's Home page with an Undo.`,
    input_schema: write.input_schema,
  },
  async run(ctx, input) {
    if (!ctx.db || !ctx.account) refuse();
    const off = vaultSwitchedOff(write, ctx.account.enabledModules);
    if (off) throw new AskInputError(`The ${off} workspace is switched off, so nothing can be changed there.`);
    const vault = await ctx.db('obsidian');
    const env = {
      userId: ctx.userId,
      vault,
      core: await ctx.db('core'),
      you: await ctx.db('you'),
      notes: vaultNotePorts(vault, ctx.userId),
    };
    const made = await runVaultWrite(write, env, input);
    if ('ok' in made) throw new AskInputError(made.error);
    const recorded = await recordDashAction(
      { userId: ctx.userId, core: ctx.core, db: ctx.db },
      {
        surface: 'routine',
        kind: made.kind,
        subjectRef: made.subjectRef,
        op: made.op,
        summary: made.summary,
        beforeValues: made.before,
        undo: made.undo,
      },
    );
    return {
      ok: true,
      rows: [made.row],
      note: recorded ? made.summary : `${made.summary} Its Undo could not be kept, so it is changed back on its page.`,
    };
  },
}));

/**
 * Jobs' role and application edits (plan #1894.6.1, lib/dash/jobs-writes.ts),
 * the same tools Ask has, run here on the service-role job_search client for
 * the verified person and recorded as Dash's. Most change one row, so the
 * bare record above keeps all its Undo needs. A merge of roles (plan
 * #1894.6.2) touches many, so its record keeps them all in `undo`, and Home's
 * Undo puts them back by Ask's rule (MANY_ROW_KINDS in lib/core/dash-actions.ts).
 */
const JOBS_TOOLS: readonly ConnectorWriteTool[] = JOBS_WRITES.map((write) => ({
  definition: {
    name: write.name,
    description: `${write.description} The change is listed on the person's Home page with an Undo.`,
    input_schema: write.input_schema,
  },
  async run(ctx, input) {
    if (!ctx.db || !ctx.account) refuse();
    if (!ctx.account.enabledModules.includes('jobs')) throw new AskInputError(JOBS_OFF);
    const made = await runJobsWrite(write, await jobsEnv(ctx.userId, ctx.db, ctx.account.timezone), input);
    if ('ok' in made) throw new AskInputError(made.error);
    if (!made.undo) {
      await record(ctx, made.subjectRef, made.op, made.kind, made.summary, made.before ?? undefined);
      return { ok: true, rows: [made.row], note: made.summary };
    }
    const recorded = await recordDashAction(
      { userId: ctx.userId, core: ctx.core, db: ctx.db },
      {
        surface: 'routine',
        kind: made.kind,
        subjectRef: made.subjectRef,
        op: made.op,
        summary: made.summary,
        beforeValues: made.before,
        undo: made.undo,
      },
    );
    if (!recorded) console.error('[connector write] record', made.kind);
    return { ok: true, rows: [made.row], note: made.summary };
  },
}));

/** Ask Dash's write tools the connector also offers, with what a client is told each does. */
type SharedWrite =
  | 'add_quick_note'
  | 'add_idea'
  | 'add_job_lead'
  | 'add_interview_round'
  | 'add_goal'
  | 'add_goal_step'
  | 'close_goal_step'
  | 'set_goal_done_when'
  | 'change_items'
  | 'add_todo'
  | 'change_todo'
  | 'close_todo'
  | 'mark_returned'
  | 'add_role_note'
  | 'move_roles'
  | 'write_prep_note'
  | 'rewrite_post'
  | 'suggest_post'
  | 'add_project';

/**
 * The shared writes that name a goal or a step by its ref. Ask holds a ref to
 * one a lookup in the conversation returned; the connector keeps no
 * conversation, so it takes any ref, and every read in these tools names the
 * verified person, so a ref that is not theirs is refused as not found.
 */
const NAMES_GOAL_ROWS: ReadonlySet<SharedWrite> = new Set(['add_goal_step', 'close_goal_step', 'set_goal_done_when']);

/**
 * The shared writes that take any ref the same way: every read in them names
 * the verified person. change_items reads each item and order by user id
 * (plan #1894.5.1). add_interview_round reads the role and its application
 * by user id too (plan #1894.6.9).
 */
const TAKES_ANY_REF: ReadonlySet<SharedWrite> = new Set([
  ...NAMES_GOAL_ROWS,
  'change_items',
  'add_interview_round',
  // Each reads the todo, item, role, application, round or post draft it
  // names by user id before changing anything (plan #1894: the connector
  // does what Ask Dash does).
  'change_todo',
  'close_todo',
  'mark_returned',
  'add_role_note',
  'move_roles',
  'write_prep_note',
  'rewrite_post',
]);

/** The shared writes that change Goals, and so need the goals client. */
const WRITES_GOALS: ReadonlySet<SharedWrite> = new Set(['add_goal', ...NAMES_GOAL_ROWS]);

function refuse(): never {
  throw new AskInputError('That change cannot be made through this connection.');
}

/**
 * One of Ask Dash's write tools, run for the connector: the same checks and
 * the same write, on a context built from the service-role clients, then
 * recorded in core.dash_actions as a routine's change (surface 'routine'), so
 * Home lists it with an Undo. A quick note keeps the blob SHA it was written
 * at, and Home's Undo takes its file out of the vault (undoneByVault).
 */
function sharedWrite(name: SharedWrite, description: string): ConnectorWriteTool {
  const dash = WRITE_TOOLS.find((tool) => tool.name === name);
  if (!dash) throw new Error(`Ask Dash has no write tool called ${name}.`);
  return {
    definition: { ...dash.definition, description },
    async run(ctx, input) {
      if (!ctx.db || !ctx.account) refuse();
      if (WRITES_GOALS.has(name) && !ctx.goals) refuse();
      const db = ctx.db;
      const goals = ctx.goals;
      const write = {
        userId: ctx.userId,
        today: ctx.account.today,
        timezone: ctx.account.timezone,
        enabledModules: ctx.account.enabledModules,
        db,
        searchSources: [],
        seen: () => TAKES_ANY_REF.has(name),
        // Only the goal writes reach this; none of the others writes a goal.
        goals: goals && WRITES_GOALS.has(name) ? goals : async () => refuse(),
        // add_todo's write, on the service-role todo client for the verified person.
        createTask: async (owner, task, timezone) =>
          insertTask((await db('todo')) as unknown as TodoSupabaseClient, owner, task, timezone),
        quickNotePorts: ctx.quickNotePorts,
      } satisfies DashWriteContext;
      const result = await dash.apply(write, input);
      if (!result.ok) return { ok: false, error: result.error };
      const recorded = await recordDashAction(
        { userId: ctx.userId, core: ctx.core, db },
        {
          surface: 'routine',
          kind: result.kind,
          subjectRef: result.subjectRef,
          op: result.op,
          summary: result.summary,
          beforeValues: result.before,
          undo: result.undo ?? null,
        },
      );
      return {
        ok: true,
        rows: [result.row],
        note: recorded
          ? `${result.summary} It is listed on Home in Dash with an Undo.`
          : `${result.summary} Its Undo could not be kept, so it is changed back on its page.`,
      };
    },
  };
}

const addQuickNote = sharedWrite(
  'add_quick_note',
  'Save a quick thought to the person\'s vault in Dash, as a quick note in its Inbox, when they ask you to note, jot down or save a thought ("add this to my quick thoughts", "save this thought on Dash"). Write it word for word as they gave it. It waits in Quick note triage to be sorted, and is listed on Home with an Undo.',
);

const addIdea = sharedWrite(
  'add_idea',
  'File an idea on the ideas page in Dash\'s Dev workspace, when they ask you to note an idea for the app ("add an idea to Dev", "file that as an idea"). Write it as they said it, readable among other ideas, and name the workspace it is about when it is about one (jobs, goals, learn, vault, dev and so on). It is listed on Home with an Undo.',
);

const addJobLead = sharedWrite(
  'add_job_lead',
  'Save a job to the person\'s leads in Dash\'s Jobs workspace, when they ask you to ("add this job to my leads", a pasted posting link). Pass the posting link when there is one; the title and the company are read from the posting when it names them, so a bare link is enough. Pass the title and company when they named them. If the posting cannot be read or names no company, the call says what to ask them. When they say the company is a target (or interested, backup or passed), pass company_priority and the company is marked so; for a job already saved, mark its company with change_company. It is listed on Home with an Undo.',
);

const addInterviewRound = sharedWrite(
  'add_interview_round',
  `Add an interview round to one of the person's roles in Dash's Jobs workspace, when they ask ("add a take-home round to the Stripe role"). Name the role by the job_search.roles ref search returned, or the job_search.applications ref job_applications returned; look it up first. The round is numbered after the role's other rounds and holds one interview of the kind given. Give a label only when they named the round, and a date and time only when they gave them. It is listed on Home with an Undo.`,
);

const addGoal = sharedWrite(
  'add_goal',
  'Add a goal to the person\'s Goals workspace in Dash, under one of their areas, when they ask for a new goal ("add a goal to run a half marathon"). Name the area by its name as they have it; when none of theirs fits, pass new_area true with a short name for one. Write the goal as an outcome. A step under a goal they already have is add_goal_step. It is listed on Home with an Undo.',
);

const addGoalStep = sharedWrite(
  'add_goal_step',
  'Add a step to the end of one of the person\'s goals in Dash, when they ask you to. Name the goal by the goals.items ref goal_status or search (kinds ["goal"]) returned for it; look it up first. The step is theirs, and the goal must already be approved. It is listed on Home with an Undo.',
);

const closeGoalStep = sharedWrite(
  'close_goal_step',
  'Mark a step under one of the person\'s goals in Dash done, when they say it is done or ask you to. Name the step by the goals.items ref search (kinds ["step"]) or goal_status returned for it; look it up first. A goal itself is not closed this way. It is listed on Home with an Undo.',
);

const changeItems = sharedWrite(
  'change_items',
  `Change many of the items the person owns in Dash's Shopping workspace at once, when they ask: mark them for sale or to return, take them off either, group copies as one item, ungroup them, separate a copy from its stack, or say they sold, gave away, donated, threw out, recycled or used them up (dispose, with disposal_method). Name the items by the public.inventory_items refs lookups returned, or whole orders by public.orders refs. At most 100 items. Deleting is not something you can do. It is listed on Home with one Undo for the whole change.`,
);

const setGoalDoneWhen = sharedWrite(
  'set_goal_done_when',
  'Write, change or clear the done-when of one of the person\'s goals in Dash, when they ask: the line that says when the goal is finished ("the song is live on Spotify"). Name the goal by the goals.items ref search (kinds ["goal"]) or goal_status returned for it; look it up first. Write it in their words; an empty done_when clears it. It is listed on Home with an Undo.',
);

const addTodo = sharedWrite(
  'add_todo',
  'Add a new todo to the person\'s list in Dash\'s Todo workspace, when they ask you to ("add a todo to call the dentist", "remind me to renew my passport on Friday"). Write it as they would, in a short line, and give due_on (YYYY-MM-DD) only when they named a day. It arrives tagged now when due today or before, eventually when it has no date or one more than two weeks off; send tags only for more, from the ones they already use (the todos lookup lists them in tags_in_use), never new ones. A line on an existing todo\'s list is add_todo_item. It is listed on Home with an Undo.',
);

const changeTodo = sharedWrite(
  'change_todo',
  'Rename one of the person\'s open todos in Dash, or move it to another day, when they ask ("move the dentist to Friday"). Name it by the todo.tasks ref search or todos returned for it; look it up first. Send only what changes: title to rename it, due_on to move it (null takes the date off), due_time only with a due_on. Notes, pins, putting off and dropping are edit_todo. It is listed on Home with an Undo.',
);

const closeTodo = sharedWrite(
  'close_todo',
  'Tick off one of the person\'s open todos in Dash, when they say it is done or ask you to. Name it by the todo.tasks ref search or todos returned for it; look it up first. The items on its list are ticked off with it. It is listed on Home with an Undo.',
);

const markReturned = sharedWrite(
  'mark_returned',
  'Mark an item the person owns in Dash\'s Shopping workspace as returned, when they say they sent it back. Name it by the public.inventory_items ref search returned for it; look it up first. It records a full refund at what the item cost. Only an owned item linked to an order can be returned. It is listed on Home with an Undo.',
);

const addRoleNote = sharedWrite(
  'add_role_note',
  'Add a note to one of the person\'s roles in Dash\'s Jobs workspace, when they ask you to note something on it ("note on the Stripe role that the recruiter is Sam"). Name the role by the job_search.roles ref search returned, or the job_search.applications ref job_applications returned; look it up first. Write the note in their words. It is listed on Home with an Undo.',
);

const moveRoles = sharedWrite(
  'move_roles',
  'Move many of the person\'s job roles in Dash to one stage at once, or archive them, when they ask ("archive every role I applied to before August with no reply", "move these three to in process"). Name the roles by the job_search.applications refs job_applications returned, or the job_search.roles refs search returned; find them with a lookup first, and for "no reply" use job_applications with no_reply. A lookup lists 50 at most: when it says more matched, narrow by date and look again so every one is named. At most 100 roles; set is not used here. stage is one of: lead, drafting, submitted, in_process, final_round, offer, rejected, withdrawn, role_closed, or archive (takes them off the board as withdrawn). Ghosted cannot be set. Deleting roles is not something you can do. Each move goes into the role\'s history as the board\'s would, and one Undo on Home puts the whole move back. Say how many roles it moved.',
);

const writePrepNote = sharedWrite(
  'write_prep_note',
  'Write the prep note for an interview round on one of the person\'s roles in Dash\'s Jobs workspace, as the role page\'s "Prepare me" does, when they ask to be prepared ("prepare me for round 2 at Stripe"). Call it only when they ask for the prep: writing a note costs a model run, recorded against their spend. Name the round by its role (the job_search.roles or job_search.applications ref a lookup returned) and its number on that role. The note is written only when it is missing or out of date; when it is current this returns the stored one and spends nothing. With no job description and nothing in their evidence bank this refuses: pass that on in plain words. The reply says whether a run was spent; tell them. It cannot be undone; the role page can write the note again.',
);

const rewritePost = sharedWrite(
  'rewrite_post',
  'Rewrite the text of one of the person\'s X post drafts on the Posts tab in Dash\'s Dev workspace, when they ask ("make it shorter", "drop the second post"). Name the draft by the public.social_posts ref a lookup returned. Send posts as the whole new text, one string per post in the thread; a post left out is gone from the thread. Keep to their wording where they did not ask for a change. Each post must stay within X\'s length, with no links, hashtags, emoji, em dashes, @ mentions, amounts or anything from another workspace; a rewrite that breaks one is refused with the reasons and nothing changes. A draft they have posted or put aside cannot be rewritten. It is listed on Home with an Undo.',
);

const suggestPost = sharedWrite(
  'suggest_post',
  'Save a new X post draft to the Posts tab in Dash\'s Dev workspace, when they ask for a post about the app, how they build it, or something near it. Write about what the app does, never what they keep in it. Send angle as the one idea the post is about, and posts as the text, one string per post in the thread. No links, hashtags, emoji, em dashes, @ mentions, amounts, their name, the companies or people in their job search, or anything from another workspace; a draft that breaks one is refused with the reasons and nothing is saved, so fix them and call again. For picture, pass the path of one gallery picture post_pictures returned, where one fits. The draft waits on the Posts tab: nothing is posted. It is listed on Home with an Undo.',
);

const addProject = sharedWrite(
  'add_project',
  'Add one of the person\'s GitHub repositories as a project in Dash\'s Dev workspace, when they ask ("add my recipes repo as a project"). It gets its own section on the plan. Name it by owner/name, or by its name alone and it is looked up among their repositories on GitHub; a name that matches none or several is refused with the matches, so ask which. One already added is refused, and one they archived is put back. It is listed on Home with an Undo.',
);

/**
 * A session's report of what it is doing (plan #2800.1), for the project
 * pages and Dev to show while it works. Bookkeeping rather than a change to
 * the person's own rows, so it is not recorded on Home and has no Undo.
 */
const reportProgress: ConnectorWriteTool = {
  definition: {
    name: 'report_progress',
    description:
      'Say what this Claude Code session is doing, for the person to see on the project page and in Dev while you work. Call it when you start, after each step you build or commit, when you stop to wait on the person (state waiting, with what you need in needs), and when you finish (done) or end without finishing (stopped). Each call rewrites this session\'s row for its step, so send the whole current picture each time. Pass session_id (your session\'s id, from CLAUDE_CODE_REMOTE_SESSION_ID), and run_id when your brief names the plan run you were sent as, thread_id when you answer in a session thread, and project when you work on one of their Dev projects rather than the dashboard itself.',
    input_schema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'This session\'s id, such as cse_015….' },
        state: { type: 'string', enum: ['working', 'waiting', 'done', 'stopped'], description: 'working while you work, waiting when you need the person, done when finished, stopped when ending without finishing.' },
        action: { type: 'string', description: 'What you did last or are doing now, in one line the person can read ("Committed the export page").' },
        needs: { type: 'string', description: 'While waiting: what you need from them, as a question or a job they can act on. Ignored in any other state.' },
        run_id: { type: 'string', description: 'The plan run this session was sent as (the id under "Ending this run" in the brief). The step is taken from it.' },
        plan_item_id: { type: 'string', description: 'The plan step\'s id, when you know it and are on a different step from the run\'s.' },
        thread_id: { type: 'string', description: 'The session thread you answer in, when you were started from one.' },
        project: { type: 'string', description: 'The Dev project\'s id (such as music-pipeline) when you work on one of their projects.' },
      },
      required: ['session_id', 'state', 'action'],
      additionalProperties: false,
    },
  },
  async run(ctx, input) {
    let report;
    try {
      report = readProgress(input);
    } catch (error) {
      if (error instanceof ProgressInputError) throw new AskInputError(error.message);
      throw error;
    }
    const { data, error } = await ctx.core.rpc('report_session_progress', progressRpcArgs(ctx.userId, report));
    if (error) throw new AskInputError(error.message);
    const row = data as { id: string; state: string; plan_item_id: string | null; updated_at: string };
    return {
      ok: true,
      rows: [
        {
          table: 'core.session_progress',
          ref: row.id,
          title: report.action,
          href: report.project ? `/dev/projects/${report.project}` : '/dev/plan',
          detail: { state: row.state, needs: report.needs, updated_at: row.updated_at },
        },
      ],
      note: report.state === 'waiting' ? 'Reported as waiting on the person.' : `Reported as ${report.state}.`,
    };
  },
};

/** Every write the connector offers, in the order clients are sent them. */
export const CONNECTOR_WRITE_TOOLS: readonly ConnectorWriteTool[] = [
  addToReadingList,
  logLearning,
  markRead,
  addQuickNote,
  addIdea,
  addJobLead,
  addInterviewRound,
  addGoal,
  addGoalStep,
  closeGoalStep,
  setGoalDoneWhen,
  changeItems,
  addTodo,
  changeTodo,
  closeTodo,
  markReturned,
  addRoleNote,
  moveRoles,
  writePrepNote,
  rewritePost,
  suggestPost,
  addProject,
  reportProgress,
  ...LEARN_TOOLS,
  ...TODO_TOOLS,
  ...YOU_TOOLS,
  ...NEWS_TOOLS,
  ...GOALS_TOOLS,
  ...SHOPPING_TOOLS,
  ...VAULT_TOOLS,
  ...JOBS_TOOLS,
];

/** Run one write. Never throws: a bad input or a failed write is an error result the model can read. */
export async function runConnectorWrite(
  tool: ConnectorWriteTool,
  ctx: ConnectorWriteContext,
  input: unknown,
): Promise<AskToolResult> {
  const args = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  try {
    return await tool.run(ctx, args);
  } catch (error) {
    if (error instanceof AskInputError) return { ok: false, error: error.message };
    console.error(`connector write ${tool.definition.name} failed`, error);
    return { ok: false, error: error instanceof Error ? error.message : 'That change could not be saved.' };
  }
}
