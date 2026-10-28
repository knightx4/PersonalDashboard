import type Anthropic from '@anthropic-ai/sdk';
import { MODULE_IDS, type ModuleId } from '@/lib/modules';
import { AskInputError, isOpenableHref, type AskContext, type AskRow, type AskToolResult } from './db';
import { mailLookup, readMailLookup } from './mail';
import { jobBoardLookup } from './job-board';
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
import { agendaLookup } from './agenda';
import { accountsLookup, balanceHistoryLookup, transactionSpendLookup } from './finances';
import { applicationAnswersLookup } from './answers';
import { duplicateAnswersLookup } from './duplicate-answers';
import { coursesLookup } from './courses';
import { learningCoveredLookup, readingListLookup } from './learn';
import { withParents } from './parents';
import { tableInfoLookup } from './table-info';
import { QUERY_OPS, QUERY_ROWS_MAX, queryRowsLookup } from './query';
import { LIST_ROWS_MAX, LISTABLE, listRowsLookup, listableList, listableSource, sourceWorkspace } from './list-rows';
import { notePositionsLookup } from './positions';
import { postPicturesLookup } from '@/lib/dash/post-pictures';
import { dashModelLookup } from '@/lib/dash/model-lookup';
import { DEV_ROW_KINDS, DEV_TEXT_KINDS, findDevTextLookup, readDevRowLookup, readSpecLookup, specList } from './dev';
import { CHART_DRAWN, CHART_TOOL_DEFINITION, parseChart } from '@/lib/talk/chart';

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
  'list_rows',
  'table_info',
  'query_rows',
  'spend_by_merchant',
  'accounts',
  'balance_history',
  'job_applications',
  'application_answers',
  'duplicate_answers',
  'todos',
  'agenda',
  'goal_status',
  'vault_notes',
  'note_positions',
  'courses',
  'reading_list',
  'learning_covered',
  'read_spec',
  'read_dev_row',
  'find_dev_text',
  'post_pictures',
  'dash_model',
  'search_mail',
  'read_mail',
  'read_job_board',
  'show_chart',
] as const;

/**
 * Tools the connector (lib/connector/mcp.ts) does not offer. Mail is searched
 * and read in Gmail as the person, which a connector token cannot do, and
 * what it holds is not to leave the app for another client. A chart is drawn
 * in the app's own reply (plan #1655), which another client does not have.
 * The model Dash answers with is the app's own setting (plan #2458.4), and a
 * connector client is not Dash.
 */
export const IN_APP_ONLY_TOOLS: readonly AskToolName[] = ['search_mail', 'read_mail', 'read_job_board', 'show_chart', 'dash_model'];

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
      'Find the person\'s own things by the words in their title or name, across every workspace that is switched on: job search companies (by name or industry), roles (by title or kind, such as accelerator) and contacts; shopping orders, owned items and saved items; todos; vault notes (by title and path) and courses from saved transcripts (by title, code, term and school); Learn readings and tracks; build plan steps, ideas and feedback; newsletter stories; goals, goal steps and files (what Dash wrote for a goal, and what the person gave it). Returns up to 20 matches, each with a table, a ref and a link. Use it to find a named thing; it does not look inside the text of a row. For a word inside the text of an idea, note, plan step, raise, comment or spec, use find_dev_text. For what the person has said, written or thought about a topic, use recall. Pass a row\'s table and ref to open_row to read it in full; a plan step, idea, feedback note or raise is read with read_dev_row instead.',
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
      'Find what the person has written about a topic by meaning, across every workspace that is switched on: vault notes, the courses on saved transcripts, job search thoughts, notes, interview notes and profile, goals and steps, goal captures, files, Learn aims, notes and cards, purchases, and for the owner with Dev on, the ideas, notes, plan steps, raises, the comments under them, and spec sections. Finds passages that are about the question even when they share none of its words. Returns up to 12 rows, closest first, each with its best one or two passages, who wrote each (the person or Dash), a closeness score and a link. Use it for questions like "what did I say I want from my next job?" or "what have I written about land value tax?", then open_row to read a vault note, file or thoughts entry in full, read_dev_row for a Dev row with its comments, or read_spec for a spec section.',
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
    description: `Read one row in full: its title and the text columns worth reading, the newest comments under it, with the link to its page. Long text comes in parts of about 8,000 characters with its line breaks kept; when the answer says there are more, call again with part 2, 3 and so on before saying what the row holds. The comments are where Dash answers a comment tagged @dash and a Prepare with Dash press on a role, so open the row to say whether that reply came and what it said. Use the table and ref another tool returned. A row found by search is named by its id, which is accepted for every table. The tables that can be opened: ${openableList()}.`,
    input_schema: {
      type: 'object',
      properties: {
        table: { type: 'string', enum: OPENABLE.map((s) => s.table) },
        ref: { type: 'string', description: 'The ref another tool returned for the row.' },
        part: {
          type: 'integer',
          minimum: 1,
          description: 'For a long note or other long text, which part to read: 1 (the default) is the start. The answer says how many parts there are.',
        },
      },
      required: ['table', 'ref'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_rows',
    description: `List the person's own rows in any table that holds what they wrote, saved, did or have, newest first, with each row's text, a ref and a link, and for a row that belongs to another (a cover letter to its application, an interview to its application, a note on an idea) that row's table, ref, title and link under parent. It reaches tables no other lookup does, such as the videos on their watch list, Learn cards, saved stories, interview notes and personality results, so use it whenever the other lookups do not cover what they asked about, and before saying you cannot see something. Pass contains to keep only rows holding every one of those words. Use it to choose for them as well as to find: "give me a good video to watch" is list_rows on learn.watch_list, then a pick from what the rows say. Open one row in full with open_row where it takes the table. The tables: ${listableList()}.`,
    input_schema: {
      type: 'object',
      properties: {
        table: { type: 'string', enum: LISTABLE.map((s) => s.table) },
        contains: {
          type: 'string',
          description: 'Words every row returned must hold, in its title or text. Leave out to list the newest rows.',
        },
        limit: { type: 'integer', minimum: 1, maximum: LIST_ROWS_MAX, description: `How many rows to return, up to ${LIST_ROWS_MAX}; 20 when left out.` },
      },
      required: ['table'],
      additionalProperties: false,
    },
  },
  {
    name: 'table_info',
    description:
      "Ask what you are able to read. With no table it lists every table list_rows can read and what each holds. With a table it gives all that table's columns with their types, the tables it points to (linksTo) and the tables that point to it (linkedFrom). Use it before naming a table or column you are not sure of, and when asked what you can see.",
    input_schema: {
      type: 'object',
      properties: {
        table: {
          type: 'string',
          enum: LISTABLE.map((s) => s.table),
          description: 'One table, for its columns and links. Leave out to list them all.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'query_rows',
    description: `Ask one table of the person's own rows a precise question: the rows where a column equals, differs from, is above or below a value, is one of a list, contains some text, or is empty or not. List them (up to ${QUERY_ROWS_MAX}, in any order), count them (count_only), or count them by the values of one column (group_by). Use it for "how many applications at each status" (group_by status), "which applications have no cover letter" (a condition with op empty) or "videos added since March" (greater on the date column), in one call; use list_rows to read the newest rows or find rows by words. linked keeps the rows that have, or have none of, a row of another table linked to them: "which to-apply applications have no answers to application questions and no cover letter" is one call on job_search.applications, with status one_of lead and drafting, cover_letter empty, and linked [{table: job_search.application_answers, present: false}]. Use it instead of looking up each row's linked rows one by one. Column names and links must be the table's own: check them with table_info (columns, linksTo, linkedFrom) first when unsure. Every result says how many rows matched and how many it lists, and names each row's parent. The tables are the ones list_rows reads.`,
    input_schema: {
      type: 'object',
      properties: {
        table: { type: 'string', enum: LISTABLE.map((s) => s.table) },
        where: {
          type: 'array',
          description: 'Conditions every row must meet. Leave out for all their rows in the table.',
          items: {
            type: 'object',
            properties: {
              column: { type: 'string', description: 'A column of the table, as table_info names it.' },
              op: {
                type: 'string',
                enum: [...QUERY_OPS],
                description:
                  'equals, not_equals (rows with nothing in the column count as not equal), greater, less (dates as YYYY-MM-DD), one_of (value is a list), contains (text holding the value, ignoring case, or a list holding it), empty (nothing in it: no value, empty text or an empty list), not_empty.',
              },
              value: {
                description: 'The value to compare with; a list for one_of; left out for empty and not_empty.',
              },
            },
            required: ['column', 'op'],
            additionalProperties: false,
          },
        },
        linked: {
          type: 'array',
          maxItems: 5,
          description:
            'Conditions on linked rows: each keeps the rows that have (present true) or have none of (present false) a row of another table linked to them by a key, either way round. The tables are those table_info lists under linksTo and linkedFrom.',
          items: {
            type: 'object',
            properties: {
              table: { type: 'string', description: 'The linked table, such as job_search.cover_letters.' },
              present: { type: 'boolean', description: 'true for rows with at least one linked row, false for rows with none.' },
              via: {
                type: 'string',
                description: 'The key column to follow, needed only where the two tables are linked more than one way.',
              },
            },
            required: ['table', 'present'],
            additionalProperties: false,
          },
        },
        columns: {
          type: 'array',
          items: { type: 'string' },
          description: "The columns to return for each row. Leave out for the table's usual ones.",
        },
        order: {
          type: 'object',
          properties: {
            column: { type: 'string' },
            ascending: { type: 'boolean', description: 'Smallest or oldest first. Largest or newest first when left out.' },
          },
          required: ['column'],
          additionalProperties: false,
          description: 'How to order the rows listed. Newest first when left out.',
        },
        count_only: { type: 'boolean', description: 'Only count the rows that match; list none.' },
        group_by: { type: 'string', description: 'Count the rows that match by the values of this one column, most common first; list none.' },
        limit: { type: 'integer', minimum: 1, maximum: QUERY_ROWS_MAX, description: `How many rows to list, up to ${QUERY_ROWS_MAX}; 50 when left out.` },
      },
      required: ['table'],
      additionalProperties: false,
    },
  },
  {
    name: 'spend_by_merchant',
    description:
      "What the person spent between two days. With bank or card accounts in Finances it reads their transactions: spent (charges less refunds, a refund counted in the month it landed), money in, and by month, by category and by merchant, leaving out card payments and transfers between their own accounts so a purchase is counted once; it lists the charges counted (newest 50), each linking to its account, and the Shopping orders they paid for. Without such accounts it reads the orders in their order emails instead, per currency, leaving out cancelled ones. Use it for any question about spending, a shop, a category such as groceries or a period's purchases, and answer from its totals: never add up transactions yourself. Narrow with merchant, category or account.",
    input_schema: {
      type: 'object',
      properties: {
        from: { ...DATE_FIELD, description: 'First day, YYYY-MM-DD, inclusive.' },
        to: { ...DATE_FIELD, description: 'Last day, YYYY-MM-DD, inclusive. Defaults to today.' },
        merchant: {
          type: 'string',
          description: 'Only merchants whose name contains these words, ignoring case (for example "ebay").',
        },
        category: {
          type: 'string',
          description: 'Only this category of transaction, in words ("food and drink", "groceries", "travel"). Transactions only.',
        },
        account: {
          type: 'string',
          description: 'Only one account, by the ref accounts returned or words of its name ("sapphire"). Transactions only.',
        },
      },
      required: ['from'],
      additionalProperties: false,
    },
  },
  {
    name: 'accounts',
    description:
      "Every account the person holds in Finances (checking, savings, credit cards, brokerage and loans) with its latest balance and the day it was read, whether that balance is stale, and their net worth now with how it moved over 30 and 365 days. A card or loan balance is the amount owed. Cards also give the limit used, the statement balance, the minimum payment and the day it is due; loans the rate, the payment and when they are paid off; brokerage the holdings' value and gain. Use it for \"how much is in checking\", \"what do I owe on my cards\", \"when is my card due\" or \"what is my net worth\", and for the refs balance_history and spend_by_merchant take.",
    input_schema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['checking', 'savings', 'credit_card', 'brokerage', 'loan'],
          description: 'Only accounts of this kind. Net worth still counts them all.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'balance_history',
    description:
      "How one account's balance, or their net worth, moved between two days: the balance at the start and end, the change, the highest and lowest day, and points to draw (every day for a short period, otherwise each month's last day). A card or loan balance is the amount owed, so a fall means less owed. Use it for \"how has my savings grown this year\" or \"how did my net worth change since March\". Leave account out for net worth.",
    input_schema: {
      type: 'object',
      properties: {
        account: {
          type: 'string',
          description: 'The account, by the ref accounts returned or words of its name ("savings", "freedom"). Leave out for net worth.',
        },
        from: { ...DATE_FIELD, description: 'First day, YYYY-MM-DD. Defaults to a year before to.' },
        to: { ...DATE_FIELD, description: 'Last day, YYYY-MM-DD. Defaults to today.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'job_applications',
    description:
      'The person\'s job applications, with each one\'s role, company, status, the day it was sent, the day they last heard from the company, and for a rejection the stage it came at. Counts by status and by rejection stage over everything matched, and how many were sent (not a lead or a draft); lists the newest 50, each linking to its role. For "how many have I applied to" answer from the sent count, never from the rows listed or the ones with a sent day alone. Filter by the day sent, by status, to open applications with no word from the company for a number of days (for "who have I heard nothing from in a month", quiet_for_days 30), to sent applications that never had a reply (no_reply), or to the ones whose status changed in a period, with what it was before (changed_status).',
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
        no_reply: {
          type: 'boolean',
          description: 'Only sent applications the company never replied to, an automatic confirmation aside, whatever their status now.',
        },
        changed_status: {
          type: 'boolean',
          description:
            'Only applications whose status changed between from and to (from defaults to six days ago, to to today), by hand or from mail, with what it was before (status_before) and after (status_after). from and to then date the change, not the day sent, and status filters status_after. For "what did I move to submitted this week that wasn\'t before", changed_status with status submitted and acknowledged, since a sent one whose confirmation came is acknowledged.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'application_answers',
    description:
      "Every answer on one job application, each with the question it answers: the answer ref, the question, its status (draft, approved or submitted), the word limit, the whole answer and a link to the role. Name the application with application_ref, or the role with role_ref for its latest application. Use it for \"the two answers on the Sent role\" or \"which questions on that application are still drafts\", to reuse an answer from one application on another (read it here, then save_answer), and to get the answer_ref that save_answer takes. It lists only that one application's answers; for the questions across every application use list_rows on job_search.questions.",
    input_schema: {
      type: 'object',
      properties: {
        role_ref: { type: 'string', description: "The job_search.roles ref, as job_applications or search returned it. Reads the role's latest application." },
        application_ref: { type: 'string', description: 'The job_search.applications ref, as job_applications returned it.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'duplicate_answers',
    description:
      'The application answers that repeat a question already answered on another role, grouped by question ("1. Why are you interested in Hooli?" and "Why are you interested in Hooli?" are one question). Each row is a copy that could go: its answer ref, the question, the role, its status and the first words, with remove true when it is an identical copy of the one kept (and keeps naming that one) and remove false when the copies are worded differently and the person has to say which to keep. Submitted answers are never rows. Use it for "remove my duplicate answers" or "which answers are repeated", then propose_delete for the rows with remove true.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'todos',
    description:
      'The person\'s todos finished between two dates, and the ones still open and past their due date today, each with its tags. Each links to the task on the todo list. Defaults to the last seven days. tags_in_use lists every tag they have on a todo.',
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
    name: 'agenda',
    description:
      "The rows other workspaces have put on the person's Todo agenda: job reminders, goal steps they sent to Todo, drafts waiting to be sent, return deadlines, bills and the like, as the Todo page shows them now. Each says in can which of finish, put_off and dismiss it takes. Use it to find the agenda_source and agenda_key that change_agenda_row needs; their own todos are in todos and search.",
    input_schema: {
      type: 'object',
      properties: {
        words: { type: 'string', description: 'Only rows whose title or detail holds all of these words.' },
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
      'The courses on the academic transcripts the person saved on the Work & school tab in You: each with its school, term, credits and grade as the transcript writes them, and a link to its row. Narrow by term ("Fall 2019", "Spring"), year, school, or words in the course code or title; every word given must match. Leave everything out to list them all. Returns up to 80, in the order they were taken. Use it for "what courses did I take in Fall 2019?", "what did I study at <school>?" or "what grade did I get in statistics?"; for what they wrote about a subject they studied, use recall.',
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
    name: 'reading_list',
    description:
      'What is on the person\'s Learn reading list: each reading with its status (queued, reading, read or abandoned), the list it is on, why it was recommended, their note on it, and its link. Narrow by subject (words of a subject\'s name, matching the readings related to it or on a list titled with those words), by query (words of the title, author or reason), and by status, where "open" means queued or reading. Newest first, up to 60. Use it for "what is on my reading list about evals?", "what have I not read yet on agents?" or "did I read Building Effective Agents?".',
    input_schema: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'Words of the subject, such as "agents" or "economics".' },
        query: { type: 'string', description: 'Words of the title, author or reason.' },
        status: { type: 'string', enum: ['open', 'queued', 'reading', 'read', 'abandoned'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'learning_covered',
    description:
      'What the person has covered on a topic in Learn: each matching subject with how many of its ideas they were tested as knowing, how many are untested and how many readings on it they have read, and each conversation logged about it with its summary and the ideas it named. A logged conversation means they met the ideas, not that they know them. Use it before explaining a topic, to build on what they have already been through, and for "what have I learned about agents?".',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Words of the subject or topic, such as "AI agents".' },
      },
      required: ['topic'],
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
      'Read one row from the Dev pages in full, with the thread of comments under it oldest first: an idea (its text, who filed it, its triage), a note (a bug report or request, with its status and how it was resolved), a plan step, feature or question (its detail, done-when, history, answer, the questions beneath it with their answers, and the last five sessions sent at it with how each ended and why it stopped) or a raise (its story and its ask). Every comment and every idea says who wrote it: "me" is the person, "Dash" is you, from an earlier session. Use it for "what did Dash suggest under this idea", "what is decided so far on step #1073.4" or "why did the sessions on #1172 close nothing". A step is named by its outline (#1073.4, the fourth step under feature #1073, as the plan page heads it), its number or its id; the others by the id search returned. When you name a step to the person, use its outline as the row\'s title gives it, never its bare number. A dismissed idea, step or raise is not returned. Only for the owner of the app, with the Dev workspace on.',
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
          description: 'The row\'s id, as search returned it; for a step, its outline ("#1073.4") or number ("#1248") works too.',
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
    name: 'post_pictures',
    description:
      'List the pictures you may attach to an X post draft on the Posts tab: the gallery screenshots kept in public/posts/, each with its path, the day it was taken, the gallery surface and workspace it shows, and a short label such as "Vault: note". Pick one whose workspace and label fit what the post is about and pass its path; these are the only images a draft can take from you, so never invent a file name. Pass workspace to keep only the pictures of one workspace. Only for the owner of the app, with the Dev workspace on.',
    input_schema: {
      type: 'object',
      properties: {
        workspace: {
          type: 'string',
          enum: [...MODULE_IDS],
          description: 'Only the pictures that show this workspace. Leave out to list them all.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'dash_model',
    description:
      'Say which model Dash is answering with: Haiku, Sonnet or Opus, as they last picked it on the Dash page or asked you to set it, or the default (Sonnet) when they never chose. Use it for "which model are you using?" or "what am I on?" and read the answer from here; do not guess from what you know about yourself. To change it, call set_dash_model.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
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
  {
    name: 'read_job_board',
    description:
      'Read the open roles on a company\'s job board, from its careers page or its website: "look at their job board and see if any roles look good for me". It finds the board the page links to (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Recruitee, Breezy, BambooHR or Rippling) and returns each open role\'s title, place and link, up to 80. It reads no other page text and cannot browse other sites. Judge the roles against the person\'s job settings and target titles, and give the link with any role you suggest.',
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The company\'s careers page or website, as the person gave it ("https://www.tenex.co/careers").',
        },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  CHART_TOOL_DEFINITION,
];

type Lookup = (ctx: AskContext, input: Record<string, unknown>) => Promise<AskToolResult>;

/** Each tool's lookup, and the workspace that has to be on for it to run (null: it checks itself). */
const LOOKUPS: Record<AskToolName, { run: Lookup; module: ModuleId | null }> = {
  search: { run: searchLookup, module: null },
  // Leaves out the switched-off workspaces itself; files belong to none.
  recall: { run: recallLookup, module: null },
  open_row: { run: openLookup, module: null },
  // Checks the workspace of the table it is given, below.
  list_rows: { run: listRowsLookup, module: null },
  // Leaves out the tables of switched-off workspaces itself.
  table_info: { run: tableInfoLookup, module: null },
  // Checks the workspace of the table it is given, below.
  query_rows: { run: queryRowsLookup, module: null },
  // Reads transactions when Finances is on and holds them, orders otherwise (below).
  spend_by_merchant: { run: spendAnyLookup, module: null },
  accounts: { run: accountsLookup, module: 'finances' },
  balance_history: { run: balanceHistoryLookup, module: 'finances' },
  job_applications: { run: applicationsLookup, module: 'jobs' },
  application_answers: { run: applicationAnswersLookup, module: 'jobs' },
  duplicate_answers: { run: duplicateAnswersLookup, module: 'jobs' },
  todos: { run: todosLookup, module: 'todo' },
  agenda: { run: agendaLookup, module: 'todo' },
  goal_status: { run: goalsLookup, module: 'goals' },
  vault_notes: { run: vaultLookup, module: 'vault' },
  note_positions: { run: notePositionsLookup, module: 'vault' },
  courses: { run: coursesLookup, module: 'you' },
  reading_list: { run: readingListLookup, module: 'learn' },
  learning_covered: { run: learningCoveredLookup, module: 'learn' },
  // Checks the owner and the Dev workspace itself (lib/ask/dev.ts).
  read_spec: { run: readSpecLookup, module: null },
  read_dev_row: { run: readDevRowLookup, module: null },
  find_dev_text: { run: findDevTextLookup, module: null },
  post_pictures: { run: postPicturesLookup, module: null },
  // Reads the account's own setting; no workspace has to be on.
  dash_model: { run: dashModelLookup, module: null },
  // The mailbox belongs to the whole app, so no workspace has to be on.
  search_mail: { run: mailLookup, module: null },
  read_mail: { run: readMailLookup, module: null },
  read_job_board: { run: jobBoardLookup, module: 'jobs' },
  // Reads nothing: it checks the figures Dash sends and keeps them as the chart.
  show_chart: { run: chartLookup, module: null },
};

/**
 * Draws a chart under the answer (plan #1655; lib/talk/chart.ts). The turn
 * keeps the chart as this call's result, which is what a reopened answer
 * draws from.
 */
async function chartLookup(_ctx: AskContext, input: Record<string, unknown>): Promise<AskToolResult> {
  const parsed = parseChart(input);
  if (!parsed.ok) return parsed;
  return { ok: true, rows: [], note: CHART_DRAWN, kept: { chart: parsed.chart } };
}

/**
 * Spending (plan #2593.8.1): from bank and card transactions when Finances is
 * on and holds some, and from Shopping's orders otherwise, so a person who
 * has linked no bank still gets an answer from their order emails.
 */
async function spendAnyLookup(ctx: AskContext, input: Record<string, unknown>): Promise<AskToolResult> {
  if (ctx.enabledModules.includes('finances')) {
    const fromTransactions = await transactionSpendLookup(ctx, input);
    if (fromTransactions) return fromTransactions;
  }
  if (!ctx.enabledModules.includes('shopping')) {
    return ctx.enabledModules.includes('finances')
      ? { ok: true, rows: [], note: 'No bank or card transactions in Finances yet, so there is no spending to add up.' }
      : { ok: false, error: 'The Finances and Shopping workspaces are switched off, so spending cannot be read.' };
  }
  if (typeof input.category === 'string' || typeof input.account === 'string') {
    throw new AskInputError('category and account need bank or card transactions in Finances, and there are none yet.');
  }
  const fromOrders = await spendLookup(ctx, input);
  if (!fromOrders.ok) return fromOrders;
  const note = 'From order emails, since there are no bank or card transactions in Finances.';
  return { ...fromOrders, note: fromOrders.note ? `${note} ${fromOrders.note}` : note };
}

/**
 * Whether a lookup is offered when the person keeps a question to one
 * workspace (plan #1899.5). A lookup bound to a workspace is offered in its
 * own. The ones that range over every workspace (search, recall, open_row,
 * list_rows) are offered too, since the context they run with is narrowed to
 * that workspace and they leave out the rest themselves. Mail belongs to no
 * workspace and the Dev lookups only to Dev, so neither is offered elsewhere.
 * A chart reads nothing and is always offered.
 */
export function lookupInScope(name: string, scope: ModuleId): boolean {
  if (!isAskToolName(name)) return true;
  if (name === 'search_mail' || name === 'read_mail') return false;
  if (name === 'read_spec' || name === 'read_dev_row' || name === 'find_dev_text' || name === 'post_pictures') return scope === 'dev';
  // Spending lives in Finances (plan #2593.1) and falls back to Shopping's
  // orders (spendAnyLookup), so it belongs to both.
  if (name === 'spend_by_merchant') return scope === 'finances' || scope === 'shopping';
  const { module } = LOOKUPS[name];
  return module === null || module === scope;
}

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
  you: 'You',
  finances: 'Finances',
  dev: 'Dev',
};

/**
 * The rows with the row each belongs to (lib/ask/parents.ts). A parent that
 * fails to read costs the rows their parents, not the lookup its answer.
 */
async function parentsOf(ctx: AskContext, rows: AskRow[]): Promise<AskRow[]> {
  try {
    return await withParents(ctx, rows);
  } catch (error) {
    console.error('ask tool parents failed', error);
    return rows;
  }
}

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
      : (name === 'list_rows' || name === 'query_rows') && typeof args.table === 'string'
        ? (() => {
            const source = listableSource(args.table);
            return source ? sourceWorkspace(source) : null;
          })()
        : null);
  if (needs && !ctx.enabledModules.includes(needs)) {
    return { ok: false, error: `The ${MODULE_LABELS[needs]} workspace is switched off, so it cannot be read.` };
  }

  try {
    const result = await run(ctx, args);
    if (!result.ok) return result;
    // The promise to the page: every row a tool gives back opens somewhere,
    // in the app or, for a message, in Gmail (isOpenableHref).
    const rows = result.rows.filter((row) => isOpenableHref(row.href));
    return { ...result, rows: await parentsOf(ctx, rows) };
  } catch (error) {
    if (error instanceof AskInputError) return { ok: false, error: error.message };
    console.error(`ask tool ${name} failed`, error);
    return { ok: false, error: 'That lookup failed to read the database.' };
  }
}
