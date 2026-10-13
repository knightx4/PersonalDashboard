import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { AskInputError, type AskRow, type AskToolResult, type SchemaClient } from '@/lib/ask/db';
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
import { LEARN_WRITES, runLearnWrite } from '@/lib/dash/learn-writes';

/**
 * The connector's write tools (plan #1808, under #1805): the few changes a
 * Claude app may make in Learn for the person it is signed in as.
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
  recordSpend: (userId: string, operation: 'match-subjects' | 'resolve-reference', reports: SpendReport[]) => Promise<void>;
  anthropicApiKey: string | undefined;
  /** How long the lookups after the reply may run, as a Date.now() value. */
  lookupDeadline: number;
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
  op: 'insert' | 'update',
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
    const made = await runLearnWrite(write, { userId: ctx.userId, learn: ctx.learn }, input);
    if ('ok' in made) throw new AskInputError(made.error);
    await record(ctx, made.subjectRef, made.op, made.kind, made.summary, made.before ?? undefined);
    return { ok: true, rows: [made.row], note: made.summary };
  },
}));

/** Every write the connector offers, in the order clients are sent them. */
export const CONNECTOR_WRITE_TOOLS: readonly ConnectorWriteTool[] = [addToReadingList, logLearning, markRead, ...LEARN_TOOLS];

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
