import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '@/lib/core/models';
import { costMicrosFor, usageFrom, type SpendReport } from '@/lib/core/spend/pricing';
import { zoneDay } from '@/lib/core/when';
import { DASH_TOOLS } from '@/lib/dash/registry';
import type { DashFile } from '@/lib/dash/files';
import { runDash, type DashExecutor, type DashVoice } from '@/lib/dash/loop';
import { budgetSlip } from '@/lib/dash/slips';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { chatPrompt, loadChatContext, newestFromPerson, type PromptMessage } from '@/lib/you/chat-context';
import type { ContextMessage } from '@/lib/you/chat-context-model';
import { loadCarryOver } from '@/lib/you/carry-over';
import { MAKE_PAGE, MAKE_PAGE_TOOL_NAME, PAGE_RULES, type BotPageStarter } from '@/lib/you/bot-pages';
import { HAND_OFF, SESSION_RULES, type SessionStarter } from '@/lib/talk/session-handoff';
import { BOT_HANDOFF_RULES, HAND_TO_BOT, HAND_TO_BOT_TOOL_NAME, personWords, type BotPasser } from '@/lib/talk/hand-to-bot';
import {
  peopleActionRules,
  PEOPLE_TOOLS,
  PEOPLE_WEB_RULES,
  peopleActing,
  peopleServerTools,
  replyServerTools,
  type PeopleDash,
} from '@/lib/you/people-actions';
import {
  ACK_AFTER_MS,
  ACK_MAX_TOKENS,
  ACK_RULES,
  ACTING_MAX_TOKENS,
  bubblePauseMs,
  cleanAck,
  MAX_FOLLOW_UPS,
  REPLY_MAX_TOKENS,
  REPLY_RULES,
  replyFailed,
  splitBubbles,
  TYPING_LEASE_MS,
  TYPING_RENEW_MS,
  wholeBubbles,
} from '@/lib/you/mentor-reply-model';
import { keepRenewing, waitForQuiet, waitingLast } from '@/lib/you/reply-turn';
import type { DashChange } from '@/lib/talk/changes';
import { ATTACH_RULES, CHART_ONLY_RULES, claimSlip, falseAttachment, NOTHING_ATTACHED, NOTHING_ATTACHED_CHART_ONLY } from '@/lib/talk/attachment-claim';
import { fetchMadeFiles, madeFilesNote, type MadeFile, type UnkeptFile } from '@/lib/talk/made-files';
import { turnCharts, type DashChart } from '@/lib/talk/chart';
import { SAVED_RULES, turnAttached, type SavedAttachment } from '@/lib/talk/attached';
import { MAX_BUBBLE_CHARTS } from '@/lib/you/chat-threads-model';

export * from '@/lib/you/mentor-reply-model';

/**
 * A mentor replying live to the person's text (plan #2748.4).
 *
 * The send saves the message and claims the chat's typing dots
 * (`claimTyping`), so the thread shows the mentor typing within a second.
 * Then, after the page has its answer, `replyToMentor` reads what the mentor
 * knows (lib/you/chat-context.ts), streams the reply through Dash's loop and
 * saves each bubble as soon as a blank line closes it. With `act` the mentor
 * has Ask Dash's tools and rules, so a text can add a todo or a plan step
 * (plan #2854.2, lib/you/people-actions.ts); without it, only the lookups. Typing is renewed while it works and cleared when it
 * is done. A message sent while the mentor is typing is saved and answered
 * when the reply in hand is finished, by the same run.
 *
 * Texts sent in a row are one turn (plan #2988, lib/you/reply-turn.ts): the
 * run waits, typing, until the person has stopped sending for a moment, then
 * answers every message of theirs no reply has read yet (`delivered_at`
 * empty), wherever it sits in the thread.
 *
 * The claim is the lock: an update that only succeeds when nobody is typing,
 * and a run that dies stops holding it once its lease runs out, so a thread
 * is never stuck waiting for a reply that is not coming.
 */

/**
 * The lookups a mentor may make: every lookup Dash has, the chart among them
 * (plan #3050.2.2), which is drawn under the reply's last bubble.
 */
export const MENTOR_LOOKUPS = DASH_TOOLS.filter((tool) => tool.kind === 'lookup');

export type MentorSpendOperation = 'mentor-reply' | 'mentor-ack';

export type MentorReplyInput = {
  client: YouSupabaseClient;
  userId: string;
  chatId: string;
  /** The account's IANA zone. */
  timeZone: string;
  /** The model the person chose for Dash (dashModelFor). */
  model: string;
  anthropicApiKey: string | null | undefined;
  /** Dash's lookups, run as the person. */
  execute: DashExecutor;
  /**
   * Ask Dash's writes, proposals and paid presses, run as the person (plan
   * #2854.2). Absent: the mentor only looks things up.
   */
  act?: PeopleDash;
  /** Keeps what the calls cost; never throws. */
  recordSpend: (operation: MentorSpendOperation, reports: SpendReport[]) => Promise<void>;
  /** True when the send already claimed the typing dots for this run. */
  claimed?: boolean;
  /**
   * The pictures and PDFs sent with these messages of the person's, read for
   * the model (plan #2974). Absent: the mentor reads the words alone.
   */
  readFiles?: (messageIds: string[]) => Promise<DashFile[]>;
  /**
   * Keeps the files the mentor's code made against the reply's last bubble
   * (plan #3050.3.1), in core.attachments, and says which could not be
   * kept. Present, the mentor is offered code execution and told it can
   * send files; absent, it can draw a chart and send nothing else.
   */
  keepFiles?: (messageId: string, files: MadeFile[]) => Promise<{ kept: unknown[]; unkept: UnkeptFile[] }>;
  /**
   * Starts a page in a Claude Code session (plan #2997), offered to the
   * mentor as make_page. Absent: the mentor cannot make pages.
   */
  makePage?: BotPageStarter;
  /**
   * Hands heavy work to a Claude Code session (plan #3005.2), offered to
   * the mentor as hand_off. Absent: the mentor has no hand_off.
   */
  handOn?: SessionStarter;
  /**
   * Passes a request to another bot on People (plan #3003.2), offered to the
   * mentor as hand_to_bot. Absent: the mentor cannot pass things on.
   */
  passToBot?: BotPasser;
  /** For tests. */
  anthropic?: Anthropic;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** For tests: ACK_AFTER_MS. */
  ackAfterMs?: number;
};

/**
 * A turn that answers a request another bot passed on (plan #3003.3), not
 * a text of the person's. The hand-off's line in the thread is the text the
 * reply hangs from: its changes are kept under it, with their Undo.
 */
export type MentorHandoffTurn = {
  /** The receiving bot's line in its own thread saying what it was passed (you.advisor_messages). */
  anchor: { id: string; createdAt: string };
  /** The hand-off as the reply's last turn: the person's words and the sender's packet. */
  brief: string;
  /** What the bot is told about acting on a hand-off, after its own rules. */
  rules: string;
  /** The bot that passed it on (you.board_advisors id), null for Ask Dash (plan #3095). */
  fromBot?: string | null;
};

/** What a hand-off turn did: the reply's words and every change it made or proposed. */
export type HandoffReplyOutcome = {
  ok: boolean;
  /** Why it did not reply, when it did not. */
  error: string | null;
  /** The reply's text, bubbles joined by blank lines; empty when none was written. */
  reply: string;
  changes: DashChange[];
};

export type MentorReplyOutcome = {
  /** Replies written, one per round. */
  rounds: RoundOutcome[];
  /** Why no reply was written, when none was. */
  error?: string;
};

export type RoundOutcome = {
  bubbles: number;
  acked: boolean;
  /** From the start of the round to the first bubble saved, ack or reply; null when none was. */
  firstBubbleMs: number | null;
  /** What the round's calls cost, in millionths of a dollar. */
  costMicros: number;
  ok: boolean;
};

/**
 * The person's messages the reply answers: those after the mentor last
 * spoke, oldest first. Their files go to the model with the reply's last
 * turn, as Ask sends the newest question's (plan #2974).
 */
export function unansweredFromPerson(messages: readonly Pick<ContextMessage, 'id' | 'role'>[]): string[] {
  const ids: string[] = [];
  for (let i = messages.length - 1; i >= 0 && messages[i].role === 'person'; i -= 1) ids.unshift(messages[i].id);
  return ids;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Show the mentor typing, when nobody else is replying in this chat: true
 * when this caller now holds the reply, false when a reply is already being
 * written. Marks the chat waiting, as the Council's reply state reads it.
 */
export async function claimTyping(client: YouSupabaseClient, userId: string, chatId: string, now: number): Promise<boolean> {
  const at = new Date(now).toISOString();
  const { data, error } = await client
    .from('advisor_chats')
    .update({
      typing_until: new Date(now + TYPING_LEASE_MS).toISOString(),
      reply_status: 'waiting',
      reply_requested_at: at,
      reply_error: null,
    })
    .eq('user_id', userId)
    .eq('id', chatId)
    .or(`typing_until.is.null,typing_until.lt.${at}`)
    .select('id');
  if (error) throw new Error(`The mentor could not start typing: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

/** Renew the dots while they are held: a renewal never puts back a lease already let go (plan #2988). */
async function renewTyping(client: YouSupabaseClient, userId: string, chatId: string, now: number): Promise<void> {
  await client
    .from('advisor_chats')
    .update({ typing_until: new Date(now + TYPING_LEASE_MS).toISOString() })
    .eq('user_id', userId)
    .eq('id', chatId)
    .not('typing_until', 'is', null);
}

async function releaseTyping(
  client: YouSupabaseClient,
  userId: string,
  chatId: string,
  error: string | null,
): Promise<void> {
  await client
    .from('advisor_chats')
    .update({ typing_until: null, reply_status: error ? 'failed' : 'idle', reply_error: error ? error.slice(0, 2000) : null })
    .eq('user_id', userId)
    .eq('id', chatId);
}

/** The person's messages in this chat that no reply has read yet, oldest first (plan #2988). */
export async function waitingFromPerson(client: YouSupabaseClient, userId: string, chatId: string): Promise<{ id: string; createdAt: string }[]> {
  const { data, error } = await client
    .from('advisor_messages')
    .select('id, created_at')
    .eq('user_id', userId)
    .eq('chat_id', chatId)
    .eq('role', 'person')
    .is('delivered_at', null)
    .order('created_at', { ascending: true })
    .limit(50);
  if (error || !Array.isArray(data)) return [];
  return (data as Record<string, unknown>[]).flatMap((r) =>
    typeof r.id === 'string' ? [{ id: r.id, createdAt: typeof r.created_at === 'string' ? r.created_at : '' }] : [],
  );
}

/** When the person last wrote in this chat, for the wait before a reply reads it. */
async function newestFromPersonAt(client: YouSupabaseClient, userId: string, chatId: string): Promise<string | null> {
  const { data, error } = await client
    .from('advisor_messages')
    .select('created_at')
    .eq('user_id', userId)
    .eq('chat_id', chatId)
    .eq('role', 'person')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const at = (data as Record<string, unknown>).created_at;
  return typeof at === 'string' ? at : null;
}

/**
 * Reply to the person's newest messages in this chat, and to any they send
 * while it is replying, up to MAX_FOLLOW_UPS more times. Never throws: a
 * reply that fails leaves the chat marked failed with a sentence saying why.
 */
export async function replyToMentor(input: MentorReplyInput): Promise<MentorReplyOutcome> {
  const { client, userId, chatId } = input;
  const now = input.now ?? Date.now;
  const rounds: RoundOutcome[] = [];
  let claimed = input.claimed === true;
  for (let round = 0; round <= MAX_FOLLOW_UPS; round++) {
    try {
      if (!claimed && !(await claimTyping(client, userId, chatId, now()))) break;
    } catch (error) {
      console.error('mentor reply could not claim the chat', error);
      break;
    }
    claimed = false;
    let answered: string | null = null;
    let failure: string | null = null;
    // The dots are renewed from the claim to the release, the wait for the person included.
    const renewing = keepRenewing(() => renewTyping(client, userId, chatId, now()), TYPING_RENEW_MS);
    try {
      await waitForQuiet(() => newestFromPersonAt(client, userId, chatId), { now, sleep: input.sleep ?? realSleep });
      const outcome = await replyOnce(input);
      answered = outcome.answered;
      failure = outcome.error;
      if (outcome.round) {
        rounds.push(outcome.round);
        console.info(
          `mentor-reply chat=${chatId} model=${input.model} bubbles=${outcome.round.bubbles} acked=${outcome.round.acked} ` +
            `first_bubble_ms=${outcome.round.firstBubbleMs ?? 'none'} cost_usd=${(outcome.round.costMicros / 1e6).toFixed(4)} ok=${outcome.round.ok}`,
        );
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : 'The reply failed.';
      console.error('mentor reply failed', error);
    } finally {
      await renewing.stop();
    }
    try {
      await releaseTyping(client, userId, chatId, failure);
    } catch (error) {
      console.error('mentor reply could not stop typing', error);
    }
    if (failure) return { rounds, error: failure };
    // Anything they sent that this round did not read is answered by the next.
    if (!answered || (await waitingFromPerson(client, userId, chatId)).length === 0) break;
  }
  return { rounds };
}

/**
 * The bot answering a request another bot passed it (plan #3003.3), in its
 * own thread, while the caller holds the typing dots: one reply, with its
 * own tools and rules and the hand-off as the last turn. Releases the dots.
 * Never throws.
 */
export async function replyToHandoff(input: MentorReplyInput & { handoff: MentorHandoffTurn }): Promise<HandoffReplyOutcome> {
  const { client, userId, chatId } = input;
  const now = input.now ?? Date.now;
  const renewing = keepRenewing(() => renewTyping(client, userId, chatId, now()), TYPING_RENEW_MS);
  let outcome: Once | null = null;
  let failure: string | null = null;
  try {
    outcome = await replyOnce(input, input.handoff);
    failure = outcome.error;
    if (outcome.round) {
      console.info(
        `bot-handoff-reply chat=${chatId} model=${input.model} bubbles=${outcome.round.bubbles} ` +
          `cost_usd=${(outcome.round.costMicros / 1e6).toFixed(4)} ok=${outcome.round.ok}`,
      );
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : 'The reply failed.';
    console.error('bot hand-off reply failed', error);
  } finally {
    await renewing.stop();
  }
  try {
    await releaseTyping(client, userId, chatId, failure);
  } catch (error) {
    console.error('bot hand-off reply could not stop typing', error);
  }
  return { ok: !failure, error: failure, reply: outcome?.reply ?? '', changes: outcome?.changes ?? [] };
}

type Once = {
  answered: string | null;
  error: string | null;
  round: RoundOutcome | null;
  /** The reply's text and the changes it made, for a hand-off turn. */
  reply?: string;
  changes?: DashChange[];
};

/**
 * One reply to the newest of the person's messages, while the caller holds
 * the typing dots; or, with `handoff`, to a request another bot passed on.
 */
async function replyOnce(input: MentorReplyInput, handoff: MentorHandoffTurn | null = null): Promise<Once> {
  const { client, userId, chatId, timeZone } = input;
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? realSleep;
  const started = now();
  const at = new Date(started);

  if (!input.anthropicApiKey && !input.anthropic) {
    return { answered: null, error: 'This deployment has no ANTHROPIC_API_KEY, so mentors cannot reply.', round: null };
  }

  const [read, waiting] = await Promise.all([
    loadChatContext(client, userId, chatId, { now: at, timeZone }),
    waitingFromPerson(client, userId, chatId),
  ]);
  // What no reply has read yet goes last, wherever it was saved (plan #2988).
  const ctx = { ...read, messages: waitingLast(read.messages, new Set(waiting.map((w) => w.id))) };
  const prompt = chatPrompt(ctx, { now: at, timeZone });
  // A hand-off is the last turn, after whatever the thread holds (plan #3003.3).
  if (handoff) withLastTurn(prompt.messages, handoff.brief);
  const answering = handoff
    ? { id: handoff.anchor.id, createdAt: handoff.anchor.createdAt, text: handoff.brief }
    : newestFromPerson(ctx.messages);
  if (!answering || prompt.messages[prompt.messages.length - 1]?.role !== 'user') {
    return { answered: null, error: null, round: null };
  }

  // The person's messages reached the mentor, who is reading them now: only
  // those read here, so one saved since is left for the next round. A
  // hand-off turn answers none of theirs, so it marks none.
  const seen = new Date(started).toISOString();
  const readIds = handoff ? [] : ctx.messages.filter((m) => m.role === 'person').map((m) => m.id);
  if (readIds.length > 0) {
    await Promise.all([
      client.from('advisor_messages').update({ delivered_at: seen }).eq('user_id', userId).eq('chat_id', chatId).in('id', readIds).is('delivered_at', null),
      client.from('advisor_messages').update({ read_at: seen }).eq('user_id', userId).eq('chat_id', chatId).in('id', readIds).is('read_at', null),
    ]);
  }

  // What was sent with the messages being answered; a reply still goes when they cannot be read.
  let files: DashFile[] | undefined;
  if (input.readFiles && !handoff) {
    try {
      const read = await input.readFiles(unansweredFromPerson(ctx.messages));
      if (read.length > 0) files = read;
    } catch (error) {
      console.error('the files sent to a mentor were not read', error);
    }
  }

  const anthropic = input.anthropic ?? new Anthropic({ apiKey: input.anthropicApiKey ?? undefined });
  const spent: Record<MentorSpendOperation, SpendReport[]> = { 'mentor-reply': [], 'mentor-ack': [] };
  const name = ctx.mentor.name;

  // Saves run one after another, so bubbles land in order with their pauses.
  let chain: Promise<void> = Promise.resolve();
  let saved = 0;
  let lastSavedAt = 0;
  let firstBubbleMs: number | null = null;
  let saveError: string | null = null;
  // The last reply bubble saved, so a chart drawn after it streamed can be put on it.
  let lastReplyId: string | null = null;
  // Set once the reply is in: a first text that comes back later is dropped.
  let closed = false;
  const save = (text: string, kind: 'reply' | 'ack', charts: DashChart[] = [], attached: SavedAttachment[] = []) => {
    chain = chain.then(async () => {
      if (saveError) return;
      if (saved > 0) {
        const wait = bubblePauseMs(text) - (now() - lastSavedAt);
        if (wait > 0) await sleep(wait);
      }
      const { data, error } = await client
        .from('advisor_messages')
        .insert({
          user_id: userId,
          chat_id: chatId,
          role: 'advisor',
          kind,
          text,
          ...(charts.length > 0 ? { charts } : {}),
          ...(attached.length > 0 ? { attached } : {}),
        })
        .select('id')
        .single();
      if (error) {
        saveError = `A reply was written but not saved: ${error.message}`;
        return;
      }
      if (kind === 'reply' && typeof data?.id === 'string') lastReplyId = data.id;
      saved += 1;
      lastSavedAt = now();
      if (firstBubbleMs === null) firstBubbleMs = lastSavedAt - started;
      await renewTyping(client, userId, chatId, lastSavedAt).catch(() => undefined);
    });
  };

  // The first text, when nothing is written three seconds in.
  let draft = '';
  let queued = 0;
  let acked = false;
  const acking = new AbortController();
  const ackTimer = setTimeout(() => {
    // A hand-off has nobody waiting on a first text.
    if (handoff || draft || queued > 0) return;
    void firstText(anthropic, ctx.layers.persona.text, prompt.messages, acking.signal, spent['mentor-ack']).then((text) => {
      if (!text || closed || draft || queued > 0) return;
      acked = true;
      save(text, 'ack');
    });
  }, input.ackAfterMs ?? ACK_AFTER_MS);

  // Whatever the mentor changes is kept under the text being answered, naming them.
  const threadHref = `/chat/people/${ctx.mentor.key}`;
  const acting = input.act
    ? peopleActing(input.act, {
        advisorId: ctx.mentor.id,
        chatId,
        messageId: answering.id,
        href: threadHref,
        ...(handoff?.fromBot ? { fromBot: handoff.fromBot } : {}),
      })
    : null;
  // A page is made in a session, not in this turn (plan #2997): the tool keeps it and the mentor says it is on it.
  // Heavy work goes to a session the same way (plan #3005.2): hand_off keeps it and the mentor says it is on it.
  // A request for another bot is kept for that bot (plan #3003.2): the mentor says it is passed on.
  const makePage = input.makePage;
  const handOn = input.handOn;
  const passBot = input.passToBot;
  const handOff =
    makePage || handOn || passBot
      ? (args: unknown, seen: (table: string, ref: string) => boolean, tool: { name: string }) => {
          if (tool.name === HAND_TO_BOT_TOOL_NAME && passBot) {
            const unanswered = new Set(unansweredFromPerson(ctx.messages));
            return passBot(
              {
                fromBot: ctx.mentor.id,
                source: { kind: 'direct', chatId, botKey: ctx.mentor.key },
                messageId: answering.id,
                asked: personWords(ctx.messages.filter((m) => unanswered.has(m.id)).map((m) => m.text)) || answering.text,
              },
              args,
              seen,
            );
          }
          if (tool.name === MAKE_PAGE_TOOL_NAME && makePage) {
            return makePage(
              {
                advisorId: ctx.mentor.id,
                advisorName: name,
                chatId,
                messageId: answering.id,
                asked: answering.text,
                persona: ctx.layers.persona.text,
                href: threadHref,
              },
              args,
            );
          }
          if (!handOn) return Promise.resolve({ ok: false as const, error: `There is no tool called ${tool.name}.` });
          return handOn(
            {
              thread: { kind: 'chat', chatId, advisorId: ctx.mentor.id },
              messageId: answering.id,
              asked: answering.text,
              botName: name,
              href: threadHref,
            },
            args,
            seen,
          );
        }
      : undefined;
  const voice: DashVoice = {
    model: input.model,
    system: [
      ctx.layers.persona.text,
      REPLY_RULES,
      input.keepFiles ? ATTACH_RULES : CHART_ONLY_RULES,
      SAVED_RULES,
      PEOPLE_WEB_RULES,
      ...(acting ? [peopleActionRules(Boolean(handOn))] : []),
      ...(makePage ? [PAGE_RULES] : []),
      ...(handOn ? [SESSION_RULES] : []),
      ...(passBot ? [BOT_HANDOFF_RULES] : []),
      ...(handoff ? [handoff.rules] : []),
    ].join('\n\n'),
    tools: [
      ...(acting ? PEOPLE_TOOLS : MENTOR_LOOKUPS),
      ...(makePage ? [MAKE_PAGE] : []),
      ...(handOn ? [HAND_OFF] : []),
      ...(passBot ? [HAND_TO_BOT] : []),
    ],
    // Code runs only where what it makes is kept (plan #3050.3.1).
    serverTools: input.keepFiles ? replyServerTools(input.model) : peopleServerTools(input.model),
    // A change's input needs room a text does not (ACTING_MAX_TOKENS, plan #2999).
    maxTokens: acting ? ACTING_MAX_TOKENS : REPLY_MAX_TOKENS,
    // A reply that reaches a limit gets one more stretch to make the change it was asked for.
    extend: acting !== null,
  };
  // What the mentor heard in its groups and has not yet folded into memory (plan #2983); a reply still goes without it.
  let carried = '';
  try {
    carried = (await loadCarryOver(client, userId, [ctx.mentor.id], chatId, { where: 'direct', now: at, timeZone })).get(ctx.mentor.id) ?? '';
  } catch (error) {
    console.error('a mentor reply could not read its other chats', error);
  }
  const rest = [
    ...(['memory', 'episodes'] as const).map((layer) => ctx.layers[layer].text),
    carried,
    ...(['recall', 'live'] as const).map((layer) => ctx.layers[layer].text),
  ].filter(Boolean);

  let answer: Awaited<ReturnType<typeof runDash>>;
  try {
    answer = await runDash({
      voice,
      context: { surface: 'thread', subject: null, page: null },
      turns: prompt.messages.map((m: PromptMessage) => ({ role: m.role, body: m.content })),
      files,
      today: zoneDay(at, timeZone),
      contextBlocks: rest,
      execute: input.execute,
      ...(acting ? { write: acting.write, propose: acting.propose, queue: acting.queue } : {}),
      ...(handOff ? { handOff } : {}),
      anthropicApiKey: input.anthropicApiKey ?? '',
      client: anthropic,
      onSpend: (report) => spent['mentor-reply'].push(report),
      onText: (piece) => {
        draft += piece;
        if (draft.trim()) acking.abort();
        const whole = wholeBubbles(draft);
        for (; queued < whole.length; queued++) save(whole[queued], 'reply');
      },
    });
  } finally {
    clearTimeout(ackTimer);
  }

  // A reply that reached its limit is kept as a slip for Dev Home's count (plan #2999).
  const slip = answer.ok ? budgetSlip(answer, name) : null;
  if (slip && input.act?.recordSlip) {
    await input.act.recordSlip({ ...slip, surface: 'people', conversation: `people:${chatId}`, href: threadHref });
  }

  const bubbles = answer.ok ? splitBubbles(answer.body) : [];
  // What show_chart drew goes on the reply's last bubble (plan #3050.2.2), never in its text.
  const charts = answer.ok ? turnCharts(answer.toolCalls).slice(0, MAX_BUBBLE_CHARTS) : [];
  // A saved page or file it attached by reference goes there too, as a card (plan #3050.4).
  const attached = answer.ok ? turnAttached(answer.toolCalls) : [];
  const unsaved = bubbles.length - queued;
  for (; queued < bubbles.length; queued++) {
    const last = queued === bubbles.length - 1;
    save(bubbles[queued], 'reply', last ? charts : [], last ? attached : []);
  }
  closed = true;
  acking.abort();
  await chain;
  // Every bubble went while the text streamed: the charts go on the last of them now.
  if ((charts.length > 0 || attached.length > 0) && unsaved <= 0 && lastReplyId && !saveError) {
    const { error } = await client
      .from('advisor_messages')
      .update({ ...(charts.length > 0 ? { charts } : {}), ...(attached.length > 0 ? { attached } : {}) })
      .eq('user_id', userId)
      .eq('chat_id', chatId)
      .eq('id', lastReplyId);
    if (error) console.error('the charts and cards of a reply were not kept', error);
  }

  // What the mentor's code made goes under the reply's last bubble (plan #3050.3.1);
  // what could not be kept is said in a text of its own.
  const made = answer.ok && !saveError && input.keepFiles ? (answer.madeFiles ?? []) : [];
  if (made.length > 0 && input.keepFiles) {
    const { files, unkept } = await fetchMadeFiles(anthropic, made);
    let notKept: UnkeptFile[] = unkept;
    if (files.length > 0 && lastReplyId) {
      try {
        const outcome = await input.keepFiles(lastReplyId, files);
        notKept = [...unkept, ...outcome.unkept];
        if (outcome.kept.length > 0) {
          // The count is what an open thread hears, to ask for the files.
          const { error } = await client
            .from('advisor_messages')
            .update({ file_count: outcome.kept.length })
            .eq('user_id', userId)
            .eq('chat_id', chatId)
            .eq('id', lastReplyId);
          if (error) console.error('the file count of a reply was not kept', error);
        }
      } catch (error) {
        console.error('the files a mentor made were not kept', error);
        notKept = [...unkept, ...files.map((file) => ({ name: file.name, why: 'it could not be kept with the reply' }))];
      }
    } else if (files.length > 0) {
      notKept = [...unkept, ...files.map((file) => ({ name: file.name, why: 'the reply it went with was not saved' }))];
    }
    const note = madeFilesNote(notKept);
    if (note) {
      save(note, 'reply');
      await chain;
    }
  }

  // A reply that says a file is attached when nothing was sent says so after all (plan #3050.1).
  // A chart it drew counts as sent; a file it names still does not (plan #3050.2.2).
  // A file its code made is said for above (plan #3050.3.1).
  // A saved page or file it attached counts as sent (plan #3050.4).
  const claim = answer.ok && !saveError ? falseAttachment(bubbles.join('\n\n'), charts.length, made.length + attached.length) : null;
  if (claim) {
    save(input.keepFiles ? NOTHING_ATTACHED : NOTHING_ATTACHED_CHART_ONLY, 'reply');
    await chain;
    if (input.act?.recordSlip) {
      await input.act
        .recordSlip({ ...claimSlip(name, claim), surface: 'people', conversation: `people:${chatId}`, href: threadHref })
        .catch((error) => console.error('the attachment slip was not kept', error));
    }
  }

  await Promise.all(
    (Object.keys(spent) as MentorSpendOperation[])
      .filter((op) => spent[op].length > 0)
      .map((op) => input.recordSpend(op, spent[op]).catch((error) => console.error(`mentor spend ${op} not kept`, error))),
  );
  const costMicros = [...spent['mentor-reply'], ...spent['mentor-ack']].reduce(
    (sum, report) => sum + (costMicrosFor(report.model, report.usage) ?? 0),
    0,
  );

  const ok = answer.ok && bubbles.length > 0 && !saveError;
  const round: RoundOutcome = { bubbles: saved, acked, firstBubbleMs, costMicros, ok };
  const did = { reply: bubbles.join('\n\n'), changes: acting ? [...acting.changes] : [] };
  if (saveError) return { answered: answering.createdAt, error: saveError, round, ...did };
  if (!answer.ok) return { answered: answering.createdAt, error: replyFailed(name, answer.detail), round, ...did };
  if (bubbles.length === 0) return { answered: answering.createdAt, error: replyFailed(name, 'the reply came back empty.'), round, ...did };
  return { answered: answering.createdAt, error: null, round, ...did };
}

/** Adds a user turn at the end, joined to the last one when that is the person's. */
function withLastTurn(messages: PromptMessage[], text: string): void {
  const last = messages[messages.length - 1];
  if (last?.role === 'user') last.content = `${last.content}\n\n${text}`;
  else messages.push({ role: 'user', content: text });
}

/**
 * The mentor's one-line first text, from a small fast model reading their
 * persona and the last few messages; null when it fails or is no longer
 * wanted.
 */
async function firstText(
  anthropic: Anthropic,
  persona: string,
  messages: readonly PromptMessage[],
  signal: AbortSignal,
  spent: SpendReport[],
): Promise<string | null> {
  const tail = messages.slice(-4);
  while (tail.length && tail[0].role !== 'user') tail.shift();
  if (!tail.length || signal.aborted) return null;
  try {
    const response = await anthropic.messages.create(
      {
        model: MODELS.mentorAck,
        max_tokens: ACK_MAX_TOKENS,
        system: [
          { type: 'text', text: persona },
          { type: 'text', text: ACK_RULES },
        ],
        messages: tail.map((m) => ({ role: m.role, content: m.content })),
      },
      { signal },
    );
    spent.push({ model: MODELS.mentorAck, usage: usageFrom(response.usage) });
    const text = response.content.find((c): c is Anthropic.TextBlock => c.type === 'text')?.text ?? '';
    // A first text stopped at its token cap ends part-way through; only its whole sentences are kept.
    return cleanAck(text, response.stop_reason === 'max_tokens');
  } catch (error) {
    if (!signal.aborted) console.error('mentor first text failed', error);
    return null;
  }
}
