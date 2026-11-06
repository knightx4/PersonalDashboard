import Anthropic from '@anthropic-ai/sdk';
import { readReport, reportRequest } from '@/lib/core/model-call';
import { MODELS } from '@/lib/core/models';
import { costMicrosFor, usageFrom, type SpendReport } from '@/lib/core/spend/pricing';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { readBrain } from '@/lib/you/board-brain';
import { memoryLayer, personaLayer, READ_LIMITS, type ContextMentor } from '@/lib/you/chat-context-model';
import { memoryOf, type CouncilMemory } from '@/lib/you/council-model';
import { loadGroup } from '@/lib/you/group-chats';
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
import { AskInputError } from '@/lib/ask/db';
import { FIND_PLACES_DEFINITION, FIND_PLACES_TOOL, placesInput, placesToolResult } from '@/lib/ask/places';
import type { PlacesLookupInput, PlacesLookupResult } from '@/lib/you/places-lookup';

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
export type SpeakerInput = { speaker: Speaker; members: BurstMember[]; transcript: string };

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

/** The thread from the person's newest message: that message, and the bots who have spoken since, in order. */
function sinceAnchor(lines: readonly Line[]): { anchor: Line | null; spoken: string[]; lastBot: Line | null } {
  let i = lines.length - 1;
  while (i >= 0 && lines[i].speakerId !== null) i--;
  if (i < 0) return { anchor: null, spoken: [], lastBot: null };
  const after = lines.slice(i + 1);
  return { anchor: lines[i], spoken: after.map((l) => l.speakerId ?? '').filter(Boolean), lastBot: after[after.length - 1] ?? null };
}

async function setMemberTyping(client: YouSupabaseClient, userId: string, chatId: string, advisorId: string, until: number | null) {
  await client
    .from('advisor_chat_members')
    .update({ typing_until: until === null ? null : new Date(until).toISOString() })
    .eq('user_id', userId)
    .eq('chat_id', chatId)
    .eq('advisor_id', advisorId);
}

async function renewLease(client: YouSupabaseClient, userId: string, chatId: string, now: number) {
  await client
    .from('advisor_chats')
    .update({ typing_until: new Date(now + TYPING_LEASE_MS).toISOString() })
    .eq('user_id', userId)
    .eq('id', chatId);
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

/** Each member's persona and memory, as a speaker's system prompt, and a one-line card for the director. */
async function loadCast(
  client: YouSupabaseClient,
  userId: string,
  memberIds: readonly string[],
): Promise<Map<string, { system: string; card: string }>> {
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
    out.set(mentor.id, { system: [personaLayer(mentor).text, remembered].filter(Boolean).join('\n\n'), card });
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
async function placesCall(findPlaces: PlacesFinder, block: Anthropic.ToolUseBlock): Promise<Anthropic.ToolResultBlockParam> {
  const args = block.input && typeof block.input === 'object' ? (block.input as Record<string, unknown>) : {};
  let content: string;
  let isError = false;
  if (block.name !== FIND_PLACES_TOOL) {
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

/**
 * One bot's text. With a places finder it is offered find_places, and may
 * call it up to SPEAKER_MAX_LOOKUPS times before it writes; with none, it
 * writes straight away, so a turn stays short.
 */
export async function speakWithModel(
  anthropic: Anthropic,
  model: string,
  input: SpeakerInput,
  spent: SpendReport[],
  findPlaces?: PlacesFinder,
): Promise<string | null> {
  const others = input.members.filter((m) => m.id !== input.speaker.id).map((m) => m.name);
  const rules = `${SPEAKER_RULES}${findPlaces ? `\n\n${SPEAKER_PLACES_RULES}` : ''}\n\nIn this group with the person: ${others.join(', ')}.`;
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: `The group text so far, oldest first:\n${input.transcript}\n\nWrite your next text as ${input.speaker.name}.` },
  ];
  for (let lookups = 0; ; lookups++) {
    const offer = findPlaces && lookups < SPEAKER_MAX_LOOKUPS;
    const response = await anthropic.messages.create({
      model,
      max_tokens: SPEAKER_MAX_TOKENS,
      system: [
        { type: 'text', text: input.speaker.system },
        { type: 'text', text: rules },
      ],
      // Past the last lookup the tool is still sent, so the turns that used it
      // read, but the model is told to write.
      ...(findPlaces ? { tools: [FIND_PLACES_DEFINITION], tool_choice: offer ? { type: 'auto' as const } : { type: 'none' as const } } : {}),
      messages,
    });
    spent.push({ model, usage: usageFrom(response.usage) });
    const calls = response.content.filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
    if (!findPlaces || !offer || calls.length === 0) {
      const text = response.content.find((c): c is Anthropic.TextBlock => c.type === 'text')?.text ?? '';
      return cleanSpeech(text, input.speaker.name);
    }
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: await Promise.all(calls.map((call) => placesCall(findPlaces, call))) });
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

  const renewing = setInterval(() => {
    renewLease(client, userId, chatId, now()).catch(() => undefined);
  }, TYPING_RENEW_MS);
  let failure: string | null = null;
  let lastAnchorAt: string | null = null;
  const loop = async (): Promise<void> => {
    const group = await loadGroup(client, userId, chatId);
    if (!group || group.members.length === 0) return;
    const members: BurstMember[] = group.members.map((m) => ({ id: m.id, key: m.key, name: m.name }));
    const formerNames = new Map(group.former.map((m) => [m.id, m.name]));
    const cast = await loadCast(client, userId, members.map((m) => m.id));
    const withCards = members.map((m) => ({ ...m, card: cast.get(m.id)?.card ?? '' }));

    let carriedRound = input.round ?? null;
    let answered: string | null = null;
    for (let burst = 0; burst <= MAX_REPLANS; burst++) {
      const lines = await readLines(client, userId, chatId);
      const { anchor, spoken, lastBot } = sinceAnchor(lines);
      if (!anchor || anchor.id === answered) break;
      if (lastBot && carriedRound === null && asksPerson(lastBot.text, lastBot.speakerId ?? '', members)) break;
      outcome.bursts += 1;
      answered = anchor.id;
      lastAnchorAt = anchor.createdAt;
      const spent: Record<GroupSpendOperation, SpendReport[]> = { 'group-director': [], 'group-speaker': [] };
      const state: BurstState = { round: carriedRound ?? (spoken.length > 0 ? 1 : 0), spoken: [...spoken] };
      carriedRound = null;
      const mentioned = mentionedIn(anchor.text, members);
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
          const keepTyping = setInterval(() => {
            setMemberTyping(client, userId, chatId, advisorId, now() + TYPING_LEASE_MS).catch(() => undefined);
          }, TYPING_RENEW_MS);
          let text: string | null = null;
          try {
            text = await speak({ speaker: { ...member, system: persona.system }, members, transcript: transcriptOf(thread, members, formerNames) }, spent['group-speaker']);
            if (text) {
              const wait = turnPauseMs(text) - (now() - turnStarted);
              if (wait > 0) await sleep(wait);
              const saved = await client
                .from('advisor_messages')
                .insert({ user_id: userId, chat_id: chatId, role: 'advisor', kind: 'reply', speaker_id: advisorId, text })
                .select('id, created_at')
                .single();
              if (saved.error || typeof saved.data?.id !== 'string') throw new Error(`A message was written but not saved: ${saved.error?.message ?? 'no row came back'}`);
              thread.push({ id: saved.data.id, speakerId: advisorId, text, createdAt: str(saved.data.created_at) });
              state.spoken.push(advisorId);
              outcome.messages += 1;
            }
          } finally {
            clearInterval(keepTyping);
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
    clearInterval(renewing);
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
