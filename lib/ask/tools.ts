import type Anthropic from '@anthropic-ai/sdk';
import type { ModuleId } from '@/lib/modules';
import { AskInputError, isOpenableHref, type AskContext, type AskToolResult } from './db';
import { mailLookup, readMailLookup } from './mail';
import {
  APPLICATION_STATUSES,
  HIT_KIND_IDS,
  OPENABLE,
  SCHEMA_MODULES,
  applicationsLookup,
  goalsLookup,
  openLookup,
  recallLookup,
  searchLookup,
  spendLookup,
  todosLookup,
  vaultLookup,
} from './lookups';
import type { AskSchema } from './db';
import { coursesLookup } from './courses';
import { notePositionsLookup } from './positions';
import { DEV_ROW_KINDS, DEV_TEXT_KINDS, findDevTextLookup, readDevRowLookup, readSpecLookup, specList } from './dev';

/**
 * Dash's read tools (plan #1088): what the model is told it can call, and
 * how a call it makes is run. The loop that calls them until an answer is
 * written is plan #1089.
 *
 * Read only, by construction: every tool is a fixed query in lookups.ts, and
 * none takes SQL or a table the catalogue does not list. Each runs as the
 * signed-in person (lib/ask/clients.ts), filtered to their id as well as
 * scoped by row level security.
 *
 * Every row a tool returns carries `table`, `ref`, `title` and `href`, which
 * is a TalkCitation (lib/talk/talk.ts) as it stands; `citationsOf` in db.ts
 * takes them off a result. A row without a link the page can open is dropped
 * here rather than trusted to each tool.
 */

export const ASK_TOOL_NAMES = [
  'search',
  'recall',
  'open_row',
  'spend_by_merchant',
  'job_applications',
  'todos',
  'goal_status',
  'vault_notes',
  'note_positions',
  'courses',
  'read_spec',
  'read_dev_row',
  'find_dev_text',
  'search_mail',
  'read_mail',
] as const;

/**
 * Tools the connector (lib/connector/mcp.ts) does not offer. Mail is searched
 * and read in Gmail as the person, which a connector token cannot do, and
 * what it holds is not to leave the app for another client.
 */
export const IN_APP_ONLY_TOOLS: readonly AskToolName[] = ['search_mail', 'read_mail'];

export type AskToolName = (typeof ASK_TOOL_NAMES)[number];

const DATE_FIELD = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } as const;

/** The tables open_row takes, with what each holds, for its description. */
function openableList(): string {
  return OPENABLE.map((s) => `${s.table} (${s.holds.replace(/\.$/, '')})`).join('; ');
}

/**
 * The definitions to pass as `tools` on messages.create. Built once: the
 * order and wording never change within a deployment, so a cached prefix
 * holds across questions.
 */
export const ASK_TOOLS: readonly Anthropic.Tool[] = [
  {
    name: 'search',
    description:
      'Find the person\'s own things by the words in their title or name, across every workspace that is switched on: job search companies, roles and contacts; shopping orders, owned items and saved items; todos; vault notes (by title and path) and courses from saved transcripts (by title, code, term and school); Learn readings and tracks; build plan steps, ideas and feedback; newsletter stories; goals and goal steps. Returns up to 20 matches, each with a table, a ref and a link. Use it to find a named thing; it does not look inside the text of a row. For a word inside the text of an idea, note, plan step, raise, comment or spec, use find_dev_text. For what the person has said, written or thought about a topic, use recall. Pass a row\'s table and ref to open_row to read it in full; a plan step, idea, feedback note or raise is read with read_dev_row instead.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Two or more characters, matched against titles and names. A name or a few words, not a question.',
        },
        kinds: {
          type: 'array',
          items: { type: 'string', enum: HIT_KIND_IDS },
          description: 'Only these kinds of thing. Leave out to search every kind.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'recall',
    description:
      'Find what the person has written about a topic by meaning, across every workspace that is switched on: vault notes, the courses on saved transcripts, job search thoughts, notes and profile, goals and steps, goal captures, files, Learn aims, notes and cards, purchases, and for the owner with Dev on, the ideas, notes, plan steps, raises, the comments under them, and spec sections. Finds passages that are about the question even when they share none of its words. Returns up to 12 rows, closest first, each with its best one or two passages, who wrote each (the person or Dash), a closeness score and a link. Use it for questions like "what did I say I want from my next job?" or "what have I written about land value tax?", then open_row to read a vault note, file or thoughts entry in full, read_dev_row for a Dev row with its comments, or read_spec for a spec section.',
    input_schema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The topic or question in plain words, as the person would put it. A sentence works better than keywords.',
        },
        only_mine: {
          type: 'boolean',
          description: "Leave out text Dash wrote (drafts, files, goal results, Learn cards) and return only the person's own writing.",
        },
      },
      required: ['question'],
      additionalProperties: false,
    },
  },
  {
    name: 'open_row',
    description: `Read one row in full: its title and the text columns worth reading, with the link to its page. Use the table and ref another tool returned. A row found by search is named by its id, which is accepted for every table. The tables that can be opened: ${openableList()}.`,
    input_schema: {
      type: 'object',
      properties: {
        table: { type: 'string', enum: OPENABLE.map((s) => s.table) },
        ref: { type: 'string', description: 'The ref another tool returned for the row.' },
      },
      required: ['table', 'ref'],
      additionalProperties: false,
    },
  },
  {
    name: 'spend_by_merchant',
    description:
      'What the person spent on orders placed between two dates, by merchant and by month, from their order emails. Totals are per currency and leave out cancelled orders; refunds are reported separately, in the period they landed. Lists the orders counted (newest 50) and each merchant, each with a link. Use it for any question about spending, a shop, or a period\'s purchases; narrow to one shop with merchant.',
    input_schema: {
      type: 'object',
      properties: {
        from: { ...DATE_FIELD, description: 'First day, YYYY-MM-DD, inclusive.' },
        to: { ...DATE_FIELD, description: 'Last day, YYYY-MM-DD, inclusive. Defaults to today.' },
        merchant: {
          type: 'string',
          description: 'Only merchants whose name contains this, ignoring case (for example "ebay").',
        },
      },
      required: ['from'],
      additionalProperties: false,
    },
  },
  {
    name: 'job_applications',
    description:
      'The person\'s job applications, with each one\'s role, company, status, the day it was sent, the day they last heard from the company, and for a rejection the stage it came at. Counts by status and by rejection stage over everything matched; lists the newest 50, each linking to its role. Filter by the day sent, by status, or to open applications with no word from the company for a number of days (for "who have I heard nothing from in a month", quiet_for_days 30).',
    input_schema: {
      type: 'object',
      properties: {
        from: { ...DATE_FIELD, description: 'Sent on or after this day, YYYY-MM-DD.' },
        to: { ...DATE_FIELD, description: 'Sent on or before this day, YYYY-MM-DD.' },
        status: {
          type: 'array',
          items: { type: 'string', enum: [...APPLICATION_STATUSES] },
          description: 'Only these statuses.',
        },
        quiet_for_days: {
          type: 'integer',
          minimum: 1,
          description: 'Only open applications where nothing has come back from the company in this many days.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'todos',
    description:
      'The person\'s todos finished between two dates, and the ones still open and past their due date today. Each links to the task on the todo list. Defaults to the last seven days.',
    input_schema: {
      type: 'object',
      properties: {
        from: { ...DATE_FIELD, description: 'First day, YYYY-MM-DD, inclusive.' },
        to: { ...DATE_FIELD, description: 'Last day, YYYY-MM-DD, inclusive. Defaults to today.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'goal_status',
    description:
      'Each of the person\'s open goals with its newest status from the daily goals review: on track, stalled, waiting on them, waiting on a date or waiting on another goal, with the reason and the next move. Each links to the goal\'s page.',
    input_schema: {
      type: 'object',
      properties: {
        include_proposed: {
          type: 'boolean',
          description: 'Also list goals still proposed and not yet approved.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'vault_notes',
    description:
      'Notes in the person\'s Obsidian vault: the ones changed between two dates, the ones whose text matches a query, or both. The query is matched against the whole note, title and body, as a web-style search ("leaving job", "\\"notice period\\"", "manager OR boss"). Returns up to 50, newest first, each with an excerpt and a link. Use it for notes from a period or for an exact word or name; for what they think about a topic, use recall, which also finds notes that put it in other words.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to find in the text of the notes.' },
        from: { ...DATE_FIELD, description: 'Changed on or after this day, YYYY-MM-DD.' },
        to: { ...DATE_FIELD, description: 'Changed on or before this day, YYYY-MM-DD.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'note_positions',
    description:
      'For one vault note, what Maya reads before writing a thought on it: the person\'s other notes nearest it by meaning, each with an excerpt; the positions their notes have been read as holding that bear on it (from this note, from a nearby note, or through a shared theme), each with its stance, its statement and the passages it was read from; and which of those positions conflict. Name the note by the ref vault_notes, search or recall returned for it. Use it to see how a note sits among the rest of their thinking, where their notes agree or disagree, or what they hold on its question.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'The note\'s ref, as vault_notes, search or recall returned it (its path).' },
      },
      required: ['ref'],
      additionalProperties: false,
    },
  },
  {
    name: 'courses',
    description:
      'The courses on the academic transcripts the person saved on the vault\'s Education tab: each with its school, term, credits and grade as the transcript writes them, and a link to its row. Narrow by term ("Fall 2019", "Spring"), year, school, or words in the course code or title; every word given must match. Leave everything out to list them all. Returns up to 80, in the order they were taken. Use it for "what courses did I take in Fall 2019?", "what did I study at <school>?" or "what grade did I get in statistics?"; for what they wrote about a subject they studied, use recall.',
    input_schema: {
      type: 'object',
      properties: {
        term: { type: 'string', description: 'Words of the term, such as "Fall 2019" or "Spring". A year alone is better as year.' },
        year: { type: 'integer', description: 'The year of the term, such as 2019.' },
        school: { type: 'string', description: 'Words of the school\'s name.' },
        query: { type: 'string', description: 'Words of the course code or title, such as "ECON" or "statistics".' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'read_spec',
    description: `Read one of the specs on the Dev specs page, section by section: the documents the app is built against. Pass a query to get the sections that talk about it, each with its full text (up to 6,000 characters) and a link to that section on the spec's page, so you can quote the paragraph that answers the question. Leave the query out, or ask for something no section mentions, and it lists the spec's headings; pass one back as section to read it. Only for the owner of the app, with the Dev workspace on. The specs, by slug: ${specList()}.`,
    input_schema: {
      type: 'object',
      properties: {
        spec: {
          type: 'string',
          description: 'The spec\'s slug, as listed above or as search returned it for a spec.',
        },
        query: {
          type: 'string',
          description: 'The topic in a few words ("em dashes", "how links expire"). Matched against the words of each section.',
        },
        section: {
          type: 'string',
          description: 'One section to read, by the section a heading list gave it.',
        },
      },
      required: ['spec'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_dev_row',
    description:
      'Read one row from the Dev pages in full, with the thread of comments under it oldest first: an idea (its text, who filed it, its triage), a note (a bug report or request, with its status and how it was resolved), a plan step, feature or question (its detail, done-when, history, answer, fog and the questions beneath it with their answers) or a raise (its story and its ask). Every comment and every idea says who wrote it: "me" is the person, "Dash" is you, from an earlier session. Use it for "what did Dash suggest under this idea" or "what is decided so far on step #1248". A step is named by its number or id; the others by the id search returned. A dismissed idea, step or raise is not returned. Only for the owner of the app, with the Dev workspace on.',
    input_schema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: [...DEV_ROW_KINDS],
          description: 'idea (public.ideas), note (public.feedback_items), step (public.plan_items, features and questions too) or raise (public.raised_items).',
        },
        ref: {
          type: 'string',
          description: 'The row\'s id, as search returned it; for a step, its number ("#1248") works too.',
        },
      },
      required: ['kind', 'ref'],
      additionalProperties: false,
    },
  },
  {
    name: 'find_dev_text',
    description:
      'Find the Dev rows and specs whose text holds every word of a query: ideas, notes (bug reports and requests, and how each was resolved), plan steps (their detail, done-when, answer and history), raises (their story and ask), the comments under any of these, and the sections of the specs. Search only matches titles; this looks inside the text. Returns up to 20 rows, newest first, and up to 5 spec sections, each with the excerpt around the match, the field it was found in, who wrote it ("me" is the person, "Dash" is you, from an earlier session; none when a step\'s detail was shaped by both) and a link. A comment is returned as the row it sits on, so read_dev_row reads the whole thread; a spec section is read with read_spec. Use it for "which ideas mention ranking" or "which comment said to drop a step". Dismissed ideas, steps and raises are left out, with the comments under them. Only for the owner of the app, with the Dev workspace on.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'One to three words to find in the text ("ranking", "drop step"). Each is matched at the start of a word, so "rank" finds "ranking". Not a question.',
        },
        kinds: {
          type: 'array',
          items: { type: 'string', enum: [...DEV_TEXT_KINDS] },
          description: 'Only these kinds: idea, note, step, raise, comment, spec. Leave out to look in all of them.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_mail',
    description:
      'Search the person\'s email in Gmail as it is right now, across every mailbox they have connected, whichever workspaces are on. Matches by sender, by words anywhere in the message, and by the days it arrived. Returns up to 20 messages, newest first, each with its sender, recipients, subject, the day and time it arrived in their timezone, Gmail\'s one-line preview and a link that opens it in Gmail; with more than one mailbox, which mailbox it is in. Use it for "when did Anthony last email me?" (from "Anthony"), "have I heard back from the landlord since Monday?" (from the landlord\'s name or words like "landlord", after Monday\'s date) or "which emails mention the lease?" (words "lease"). Gmail matches words and names, not meaning, so try another word or a shorter name before saying nothing was found. With no mailbox connected it returns an error saying so.',
    input_schema: {
      type: 'object',
      properties: {
        from: {
          type: 'string',
          description: 'The sender: a name, part of a name, or an address ("Anthony", "landlord@example.com").',
        },
        words: {
          type: 'string',
          description: 'Words the message must contain, in its subject or text ("lease renewal"). Every word must match.',
        },
        after: { ...DATE_FIELD, description: 'Arrived on or after this day, YYYY-MM-DD, in their timezone.' },
        before: { ...DATE_FIELD, description: 'Arrived before this day, YYYY-MM-DD, in their timezone; the day itself is not included.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'read_mail',
    description:
      'Open one email and read its text, for a question about what a message says: "what did the recruiter say about the start date?", "what time did they suggest?". Find the message with search_mail first and pass the ref it returned. Returns the sender, recipients, subject, the day and time it arrived in their timezone, the message\'s text (the first 8,000 characters of a long one) and a link that opens it in Gmail. Open only the messages the question is about; for who wrote, when, or what about, search_mail is enough.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'The ref search_mail returned for the message.' },
      },
      required: ['ref'],
      additionalProperties: false,
    },
  },
];

type Lookup = (ctx: AskContext, input: Record<string, unknown>) => Promise<AskToolResult>;

/** Each tool's lookup, and the workspace that has to be on for it to run (null: it checks itself). */
const LOOKUPS: Record<AskToolName, { run: Lookup; module: ModuleId | null }> = {
  search: { run: searchLookup, module: null },
  // Leaves out the switched-off workspaces itself; files belong to none.
  recall: { run: recallLookup, module: null },
  open_row: { run: openLookup, module: null },
  spend_by_merchant: { run: spendLookup, module: 'shopping' },
  job_applications: { run: applicationsLookup, module: 'jobs' },
  todos: { run: todosLookup, module: 'todo' },
  goal_status: { run: goalsLookup, module: 'goals' },
  vault_notes: { run: vaultLookup, module: 'vault' },
  note_positions: { run: notePositionsLookup, module: 'vault' },
  courses: { run: coursesLookup, module: 'vault' },
  // Checks the owner and the Dev workspace itself (lib/ask/dev.ts).
  read_spec: { run: readSpecLookup, module: null },
  read_dev_row: { run: readDevRowLookup, module: null },
  find_dev_text: { run: findDevTextLookup, module: null },
  // The mailbox belongs to the whole app, so no workspace has to be on.
  search_mail: { run: mailLookup, module: null },
  read_mail: { run: readMailLookup, module: null },
};

export function isAskToolName(name: string): name is AskToolName {
  return (ASK_TOOL_NAMES as readonly string[]).includes(name);
}

const MODULE_LABELS: Record<ModuleId, string> = {
  shopping: 'Shopping',
  jobs: 'Job search',
  vault: 'Vault',
  todo: 'Todo',
  learn: 'Learn',
  news: 'News',
  goals: 'Goals',
  dev: 'Dev',
};

/**
 * Run one tool call the model made. Never throws: a bad input, a switched-off
 * workspace or a failed read comes back as `{ ok: false, error }`, which the
 * loop hands the model as an error tool_result so it can try another way.
 */
export async function executeAskTool(
  name: string,
  input: unknown,
  ctx: AskContext,
): Promise<AskToolResult> {
  if (!isAskToolName(name)) return { ok: false, error: `There is no tool called ${name}.` };
  const args = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const { run, module } = LOOKUPS[name];

  const needs =
    module ??
    (name === 'open_row' && typeof args.table === 'string'
      ? (SCHEMA_MODULES[args.table.split('.')[0] as AskSchema] ?? null)
      : null);
  if (needs && !ctx.enabledModules.includes(needs)) {
    return { ok: false, error: `The ${MODULE_LABELS[needs]} workspace is switched off, so it cannot be read.` };
  }

  try {
    const result = await run(ctx, args);
    if (!result.ok) return result;
    // The promise to the page: every row a tool gives back opens somewhere,
    // in the app or, for a message, in Gmail (isOpenableHref).
    return { ...result, rows: result.rows.filter((row) => isOpenableHref(row.href)) };
  } catch (error) {
    if (error instanceof AskInputError) return { ok: false, error: error.message };
    console.error(`ask tool ${name} failed`, error);
    return { ok: false, error: 'That lookup failed to read the database.' };
  }
}
