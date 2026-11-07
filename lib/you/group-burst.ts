import Anthropic from '@anthropic-ai/sdk';
import { readReport, reportRequest } from '@/lib/core/model-call';
import { MODELS } from '@/lib/core/models';
import { costMicrosFor, usageFrom, type SpendReport } from '@/lib/core/spend/pricing';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { readBrain } from '@/lib/you/board-brain';
import { memoryLayer, personaLayer, READ_LIMITS, type ContextMentor } from '@/lib/you/chat-context-model';
import { memoryOf, type CouncilMemory } from '@/lib/you/council-model';
import { loadGroup } from '@/lib/you/group-chats';
import { loadCarryOver } from '@/lib/you/carry-over';
import {
  asksPerson,
  BURST_REQUEST_MS,
  CHAIN_RESERVE_MS,
  cleanSpeech,
  DIRECTOR_MAX_TOKENS,
  DIRECTOR_RULES,
  DIRECTOR_TOOL,
  directorPlanOf,
  directorPrompt,
  MAX_REPLANS,
  mentionedIn,
  planReactions,
  planTurns,
  SPEAKER_MAX_TOKENS,
  SPEAKER_RULES,
  THREAD_READ,
  transcriptOf,
  turnPauseMs,
  WAIT,
  type BurstLine,
  type BurstMember,
  type BurstState,
  type DirectorPlan,
} from '@/lib/you/group-burst-model';
import { claimTyping, TYPING_LEASE_MS, TYPING_RENEW_MS } from '@/lib/you/mentor-reply';
import { keepRenewing, waitForQuiet } from '@/lib/you/reply-turn';
import { AskInputError } from '@/lib/ask/db';
import { FIND_PLACES_DEFINITION, FIND_PLACES_TOOL, placesInput, placesToolResult } from '@/lib/ask/places';
import type { PlacesLookupInput, PlacesLookupResult } from '@/lib/you/places-lookup';
import type { AskToolResult } from '@/lib/ask/db';
import { MAKE_PAGE_TOOL, MAKE_PAGE_TOOL_NAME, PAGE_RULES, type BotPageStarter } from '@/lib/you/bot-pages';
import { HAND_OFF_TOOL, HAND_OFF_TOOL_NAME } from '@/lib/talk/handoff';
import { SESSION_RULES, type SessionStarter } from '@/lib/talk/session-handoff';
import { BOT_HANDOFF_RULES, HAND_TO_BOT_TOOL, HAND_TO_BOT_TOOL_NAME, personWords, type BotPasser } from '@/lib/talk/hand-to-bot';
import { ATTACH_RULES, CHART_ONLY_RULES, claimSlip, falseAttachment, NOTHING_ATTACHED, NOTHING_ATTACHED_CHART_ONLY } from '@/lib/talk/attachment-claim';
import { dashCodeExecution, fetchMadeFiles, madeFileIds, madeFilesNote, type MadeFile, type UnkeptFile } from '@/lib/talk/made-files';
import { CHART_DRAWN, CHART_TOOL, CHART_TOOL_DEFINITION, parseChart, type DashChart } from '@/lib/talk/chart';
import { MAX_BUBBLE_CHARTS } from '@/lib/you/chat-threads-model';
import type { DashSlip } from '@/lib/dash/slips';

export * from '@/lib/you/group-burst-model';

/**
 * A group chat answering the person (plan #2879.1.2). The send saves the
 * message and claims the chat's lease (you.advisor_chats.typing_until, the
 * same claim a direct chat's reply holds); then, after the page has its
 * answer, `runGroupBurst` runs the burst: the director plans, each picked
 * bot writes as itself with its own typing dots on its member row, a short
 * pause scaled to the text before each lands, and the director looks again.
 * The caps in group-burst-model.ts are applied to every plan.
 *
 * A message the person sends mid-burst is saved by its own send, which
 * finds the lease held; the burst sees it after the turn in hand, stops,
 * and the director plans again from the new message, with the caps counted
 * afresh. A burst near the end of its request's time hands on to a chained
 * request (`chain`), which keeps the lease and carries on from the round it
 * was in. What every call cost is recorded once per burst.
 */

export type GroupSpendOperation = 'group-director' | 'group-speaker';

/** The bot whose turn it is, with what it reads before writing. */
export type Speaker = BurstMember & { system: string };

export type DirectorInput = { members: (BurstMember & { card: string })[]; lines: BurstLine[]; transcript: string; state: BurstState };
export type SpeakerInput = {
  speaker: Speaker;
  members: BurstMember[];
  transcript: string;
  /** Starts a page for this speaker, answering the person's newest message (plan #2997). Absent: no make_page. */
  page?: (input: unknown) => Promise<AskToolResult>;
  /** Hands heavy work to a session for this speaker (plan #3005.2). Absent: no hand_off. */
  handOn?: (input: unknown) => Promise<AskToolResult>;
  /** Passes a request to another bot for this speaker (plan #3003.2). Absent: no hand_to_bot. */
  passToBot?: (input: unknown) => Promise<AskToolResult>;
  /**
   * Where the charts this speaker draws with show_chart are kept, to go on
   * its text (plan #3050.2.2). Absent: no show_chart.
   */
  charts?: DashChart[];
  /**
   * Where the ids of the files this speaker's code writes are collected, to
   * be kept under its text (plan #3050.3.3). Present, it is offered code
   * execution and told it can send what its code makes; absent, it can draw
   * a chart and send nothing else.
   */
  made?: string[];
};

export type GroupBurstInput = {
  client: YouSupabaseClient;
  userId: string;
  chatId: string;
  /** The model the person chose for Dash, which each bot writes with. */
  model: string;
  anthropicApiKey: string | null | undefined;
  /** Keeps what the calls cost; never throws. */
  recordSpend: (operation: GroupSpendOperation, reports: SpendReport[]) => Promise<void>;
  /**
   * Looks places up near home (lib/you/places-lookup.ts, bound to the person,
   * plan #2987.3), offered to each speaker as find_places. Absent: the
   * speakers write with no tools at all.
   */
  findPlaces?: PlacesFinder;
  /**
   * Starts a page in a Claude Code session (plan #2997), offered to each
   * speaker as make_page. Absent: no bot in the group can make pages.
   */
  makePage?: BotPageStarter;
  /**
   * Hands heavy work to a Claude Code session (plan #3005.2), offered to
   * each speaker as hand_off. One hand-off per message of the person's,
   * whichever bot calls it. Absent: no bot in the group can hand on.
   */
  handOn?: SessionStarter;
  /**
   * Passes a request to another bot on People (plan #3003.2), offered to
   * each speaker as hand_to_bot. One row per request, whichever bot calls
   * it. Absent: no bot in the group can pass things on.
   */
  passToBot?: BotPasser;
  /**
   * Keeps a slip when a bot's text says it attached a file that was never
   * sent (plan #3050.1). Absent: the text still says nothing came through.
   */
  recordSlip?: (slip: DashSlip) => Promise<void>;
  /**
   * Keeps the files a speaker's code made against its text (plan
   * #3050.3.3), in core.attachments, and says which could not be kept.
   * Present, each speaker is offered code execution and told it can send
   * files; absent, the speakers can draw a chart and send nothing else.
   */
  keepFiles?: (messageId: string, files: MadeFile[]) => Promise<{ kept: unknown[]; unkept: UnkeptFile[] }>;
  /** The account's IANA zone, for the times on what a bot carries in from its other chats. Defaults to UTC. */
  timeZone?: string;
  /** True when the send (or the request that chained here) already holds the lease. */
  claimed?: boolean;
  /** The round a chained request carries on from. */
  round?: number;
  /** When this request's time runs out, as an epoch ms. Defaults to BURST_REQUEST_MS from the start. */
  deadline?: number;
  /** Starts a request to carry the burst on; the lease passes to it. */
  chain?: (from: { round: number }) => Promise<void>;
  /** How many times this run has started again for a message sent as it let go. */
  replans?: number;
  /** For tests: the director and the speakers without the API. */
  director?: (input: DirectorInput, spent: SpendReport[]) => Promise<DirectorPlan>;
  speak?: (input: SpeakerInput, spent: SpendReport[]) => Promise<string | null>;
  anthropic?: Anthropic;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type BurstOutcome = {
  /** Bot messages written, over every burst this run made. */
  messages: number;
  reactions: number;
  /** Bursts run: one, and one more each time the person wrote mid-burst. */
  bursts: number;
  /** True when the run handed on to a chained request. */
  chained: boolean;
  costMicros: number;
  error?: string;
};

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const strOrNull = (value: unknown): string | null => str(value) || null;

type Line = BurstLine & { createdAt: string };

async function readLines(client: YouSupabaseClient, userId: string, chatId: string): Promise<Line[]> {
  const { data, error } = await client
    .from('advisor_messages')
    .select('id, role, speaker_id, text, created_at')
    .eq('user_id', userId)
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(THREAD_READ);
  if (error) throw new Error(`Reading the group failed: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[])
    .flatMap((r) => {
      const text = str(r.text);
      if (typeof r.id !== 'string' || !text) return [];
      return [{ id: r.id, speakerId: r.role === 'person' ? null : str(r.speaker_id) || 'gone', text, createdAt: str(r.created_at) }];
    })
    .reverse();
}

/**
 * The thread from the person's newest message: that message, and the bots
 * who have spoken since, in order. `said` is what the person sent in a row
 * up to it, read as one message (plan #2988), so a bot named in the first of
 * three texts is still the one asked.
 */
function sinceAnchor(lines: readonly Line[]): { anchor: Line | null; spoken: string[]; lastBot: Line | null; said: string } {
  let i = lines.length - 1;
  while (i >= 0 && lines[i].speakerId !== null) i--;
  if (i < 0) return { anchor: null, spoken: [], lastBot: null, said: '' };
  let first = i;
  while (first > 0 && lines[first - 1].speakerId === null) first--;
  const after = lines.slice(i + 1);
  return {
    anchor: lines[i],
    spoken: after.map((l) => l.speakerId ?? '').filter(Boolean),
    lastBot: after[after.length - 1] ?? null,
    said: lines.slice(first, i + 1).map((l) => l.text).join('\n'),
  };
}

async function setMemberTyping(client: YouSupabaseClient, userId: string, chatId: string, advisorId: string, until: number | null) {
  await client
    .from('advisor_chat_members')
    .update({ typing_until: until === null ? null : new Date(until).toISOString() })
    .eq('user_id', userId)
    .eq('chat_id', chatId)
    .eq('advisor_id', advisorId);
}

/** Renew the lease while it is held: a renewal never puts back a lease already let go (plan #2988). */
async function renewLease(client: YouSupabaseClient, userId: string, chatId: string, now: number) {
  await client
    .from('advisor_chats')
    .update({ typing_until: new Date(now + TYPING_LEASE_MS).toISOString() })
    .eq('user_id', userId)
    .eq('id', chatId)
    .not('typing_until', 'is', null);
}

async function releaseLease(client: YouSupabaseClient, userId: string, chatId: string, error: string | null) {
  await Promise.all([
    client
      .from('advisor_chats')
      .update({ typing_until: null, reply_status: error ? 'failed' : 'idle', reply_error: error ? error.slice(0, 2000) : null })
      .eq('user_id', userId)
      .eq('id', chatId),
    client.from('advisor_chat_members').update({ typing_until: null }).eq('user_id', userId).eq('chat_id', chatId),
  ]);
}

/**
 * Each member's persona, memory and what it heard in its other chats since
 * the nightly run (plan #2983), as a speaker's system prompt, and a one-line
 * card for the director. The memory is the same page a one-on-one reply
 * reads, cut to its layer's budget.
 */
async function loadCast(
  client: YouSupabaseClient,
  userId: string,
  chatId: string,
  memberIds: readonly string[],
  timeZone: string,
  now: Date,
): Promise<Map<string, { system: string; card: string }>> {
  const carried = loadCarryOver(client, userId, memberIds, chatId, { where: 'group', now, timeZone }).catch((error) => {
    console.error('a group could not read its bots\' other chats', error);
    return new Map<string, string>();
  });
  const [advisors, memory] = await Promise.all([
    client
      .from('board_advisors')
      .select('id, key, name, kind, question, focus, persona, brain, made_by_you')
      .eq('user_id', userId)
      .in('id', [...memberIds]),
    client
      .from('advisor_memory')
      .select('id, advisor_id, kind, text, due_on, done_at, created_at')
      .eq('user_id', userId)
      .in('advisor_id', [...memberIds])
      .is('retired_at', null)
      .order('created_at', { ascending: false })
      .limit(READ_LIMITS.memory * memberIds.length),
  ]);
  if (advisors.error) throw new Error(`Reading the group's bots failed: ${advisors.error.message}`);
  if (memory.error) throw new Error(`Reading what the bots remember failed: ${memory.error.message}`);
  const memoryBy = new Map<string, CouncilMemory[]>();
  for (const row of (memory.data ?? []) as Record<string, unknown>[]) {
    const m = memoryOf(row);
    const id = str(row.advisor_id);
    if (!m || !id) continue;
    const list = memoryBy.get(id) ?? [];
    if (list.length < READ_LIMITS.memory) list.push(m);
    memoryBy.set(id, list);
  }
  const elsewhere = await carried;
  const out = new Map<string, { system: string; card: string }>();
  for (const row of (advisors.data ?? []) as Record<string, unknown>[]) {
    const mentor: ContextMentor = {
      id: str(row.id),
      key: str(row.key),
      name: str(row.name),
      kind: row.kind === 'seat' ? 'seat' : 'guest',
      question: str(row.question),
      focus: strOrNull(row.focus),
      persona: strOrNull(row.persona),
      brain: readBrain(row.brain),
      madeByYou: row.made_by_you === true,
    };
    const remembered = memoryLayer(memoryBy.get(mentor.id) ?? []).text;
    const card = (mentor.focus ?? mentor.question ?? '').replace(/\s+/g, ' ').slice(0, 200);
    out.set(mentor.id, { system: [personaLayer(mentor).text, remembered, elsewhere.get(mentor.id) ?? ''].filter(Boolean).join('\n\n'), card });
  }
  return out;
}

/** The director: one Haiku call through a forced tool; a failure reads as waiting. */
async function directWithModel(anthropic: Anthropic, input: DirectorInput, spent: SpendReport[]): Promise<DirectorPlan> {
  try {
    const response = await anthropic.messages.create({
      model: MODELS.groupDirector,
      max_tokens: DIRECTOR_MAX_TOKENS,
      system: DIRECTOR_RULES,
      ...reportRequest(DIRECTOR_TOOL, MODELS.groupDirector),
      messages: [{ role: 'user', content: directorPrompt(input) }],
    });
    spent.push({ model: MODELS.groupDirector, usage: usageFrom(response.usage) });
    const block = readReport(response, DIRECTOR_TOOL.name, MODELS.groupDirector);
    return block.ok ? directorPlanOf(block.value) : WAIT;
  } catch (error) {
    console.error('group director failed', error);
    return WAIT;
  }
}

export type PlacesFinder = (input: PlacesLookupInput) => Promise<PlacesLookupResult>;

/**
 * The most places lookups one bot's turn makes (plan #2987.3). A group text
 * is short, so one search, and one more when the first was refused for its
 * input or found nothing, is plenty.
 */
export const SPEAKER_MAX_LOOKUPS = 2;

/** What a speaker is told about find_places, after the texting rules. */
export const SPEAKER_PLACES_RULES = `When the person asks for a place nearby, such as somewhere to eat near home, look it up with find_places before you suggest one. Name only places it found, say in your own voice why one fits, and put its Maps link in your text. If it comes back with an error, say that plainly.`;

/** One find_places call run for a speaker, as the tool_result the model reads. */
async function placesCall(findPlaces: PlacesFinder | undefined, block: Anthropic.ToolUseBlock): Promise<Anthropic.ToolResultBlockParam> {
  const args = block.input && typeof block.input === 'object' ? (block.input as Record<string, unknown>) : {};
  let content: string;
  let isError = false;
  if (block.name !== FIND_PLACES_TOOL || !findPlaces) {
    content = `There is no tool called ${block.name}.`;
    isError = true;
  } else {
    try {
      const result = placesToolResult(await findPlaces(placesInput(args)));
      if (result.ok) content = JSON.stringify({ places: result.found ?? [], totals: result.totals, note: result.note });
      else {
        content = result.error;
        isError = true;
      }
    } catch (error) {
      if (!(error instanceof AskInputError)) console.error('group places lookup failed', error);
      content = error instanceof AskInputError ? error.message : 'That places lookup failed.';
      isError = true;
    }
  }
  return { type: 'tool_result', tool_use_id: block.id, content, ...(isError ? { is_error: true } : {}) };
}

/** One make_page (plan #2997), hand_off (plan #3005.2) or hand_to_bot (plan #3003.2) call run for a speaker, as the tool_result the model reads. */
async function handOffCall(
  start: (input: unknown) => Promise<AskToolResult>,
  block: Anthropic.ToolUseBlock,
  failed: string,
): Promise<Anthropic.ToolResultBlockParam> {
  try {
    const result = await start(block.input);
    if (result.ok) return { type: 'tool_result', tool_use_id: block.id, content: result.note ?? 'Started.' };
    return { type: 'tool_result', tool_use_id: block.id, content: result.error, is_error: true };
  } catch (error) {
    console.error(`group ${block.name} failed`, error);
    return { type: 'tool_result', tool_use_id: block.id, content: failed, is_error: true };
  }
}

/** One show_chart call of a speaker's (plan #3050.2.2): the chart is kept for its text, as the tool_result the model reads. */
function chartCall(charts: DashChart[], block: Anthropic.ToolUseBlock): Anthropic.ToolResultBlockParam {
  const parsed = parseChart(block.input);
  if (!parsed.ok) return { type: 'tool_result', tool_use_id: block.id, content: parsed.error, is_error: true };
  if (charts.length >= MAX_BUBBLE_CHARTS) {
    return { type: 'tool_result', tool_use_id: block.id, content: `A text holds at most ${MAX_BUBBLE_CHARTS} charts.`, is_error: true };
  }
  charts.push(parsed.chart);
  return { type: 'tool_result', tool_use_id: block.id, content: CHART_DRAWN };
}

/**
 * How many times one speaker's turn is sent back after its code paused it
 * (stop_reason pause_turn, plan #3050.3.3), beyond its lookups. A chart
 * drawn in Python seldom pauses at all.
 */
export const SPEAKER_MAX_PAUSES = 2;

/**
 * A speaker's longest answer when it can run code (plan #3050.3.3): the code
 * is written in the same answer as the text, and a matplotlib chart alone is
 * a few hundred tokens. The text is held short by the texting rules.
 */
export const SPEAKER_CODE_MAX_TOKENS = 4000;

/**
 * The text a speaker wrote in one answer. With code in it, the words after
 * the code's last result, since the words before are the model saying what
 * it is about to do; with none, its first text, as before.
 */
export function speakerText(content: readonly { type: string; text?: unknown }[]): string {
  const lastTool = content.findLastIndex((c) => c.type === 'server_tool_use' || c.type.endsWith('_tool_result'));
  const texts = (from: number) =>
    content
      .slice(from)
      .flatMap((c) => (c.type === 'text' && typeof c.text === 'string' && c.text.trim() ? [c.text.trim()] : []));
  if (lastTool < 0) return texts(0)[0] ?? '';
  const after = texts(lastTool + 1);
  return after.length > 0 ? after.join(' ') : (texts(0).at(-1) ?? '');
}

/** One call of a speaker's, run by its name. */
function speakerCall(input: SpeakerInput, findPlaces: PlacesFinder | undefined, call: Anthropic.ToolUseBlock): Promise<Anthropic.ToolResultBlockParam> {
  if (call.name === CHART_TOOL && input.charts) return Promise.resolve(chartCall(input.charts, call));
  if (call.name === MAKE_PAGE_TOOL_NAME && input.page) return handOffCall(input.page, call, 'The page could not be started. Say so plainly.');
  if (call.name === HAND_OFF_TOOL_NAME && input.handOn) {
    return handOffCall(input.handOn, call, 'It was not passed on. Say so plainly, and do not ask them to try again.');
  }
  if (call.name === HAND_TO_BOT_TOOL_NAME && input.passToBot) {
    return handOffCall(input.passToBot, call, 'It was not passed on. Say so plainly, and do not ask them to try again.');
  }
  return placesCall(findPlaces, call);
}

/**
 * One bot's text. With a places finder it is offered find_places, and with
 * a page starter make_page (plan #2997); with a place for charts,
 * show_chart (plan #3050.2.2). It may call them up to SPEAKER_MAX_LOOKUPS
 * times before it writes. With somewhere to collect what its code makes, it
 * may run code too (plan #3050.3.3), in the container its first run made,
 * and the ids of the files the code wrote go into `input.made`. With none,
 * it writes straight away, so a turn stays short.
 */
export async function speakWithModel(
  anthropic: Anthropic,
  model: string,
  input: SpeakerInput,
  spent: SpendReport[],
  findPlaces?: PlacesFinder,
): Promise<string | null> {
  const others = input.members.filter((m) => m.id !== input.speaker.id).map((m) => m.name);
  const code = Boolean(input.made);
  const rules = [
    SPEAKER_RULES,
    code ? ATTACH_RULES : CHART_ONLY_RULES,
    ...(findPlaces ? [SPEAKER_PLACES_RULES] : []),
    ...(input.page ? [PAGE_RULES] : []),
    ...(input.handOn ? [SESSION_RULES] : []),
    ...(input.passToBot ? [BOT_HANDOFF_RULES] : []),
    `In this group with the person: ${others.join(', ')}.`,
  ].join('\n\n');
  const tools: Anthropic.ToolUnion[] = [
    ...(code ? [dashCodeExecution()] : []),
    ...(input.charts ? [CHART_TOOL_DEFINITION] : []),
    ...(findPlaces ? [FIND_PLACES_DEFINITION] : []),
    ...(input.page ? [MAKE_PAGE_TOOL] : []),
    ...(input.handOn ? [HAND_OFF_TOOL] : []),
    ...(input.passToBot ? [HAND_TO_BOT_TOOL] : []),
  ];
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: `The group text so far, oldest first:\n${input.transcript}\n\nWrite your next text as ${input.speaker.name}.` },
  ];
  // The container the code first ran in, which later rounds reuse so its files stay at hand.
  let container: string | null = null;
  let pauses = 0;
  for (let lookups = 0; ; lookups++) {
    const offer = tools.length > 0 && lookups < SPEAKER_MAX_LOOKUPS;
    const response: Anthropic.Message = await anthropic.messages.create({
      model,
      max_tokens: code ? SPEAKER_CODE_MAX_TOKENS : SPEAKER_MAX_TOKENS,
      system: [
        { type: 'text', text: input.speaker.system },
        { type: 'text', text: rules },
      ],
      // Past the last lookup the tool is still sent, so the turns that used it
      // read, but the model is told to write.
      ...(tools.length > 0 ? { tools, tool_choice: offer ? { type: 'auto' as const } : { type: 'none' as const } } : {}),
      messages,
      // Widened: the installed SDK's params predate the container.
      ...(container ? ({ container } as Record<string, string>) : {}),
    });
    spent.push({ model, usage: usageFrom(response.usage) });
    if (input.made) {
      for (const id of madeFileIds(response.content)) if (!input.made.includes(id)) input.made.push(id);
      const ran = (response as unknown as { container?: { id?: unknown } | null }).container?.id;
      if (typeof ran === 'string' && ran) container = ran;
    }
    const calls = response.content.filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
    // The code paused the turn: send it back as it is, and the model carries on (plan #3050.3.3).
    const stopped: string | null = response.stop_reason;
    if (code && offer && calls.length === 0 && stopped === 'pause_turn' && pauses < SPEAKER_MAX_PAUSES) {
      pauses += 1;
      lookups -= 1;
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }
    if (!offer || calls.length === 0) return cleanSpeech(speakerText(response.content), input.speaker.name);
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: await Promise.all(calls.map((call) => speakerCall(input, findPlaces, call))) });
  }
}

/**
 * Answer the person's newest message in this group, and any they send while
 * it does, up to MAX_REPLANS times. Never throws: a burst that fails leaves
 * the chat marked failed with a sentence saying why.
 */
export async function runGroupBurst(input: GroupBurstInput): Promise<BurstOutcome> {
  const { client, userId, chatId } = input;
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? realSleep;
  const started = now();
  const deadline = input.deadline ?? started + BURST_REQUEST_MS;
  const outcome: BurstOutcome = { messages: 0, reactions: 0, bursts: 0, chained: false, costMicros: 0 };

  if (!input.claimed) {
    try {
      if (!(await claimTyping(client, userId, chatId, now()))) return outcome;
    } catch (error) {
      console.error('group burst could not claim the chat', error);
      return outcome;
    }
  }
  if (!input.director && !input.speak && !input.anthropicApiKey && !input.anthropic) {
    await releaseLease(client, userId, chatId, 'This deployment has no ANTHROPIC_API_KEY, so the group cannot reply.').catch(() => undefined);
    return { ...outcome, error: 'no api key' };
  }
  const anthropic = input.anthropic ?? (input.anthropicApiKey ? new Anthropic({ apiKey: input.anthropicApiKey }) : null);
  const direct = input.director ?? ((d: DirectorInput, s: SpendReport[]) => (anthropic ? directWithModel(anthropic, d, s) : Promise.resolve(WAIT)));
  const speak =
    input.speak ??
    ((d: SpeakerInput, s: SpendReport[]) => (anthropic ? speakWithModel(anthropic, input.model, d, s, input.findPlaces) : Promise.resolve(null)));

  const renewing = keepRenewing(() => renewLease(client, userId, chatId, now()), TYPING_RENEW_MS);
  let failure: string | null = null;
  let lastAnchorAt: string | null = null;
  const loop = async (): Promise<void> => {
    const group = await loadGroup(client, userId, chatId);
    if (!group || group.members.length === 0) return;
    const members: BurstMember[] = group.members.map((m) => ({ id: m.id, key: m.key, name: m.name }));
    const formerNames = new Map(group.former.map((m) => [m.id, m.name]));
    const cast = await loadCast(client, userId, chatId, members.map((m) => m.id), input.timeZone ?? 'UTC', new Date(now()));
    const withCards = members.map((m) => ({ ...m, card: cast.get(m.id)?.card ?? '' }));

    let carriedRound = input.round ?? null;
    let answered: string | null = null;
    for (let burst = 0; burst <= MAX_REPLANS; burst++) {
      // Texts sent in a row are one turn: wait, the lease held, until the person stops (plan #2988).
      if (input.round === undefined || burst > 0) {
        await waitForQuiet(async () => (await readLines(client, userId, chatId)).findLast((l) => l.speakerId === null)?.createdAt ?? null, { now, sleep });
      }
      const lines = await readLines(client, userId, chatId);
      const { anchor, spoken, lastBot, said } = sinceAnchor(lines);
      if (!anchor || anchor.id === answered) break;
      if (lastBot && carriedRound === null && asksPerson(lastBot.text, lastBot.speakerId ?? '', members)) break;
      outcome.bursts += 1;
      answered = anchor.id;
      lastAnchorAt = anchor.createdAt;
      const spent: Record<GroupSpendOperation, SpendReport[]> = { 'group-director': [], 'group-speaker': [] };
      const state: BurstState = { round: carriedRound ?? (spoken.length > 0 ? 1 : 0), spoken: [...spoken] };
      carriedRound = null;
      const mentioned = mentionedIn(said, members);
      const thread = [...lines];
      let interrupted = false;
      let over = false;

      while (!over && !interrupted) {
        const transcript = transcriptOf(thread, members, formerNames);
        const plan = await direct({ members: withCards, lines: thread, transcript, state }, spent['group-director']);
        for (const r of planReactions(plan, thread, members)) {
          const { error } = await client
            .from('advisor_message_reactions')
            .upsert({ user_id: userId, message_id: r.messageId, advisor_id: r.advisorId, reaction: r.reaction }, { onConflict: 'message_id,advisor_id' });
          if (!error) outcome.reactions += 1;
        }
        const turns = planTurns(plan, state, members, state.round === 0 ? mentioned : []);
        if (turns.length === 0) break;

        for (const advisorId of turns) {
          if (now() > deadline - CHAIN_RESERVE_MS && input.chain) {
            await input.chain({ round: state.round });
            outcome.chained = true;
            return;
          }
          const member = members.find((m) => m.id === advisorId);
          const persona = cast.get(advisorId);
          if (!member || !persona) continue;
          const turnStarted = now();
          await setMemberTyping(client, userId, chatId, advisorId, turnStarted + TYPING_LEASE_MS).catch(() => undefined);
          const keepTyping = keepRenewing(() => setMemberTyping(client, userId, chatId, advisorId, now() + TYPING_LEASE_MS), TYPING_RENEW_MS);
          let text: string | null = null;
          try {
            const makePage = input.makePage;
            const page = makePage
              ? (args: unknown) =>
                  makePage(
                    {
                      advisorId,
                      advisorName: member.name,
                      chatId,
                      messageId: anchor.id,
                      asked: anchor.text,
                      persona: persona.system,
                      href: `/chat/groups/${chatId}`,
                    },
                    args,
                  )
              : undefined;
            const startSession = input.handOn;
            const handOn = startSession
              ? (args: unknown) =>
                  startSession(
                    {
                      thread: { kind: 'chat', chatId, advisorId },
                      messageId: anchor.id,
                      asked: anchor.text,
                      botName: member.name,
                      href: `/chat/groups/${chatId}`,
                    },
                    args,
                  )
              : undefined;
            // The person's texts in this turn are the request, so two bots passing the same one keep one row.
            const passBot = input.passToBot;
            const passToBot = passBot
              ? (args: unknown) =>
                  passBot(
                    {
                      fromBot: advisorId,
                      source: { kind: 'group', chatId },
                      messageId: anchor.id,
                      asked: personWords(said.split('\n')) || anchor.text,
                    },
                    args,
                  )
              : undefined;
            // What show_chart draws goes on this text (plan #3050.2.2), and what its code makes under it (plan #3050.3.3).
            const charts: DashChart[] = [];
            const made: string[] = [];
            text = await speak(
              {
                speaker: { ...member, system: persona.system },
                members,
                transcript: transcriptOf(thread, members, formerNames),
                ...(page ? { page } : {}),
                ...(handOn ? { handOn } : {}),
                ...(passToBot ? { passToBot } : {}),
                charts,
                ...(input.keepFiles ? { made } : {}),
              },
              spent['group-speaker'],
            );
            // A text that says a file is attached when nothing was sent says so after all (plan #3050.1).
            // A chart it drew counts as sent; a file it names still does not (plan #3050.2.2).
            // A file its code made is said for once it is kept (plan #3050.3.3).
            const claim = text ? falseAttachment(text, charts.length, made.length) : null;
            if (text && claim) {
              text = `${text}\n\n${input.keepFiles ? NOTHING_ATTACHED : NOTHING_ATTACHED_CHART_ONLY}`;
              await input
                .recordSlip?.({ ...claimSlip(member.name, claim), surface: 'people', conversation: `people:${chatId}`, href: `/chat/groups/${chatId}` })
                .catch((error) => console.error('the attachment slip was not kept', error));
            }
            if (text) {
              const wait = turnPauseMs(text) - (now() - turnStarted);
              if (wait > 0) await sleep(wait);
              const saved = await client
                .from('advisor_messages')
                .insert({ user_id: userId, chat_id: chatId, role: 'advisor', kind: 'reply', speaker_id: advisorId, text, ...(charts.length > 0 ? { charts } : {}) })
                .select('id, created_at')
                .single();
              if (saved.error || typeof saved.data?.id !== 'string') throw new Error(`A message was written but not saved: ${saved.error?.message ?? 'no row came back'}`);
              thread.push({ id: saved.data.id, speakerId: advisorId, text, createdAt: str(saved.data.created_at) });
              state.spoken.push(advisorId);
              outcome.messages += 1;
              // What its code made goes under this text; what could not be kept is said in a text of its own (plan #3050.3.3).
              const note =
                made.length > 0 && input.keepFiles
                  ? await keepSpeakerFiles({ client, userId, chatId, messageId: saved.data.id, made, keep: input.keepFiles, anthropic })
                  : null;
              if (note) {
                const said = await client
                  .from('advisor_messages')
                  .insert({ user_id: userId, chat_id: chatId, role: 'advisor', kind: 'reply', speaker_id: advisorId, text: note })
                  .select('id, created_at')
                  .single();
                if (said.error || typeof said.data?.id !== 'string') console.error('the note on a file not kept was not saved', said.error);
                else thread.push({ id: said.data.id, speakerId: advisorId, text: note, createdAt: str(said.data.created_at) });
              }
            } else if (made.length > 0) {
              console.error(`group speaker ${member.name} made ${made.length} files and wrote no text; they were not kept`);
            }
          } finally {
            await keepTyping.stop();
            await setMemberTyping(client, userId, chatId, advisorId, null).catch(() => undefined);
          }
          if (await personWroteSince(client, userId, chatId, anchor.createdAt)) {
            interrupted = true;
            break;
          }
          if (text && asksPerson(text, advisorId, members)) {
            over = true;
            break;
          }
        }
        state.round += 1;
      }

      const reports = [...spent['group-director'], ...spent['group-speaker']];
      const cost = reports.reduce((sum, r) => sum + (costMicrosFor(r.model, r.usage) ?? 0), 0);
      outcome.costMicros += cost;
      await Promise.all(
        (Object.keys(spent) as GroupSpendOperation[])
          .filter((op) => spent[op].length > 0)
          .map((op) => input.recordSpend(op, spent[op]).catch((error) => console.error(`group spend ${op} not kept`, error))),
      );
      console.info(
        `group-burst chat=${chatId} model=${input.model} messages=${state.spoken.length - spoken.length} rounds=${state.round} ` +
          `interrupted=${interrupted} cost_usd=${(cost / 1e6).toFixed(4)}`,
      );
      if (!interrupted) break;
      // The turn that was in hand may have landed after the new message; it
      // still counts toward the caps, but the bots now answer the person afresh.
      carriedRound = 0;
    }
  };
  try {
    await loop();
  } catch (error) {
    failure = error instanceof Error ? error.message : 'The group could not reply.';
    console.error('group burst failed', error);
  } finally {
    await renewing.stop();
  }
  if (outcome.chained) return outcome;
  await releaseLease(client, userId, chatId, failure).catch((error) => console.error('group burst could not let go', error));
  if (failure) return { ...outcome, error: failure };
  // A message sent as the burst let go found the lease still held; answer it now.
  if (lastAnchorAt && (input.replans ?? 0) < MAX_REPLANS && (await personWroteSince(client, userId, chatId, lastAnchorAt))) {
    const more = await runGroupBurst({ ...input, claimed: false, round: undefined, replans: (input.replans ?? 0) + 1 });
    return {
      messages: outcome.messages + more.messages,
      reactions: outcome.reactions + more.reactions,
      bursts: outcome.bursts + more.bursts,
      chained: more.chained,
      costMicros: outcome.costMicros + more.costMicros,
      ...(more.error ? { error: more.error } : {}),
    };
  }
  return outcome;
}

/** Every file the code made, as unkept for one reason, when not one of them could be read. */
const allUnkept = (made: readonly string[], why: string): UnkeptFile[] => made.map(() => ({ name: 'One file', why }));

/**
 * Keeps the files a speaker's code made under its saved text (plan
 * #3050.3.3), as a direct reply does (lib/you/mentor-reply.ts): each is read
 * through the Files API and kept in core.attachments against the message,
 * whose file_count is then set so an open thread hears it and asks for them.
 * Returns the text naming what could not be kept, or null when all were.
 * Never throws.
 */
async function keepSpeakerFiles(input: {
  client: YouSupabaseClient;
  userId: string;
  chatId: string;
  messageId: string;
  made: readonly string[];
  keep: NonNullable<GroupBurstInput['keepFiles']>;
  anthropic: Pick<Anthropic, 'get'> | null;
}): Promise<string | null> {
  const { client, userId, chatId, messageId, made, keep, anthropic } = input;
  const fetchFailed = 'it could not be fetched from where the code ran';
  if (!anthropic) return madeFilesNote(allUnkept(made, fetchFailed));
  let notKept: UnkeptFile[];
  try {
    const { files, unkept } = await fetchMadeFiles(anthropic, made);
    notKept = unkept;
    if (files.length > 0) {
      try {
        const outcome = await keep(messageId, files);
        notKept = [...unkept, ...outcome.unkept];
        if (outcome.kept.length > 0) {
          // The count is what an open thread hears, to ask for the files.
          const { error } = await client
            .from('advisor_messages')
            .update({ file_count: outcome.kept.length })
            .eq('user_id', userId)
            .eq('chat_id', chatId)
            .eq('id', messageId);
          if (error) console.error('the file count of a group text was not kept', error);
        }
      } catch (error) {
        console.error('the files a group speaker made were not kept', error);
        notKept = [...unkept, ...files.map((file) => ({ name: file.name, why: 'it could not be kept with the text' }))];
      }
    }
  } catch (error) {
    console.error('the files a group speaker made were not read', error);
    notKept = allUnkept(made, fetchFailed);
  }
  return madeFilesNote(notKept);
}

/** Whether the person has written since `after` (an ISO time). */
async function personWroteSince(client: YouSupabaseClient, userId: string, chatId: string, after: string): Promise<boolean> {
  const { data, error } = await client
    .from('advisor_messages')
    .select('id')
    .eq('user_id', userId)
    .eq('chat_id', chatId)
    .eq('role', 'person')
    .gt('created_at', after)
    .limit(1);
  return !error && Array.isArray(data) && data.length > 0;
}
