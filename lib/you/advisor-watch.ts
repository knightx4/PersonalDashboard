import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '@/lib/core/models';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { THINKING_ROOM } from '@/lib/learn/graph/tool-call';
import { AskInputError, type AskContext } from '@/lib/ask/db';
import { LISTABLE, ownerColumn, sourceWorkspace } from '@/lib/ask/list-rows';
import { QUERY_OPS, queryRowsLookup } from '@/lib/ask/query';
import { listableShapes, type TableShape } from '@/lib/ask/table-info';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { replyJson, type MadeReachOut } from '@/lib/you/reach-out-make';
import { cadenceWords } from '@/lib/you/advisor-watch-words';

/**
 * A watch Dash writes itself when someone on People is asked to text about
 * something no fixed watch reads (plan #3030.1.1, under #3030.1): "tell me
 * when a vault note mentions my sister".
 *
 * One Sonnet call with structured output writes a query_rows query (one
 * table of the tables list_rows reads, conditions on its own columns, an
 * order) with what it checks, what would send a text, the cadence and a
 * sample text. The model is given every readable table with its columns, so
 * the one call is enough. The query is then run once through queryRowsLookup
 * for the owner, which checks every column and op against the table and
 * reads only their rows, and a query it refuses is refused here with its
 * reason. What passes is kept in you.advisor_watches as proposed (you 0050):
 * nothing runs it until the person approves it (#3030.1.2), and the daily
 * round runs it after that (#3030.1.3).
 *
 * The query is data, never SQL text, so it can only read, and only the
 * owner's rows: queryRowsLookup adds the owner filter to every read.
 */

const MODEL = MODELS.reachOutRule;

export const WATCH_LIMITS = {
  about: 200,
  sendsWhen: 300,
  sample: 400,
  conditions: 6,
  /** The most rows one run of a watch reads. */
  rows: 50,
  everyDays: 90,
  whyNot: 400,
} as const;

export const WATCH_MODES = ['each', 'roundup'] as const;
export type WatchMode = (typeof WATCH_MODES)[number];

/** The query_rows input a watch runs: no counting or grouping, a capped limit. */
export type WatchQuery = {
  table: string;
  where?: { column: string; op: (typeof QUERY_OPS)[number]; value?: unknown }[];
  order?: { column: string; ascending?: boolean };
  limit: number;
};

export type WatchDraft = {
  key: string;
  about: string;
  sendsWhen: string;
  sample: string;
  everyDays: number;
  mode: WatchMode;
  query: WatchQuery;
  tables: string[];
};

/** What the dry run found: the draft and how many rows it matched today. */
export type DraftedWatch = { ok: true; draft: WatchDraft; matched: number } | { ok: false; error: string };

const SCALAR = { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] } as const;

/** The reply's shape, as sent in output_config.format. */
export function watchReplySchema(tables: readonly string[]) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['possible', 'why_not', 'key', 'about', 'sends_when', 'sample', 'every_days', 'mode', 'query'],
    properties: {
      possible: { type: 'boolean', description: 'false when none of the tables holds what they asked about.' },
      why_not: { type: 'string', description: 'When not possible, what is missing, in a few plain words; otherwise empty.' },
      key: { type: 'string', description: 'Short snake_case name for the watch.' },
      about: { type: 'string', description: 'What it checks, in plain words.' },
      sends_when: { type: 'string', description: 'What would make a text go out.' },
      sample: { type: 'string', description: 'A text as the person on People would send it.' },
      every_days: { type: 'integer' },
      mode: { type: 'string', enum: [...WATCH_MODES] },
      query: {
        type: 'object',
        additionalProperties: false,
        required: ['table', 'where', 'order'],
        properties: {
          table: { type: 'string', enum: [...tables] },
          where: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['column', 'op', 'value'],
              properties: {
                column: { type: 'string' },
                op: { type: 'string', enum: [...QUERY_OPS] },
                value: { anyOf: [SCALAR, { type: 'array', items: SCALAR }, { type: 'null' }] },
              },
            },
          },
          order: {
            anyOf: [
              {
                type: 'object',
                additionalProperties: false,
                required: ['column', 'ascending'],
                properties: { column: { type: 'string' }, ascending: { type: 'boolean' } },
              },
              { type: 'null' },
            ],
          },
        },
      },
    },
  } as const;
}

/** A column type in a few characters, for the prompt. */
function shortType(type: string): string {
  return type
    .replace('timestamp with time zone', 'timestamptz')
    .replace('timestamp without time zone', 'timestamp')
    .replace('character varying', 'text')
    .replace('double precision', 'number');
}

/** Columns a watch has no use for: the owner, and vectors. */
function usefulColumn(name: string, type: string, owner: string): boolean {
  return name !== owner && !/^vector|^tsvector|^USER-DEFINED/.test(type);
}

/** The readable tables in workspaces that are on, each with what it holds and its columns. */
export function watchTableLines(shapes: ReadonlyMap<string, TableShape>, enabled: AskContext['enabledModules']): { tables: string[]; lines: string[] } {
  const tables: string[] = [];
  const lines: string[] = [];
  for (const source of LISTABLE) {
    const workspace = sourceWorkspace(source);
    if (workspace && !enabled.includes(workspace)) continue;
    const owner = ownerColumn(source) ?? 'user_id';
    const columns = (shapes.get(source.table)?.columns ?? []).filter((c) => usefulColumn(c.column, c.type, owner));
    if (!columns.length) continue;
    tables.push(source.table);
    lines.push(
      `- ${source.table}: ${source.holds.replace(/\.$/, '')}. Columns: ${columns.map((c) => `${c.column} ${shortType(c.type)}`).join(', ')}.`,
    );
  }
  return { tables, lines };
}

export function watchRules(tableLines: readonly string[], today: string): string {
  return `The person keeps a list of people who text them, each with a persona. They
asked one of them to text about something none of the app's fixed watches
reads. Write a watch for it: one query over one of the person's tables, which
the app runs on a cadence, texting them about the rows it matches that are new
or changed since the last run.

The query reads one table of these, and only its listed columns:

${tableLines.join('\n')}

It is the person's own rows only; the app adds that. Give:
- table: the one table that holds it.
- where: up to ${WATCH_LIMITS.conditions} conditions, every one met. op is one of equals, not_equals,
  greater, less (dates as YYYY-MM-DD; today is ${today}), one_of (value a list),
  contains (text holding the value, ignoring case), empty, not_empty (value
  null for those two). "Mentions my sister" is contains on the text column
  that holds the note, with the word they would use; when they give a name,
  use the name. Do not add a date condition for "new": the app compares
  each run with the last one.
- order: the column to order by, newest first (ascending false), or null.

Also give:
- key: a short snake_case name.
- about: what it checks, in a few plain words, as the person would say it
  ("Vault notes that mention your sister"). At most ${WATCH_LIMITS.about} characters.
- sends_when: what makes a text go out, in one plain sentence. At most ${WATCH_LIMITS.sendsWhen}.
- sample: one text as the person on People would send it when it matches,
  short, in plain words. At most ${WATCH_LIMITS.sample}.
- every_days: how often it is checked, 1 to ${WATCH_LIMITS.everyDays}. "Tell me when" is 1, weekly 7.
- mode: "each" for a text per new match, "roundup" for one text about all of
  them since the last.

When no table holds what they asked about, give possible false and why_not
in a few plain words, and fill the rest with empty values.`;
}

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** "custom_" and a slug of the model's key, within advisor_reach_outs.watch_key's 40 characters. */
export function watchKey(raw: string, suffix: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24)
    .replace(/_+$/, '');
  const tail = suffix.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6) || 'watch';
  return `custom_${slug ? `${slug}_` : ''}${tail}`;
}

/**
 * The model's reply as a draft, or why it was refused. Checks what the
 * schema cannot state: the lengths, the cadence, a table that is readable
 * now. The columns are checked by the dry run.
 */
export function readWatchReply(reply: unknown, tables: readonly string[], suffix: string): { ok: true; draft: WatchDraft } | { ok: false; error: string } {
  if (!isObject(reply)) return { ok: false, error: 'Dash could not write a watch for that. Try saying it another way.' };
  if (reply.possible !== true) {
    const why = str(reply.why_not).slice(0, WATCH_LIMITS.whyNot);
    return { ok: false, error: why ? `Dash cannot watch that: ${why.replace(/\.$/, '')}.` : 'Dash found nothing in the app that holds that, so it cannot watch it.' };
  }
  const query = isObject(reply.query) ? reply.query : null;
  const table = str(query?.table);
  if (!query || !tables.includes(table)) return { ok: false, error: 'Dash wrote a watch on a table it cannot read. Try again.' };
  const where = Array.isArray(query.where) ? query.where : [];
  if (where.length > WATCH_LIMITS.conditions) return { ok: false, error: `Dash wrote a watch with more than ${WATCH_LIMITS.conditions} conditions. Try asking for less at once.` };
  const conditions: NonNullable<WatchQuery['where']> = [];
  for (const raw of where) {
    if (!isObject(raw)) return { ok: false, error: 'Dash wrote a watch it could not read. Try again.' };
    const op = raw.op as (typeof QUERY_OPS)[number];
    const condition: NonNullable<WatchQuery['where']>[number] = { column: str(raw.column), op };
    if (op !== 'empty' && op !== 'not_empty') condition.value = raw.value;
    conditions.push(condition);
  }
  const about = str(reply.about);
  const sendsWhen = str(reply.sends_when);
  const sample = str(reply.sample);
  if (!about || about.length > WATCH_LIMITS.about) return { ok: false, error: 'Dash did not say what the watch checks. Try again.' };
  if (!sendsWhen || sendsWhen.length > WATCH_LIMITS.sendsWhen) return { ok: false, error: 'Dash did not say what would send a text. Try again.' };
  if (!sample || sample.length > WATCH_LIMITS.sample) return { ok: false, error: 'Dash did not write what a text would say. Try again.' };
  const everyDays = reply.every_days;
  if (typeof everyDays !== 'number' || !Number.isInteger(everyDays) || everyDays < 1 || everyDays > WATCH_LIMITS.everyDays) {
    return { ok: false, error: `Dash gave the watch a cadence it cannot keep (every 1 to ${WATCH_LIMITS.everyDays} days). Try again.` };
  }
  const mode = (WATCH_MODES as readonly unknown[]).includes(reply.mode) ? (reply.mode as WatchMode) : 'each';
  const order = isObject(query.order) && str(query.order.column) ? { column: str(query.order.column), ascending: query.order.ascending === true } : undefined;
  const watchQuery: WatchQuery = { table, limit: WATCH_LIMITS.rows };
  if (conditions.length) watchQuery.where = conditions;
  if (order) watchQuery.order = order;
  return {
    ok: true,
    draft: { key: watchKey(str(reply.key), suffix), about, sendsWhen, sample, everyDays, mode, query: watchQuery, tables: [table] },
  };
}

/**
 * Run the watch's query once for the owner: the check that every column and
 * op is the table's, and the number of rows it matches now. Throws an
 * AskInputError with query_rows's reason when the query is refused.
 */
export async function runWatchQuery(ask: AskContext, query: WatchQuery) {
  const result = await queryRowsLookup(ask, { ...query, limit: Math.min(query.limit, WATCH_LIMITS.rows) });
  if (!result.ok) throw new AskInputError(result.error);
  return result;
}

/** What to write a watch for: the whole brief, or only the parts a fixed watch left out. */
export type WatchAsk = { name: string; brief: string; only?: readonly string[] };

export function watchPrompt(input: WatchAsk): string {
  const asked = `The person on their list is ${input.name}.\n\nWhat they asked ${input.name} to text them about:\n${input.brief}`;
  if (!input.only?.length) return asked;
  return `${asked}\n\nA fixed watch already covers the rest. Write the watch for this part only:\n${input.only.map((part) => `- ${part}`).join('\n')}\nWhen these need more than one table, write it for the first one a table holds.`;
}

/**
 * What a reach-out brief leaves for a watch Dash writes itself (plan
 * #3030.2): all of it when the rule was refused because nothing in it is in
 * a table a fixed watch reads, the parts it could not watch when the rule
 * covered the rest, and nothing when the rule covered it all or was refused
 * for another reason.
 */
export function watchAskFor(made: MadeReachOut | null): { only?: string[] } | null {
  if (!made) return null;
  if (!made.ok) return made.uncovered ? {} : null;
  const parts = made.rule.cannot_watch ?? [];
  return parts.length ? { only: parts } : null;
}

/**
 * Write a watch for what no fixed watch covers, and check it by running it
 * once. One paid call; what it cost goes to `onSpend` (operation
 * 'write-advisor-watch'). Never throws.
 */
export async function draftAdvisorWatch(
  input: WatchAsk,
  options: {
    ask: AskContext;
    apiKey?: string;
    client?: Pick<Anthropic, 'messages'>;
    onSpend?: SpendSink;
    /** A few characters that keep the key unique; random when absent. */
    suffix?: string;
  },
): Promise<DraftedWatch> {
  let tables: string[];
  let lines: string[];
  try {
    ({ tables, lines } = watchTableLines(await listableShapes(options.ask), options.ask.enabledModules));
  } catch (error) {
    console.error('advisor watch: reading the tables failed', error instanceof Error ? error.message : error);
    return { ok: false, error: 'Dash could not read which tables it can watch just now. Try again.' };
  }
  if (!tables.length) return { ok: false, error: 'Dash has no tables it can watch here.' };

  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });
  let response;
  try {
    // Widened: the installed SDK's types predate output_config.
    const format = {
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: watchReplySchema(tables) } },
    } as unknown as Record<string, never>;
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 2_000 + THINKING_ROOM,
      system: watchRules(lines, options.ask.today),
      messages: [{ role: 'user', content: watchPrompt(input) }],
      ...format,
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return { ok: false, error: 'Dash is busy. Try again in a minute.' };
    return { ok: false, error: 'Dash could not write a watch just now. Try again.' };
  }
  options.onSpend?.({ model: MODEL, usage: usageFrom(response.usage) });
  const read = replyJson(response as Parameters<typeof replyJson>[0]);
  if ('error' in read) return { ok: false, error: read.error.replace('a rule', 'a watch').replace('the rule', 'the watch') };
  const suffix = options.suffix ?? crypto.randomUUID().slice(0, 6);
  const drafted = readWatchReply(read.json, tables, suffix);
  if (!drafted.ok) return drafted;

  try {
    const result = await runWatchQuery(options.ask, drafted.draft.query);
    const matched = typeof result.totals?.matched === 'number' ? result.totals.matched : result.rows.length;
    return { ok: true, draft: drafted.draft, matched };
  } catch (error) {
    if (error instanceof AskInputError) return { ok: false, error: `Dash wrote a watch it could not run (${error.message}) Try saying it another way.` };
    console.error('advisor watch: the dry run failed', error instanceof Error ? error.message : error);
    return { ok: false, error: 'Dash wrote a watch but could not try it just now. Try again.' };
  }
}

export { cadenceWords };

/** What set_reach_out says back for a proposed watch. */
export function watchSummary(name: string, draft: WatchDraft, matched: number): string {
  const now = matched === 0 ? 'Nothing matches yet.' : matched === 1 ? 'One row matches now.' : `${matched} rows match now.`;
  return `Dash wrote ${name} a watch: ${draft.about.replace(/\.$/, '')}, checked ${cadenceWords(draft.everyDays)} in ${draft.tables.join(', ')}. ${draft.sendsWhen.replace(/\.$/, '')}. ${now} It waits for your OK and runs nothing until you approve it. A text would read: "${draft.sample}"`;
}

/** The proposed watch's row, as you.advisor_watches keeps it. */
export function watchRow(userId: string, advisorId: string, brief: string, drafted: { draft: WatchDraft; matched: number }) {
  const { draft } = drafted;
  return {
    user_id: userId,
    advisor_id: advisorId,
    key: draft.key,
    brief: brief.trim().slice(0, 2000),
    about: draft.about,
    sends_when: draft.sendsWhen,
    sample: draft.sample,
    query: draft.query,
    tables: draft.tables,
    every_days: draft.everyDays,
    mode: draft.mode,
    status: 'proposed' as const,
    matched: drafted.matched,
  };
}

/** Keep the proposed watch; returns the row as saved. */
export async function saveProposedWatch(
  client: YouSupabaseClient,
  row: ReturnType<typeof watchRow>,
): Promise<Record<string, unknown>> {
  const { data, error } = await client.from('advisor_watches').insert(row).select('*').single();
  if (error || !data) throw new Error(`Saving the watch failed: ${error?.message ?? 'no row'}`);
  return data as Record<string, unknown>;
}
