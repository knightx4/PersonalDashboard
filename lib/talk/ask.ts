import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { ASK_TOOLS } from '@/lib/ask/tools';
import { PROPOSAL_TOOLS } from '@/lib/ask/propose';
import { citationsOf, toolResultText, type AskToolResult } from '@/lib/ask/db';
import type { PageContext } from '@/lib/ask/page';
import { whyNoReport } from '@/lib/learn/graph/tool-call';
import type { DashChange, NewDashChange } from './changes';
import { HAND_OFF_TOOL, HAND_OFF_TOOL_NAME, HANDED_OFF, handoffRequest, NO_HANDOFF, type DashHandoff } from './handoff';
import { TALK_MODEL } from './reply';
import {
  askTitle,
  MAX_TURN,
  toModelMessages,
  type NewTalkTurn,
  type TalkCitation,
  type TalkSubject,
  type TalkToolCall,
  type TalkTurn,
} from './talk';

/**
 * Dash answering a question about anything in the app (plan #1089).
 *
 * The model is given the read tools from lib/ask/tools.ts and an `answer`
 * tool. Every round it must call one or the other: lookups are run and their
 * results sent back, and the loop ends when it calls `answer`. The answer
 * names the rows it relied on by table and ref, and only rows a tool returned
 * in this conversation are kept as citations; anything else it names is
 * dropped.
 *
 * Beside the lookups it has four proposal tools (lib/ask/propose.ts, plans
 * #1188 and #1296): add a todo, add a goal step, mark an item returned, start
 * a watch. A proposal is
 * kept as a proposed row in core.dash_actions and nothing else is written;
 * the person confirms each on its own. Proposals count toward the lookup cap,
 * and one naming a row can only name a row a lookup returned, as citations do.
 *
 * When asked for something none of those tools can do, it calls `hand_off`
 * (lib/talk/handoff.ts, plan #1402): the request is kept, the answer says it
 * was passed on, and the backup routine is started once the answer is kept.
 *
 * Three limits stop the looking, and when one is reached the next call is
 * made to answer with what it has: eight lookups, an input token budget, and
 * a time budget that leaves the last call room inside the request. An answer
 * written under a limit ends with a sentence saying so.
 *
 * When that last call still comes back with nothing to say, the answer is
 * built from what the lookups found instead (plan #1437): the rows they
 * returned, listed and cited, under a sentence saying the answer was not
 * finished. Only a run whose lookups found nothing ends in an error.
 *
 * `onLookup` hears each lookup as it starts and as it finishes, which is what
 * a page showing the lookups while they run listens to.
 *
 * `answerQuestion` is the loop alone. `askDash` below it keeps the turns and
 * the spend through the stores it is handed; lib/talk/ask-request.ts hands it
 * the real ones inside a request.
 */

export const ASK_MODEL = TALK_MODEL;

/** The most lookups and proposals one answer may make. */
export const MAX_LOOKUPS = 8;
/** Input tokens across the calls of one answer, cached and not, before it must answer. */
export const INPUT_BUDGET = 150_000;
/**
 * Time spent looking before it must answer. Ask runs in app/api/ask/route.ts,
 * whose maxDuration is 300 seconds (plan #1438). Forty seconds fits five rounds of lookups (the
 * jobs question that failed at fourteen took five), and leaves the answer
 * call and the writes well inside even a sixty-second limit.
 */
export const TIME_BUDGET_MS = 40_000;
/** Output tokens for one call. A list of every company in three months runs past 2000. */
export const ANSWER_MAX_TOKENS = 4000;
/** The most rows an answer built from the lookups lists by name. */
export const FALLBACK_ROWS = 25;

const ANSWER_TOOL = 'answer';

const ANSWER: Anthropic.Tool = {
  name: ANSWER_TOOL,
  description:
    'Give the person your answer. Call this once you have what you need, or once the lookups show the data cannot answer the question. It ends your turn.',
  input_schema: {
    type: 'object',
    properties: {
      answer: {
        type: 'string',
        description: 'The answer, in plain prose. Name the things it rests on by their titles.',
      },
      cited: {
        type: 'array',
        description:
          'The rows the answer rests on, each by the table and ref a lookup returned for it. Leave out rows you looked at and did not use.',
        items: {
          type: 'object',
          properties: { table: { type: 'string' }, ref: { type: 'string' } },
          required: ['table', 'ref'],
          additionalProperties: false,
        },
      },
    },
    required: ['answer', 'cited'],
    additionalProperties: false,
  },
};

/**
 * The tools sent on every call: the lookups, then `answer`. The same list in
 * the same order every time, with the cache breakpoint on the last, so the
 * prefix is cached across rounds and across questions.
 */
const TOOLS: Anthropic.Tool[] = [
  ...ASK_TOOLS,
  ...PROPOSAL_TOOLS,
  HAND_OFF_TOOL,
  { ...ANSWER, cache_control: { type: 'ephemeral' } },
];

const SYSTEM = `You are Dash, the assistant inside somebody's personal dashboard. It holds their
shopping orders, job applications, notes, todos, reading, newsletters, goals
and build plan, and can search the email in the Gmail they connected. They are
asking you a question about their own things.

LOOK IT UP. Answer from what the lookup tools return, never from memory or a
guess about what they probably have. Work out which lookups the question needs
and make them; where two are independent, make them in the same turn. You
have at most ${MAX_LOOKUPS} lookups for one answer, so choose them well.
When they ask what they said, wrote or think about something, start with
recall, and keep their own words apart from anything Dash wrote for them.

WHEN THE DATA CANNOT ANSWER IT, SAY SO. If the lookups do not hold what the
question needs, or a workspace is switched off, answer "I cannot see that"
and say in a sentence what you could see instead. Do not fill the gap with a
likely answer.

ANSWER THROUGH THE answer TOOL. Keep it short: a few sentences, or a short
list when they asked for a list. Give figures exactly as the lookups gave
them, with their currency. Name each order, application, note, step or other
row you used by its title, and list each in cited by the table and ref the
lookup returned for it. Cite only rows a lookup returned. For an email, say
who sent it, the day it arrived and its subject, and cite it the same way:
the person opens it in Gmail from there. When the question is about what an
email says, find it with search_mail, then open it with read_mail and answer
from its text. Open only the messages the question is about, and quote no
more of the text than the answer needs.

YOU CAN PROPOSE FOUR CHANGES, AND ONLY WHEN ASKED. When they ask you to add
a todo, add a step under one of their goals, or say they sent an item back,
call propose_todo, propose_goal_step or propose_returned. When they ask you to
watch a price on a page outside the app, or to tell them when it drops, call
propose_watch. A goal, a step or an item is named by the ref a lookup returned
for it, so look it up first. Nothing is written when you propose: each
proposal shows as a card under your answer and they confirm or decline it.
Say in your answer what you proposed, and for a watch, what it will do and
when it stops. You may propose several in one answer.

ANYTHING ELSE THEY ASK YOU TO DO, HAND ON. When they ask you to create or
change something none of your tools can (a new goal, editing or completing a
todo, a job application, a note), call hand_off with the request written out
in full, including every detail they gave and the refs of rows you looked up
for it. A routine does it within a few minutes and its reply appears in this
conversation. Then say in a sentence that you have passed it on; do not say
it is done, and do not propose something near it instead. Never hand on a
question you can answer by looking things up, and never a request to delete
something, send an email or spend money: for those, say you cannot.

THE PAGE THEY ASKED FROM IS CONTEXT FOR "THIS". A line after these rules may say
which page of the app they asked from, and the row it shows. When the question
points at that row, by "this", "here", "it" or by its subject, look the row up
first with the tool the line names, and answer about it. When the question is
about anything else, ignore the page and answer as if it had not been said.`;

/** What the model is told the date is: after the cache breakpoint, since it changes daily. */
function dateLine(today: string): string {
  return `Today is ${today} in the person's timezone. Read "this month", "last week" and the like from it.`;
}

/**
 * What the model is told about the page the question was asked from (plan
 * #1271): one line after the date, outside the cached prefix since it changes
 * with every page. Null when there is no page to tell.
 */
export function pageLine(page: PageContext | null | undefined): string | null {
  if (!page) return null;
  const at = `They asked from the ${page.page} page (${page.path})`;
  if (!page.row) return `${at}.`;
  const { table, ref, title } = page.row;
  const shown = title.replace(/\s+/g, ' ').trim();
  // open_row does not take the goals tables; goal_status is how Dash reads
  // a goal, and a goal's ref is what propose_goal_step names.
  const reach = table.startsWith('goals.')
    ? 'open_row does not take goals, so read it through goal_status'
    : `open_row with table ${table} and ref ${ref} reads it`;
  return `${at}, which shows "${shown}" (${table}, ref ${ref}): ${reach}.`;
}

/** Said to the model when a limit is reached, in place of any further lookup. */
const LIMIT_REACHED = 'No lookups are left for this answer. Answer now with what you have.';

/**
 * Why the answer stopped. 'unfinished': the model wrote nothing usable, and
 * the answer was built from the lookups (answerFromLookups).
 */
export type AskStop = 'answered' | 'lookups' | 'budget' | 'time' | 'unfinished';

/** The sentence an answer written under a limit ends with. */
export function limitNote(stop: Exclude<AskStop, 'answered' | 'unfinished'>): string {
  return stop === 'lookups'
    ? `I stopped after ${MAX_LOOKUPS} lookups, so this answer rests only on what those found.`
    : 'I stopped looking before I had checked everything, so this answer rests only on what I found by then.';
}

export type AskAnswer =
  | {
      ok: true;
      body: string;
      toolCalls: TalkToolCall[];
      citations: TalkCitation[];
      stop: AskStop;
    }
  | { ok: false; detail: string; toolCalls: TalkToolCall[] };

/**
 * One lookup, heard as it starts and again as it finishes (plan #1438 shows
 * them in the thread while they run). `id` is the model's tool_use id and
 * pairs the two; `index` counts lookups in this answer from 0. The finished
 * event carries the result as the turn keeps it (TalkToolCall.result), so
 * what streams is what a reopened answer shows. Proposals and hand-offs are
 * heard too; a call refused at the cap is heard only as finished.
 */
export type AskLookupEvent =
  | { phase: 'started'; id: string; index: number; name: string; input: unknown }
  | { phase: 'finished'; id: string; index: number; name: string; input: unknown; ok: boolean; result: unknown };

/** Runs one lookup. Never throws; executeAskTool in lib/ask/tools.ts with its context bound. */
export type AskExecutor = (name: string, input: unknown) => Promise<AskToolResult>;

/**
 * Checks and keeps one proposal. Never throws; executeProposal in
 * lib/ask/propose.ts with its context bound. `seen` says whether a lookup in
 * this conversation returned a row.
 */
export type AskProposer = (
  name: string,
  input: unknown,
  seen: (table: string, ref: string) => boolean,
) => Promise<AskToolResult>;

/** Said to the model when a proposal is made where none can be kept. */
const NO_PROPOSALS = 'Changes cannot be proposed here. Answer in words.';

/** A proposal tool, or a name the model made up in their shape: both go to the proposer, which refuses any but the four. */
const isProposal = (name: string) => name.startsWith('propose_');

const citationKey = (c: { table: string; ref: string }) => `${c.table}\u0000${c.ref}`;

/**
 * A lookup's result as it is kept on the turn: the rows by what the page
 * shows, without the detail the model read, and any totals and note. Enough
 * for a reopened answer to show what was looked up and found.
 */
function keptResult(result: AskToolResult): unknown {
  if (!result.ok) return result;
  // A lookup whose rows must not be stored (search_mail, read_mail) says what to keep instead.
  if (result.kept) return { ok: true, ...result.kept };
  return {
    ok: true,
    rows: citationsOf(result),
    ...(result.totals ? { totals: result.totals } : {}),
    ...(result.note ? { note: result.note } : {}),
  };
}

/**
 * The conversation so far as the model is sent it. An earlier answer carries
 * the rows it cited, so a follow-up ("and the second one?") can name them.
 */
function historyMessages(turns: readonly Pick<TalkTurn, 'role' | 'body' | 'citations'>[]): Anthropic.MessageParam[] {
  return toModelMessages(
    turns.map((turn) => {
      if (turn.role !== 'assistant' || !turn.citations?.length) return turn;
      const rows = turn.citations.map((c) => `${c.table} ${c.ref} "${c.title}"`).join('; ');
      return { role: turn.role, body: `${turn.body}\n\n(Rows cited: ${rows})` };
    }),
  );
}

/** Moves the one rolling cache breakpoint onto the newest tool results. */
function withRollingBreakpoint(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const last = messages[messages.length - 1];
  if (!last || typeof last.content === 'string' || last.content.length === 0) return messages;
  const blocks = [...last.content];
  const tail = blocks[blocks.length - 1];
  if (tail.type !== 'tool_result') return messages;
  blocks[blocks.length - 1] = { ...tail, cache_control: { type: 'ephemeral' } };
  return [...messages.slice(0, -1), { ...last, content: blocks }];
}

/**
 * The answer given when the model wrote nothing usable after its lookups
 * (plan #1437): the rows they returned, each named once, in the order found,
 * and cited so the person can open them. Null when no lookup returned a row,
 * since a list of nothing is not an answer.
 */
export function answerFromLookups(found: readonly TalkCitation[]): { body: string; citations: TalkCitation[] } | null {
  const seen = new Set<string>();
  const rows: TalkCitation[] = [];
  for (const row of found) {
    const key = citationKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  if (rows.length === 0) return null;
  const listed = rows.slice(0, FALLBACK_ROWS);
  const lines = listed.map((row) => `- ${row.title.replace(/\s+/g, ' ').trim()}`);
  const more = rows.length - listed.length;
  if (more > 0) lines.push(`- and ${more} more`);
  const body = [
    'I could not finish writing the answer, so here is what my lookups found. Ask again for more about any of them.',
    lines.join('\n'),
  ].join('\n\n');
  return { body: body.slice(0, MAX_TURN), citations: listed };
}

function answerInput(input: unknown): { answer: string; cited: { table: string; ref: string }[] } {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const answer = typeof raw.answer === 'string' ? raw.answer.trim() : '';
  const cited = Array.isArray(raw.cited)
    ? raw.cited.flatMap((c) =>
        c && typeof c === 'object' && typeof (c as { table?: unknown }).table === 'string' &&
        typeof (c as { ref?: unknown }).ref === 'string'
          ? [{ table: (c as { table: string }).table, ref: (c as { ref: string }).ref }]
          : [],
      )
    : [];
  return { answer, cited };
}

/**
 * Dash's answer to the last of the turns, which is the person's question.
 * Calls the model until it answers or a limit is reached. Never throws.
 */
export async function answerQuestion(input: {
  /** The conversation so far, oldest first, ending with the question. */
  turns: readonly Pick<TalkTurn, 'role' | 'body' | 'citations'>[];
  /** YYYY-MM-DD in the person's timezone. */
  today: string;
  /** The page the question was asked from; null or absent when none is told. */
  page?: PageContext | null;
  execute: AskExecutor;
  /** Absent: every proposal is refused. */
  propose?: AskProposer;
  /**
   * Keeps a hand-off and returns what to tell the model. Absent: every
   * hand-off is refused. `seen` says whether Dash has seen the row it names.
   */
  handOff?: (input: unknown, seen: (table: string, ref: string) => boolean) => Promise<AskToolResult>;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
  /** For tests: the clock the time budget reads. */
  now?: () => number;
  /** Hears each lookup start and finish. Whatever it throws is ignored. */
  onLookup?: (event: AskLookupEvent) => void;
}): Promise<AskAnswer> {
  const toolCalls: TalkToolCall[] = [];
  // Every row a lookup in this answer returned, in the order found: what an
  // answer is built from when the model writes none.
  const found: TalkCitation[] = [];
  const hear = (event: AskLookupEvent) => {
    try {
      input.onLookup?.(event);
    } catch (error) {
      console.error('ask lookup listener failed', error);
    }
  };
  const fail = (detail: string): AskAnswer => {
    const built = answerFromLookups(found);
    if (!built) return { ok: false, detail, toolCalls };
    return { ok: true, body: built.body, toolCalls, citations: built.citations, stop: 'unfinished' };
  };
  const history = historyMessages(input.turns);
  if (history.length === 0 || history[history.length - 1].role !== 'user') {
    return { ok: false, detail: 'There is no question to answer.', toolCalls };
  }

  // Rows the answer may cite: what the tools return now, and what earlier
  // answers in this conversation cited, which tools returned then.
  const known = new Map<string, TalkCitation>();
  for (const turn of input.turns) for (const c of turn.citations ?? []) known.set(citationKey(c), c);

  const now = input.now ?? Date.now;
  const started = now();
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: dateLine(input.today) },
  ];
  const onPage = pageLine(input.page);
  if (onPage) system.push({ type: 'text', text: onPage });

  const messages: Anthropic.MessageParam[] = [...history];
  let lookups = 0;
  let inputTokens = 0;

  // Each round either answers or makes at least one lookup, and the lookups
  // are capped, so this ends; the bound is a second guard.
  for (let round = 0; round <= MAX_LOOKUPS + 1; round++) {
    const limit: AskStop | null =
      lookups >= MAX_LOOKUPS
        ? 'lookups'
        : inputTokens >= INPUT_BUDGET
          ? 'budget'
          : now() - started >= TIME_BUDGET_MS
            ? 'time'
            : null;
    const mustAnswer = limit !== null || round === MAX_LOOKUPS + 1;

    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model: ASK_MODEL,
        max_tokens: ANSWER_MAX_TOKENS,
        system,
        tools: TOOLS,
        tool_choice: mustAnswer ? { type: 'tool', name: ANSWER_TOOL } : { type: 'any' },
        messages: withRollingBreakpoint(messages),
      });
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'The answer failed.');
    }

    const usage = usageFrom(response.usage);
    input.onSpend?.({ model: ASK_MODEL, usage });
    inputTokens += usage.inputTokens + usage.cachedInputTokens + usage.cacheWriteTokens;

    const uses = response.content.filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
    const answered = uses.find((c) => c.name === ANSWER_TOOL);
    if (answered) {
      const { answer, cited } = answerInput(answered.input);
      if (!answer) return fail('The answer came back empty.');
      const citations: TalkCitation[] = [];
      const seen = new Set<string>();
      for (const c of cited) {
        const key = citationKey(c);
        const row = known.get(key);
        if (row && !seen.has(key)) {
          seen.add(key);
          citations.push(row);
        }
      }
      const stop: AskStop = limit ?? 'answered';
      const note = stop === 'answered' ? '' : `\n\n${limitNote(stop)}`;
      return {
        ok: true,
        body: `${answer.slice(0, MAX_TURN - note.length)}${note}`,
        toolCalls,
        citations,
        stop,
      };
    }

    if (uses.length === 0 || mustAnswer) {
      // Told to call a tool and did not: a reply cut off, or prose instead.
      const text = response.content.find((c): c is Anthropic.TextBlock => c.type === 'text')?.text.trim();
      if (text && response.stop_reason !== 'max_tokens') {
        return { ok: true, body: text.slice(0, MAX_TURN), toolCalls, citations: [], stop: limit ?? 'answered' };
      }
      // Told to answer and made more lookups instead, which is how a jobs
      // question failed after five rounds of lookups ("stopped: tool_use").
      // Refuse those lookups and ask once more with no tool allowed, so what
      // was already looked up still becomes an answer.
      if (uses.length > 0) {
        const at = lookups;
        messages.push(
          { role: 'assistant', content: response.content },
          {
            role: 'user',
            content: uses.map((use, i) => {
              const result = keptResult({ ok: false, error: LIMIT_REACHED });
              toolCalls.push({ name: use.name, input: use.input, result });
              hear({ phase: 'finished', id: use.id, index: at + i, name: use.name, input: use.input, ok: false, result });
              return { type: 'tool_result', tool_use_id: use.id, content: LIMIT_REACHED, is_error: true };
            }),
          },
        );
        let prose: Anthropic.Message;
        try {
          prose = await client.messages.create({
            model: ASK_MODEL,
            max_tokens: ANSWER_MAX_TOKENS,
            system,
            tools: TOOLS,
            tool_choice: { type: 'none' },
            messages: withRollingBreakpoint(messages),
          });
        } catch (error) {
          return fail(error instanceof Error ? error.message : 'The answer failed.');
        }
        input.onSpend?.({ model: ASK_MODEL, usage: usageFrom(prose.usage) });
        const said = prose.content.find((c): c is Anthropic.TextBlock => c.type === 'text')?.text.trim();
        if (said && prose.stop_reason !== 'max_tokens') {
          const stop: AskStop = limit ?? 'lookups';
          const note = `\n\n${limitNote(stop)}`;
          return { ok: true, body: `${said.slice(0, MAX_TURN - note.length)}${note}`, toolCalls, citations: [], stop };
        }
        return fail(whyNoReport(prose));
      }
      return fail(whyNoReport(response));
    }

    // Run this round's lookups together, as many as the cap still allows.
    const results = await Promise.all(
      uses.map(async (use, i): Promise<AskToolResult> => {
        if (lookups + i >= MAX_LOOKUPS) return { ok: false, error: LIMIT_REACHED };
        hear({ phase: 'started', id: use.id, index: lookups + i, name: use.name, input: use.input });
        if (use.name === HAND_OFF_TOOL_NAME) {
          if (!input.handOff) return { ok: false, error: NO_HANDOFF };
          // The row it is about counts when a lookup returned it or the page shows it.
          const row = input.page?.row;
          return input.handOff(
            use.input,
            (table, ref) => known.has(citationKey({ table, ref })) || (row?.table === table && row.ref === ref),
          );
        }
        if (isProposal(use.name)) {
          if (!input.propose) return { ok: false, error: NO_PROPOSALS };
          return input.propose(use.name, use.input, (table, ref) => known.has(citationKey({ table, ref })));
        }
        return input.execute(use.name, use.input);
      }),
    );
    const blocks: Anthropic.ToolResultBlockParam[] = uses.map((use, i) => {
      const result = results[i];
      const kept = keptResult(result);
      toolCalls.push({ name: use.name, input: use.input, result: kept });
      hear({ phase: 'finished', id: use.id, index: lookups + i, name: use.name, input: use.input, ok: result.ok, result: kept });
      for (const c of citationsOf(result)) {
        known.set(citationKey(c), c);
        found.push(c);
      }
      return {
        type: 'tool_result',
        tool_use_id: use.id,
        content: result.ok ? toolResultText(result) : result.error,
        ...(result.ok ? {} : { is_error: true }),
      };
    });
    lookups += uses.length;
    messages.push({ role: 'assistant', content: response.content }, { role: 'user', content: blocks });
  }

  return fail('The answer did not finish.');
}

// ---------------------------------------------------------------------------
// Keeping the question, the answer and the spend
// ---------------------------------------------------------------------------

/** Where askDash reads and writes the conversation; store.ts bound to a client and a user. */
export type AskStores = {
  start: (question: string) => Promise<TalkSubject & { kind: 'ask' }>;
  load: (ref: string) => Promise<TalkTurn[]>;
  append: (subject: TalkSubject, turns: readonly NewTalkTurn[]) => Promise<TalkTurn[]>;
  /** Writes what the calls cost, under the operation 'ask-dash'. Never throws. */
  recordSpend: (reports: Parameters<SpendSink>[0][]) => Promise<void>;
  /** Keeps a proposal in the conversation (changes.ts insertProposal). */
  saveProposal: (conversationId: string, change: NewDashChange) => Promise<DashChange>;
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
};

/** Checks a proposal against the person's rows and keeps it; lib/ask/propose.ts bound to a request. */
export type AskProposalRunner = (
  name: string,
  input: unknown,
  seen: (table: string, ref: string) => boolean,
  save: (change: NewDashChange) => Promise<DashChange>,
) => Promise<AskToolResult>;

export type AskDashResult = {
  /** The conversation, to reopen or continue; absent only when nothing was kept. */
  conversation?: { ref: string; title: string | null };
  /** The turns written by this call, oldest first: the question, then the answer when there is one. */
  turns: TalkTurn[];
  /** Why there is no answer, in a sentence for the person. */
  error?: string;
  /** Why the answer stopped: 'answered', or the limit it was written under. */
  stop?: AskStop;
  /** The changes the answer proposed, each tied to its turn, in the order proposed. */
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
    today: string;
    /**
     * The page it was asked from, resolved (lib/ask/page.ts). Not kept with
     * the conversation: each question carries the page it was asked on.
     */
    page?: PageContext | null;
    execute: AskExecutor;
    /** Absent: every proposal is refused. */
    propose?: AskProposalRunner;
    anthropicApiKey: string | null | undefined;
    client?: Anthropic;
    now?: () => number;
    /** Hears each lookup start and finish (AskLookupEvent). */
    onLookup?: (event: AskLookupEvent) => void;
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
    asked = await stores.append(subject, [{ role: 'user', body: question }]);
  } catch {
    return { turns: [], error: 'Your question was not kept. Try again.' };
  }
  const conversation = { ref: subject.ref, title: subject.title ?? null };

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
  const answer = await answerQuestion({
    turns: [...earlier, ...asked],
    today: input.today,
    page: input.page,
    execute: input.execute,
    propose: propose ? (name, args, seen) => propose(name, args, seen, save) : undefined,
    handOff,
    anthropicApiKey: input.anthropicApiKey,
    client: input.client,
    now: input.now,
    onLookup: input.onLookup,
    onSpend: (report) => spent.push(report),
  });
  await stores.recordSpend(spent);
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
