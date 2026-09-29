import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { loadGraph } from '@/lib/learn/graph/load';
import { isRooted, rootingFor, type Rooting } from '@/lib/learn/graph/rooting';
import {
  fetchYouTubeChannel,
  parseChannelInput,
  searchYouTubeChannels,
  SEARCH_QUOTA_UNITS,
  type YouTubeChannel,
  type YouTubeChannelHit,
  type YouTubeFailure,
} from '@/lib/learn/providers/youtube';
import { loadChannels } from './library';

/**
 * Finding the YouTube channels people recommend for a subject (plan #1195,
 * under #1185).
 *
 * One Sonnet call with web search is given the subject's name and note and
 * what Learn knows of your level in it, and names up to five channels with a
 * handle and the reason each is recommended. Each is then found on YouTube:
 * by its handle through `channels.list` (1 quota unit), or, when it came
 * without a handle that works, by name through `search.list` (100 units, then
 * 1 more to read the channel it found). At most MAX_CHANNEL_SEARCHES of those,
 * so a subject costs at most about 400 units here and leaves room for the
 * sampling in #1196 inside the feature's 500.
 *
 * Channels you already follow and channels already stored for the subject are
 * dropped, including passed and unfollowed ones, whose rows stay so they are
 * not suggested again. The rest are written to learn.subject_channels with no
 * verdict; judging them is #1196.
 *
 * Nothing here throws for an ordinary failure. A missing key, a quota refusal
 * or a search that found nothing comes back as a named failure carrying the
 * channels written before it happened, so the page can say how far it got.
 */

export const FIND_CHANNELS_MODEL = 'claude-sonnet-5';

/** Channels asked for and written per search. */
export const MAX_CHANNELS = 5;

/** `search.list` calls allowed per subject, at 100 quota units each. */
export const MAX_CHANNEL_SEARCHES = 4;

const MAX_WEB_SEARCHES = 6;
/** Channels named in the prompt as already known, before it stops being read. */
const MAX_EXCLUDED = 40;
const MAX_WHY = 600;
const TOOL_NAME = 'report_channels';

const SYSTEM = `You are given a subject somebody is studying, in their own words, and what is
known of their level in it. Find the YouTube channels that people who know the
subject recommend for learning it.

SEARCH FOR RECOMMENDATIONS, not for channels. Look for where learners and
teachers of this subject say which channels taught them well: forum threads,
course pages, reading lists, well-regarded blogs. A channel recommended by
several independent sources for this subject beats one that is merely large.

FIT THEIR LEVEL. Prefer channels that teach the subject at the depth they are
at, starting from what they already know. A channel of research talks is no
use to somebody at the start; a channel of beginner explainers is no use to
somebody who has the basics settled.

THE CHANNEL MUST TEACH THIS SUBJECT. A general science or education channel
counts only if it has a substantial run of videos on this subject. Never
return a channel whose purpose is to sell a course, a reaction or compilation
channel, or a channel you cannot tie to a real recommendation.

FOR EACH CHANNEL
- name: the channel's name as YouTube shows it.
- handle: its @handle, exactly as it appears in its URL
  (youtube.com/@handle), or null if you did not see one. Never guess a handle.
- why: one or two sentences on who recommends it and what it does well for
  this subject at their level. This is shown to the reader, so never imply you
  checked something you did not.

Up to ${MAX_CHANNELS} channels, best first. Fewer is fine. If nothing
recommended turns up, report an empty list rather than filling it.`;

export type ChannelRef = { handle: string } | { channelId: string };

export type RecommendedChannel = {
  name: string;
  /** Null when the recommendation named no handle that parses. */
  ref: ChannelRef | null;
  why: string;
};

const reportSchema = z.object({
  channels: z
    .array(
      z.object({
        name: z.string(),
        handle: z.string().nullish(),
        why: z.string().nullish(),
      }),
    )
    .default([]),
});

function key(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function refKey(ref: ChannelRef): string {
  return 'handle' in ref ? `h:${ref.handle.toLowerCase()}` : `c:${ref.channelId}`;
}

/**
 * The model's report as channels to look up, or null when it is malformed.
 *
 * A handle is accepted as `@name`, bare `name` or a channel link; anything
 * else is dropped to null, and the channel is looked up by name instead.
 * Repeats are dropped and the list is cut to MAX_CHANNELS.
 */
export function readRecommendations(input: unknown): RecommendedChannel[] | null {
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) return null;

  const out: RecommendedChannel[] = [];
  const seen = new Set<string>();
  for (const channel of parsed.data.channels) {
    const name = channel.name.trim();
    if (!name) continue;

    const rawHandle = channel.handle?.trim();
    const input = rawHandle ? parseChannelInput(rawHandle) : null;
    const ref: ChannelRef | null = input?.ok ? ('handle' in input ? { handle: input.handle } : { channelId: input.channelId }) : null;

    const keys = [`n:${key(name)}`, ...(ref ? [refKey(ref)] : [])];
    if (keys.some((k) => seen.has(k))) continue;
    for (const k of keys) seen.add(k);

    const why = (channel.why ?? '').trim().slice(0, MAX_WHY);
    out.push({ name, ref, why: why || `Recommended for this subject.` });
    if (out.length === MAX_CHANNELS) break;
  }
  return out;
}

export function rootingLines(rooting: Rooting): string[] {
  if (!isRooted(rooting)) {
    return [
      '',
      'Learn has no record yet of what they know in this subject, so assume',
      'nothing and favour channels that start from the ground.',
    ];
  }
  const lines = ['', 'What they have already settled in this subject:'];
  for (const claim of rooting.settled) lines.push(`- ${claim}`);
  if (rooting.settledOmitted > 0) lines.push(`- …and ${rooting.settledOmitted} more.`);
  if (rooting.frontier.length > 0) {
    lines.push('', 'What they are ready to take on next:');
    for (const claim of rooting.frontier) lines.push(`- ${claim}`);
  }
  return lines;
}

export function buildChannelPrompt(input: {
  subject: string;
  note: string | null;
  rooting: Rooting;
  known: string[];
}): string {
  const lines = [`Subject: ${input.subject}`];
  if (input.note?.trim()) lines.push('', `Their note on it: ${input.note.trim()}`);
  lines.push(...rootingLines(input.rooting));
  if (input.known.length > 0) {
    lines.push('', 'They already know of these channels, so do not name them again:');
    for (const name of input.known.slice(0, MAX_EXCLUDED)) lines.push(`- ${name}`);
  }
  lines.push('', `Search, then call ${TOOL_NAME}.`);
  return lines.join('\n');
}

export type RecommendResult =
  | { ok: true; channels: RecommendedChannel[] }
  | { ok: false; reason: 'search-failed'; detail: string };

/** The one model call: up to five recommended channels. Never throws. */
export async function recommendChannels(input: {
  prompt: string;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<RecommendResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  let response;
  try {
    response = await client.messages.create({
      model: FIND_CHANNELS_MODEL,
      max_tokens: 4096,
      system: SYSTEM,
      tools: [
        {
          type: 'web_search_20260209',
          name: 'web_search',
          max_uses: MAX_WEB_SEARCHES,
        } as unknown as Anthropic.Tool,
        {
          name: TOOL_NAME,
          description: 'Report the recommended YouTube channels for this subject, best first.',
          input_schema: {
            type: 'object',
            properties: {
              channels: {
                type: 'array',
                maxItems: MAX_CHANNELS,
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    handle: { type: ['string', 'null'] },
                    why: { type: 'string' },
                  },
                  required: ['name', 'handle', 'why'],
                },
              },
            },
            required: ['channels'],
          },
        },
      ],
      messages: [{ role: 'user', content: input.prompt }],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, reason: 'search-failed', detail: 'Rate limited. Try again shortly.' };
    }
    return {
      ok: false,
      reason: 'search-failed',
      detail: error instanceof Error ? error.message : 'The search failed.',
    };
  }

  // Before the reply is read: a malformed answer still cost what it cost.
  input.onSpend?.({ model: FIND_CHANNELS_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') {
    return { ok: false, reason: 'search-failed', detail: 'The search ran but reported no channels.' };
  }
  const channels = readRecommendations(block.input);
  if (!channels) return { ok: false, reason: 'search-failed', detail: 'The channels came back malformed.' };
  return { ok: true, channels };
}

// ---------------------------------------------------------------------------
// Finding each recommended channel on YouTube.
// ---------------------------------------------------------------------------

export type ChannelLookup = {
  byRef(ref: ChannelRef): Promise<({ ok: true } & YouTubeChannel) | YouTubeFailure>;
  search(name: string): Promise<({ ok: true; channels: YouTubeChannelHit[] }) | YouTubeFailure>;
};

const youtubeLookup: ChannelLookup = {
  byRef: (ref) => fetchYouTubeChannel(ref),
  search: (name) => searchYouTubeChannels(name),
};

export type ResolvedChannel = {
  channelId: string;
  title: string;
  handle: string | null;
  why: string;
};

export type Resolution = {
  resolved: ResolvedChannel[];
  /** Names YouTube did not find, or that were left once the searches ran out. */
  unresolved: string[];
  /** Why resolving stopped early: a missing key, a quota refusal, an error. */
  failure: YouTubeFailure | null;
  quotaUnits: number;
};

/** The hit whose name matches the recommendation, or the first. */
export function pickHit(name: string, hits: YouTubeChannelHit[]): YouTubeChannelHit | null {
  return hits.find((hit) => key(hit.title) === key(name)) ?? hits[0] ?? null;
}

/**
 * Look each recommendation up, in order.
 *
 * A handle that YouTube does not know falls back to a search by name, as a
 * recommendation with no handle does. Anything but not-found stops the run:
 * a quota refusal or a missing key will answer every later call the same way.
 * `skip` is asked before any quota is spent, and again once the channel id is
 * known.
 */
export async function resolveRecommendations(
  recommendations: RecommendedChannel[],
  options: {
    lookup?: ChannelLookup;
    maxSearches?: number;
    skip?: (candidate: { handle?: string; channelId?: string }) => boolean;
  } = {},
): Promise<Resolution> {
  const lookup = options.lookup ?? youtubeLookup;
  let searchesLeft = options.maxSearches ?? MAX_CHANNEL_SEARCHES;
  const skip = options.skip ?? (() => false);
  const result: Resolution = { resolved: [], unresolved: [], failure: null, quotaUnits: 0 };
  const taken = new Set<string>();

  const accept = (rec: RecommendedChannel, channel: YouTubeChannel) => {
    if (taken.has(channel.channelId)) return;
    if (skip({ channelId: channel.channelId, handle: channel.handle ?? undefined })) return;
    taken.add(channel.channelId);
    result.resolved.push({ channelId: channel.channelId, title: channel.title, handle: channel.handle, why: rec.why });
  };

  for (const rec of recommendations) {
    if (rec.ref && skip('handle' in rec.ref ? { handle: rec.ref.handle } : { channelId: rec.ref.channelId })) continue;

    if (rec.ref) {
      const found = await lookup.byRef(rec.ref);
      result.quotaUnits += 1;
      if (found.ok) {
        accept(rec, found);
        continue;
      }
      if (found.reason !== 'not-found') {
        result.failure = found;
        return result;
      }
    }

    if (searchesLeft <= 0) {
      result.unresolved.push(rec.name);
      continue;
    }
    searchesLeft -= 1;
    const hits = await lookup.search(rec.name);
    result.quotaUnits += SEARCH_QUOTA_UNITS;
    if (!hits.ok) {
      result.failure = hits;
      return result;
    }
    const hit = pickHit(rec.name, hits.channels);
    if (!hit) {
      result.unresolved.push(rec.name);
      continue;
    }
    if (taken.has(hit.channelId) || skip({ channelId: hit.channelId })) continue;

    // The search answer has no handle and no uploads playlist; one more unit
    // reads both, and confirms the channel still exists.
    const channel = await lookup.byRef({ channelId: hit.channelId });
    result.quotaUnits += 1;
    if (channel.ok) accept(rec, channel);
    else if (channel.reason === 'not-found') result.unresolved.push(rec.name);
    else {
      result.failure = channel;
      return result;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// The whole search for one subject.
// ---------------------------------------------------------------------------

export type FoundChannel = {
  id: string;
  youtubeChannelId: string;
  title: string;
  handle: string | null;
  foundWhy: string;
};

export type FindChannelsFailure =
  | 'no-anthropic-key'
  | 'no-youtube-key'
  | 'no-subject'
  | 'search-failed'
  | 'quota'
  | 'youtube-failed'
  | 'nothing-new';

export type FindChannelsResult =
  | { ok: true; added: FoundChannel[]; unresolved: string[]; quotaUnits: number }
  | { ok: false; reason: FindChannelsFailure; detail: string; added: FoundChannel[]; quotaUnits: number };

function youtubeFailure(failure: YouTubeFailure): { reason: FindChannelsFailure; detail: string } {
  if (failure.reason === 'no-key') {
    return { reason: 'no-youtube-key', detail: 'Finding channels needs YOUTUBE_API_KEY to be set.' };
  }
  if (failure.reason === 'quota') {
    return {
      reason: 'quota',
      detail: 'YouTube refused the lookup: the daily quota is spent, or the key is restricted. Try again tomorrow.',
    };
  }
  return { reason: 'youtube-failed', detail: `YouTube did not answer: ${failure.detail}` };
}

type StoredRow = { youtube_channel_id: string; title: string; handle: string | null };

/**
 * Search for channels for one subject and store the new ones.
 *
 * `learn` may be the session client or the service client; every read and
 * write names `userId` either way. The caller records the spend handed to
 * `onSpend` under the 'find-channels' operation.
 */
export async function findChannelsForSubject(input: {
  learn: LearnSupabaseClient;
  userId: string;
  subjectId: string;
  anthropicApiKey?: string | null;
  client?: Anthropic;
  lookup?: ChannelLookup;
  onSpend?: SpendSink;
}): Promise<FindChannelsResult> {
  const { learn, userId, subjectId } = input;
  const none = { added: [] as FoundChannel[], quotaUnits: 0 };

  const apiKey = input.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY ?? null;
  if (!apiKey && !input.client) {
    return { ok: false, reason: 'no-anthropic-key', detail: 'Finding channels needs ANTHROPIC_API_KEY to be set.', ...none };
  }
  // Checked before the web search is paid for, since nothing it found could be looked up.
  if (!input.lookup && !process.env.YOUTUBE_API_KEY?.trim()) {
    return { ok: false, reason: 'no-youtube-key', detail: 'Finding channels needs YOUTUBE_API_KEY to be set.', ...none };
  }

  const subject = await learn
    .from('subjects')
    .select('id, name, note')
    .eq('id', subjectId)
    .eq('user_id', userId)
    .maybeSingle();
  if (subject.error) throw new Error(`Reading the subject failed: ${subject.error.message}`);
  if (!subject.data) return { ok: false, reason: 'no-subject', detail: 'That subject is not yours or no longer exists.', ...none };
  const { name, note } = subject.data as { id: string; name: string; note: string | null };

  const stored = await learn
    .from('subject_channels')
    .select('youtube_channel_id, title, handle')
    .eq('user_id', userId)
    .eq('subject_id', subjectId);
  if (stored.error) throw new Error(`Reading the channels found so far failed: ${stored.error.message}`);
  const storedRows = (stored.data ?? []) as StoredRow[];
  const followed = await loadChannels(learn);

  const knownIds = new Set<string>();
  const knownHandles = new Set<string>();
  const knownNames: string[] = [];
  for (const row of storedRows) {
    knownIds.add(row.youtube_channel_id);
    if (row.handle) knownHandles.add(row.handle.toLowerCase());
    knownNames.push(row.handle ? `${row.title} (${row.handle})` : row.title);
  }
  for (const channel of followed) {
    knownIds.add(channel.youtube_channel_id);
    if (channel.youtube_handle) knownHandles.add(channel.youtube_handle.toLowerCase());
    knownNames.push(channel.youtube_handle ? `${channel.name} (${channel.youtube_handle})` : channel.name);
  }

  const rooting = rootingFor(await loadGraph(learn, subjectId, userId), null);
  const recommended = await recommendChannels({
    prompt: buildChannelPrompt({ subject: name, note, rooting, known: knownNames }),
    anthropicApiKey: apiKey ?? '',
    client: input.client,
    onSpend: input.onSpend,
  });
  if (!recommended.ok) return { ok: false, reason: recommended.reason, detail: recommended.detail, ...none };

  const resolution = await resolveRecommendations(recommended.channels, {
    lookup: input.lookup,
    skip: ({ handle, channelId }) =>
      (handle !== undefined && knownHandles.has(handle.toLowerCase())) ||
      (channelId !== undefined && knownIds.has(channelId)),
  });

  let added: FoundChannel[] = [];
  if (resolution.resolved.length > 0) {
    const rows = resolution.resolved.map((channel) => ({
      user_id: userId,
      subject_id: subjectId,
      youtube_channel_id: channel.channelId,
      title: channel.title,
      handle: channel.handle,
      found_why: channel.why,
    }));
    const written = await learn
      .from('subject_channels')
      .upsert(rows, { onConflict: 'subject_id,youtube_channel_id', ignoreDuplicates: true })
      .select('id, youtube_channel_id, title, handle, found_why');
    if (written.error) throw new Error(`Storing the channels found failed: ${written.error.message}`);
    added = ((written.data ?? []) as (StoredRow & { id: string; found_why: string | null })[]).map((row) => ({
      id: row.id,
      youtubeChannelId: row.youtube_channel_id,
      title: row.title,
      handle: row.handle,
      foundWhy: row.found_why ?? '',
    }));
  }

  if (resolution.failure) {
    return { ok: false, ...youtubeFailure(resolution.failure), added, quotaUnits: resolution.quotaUnits };
  }
  if (added.length === 0) {
    return {
      ok: false,
      reason: 'nothing-new',
      detail:
        recommended.channels.length === 0
          ? 'The search found no channels recommended for this subject.'
          : resolution.unresolved.length > 0
            ? `YouTube could not find ${resolution.unresolved.join(', ')}, and the other channels named are ones you already follow or were found for this subject before.`
            : 'Every channel the search found is one you already follow or was found for this subject before.',
      added,
      quotaUnits: resolution.quotaUnits,
    };
  }
  return { ok: true, added, unresolved: resolution.unresolved, quotaUnits: resolution.quotaUnits };
}
