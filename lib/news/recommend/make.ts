import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { NewsOperation } from '@/lib/core/spend/operations';
import { usageFrom, type SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import type { NewsSupabaseClient } from '@/lib/news/db/schema-name';
import { readStories } from '@/lib/news/issues/stories';
import {
  alreadyReceived,
  indexSenders,
  readPicks,
  topicsFor,
  type KnownSender,
  type NewsletterPick,
  type RecommendTopic,
} from './picks';

/**
 * Making the list of free newsletters recommended on the Newsletters tab
 * (plan #944, under #943).
 *
 * One request to Opus with the web search tool (#945 chose searching, so each
 * pick can be checked as still running, free, and signed up to at the link
 * given). It is told which topics to fill, how many of your stories fall under
 * each, and the newsletters you already get, and reports its picks through a
 * tool. The reply is then checked here: a pick you already receive, one with
 * no link, and one under a topic not asked for are all dropped (picks.ts).
 *
 * The list is stored whole in news.recommendations, replacing the last one,
 * and only when the run found something, so a failed reload leaves the old
 * list in place. What the call cost is recorded under 'recommend-newsletters'
 * whether or not its reply was usable.
 */

export const RECOMMEND_MODEL = 'claude-opus-5';

/** The name this call has in core.model_spend. Stable: renaming it splits the history. */
export const RECOMMEND_OPERATION: NewsOperation = 'recommend-newsletters';

const TOOL_NAME = 'report_newsletters';

/** About two searches a topic. */
const MAX_SEARCHES = 24;

/**
 * How many times a turn the server paused (`pause_turn`, after ten rounds of
 * searching) is picked up again before giving up.
 */
const MAX_CONTINUATIONS = 4;

/** Senders named in the prompt. Far above the number anyone subscribes to. */
const MAX_SENDERS = 200;

/** Issues whose stories are counted for the topic tally, newest first. */
const TALLY_ISSUES = 300;

const SYSTEM = `You recommend free email newsletters to one reader, a few for
each news topic you are given.

WHAT COUNTS
- Free to receive by email. A newsletter with a paid tier counts only if the
  free edition is a real newsletter and not a teaser for the paid one.
- Still being sent. Search to check it has published in the last few months.
- Well regarded for the topic: written by people who know the field, or by a
  publication known for it. Never a content farm, a listicle mill, or a
  newsletter that exists to sell a course or a product.

FOR EACH TOPIC give two to four. Fewer good ones beat four middling ones, and
two is enough when only two are worth reading.

LEAVE OUT every newsletter the reader already receives, which you are given by
name and by the domain it arrives from. Leave out anything else from those
domains too.

LEAN TOWARDS WHAT THEY READ. You are told how many of their stories fall under
each topic, and the names of the newsletters they get. Use both to judge the
kind of writing they like, such as short daily briefings or long weekly
analysis, and prefer that kind.

LOCAL. When a local area is named, the Local picks are about that place: its
news, politics or events. Never give Local picks for anywhere else.

FOR EACH PICK
- name: the newsletter's own name.
- publisher: the person or publication that sends it.
- topic: exactly one of the topics you were given.
- reason: one sentence, under twenty words, on why it suits this reader. Say
  what it covers and how often, not that it is excellent.
- link: the page where somebody signs up, as you found it in your search. Leave
  the pick out if you could not find one.`;

/** How many of your stories carry each topic, over your recent issues. */
export type TopicTally = Partial<Record<RecommendTopic, number>>;

export type RecommendInput = {
  topics: readonly RecommendTopic[];
  localArea: string | null;
  senders: readonly KnownSender[];
  tally: TopicTally;
};

function buildPrompt(input: RecommendInput): string {
  const lines = ['Topics to fill, with how many of their stories fell under each:'];
  for (const topic of input.topics) lines.push(`- ${topic}: ${input.tally[topic] ?? 0}`);

  if (input.localArea) lines.push('', `Their local area: ${input.localArea}`);

  const senders = input.senders.slice(0, MAX_SENDERS);
  if (senders.length > 0) {
    lines.push('', 'Newsletters they already receive (name, then the address it comes from):');
    for (const sender of senders) {
      lines.push(`- ${sender.name ?? '(no name)'}, ${sender.email}`);
    }
  } else {
    lines.push('', 'They receive no newsletters yet.');
  }

  lines.push('', `Search, then call ${TOOL_NAME} once with every pick.`);
  return lines.join('\n');
}

const TOOLS = [
  {
    type: 'web_search_20260209',
    name: 'web_search',
    max_uses: MAX_SEARCHES,
  } as unknown as Anthropic.Tool,
  {
    name: TOOL_NAME,
    description: 'Report the recommended newsletters, every topic in one call.',
    input_schema: {
      type: 'object' as const,
      properties: {
        picks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              publisher: { type: 'string' },
              topic: { type: 'string' },
              reason: { type: 'string' },
              link: { type: 'string' },
            },
            required: ['name', 'publisher', 'topic', 'reason', 'link'],
          },
        },
      },
      required: ['picks'],
    },
  },
];

/**
 * Ask the model for picks and check them. Throws when the call fails or the
 * reply holds no report; hands every response's cost to `onSpend` first.
 */
export async function pickNewsletters(
  input: RecommendInput,
  options: { client: Pick<Anthropic, 'messages'>; onSpend: (report: SpendReport) => void },
): Promise<NewsletterPick[]> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: buildPrompt(input) }];

  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn += 1) {
    const response = await options.client.messages.create({
      model: RECOMMEND_MODEL,
      max_tokens: 16_000,
      system: SYSTEM,
      tools: TOOLS,
      messages,
    });
    options.onSpend({ model: RECOMMEND_MODEL, usage: usageFrom(response.usage) });

    const block = response.content.find(
      (content) => content.type === 'tool_use' && content.name === TOOL_NAME,
    );
    if (block && block.type === 'tool_use') {
      const raw = (block.input as { picks?: unknown } | null)?.picks;
      const index = indexSenders(input.senders);
      return readPicks(
        Array.isArray(raw) ? raw.filter((pick) => !isReceived(pick, index)) : [],
        input.topics,
      );
    }

    // Widened: the installed SDK's type predates both of these reasons.
    const stop: string | null = response.stop_reason;
    // Ten rounds of searching end the turn early. Sending it back as it is
    // lets the server carry on where it stopped.
    if (stop === 'pause_turn') {
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }
    if (stop === 'refusal') throw new Error('The model declined to make the list.');
    throw new Error('The search ran but reported no newsletters.');
  }
  throw new Error('The search did not finish.');
}

/** Checked on the raw entry so a pick is dropped before it takes a topic's place. */
function isReceived(entry: unknown, index: ReturnType<typeof indexSenders>): boolean {
  const [pick] = readPicks([entry]);
  return !!pick && alreadyReceived(pick, index);
}

// ---------------------------------------------------------------------------
// Reading what the list is made from
// ---------------------------------------------------------------------------

async function loadSenders(news: NewsSupabaseClient, userId: string): Promise<KnownSender[]> {
  const { data, error } = await news
    .from('senders')
    .select('email, name')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`news: reading your newsletters failed (${error.message})`);
  return (data ?? []).map((row) => ({
    email: String(row.email),
    name: (row.name as string | null) ?? null,
  }));
}

async function loadTally(news: NewsSupabaseClient, userId: string): Promise<TopicTally> {
  const { data, error } = await news
    .from('issues')
    .select('stories')
    .eq('user_id', userId)
    .not('stories', 'is', null)
    .order('received_at', { ascending: false })
    .limit(TALLY_ISSUES);
  if (error) throw new Error(`news: reading your stories failed (${error.message})`);
  const tally: TopicTally = {};
  for (const row of data ?? []) {
    for (const story of readStories(row.stories)) {
      if (!story.topic || story.topic === 'Other') continue;
      tally[story.topic] = (tally[story.topic] ?? 0) + 1;
    }
  }
  return tally;
}

async function loadArea(news: NewsSupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await news
    .from('preferences')
    .select('local_area')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`news: reading your local area failed (${error.message})`);
  return (data?.local_area as string | null | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// The two calls the page makes
// ---------------------------------------------------------------------------

export type StoredRecommendations = { picks: NewsletterPick[]; madeAt: string };

/**
 * The stored list, or null when none has been made. Makes no model call.
 * Throws when the row cannot be read. `news` may be the session client or the
 * service role; the query names the account either way.
 */
export async function loadRecommendations(
  news: NewsSupabaseClient,
  userId: string,
): Promise<StoredRecommendations | null> {
  const { data, error } = await news
    .from('recommendations')
    .select('picks, made_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`news: reading your recommended newsletters failed (${error.message})`);
  if (!data) return null;
  return { picks: readPicks(data.picks), madeAt: String(data.made_at) };
}

export type MakeResult =
  | ({ ok: true } & StoredRecommendations)
  | { ok: false; reason: 'no-key' | 'nothing-found' | 'error'; detail: string };

/**
 * Make a new list and store it in place of the old one. Never throws.
 *
 * On any failure the stored list is left as it was, so a reload that fails
 * still has the previous list to show. A run whose picks are all dropped
 * counts as a failure ('nothing-found') for the same reason. A run takes
 * about a minute, sometimes two, because the model searches for each topic.
 */
export async function makeRecommendations(input: {
  news: NewsSupabaseClient;
  /** Bound to the core schema, for core.model_spend. */
  spend: Pick<CoreSupabaseClient, 'from'>;
  userId: string;
  anthropicApiKey: string | undefined;
  client?: Pick<Anthropic, 'messages'>;
  now?: () => Date;
}): Promise<MakeResult> {
  if (!input.anthropicApiKey && !input.client) {
    return { ok: false, reason: 'no-key', detail: 'ANTHROPIC_API_KEY is not set.' };
  }

  const reports: SpendReport[] = [];
  let picks: NewsletterPick[];
  try {
    const [senders, tally, localArea] = await Promise.all([
      loadSenders(input.news, input.userId),
      loadTally(input.news, input.userId),
      loadArea(input.news, input.userId),
    ]);
    const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
    picks = await pickNewsletters(
      { topics: topicsFor(localArea), localArea, senders, tally },
      { client, onSpend: (report) => reports.push(report) },
    );
  } catch (error) {
    await recordReports(input, reports);
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, reason: 'error', detail: 'Rate limited. Try again shortly.' };
    }
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: 'error', detail: detail || 'Making the list failed.' };
  }
  await recordReports(input, reports);

  if (picks.length === 0) {
    return {
      ok: false,
      reason: 'nothing-found',
      detail: 'The search found no free newsletters you do not already get.',
    };
  }

  // Set explicitly: the column's default applies on insert, not on the update
  // a reload makes.
  const madeAt = (input.now?.() ?? new Date()).toISOString();
  const { error } = await input.news
    .from('recommendations')
    .upsert({ user_id: input.userId, picks, made_at: madeAt }, { onConflict: 'user_id' });
  if (error) {
    return { ok: false, reason: 'error', detail: `Saving the list failed (${error.message}).` };
  }
  return { ok: true, picks, madeAt };
}

async function recordReports(
  input: { spend: Pick<CoreSupabaseClient, 'from'>; userId: string },
  reports: SpendReport[],
): Promise<void> {
  for (const report of reports) {
    await recordSpend(input.spend, input.userId, {
      module: 'news',
      operation: RECOMMEND_OPERATION,
      model: report.model,
      usage: report.usage,
    });
  }
}
