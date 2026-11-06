import type Anthropic from '@anthropic-ai/sdk';
import type { AskToolResult } from '@/lib/ask/db';
import type { DashHandoffTool } from '@/lib/dash/registry';
import type { FireRoutineResult } from '@/lib/feedback/routine';

/**
 * A bot on People making a page in a Claude Code session (plan #2997).
 *
 * When the person asks a bot for something richer than a text ("prepare me
 * something to practise my accounting before tomorrow's interview"), the bot
 * calls `make_page`. That keeps the request in core.dash_handoffs as a
 * `page` hand-off (core migration 0305), starts the Dash backup routine on it
 * with a brief that sends it to .claude/skills/bot-pages, and tells the bot
 * to say it is on it. The model call is only the bot's reply: the page itself
 * is built by the routine, in a session, not on the API.
 *
 * The routine writes one self-contained HTML page into core.files (format
 * `html`), which opens at /goals/files/<id> and in the files list, and posts
 * the link into the same thread as the bot. If it fails, or nothing comes
 * back in time, the bot says so in the thread (you.watch_bot_pages, you
 * migration 0047).
 *
 * This file is the part with no database: the tool, reading its input, the
 * brief, and the steps of starting one, behind ports.
 */

export const MAKE_PAGE_TOOL_NAME = 'make_page';

/** The longest request, title and context kept (dash_handoffs checks, core 0305). */
export const MAX_PAGE_REQUEST = 4000;
export const MAX_PAGE_TITLE = 120;
export const MAX_PAGE_CONTEXT = 12000;

/** When the bot says it is still working, and when it gives up (you.watch_bot_pages). */
export const PAGE_NUDGE_MINUTES = 20;
export const PAGE_GIVE_UP_MINUTES = 90;

export const MAKE_PAGE_TOOL: Anthropic.Tool = {
  name: MAKE_PAGE_TOOL_NAME,
  description:
    'Make the person a page: a practice drill, a quiz, a prep sheet, a study guide, a checklist, a worked example, anything richer than a text. A session builds it as one interactive page, saves it to their files and posts the link in this chat, usually within a few minutes. Use it whenever they ask you to prepare, build or make something like that, instead of writing it out in texts. Call it once per request.',
  input_schema: {
    type: 'object',
    properties: {
      request: {
        type: 'string',
        description:
          'What to make, complete on its own: what it is for, what it covers, how they use it. "An accounting practice drill for tomorrow\'s interview: journal entries, revenue recognition, accruals and month-end close. Each question takes an answer, then reveals the worked answer, with a score at the end."',
      },
      title: {
        type: 'string',
        description: 'A short name for the page, as the files list shows it: "Accounting practice drill".',
      },
      context: {
        type: 'string',
        description:
          'Everything you know that bears on it, from this chat, your memory and your lookups: the role and company, the interview round and date, what the job description asks for, their strengths and gaps, with the ref of each row you looked up. The session reads this before it builds.',
      },
    },
    required: ['request', 'title'],
    additionalProperties: false,
  },
};

/** The tool as the Dash loop offers it: a hand-off, sent to the `handOff` hook. */
export const MAKE_PAGE: DashHandoffTool = { name: MAKE_PAGE_TOOL_NAME, kind: 'handoff', definition: MAKE_PAGE_TOOL };

/** What a bot is told about making pages, after its own rules. */
export const PAGE_RULES = `YOU CAN MAKE PAGES. When they ask you to prepare, build or make them
something richer than a text, such as a practice drill, a quiz, a prep sheet
or a study guide, call make_page with what to make and everything you know
that bears on it. Do not write the page out in texts. Once it is started, say
in one short text, in your own voice, that you are on it and the link will
come here. Never say it is ready: the link arrives later, from you, in this
chat.`;

/** Said to the model once the page is started. */
export const PAGE_STARTED =
  'Started. Say in one short text, in your own voice, that you are on it (something like "OK, I\'m on it") and that the link will come here when it is ready. Do not write the page here and do not say it is done.';

/** Said to the model when this message already has a page being made. */
export const PAGE_ALREADY =
  'A page for this message is already being made. Say in a short text that you are on it and the link will come here.';

/** Said to the model when the page could not be started, with the reason. */
export function pageNotStarted(why: string): string {
  return `The page could not be started: ${why} Tell them in a short text, in your own voice, that it did not work and why, in plain words.`;
}

/** Why no page can be made from here: the routine is not set up, or this is not the owner's account. */
export const NO_PAGES =
  'Pages cannot be made on this deployment yet: the routine that builds them is not set up. Tell them in a sentence that you cannot make pages yet.';

export type PageRequest = { request: string; title: string; context: string | null };

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** The tool's input, or why it cannot be used. */
export function pageRequest(input: unknown): ({ ok: true } & PageRequest) | { ok: false; error: string } {
  const args = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const request = text(args.request);
  const title = text(args.title).replace(/\s+/g, ' ');
  const context = text(args.context);
  if (!request) return { ok: false, error: 'request is missing. Say what to make.' };
  if (!title) return { ok: false, error: 'title is missing. Give the page a short name.' };
  if (request.length > MAX_PAGE_REQUEST) {
    return { ok: false, error: `request is ${request.length} characters; the most is ${MAX_PAGE_REQUEST}.` };
  }
  return {
    ok: true,
    request,
    title: title.slice(0, MAX_PAGE_TITLE),
    // Context is the bot's notes; a long one is cut rather than refused.
    context: context ? context.slice(0, MAX_PAGE_CONTEXT) : null,
  };
}

/** Which bot, in which chat, answering which message of the person's. */
export type PageAsker = {
  advisorId: string;
  advisorName: string;
  chatId: string;
  /** The person's message being answered: one page per message. */
  messageId: string;
  /** The person's own words in that message. */
  asked: string;
  /** The bot's persona as it replied, so the page is written as them. */
  persona: string;
  /** Where the thread opens. */
  href: string;
};

/** Starts a page for the bot in `asker`; what the reply's tool call runs (lib/you/bot-pages-store.ts). */
export type BotPageStarter = (asker: PageAsker, input: unknown) => Promise<AskToolResult>;

/** A page hand-off as kept, before the routine starts. */
export type KeptPage = { id: string };

/**
 * The turn the routine is started with. It names the skill first, since the
 * Dash backup routine also takes Ask's hand-offs, then the row, whose and
 * where; the skill reads everything else from the row by its id.
 */
export function botPageBrief(page: { id: string; title: string; request: string }, asker: Pick<PageAsker, 'advisorName' | 'chatId'>, userId: string): string {
  return [
    'Follow .claude/skills/bot-pages/SKILL.md.',
    '',
    `Bot page ${page.id}`,
    `user_id ${userId}`,
    `chat ${asker.chatId}`,
    `bot ${asker.advisorName}`,
    '',
    `Title: ${page.title}`,
    `Request: ${page.request}`,
  ].join('\n');
}

export type BotPagePorts = {
  /** Keeps the hand-off as pending; null when this message already has one. */
  keep: (asker: PageAsker, page: PageRequest) => Promise<KeptPage | null>;
  /** Starts the routine with the brief. */
  fire: (brief: string) => Promise<FireRoutineResult>;
  /** Records what starting it produced: fired with its run, or failed with why. */
  mark: (id: string, fired: FireRoutineResult) => Promise<void>;
  /** Counts the run in spend. Never throws. */
  count: (id: string) => Promise<void>;
};

/**
 * Start one page: keep it, start the routine, count it, and return what the
 * bot is told. Never throws: a failure comes back as what to tell the person.
 * A page whose routine would not start is marked failed, so the thread is
 * told by the bot (you.tell_bot_page) even if the reply goes wrong.
 */
export async function startBotPage(ports: BotPagePorts, asker: PageAsker, input: unknown, userId: string): Promise<AskToolResult> {
  const parsed = pageRequest(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const page: PageRequest = { request: parsed.request, title: parsed.title, context: parsed.context };
  let kept: KeptPage | null;
  try {
    kept = await ports.keep(asker, page);
  } catch (error) {
    console.error('the page request was not kept', error);
    return { ok: true, rows: [], note: pageNotStarted('the request could not be saved.') };
  }
  if (!kept) return { ok: true, rows: [], note: PAGE_ALREADY };
  let fired: FireRoutineResult;
  try {
    fired = await ports.fire(botPageBrief({ id: kept.id, ...page }, asker, userId));
  } catch (error) {
    fired = { ok: false, error: error instanceof Error ? error.message : 'The routine could not be reached.', status: null, body: null };
  }
  try {
    await ports.mark(kept.id, fired);
  } catch (error) {
    console.error('the page hand-off was not marked', error);
  }
  if (!fired.ok) return { ok: true, rows: [], note: pageNotStarted('the session that builds it would not start.') };
  await ports.count(kept.id).catch((error) => console.error('the page run was not counted', error));
  return { ok: true, rows: [], note: PAGE_STARTED };
}

/** What the person reads when a page fails, in the bot's voice (you.tell_bot_page writes the same). */
export function pageFailedText(error: string | null): string {
  const why = (error ?? '').trim().replace(/\s+/g, ' ');
  return why
    ? `That didn't work, sorry. ${why.endsWith('.') ? why : `${why}.`} Ask me again and I'll have another go.`
    : "That didn't work, sorry. Ask me again and I'll have another go.";
}
