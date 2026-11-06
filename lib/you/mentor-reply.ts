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
import { MAKE_PAGE, PAGE_RULES, type BotPageStarter } from '@/lib/you/bot-pages';
import {
  PEOPLE_ACTION_RULES,
  PEOPLE_TOOLS,
  PEOPLE_WEB_RULES,
  peopleActing,
  peopleServerTools,
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
 * The claim is the lock: an update that only succeeds when nobody is typing,
 * and a run that dies stops holding it once its lease runs out, so a thread
 * is never stuck waiting for a reply that is not coming.
 */

/** The lookups a mentor may make: every lookup Dash has, except the chart, which only Ask draws. */
export const MENTOR_LOOKUPS = DASH_TOOLS.filter((tool) => tool.kind === 'lookup' && tool.name !== 'show_chart');

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
   * Starts a page in a Claude Code session (plan #2997), offered to the
   * mentor as make_page. Absent: the mentor cannot make pages.
   */
  makePage?: BotPageStarter;
  /** For tests. */
  anthropic?: Anthropic;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** For tests: ACK_AFTER_MS. */
  ackAfterMs?: number;
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

async function renewTyping(client: YouSupabaseClient, userId: string, chatId: string, now: number): Promise<void> {
  await client
    .from('advisor_chats')
    .update({ typing_until: new Date(now + TYPING_LEASE_MS).toISOString() })
    .eq('user_id', userId)
    .eq('id', chatId);
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
    try {
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
    }
    try {
      await releaseTyping(client, userId, chatId, failure);
    } catch (error) {
      console.error('mentor reply could not stop typing', error);
    }
    if (failure) return { rounds, error: failure };
    if (!answered || !(await personWroteSince(client, userId, chatId, answered))) break;
  }
  return { rounds };
}

type Once = { answered: string | null; error: string | null; round: RoundOutcome | null };

/** One reply to the newest of the person's messages, while the caller holds the typing dots. */
async function replyOnce(input: MentorReplyInput): Promise<Once> {
  const { client, userId, chatId, timeZone } = input;
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? realSleep;
  const started = now();
  const at = new Date(started);

  if (!input.anthropicApiKey && !input.anthropic) {
    return { answered: null, error: 'This deployment has no ANTHROPIC_API_KEY, so mentors cannot reply.', round: null };
  }

  const ctx = await loadChatContext(client, userId, chatId, { now: at, timeZone });
  const prompt = chatPrompt(ctx, { now: at, timeZone });
  const answering = newestFromPerson(ctx.messages);
  if (!answering || prompt.messages[prompt.messages.length - 1]?.role !== 'user') {
    return { answered: null, error: null, round: null };
  }

  // The person's messages reached the mentor, who is reading them now.
  const seen = new Date(started).toISOString();
  await Promise.all([
    client.from('advisor_messages').update({ delivered_at: seen }).eq('user_id', userId).eq('chat_id', chatId).eq('role', 'person').is('delivered_at', null),
    client.from('advisor_messages').update({ read_at: seen }).eq('user_id', userId).eq('chat_id', chatId).eq('role', 'person').is('read_at', null),
  ]);

  // What was sent with the messages being answered; a reply still goes when they cannot be read.
  let files: DashFile[] | undefined;
  if (input.readFiles) {
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
  // Set once the reply is in: a first text that comes back later is dropped.
  let closed = false;
  const save = (text: string, kind: 'reply' | 'ack') => {
    chain = chain.then(async () => {
      if (saveError) return;
      if (saved > 0) {
        const wait = bubblePauseMs(text) - (now() - lastSavedAt);
        if (wait > 0) await sleep(wait);
      }
      const { error } = await client
        .from('advisor_messages')
        .insert({ user_id: userId, chat_id: chatId, role: 'advisor', kind, text });
      if (error) {
        saveError = `A reply was written but not saved: ${error.message}`;
        return;
      }
      saved += 1;
      lastSavedAt = now();
      if (firstBubbleMs === null) firstBubbleMs = lastSavedAt - started;
      await renewTyping(client, userId, chatId, lastSavedAt).catch(() => undefined);
    });
  };

  const renewing = setInterval(() => {
    renewTyping(client, userId, chatId, now()).catch(() => undefined);
  }, TYPING_RENEW_MS);

  // The first text, when nothing is written three seconds in.
  let draft = '';
  let queued = 0;
  let acked = false;
  const acking = new AbortController();
  const ackTimer = setTimeout(() => {
    if (draft || queued > 0) return;
    void firstText(anthropic, ctx.layers.persona.text, prompt.messages, acking.signal, spent['mentor-ack']).then((text) => {
      if (!text || closed || draft || queued > 0) return;
      acked = true;
      save(text, 'ack');
    });
  }, input.ackAfterMs ?? ACK_AFTER_MS);

  // Whatever the mentor changes is kept under the text being answered, naming them.
  const threadHref = `/chat/people/${ctx.mentor.key}`;
  const acting = input.act
    ? peopleActing(input.act, { advisorId: ctx.mentor.id, chatId, messageId: answering.id, href: threadHref })
    : null;
  // A page is made in a session, not in this turn (plan #2997): the tool keeps it and the mentor says it is on it.
  const makePage = input.makePage;
  const handOff = makePage
    ? (args: unknown) =>
        makePage(
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
        )
    : undefined;
  const voice: DashVoice = {
    model: input.model,
    system: [
      ctx.layers.persona.text,
      REPLY_RULES,
      PEOPLE_WEB_RULES,
      ...(acting ? [PEOPLE_ACTION_RULES] : []),
      ...(makePage ? [PAGE_RULES] : []),
    ].join('\n\n'),
    tools: [...(acting ? PEOPLE_TOOLS : MENTOR_LOOKUPS), ...(makePage ? [MAKE_PAGE] : [])],
    serverTools: peopleServerTools(input.model),
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
  for (; queued < bubbles.length; queued++) save(bubbles[queued], 'reply');
  closed = true;
  acking.abort();
  await chain;
  clearInterval(renewing);

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
  if (saveError) return { answered: answering.createdAt, error: saveError, round };
  if (!answer.ok) return { answered: answering.createdAt, error: replyFailed(name, answer.detail), round };
  if (bubbles.length === 0) return { answered: answering.createdAt, error: replyFailed(name, 'the reply came back empty.'), round };
  return { answered: answering.createdAt, error: null, round };
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
    return cleanAck(text);
  } catch (error) {
    if (!signal.aborted) console.error('mentor first text failed', error);
    return null;
  }
}
