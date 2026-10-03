import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { citationsOf, toolResultText, type AskToolResult } from '@/lib/ask/db';
import type { PageContext } from '@/lib/ask/page';
import { whyNoReport } from '@/lib/learn/graph/tool-call';
import { NO_HANDOFF } from '@/lib/talk/handoff';
import { MAX_TURN, toModelMessages, type TalkCitation, type TalkToolCall, type TalkTurn } from '@/lib/talk/talk';
import { parseRef } from '@/lib/core/refs';
import { dashTool, type DashHandoffTool, type DashTool, type DashWriteTool } from './registry';

/**
 * The one loop every Dash conversation runs on (plan #1463, feature #1462;
 * docs/CORE-AND-DASH-SPEC.md, Part 6). Grown from Ask Dash's (plan #1089),
 * which is the first surface on it (lib/dash/ask.ts).
 *
 * A surface hands in its voice (model, rules, the registry tools it offers)
 * and a context: which surface, the row the conversation hangs from when
 * there is one, and the page the person is on. The model is given the
 * voice's tools and an `answer` tool. Every round it must call one or the
 * other: tool calls are run and their results sent back, and the loop ends
 * when it calls `answer`. The answer names the rows it relied on by table and
 * ref, and only rows a tool returned in this conversation are kept as
 * citations; anything else it names is dropped.
 *
 * Each call is routed by its tool's kind in lib/dash/registry.ts: a lookup to
 * `execute`, a proposal to `propose`, a hand-off to `handOff`, a write to
 * `write`. A surface leaves out the handlers it does not allow, and a call to
 * one of those is refused with a sentence telling the model to answer in
 * words. Every call, of any kind, counts toward the lookup cap, and one
 * naming a row can only name a row a lookup returned, as citations do.
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
 * `onLookup` hears each call as it starts and as it finishes, which is what
 * a page showing the lookups while they run listens to.
 */

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

export const ANSWER_TOOL = 'answer';

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
 * The tools sent on every call: the voice's registry tools, then `answer`.
 * The same list in the same order every time, with the cache breakpoint on
 * the last, so the prefix is cached across rounds and across questions.
 */
export function modelTools(tools: readonly DashTool[], finish: Anthropic.Tool = ANSWER): Anthropic.Tool[] {
  return [...tools.map((tool) => tool.definition), { ...finish, cache_control: { type: 'ephemeral' } }];
}

/** Every tool a voice is sent: its server tools first, then modelTools. */
function voiceTools(voice: DashVoice): Anthropic.ToolUnion[] {
  return [...(voice.serverTools ?? []), ...modelTools(voice.tools, voice.finish)];
}

/** The surfaces Dash talks on, as core.dash_actions names them. */
export type DashSurface = 'ask' | 'thread' | 'capture';

/** How Dash speaks on a surface: the model, the rules it is given, and the tools it may call. */
export type DashVoice = {
  model: string;
  /** The rules, sent first and cached. */
  system: string;
  /** The registry tools offered, in the order sent. */
  tools: readonly DashTool[];
  /**
   * Anthropic's own tools, run on their side, sent ahead of the registry
   * tools: Maya's web search (plan #1479). A voice with any is let choose
   * between them and its tools each round rather than made to call one, and
   * asked once more for its answer if it stops without one.
   */
  serverTools?: readonly Anthropic.ToolUnion[];
  /**
   * The tool that ends a turn in place of `answer`, for a voice whose answer
   * has a shape of its own, such as Maya's thought. Its input comes back as
   * the answer's `report`, and its `answer` field, when it has one, as the body.
   */
  finish?: Anthropic.Tool;
  /** Output tokens for one call; ANSWER_MAX_TOKENS when absent. */
  maxTokens?: number;
};

/** Where the conversation is happening. */
export type DashContext = {
  surface: DashSurface;
  /**
   * The row the conversation hangs from, as a `schema.table:id` ref (lib/core/
   * refs.ts): a goal, a dev row, a role. Null for Ask, whose conversation is
   * its own subject. The turns handed to the loop are this row's thread.
   */
  subject: { ref: string; title?: string | null } | null;
  /** The page the person is on; null when none is told. */
  page: PageContext | null;
};

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
  // a goal, and a goal's ref is what add_goal_step names.
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
export type DashStop = 'answered' | 'lookups' | 'budget' | 'time' | 'unfinished';

/** The sentence an answer written under a limit ends with. */
export function limitNote(stop: Exclude<DashStop, 'answered' | 'unfinished'>): string {
  return stop === 'lookups'
    ? `I stopped after ${MAX_LOOKUPS} lookups, so this answer rests only on what those found.`
    : 'I stopped looking before I had checked everything, so this answer rests only on what I found by then.';
}

export type DashAnswer =
  | {
      ok: true;
      body: string;
      toolCalls: TalkToolCall[];
      citations: TalkCitation[];
      stop: DashStop;
      /** For a voice with its own `finish` tool: that call's input, as the model gave it. */
      report?: unknown;
      /**
       * For a voice with server tools: the passages a web search returned and
       * the model cited, which an exact quote can be checked against.
       */
      webCited?: string[];
    }
  | { ok: false; detail: string; toolCalls: TalkToolCall[] };

/**
 * One tool call, heard as it starts and again as it finishes (plan #1438 shows
 * them in the thread while they run). `id` is the model's tool_use id and
 * pairs the two; `index` counts calls in this answer from 0. The finished
 * event carries the result as the turn keeps it (TalkToolCall.result), so
 * what streams is what a reopened answer shows. Proposals and hand-offs are
 * heard too; a call refused at the cap is heard only as finished.
 */
export type DashLookupEvent =
  | { phase: 'started'; id: string; index: number; name: string; input: unknown }
  | { phase: 'finished'; id: string; index: number; name: string; input: unknown; ok: boolean; result: unknown };

/** Whether Dash has seen a row: a lookup returned it, or for some calls, the page shows it. */
export type DashSeen = (table: string, ref: string) => boolean;

/** Runs one lookup. Never throws; executeAskTool in lib/ask/tools.ts with its context bound. */
export type DashExecutor = (name: string, input: unknown) => Promise<AskToolResult>;

/**
 * Checks and keeps one proposal. Never throws; executeProposal in
 * lib/ask/propose.ts with its context bound. `seen` says whether a lookup in
 * this conversation returned a row.
 */
export type DashProposer = (name: string, input: unknown, seen: DashSeen) => Promise<AskToolResult>;

/**
 * Makes one write. Never throws. The surface binds the person's context,
 * runs the tool's `apply`, records it with recordDashAction (Part 5), and
 * returns what to tell the model.
 */
export type DashWriter = (tool: DashWriteTool, input: unknown, seen: DashSeen) => Promise<AskToolResult>;

/** Said to the model when a proposal is made where none can be kept. */
const NO_PROPOSALS = 'Changes cannot be proposed here. Answer in words.';
/** Said to the model when a write is called where none can be made. */
const NO_WRITES = 'Changes cannot be made here. Answer in words.';

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
 * The passages a web search returned and the model cited in its text. Result
 * pages come back encrypted, so a cited passage (`cited_text` on a
 * `web_search_result_location` citation) is the only search text the app can
 * read.
 */
export function citedSearchText(content: readonly { type: string; citations?: unknown }[]): string[] {
  const out: string[] = [];
  for (const block of content) {
    if (block.type !== 'text' || !Array.isArray(block.citations)) continue;
    for (const citation of block.citations as { type?: unknown; cited_text?: unknown }[]) {
      if (citation?.type === 'web_search_result_location' && typeof citation.cited_text === 'string') {
        out.push(citation.cited_text);
      }
    }
  }
  return out;
}

/** What runDash is handed. */
export type DashRun = {
  voice: DashVoice;
  context: DashContext;
  /** The conversation so far, oldest first, ending with the person's turn. */
  turns: readonly Pick<TalkTurn, 'role' | 'body' | 'citations'>[];
  /** YYYY-MM-DD in the person's timezone. */
  today: string;
  execute: DashExecutor;
  /** Absent: every proposal is refused. */
  propose?: DashProposer;
  /**
   * Keeps a hand-off and returns what to tell the model. Absent: every
   * hand-off is refused. `seen` says whether Dash has seen the row it names;
   * `tool` is which hand-off was called, since a thread has more than one.
   */
  handOff?: (input: unknown, seen: DashSeen, tool: DashHandoffTool) => Promise<AskToolResult>;
  /** Absent: every write is refused. */
  write?: DashWriter;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
  /** For tests: the clock the time budget reads. */
  now?: () => number;
  /** Hears each call start and finish. Whatever it throws is ignored. */
  onLookup?: (event: DashLookupEvent) => void;
};

/**
 * Dash's answer to the last of the turns, which is the person's. Calls the
 * model until it answers or a limit is reached. Never throws.
 */
export async function runDash(input: DashRun): Promise<DashAnswer> {
  const { voice, context } = input;
  const model = voice.model;
  const tools = voiceTools(voice);
  const finishName = voice.finish?.name ?? ANSWER_TOOL;
  const maxTokens = voice.maxTokens ?? ANSWER_MAX_TOKENS;
  // A voice with server tools chooses each round; one without must call a tool.
  const choose = (voice.serverTools?.length ?? 0) > 0;
  const webCited: string[] = [];
  const extras = (): { report?: unknown; webCited?: string[] } => ({
    ...(choose ? { webCited } : {}),
  });
  const toolCalls: TalkToolCall[] = [];
  // Every row a lookup in this answer returned, in the order found: what an
  // answer is built from when the model writes none.
  const found: TalkCitation[] = [];
  const hear = (event: DashLookupEvent) => {
    try {
      input.onLookup?.(event);
    } catch (error) {
      console.error('ask lookup listener failed', error);
    }
  };
  const fail = (detail: string): DashAnswer => {
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
  const seenByLookup: DashSeen = (table, ref) => known.has(citationKey({ table, ref }));
  // A hand-off or a write may also name the row the page shows, or the row
  // the thread hangs from (plan #1465).
  const row = context.page?.row;
  const subject = context.subject ? parseRef(context.subject.ref) : null;
  const seenOrShown: DashSeen = (table, ref) =>
    seenByLookup(table, ref) ||
    (row?.table === table && row.ref === ref) ||
    (subject?.table === table && subject.id === ref);

  const now = input.now ?? Date.now;
  const started = now();
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: voice.system, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: dateLine(input.today) },
  ];
  const onPage = pageLine(context.page);
  if (onPage) system.push({ type: 'text', text: onPage });

  /** Runs one call by its tool's kind in the voice's registry. */
  const run = (name: string, args: unknown): Promise<AskToolResult> => {
    const tool = dashTool(name, voice.tools);
    if (tool?.kind === 'handoff') {
      if (!input.handOff) return Promise.resolve({ ok: false, error: NO_HANDOFF });
      return input.handOff(args, seenOrShown, tool);
    }
    if (tool?.kind === 'write') {
      if (!input.write) return Promise.resolve({ ok: false, error: NO_WRITES });
      return input.write(tool, args, seenOrShown);
    }
    if (tool?.kind === 'proposal' || (!tool && isProposal(name))) {
      if (!input.propose) return Promise.resolve({ ok: false, error: NO_PROPOSALS });
      return input.propose(name, args, seenByLookup);
    }
    // A lookup, or a name the model made up, which the executor refuses.
    return input.execute(name, args);
  };

  const messages: Anthropic.MessageParam[] = [...history];
  // A voice that chooses may search and be paused, and every round resends
  // the opening message, which for Maya is the note and all its material:
  // cached, so the rounds after the first read it at a tenth of the price.
  const opening = messages[0];
  if (choose && opening && typeof opening.content === 'string') {
    messages[0] = { ...opening, content: [{ type: 'text', text: opening.content, cache_control: { type: 'ephemeral' } }] };
  }
  let lookups = 0;
  let inputTokens = 0;
  // Set when a voice that chooses stopped without its answer: the next round must give it.
  let asked = false;

  // Each round either answers or makes at least one lookup, and the lookups
  // are capped, so this ends; the bound is a second guard.
  for (let round = 0; round <= MAX_LOOKUPS + 1; round++) {
    const limit: DashStop | null =
      lookups >= MAX_LOOKUPS
        ? 'lookups'
        : inputTokens >= INPUT_BUDGET
          ? 'budget'
          : now() - started >= TIME_BUDGET_MS
            ? 'time'
            : null;
    const mustAnswer = limit !== null || asked || round === MAX_LOOKUPS + 1;

    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        tools,
        tool_choice: mustAnswer ? { type: 'tool', name: finishName } : choose ? { type: 'auto' } : { type: 'any' },
        messages: withRollingBreakpoint(messages),
      });
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'The answer failed.');
    }

    const usage = usageFrom(response.usage);
    input.onSpend?.({ model, usage });
    inputTokens += usage.inputTokens + usage.cachedInputTokens + usage.cacheWriteTokens;
    if (choose) webCited.push(...citedSearchText(response.content as { type: string; citations?: unknown }[]));

    const uses = response.content.filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
    const answered = uses.find((c) => c.name === finishName);
    if (answered) {
      // Writes made in the same round as the answer are made first (plan
      // #1478): the answer says they are done, and capture files every move
      // and its answer in one round. Lookups beside an answer are not run,
      // since nothing would read what they return.
      const writes = uses.filter((use) => use !== answered && dashTool(use.name, voice.tools)?.kind === 'write');
      const made = await Promise.all(
        writes.map(async (use, i): Promise<AskToolResult> => {
          if (lookups + i >= MAX_LOOKUPS) return { ok: false, error: LIMIT_REACHED };
          hear({ phase: 'started', id: use.id, index: lookups + i, name: use.name, input: use.input });
          return run(use.name, use.input);
        }),
      );
      writes.forEach((use, i) => {
        const result = made[i];
        const kept = keptResult(result);
        toolCalls.push({ name: use.name, input: use.input, result: kept });
        hear({ phase: 'finished', id: use.id, index: lookups + i, name: use.name, input: use.input, ok: result.ok, result: kept });
        for (const c of citationsOf(result)) {
          known.set(citationKey(c), c);
          found.push(c);
        }
      });
      lookups += writes.length;
      const { answer, cited } = answerInput(answered.input);
      if (!answer && !voice.finish) return fail('The answer came back empty.');
      const citations: TalkCitation[] = [];
      const seen = new Set<string>();
      for (const c of cited) {
        const key = citationKey(c);
        const kept = known.get(key);
        if (kept && !seen.has(key)) {
          seen.add(key);
          citations.push(kept);
        }
      }
      const stop: DashStop = limit ?? 'answered';
      const note = stop === 'answered' ? '' : `\n\n${limitNote(stop)}`;
      return {
        ok: true,
        body: answer ? `${answer.slice(0, MAX_TURN - note.length)}${note}` : '',
        toolCalls,
        citations,
        stop,
        ...extras(),
        ...(voice.finish ? { report: answered.input } : {}),
      };
    }

    // Server tools paused the turn (a long search): send it back as it is.
    // Widened: the installed SDK's type may predate the reason.
    const stopped: string | null = response.stop_reason;
    if (uses.length === 0 && stopped === 'pause_turn' && !mustAnswer) {
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }
    // A voice that chooses stopped without its answer: ask for it once, keeping
    // what it searched and wrote.
    if (choose && uses.length === 0 && !mustAnswer && stopped !== 'max_tokens' && stopped !== 'refusal') {
      messages.push(
        { role: 'assistant', content: response.content },
        { role: 'user', content: `Now give it through ${finishName}.` },
      );
      asked = true;
      continue;
    }
    if (voice.finish && (uses.length === 0 || mustAnswer)) {
      // Its answer has a shape prose cannot give.
      return fail(stopped === 'refusal' ? 'The model declined to answer.' : whyNoReport(response));
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
            model,
            max_tokens: maxTokens,
            system,
            tools,
            tool_choice: { type: 'none' },
            messages: withRollingBreakpoint(messages),
          });
        } catch (error) {
          return fail(error instanceof Error ? error.message : 'The answer failed.');
        }
        input.onSpend?.({ model, usage: usageFrom(prose.usage) });
        const said = prose.content.find((c): c is Anthropic.TextBlock => c.type === 'text')?.text.trim();
        if (said && prose.stop_reason !== 'max_tokens') {
          const stop: DashStop = limit ?? 'lookups';
          const note = `\n\n${limitNote(stop)}`;
          return { ok: true, body: `${said.slice(0, MAX_TURN - note.length)}${note}`, toolCalls, citations: [], stop };
        }
        return fail(whyNoReport(prose));
      }
      return fail(whyNoReport(response));
    }

    // Run this round's calls together, as many as the cap still allows.
    const results = await Promise.all(
      uses.map(async (use, i): Promise<AskToolResult> => {
        if (lookups + i >= MAX_LOOKUPS) return { ok: false, error: LIMIT_REACHED };
        hear({ phase: 'started', id: use.id, index: lookups + i, name: use.name, input: use.input });
        return run(use.name, use.input);
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
