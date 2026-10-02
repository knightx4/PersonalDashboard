import 'server-only';

import { z } from 'zod';
import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createLearnServiceSupabase } from '@/inngest/learn/supabase-admin';
import { recordSpend } from '@/lib/core/spend/record';
import { jevEnabledFor } from '@/lib/jev/enabled';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { embedVideoSegmentsOverRest, restLedger } from '@/lib/learn/catalogue/embed-rest';
import type { EmbedSweepResult } from '@/lib/learn/catalogue/embed-sweep';
import { scheduledRunAllowance } from '@/lib/learn/youtube/budget';
import {
  addChannel,
  listChannel,
  loadChannels,
  removeChannelFromLibrary,
  type ListChannelResult,
} from '@/lib/learn/youtube/library';
import { unfollowSubjectChannel, type UnfollowResult } from '@/lib/learn/youtube/follow-channel';
import {
  embedVideoMetadata,
  metadataEmbedDeadline,
  queueMatchingVideos,
  type MatchQueueResult,
  type MetadataEmbedResult,
} from '@/lib/learn/youtube/match';
import {
  loadCreditState,
  loadTranscript,
  queueTranscripts,
  transcribeVideos,
  waitingVideoIds,
  type RequestedBy,
  type TranscribeResult,
} from '@/lib/learn/youtube/transcripts';
import { parsePlaylistInput } from '@/lib/learn/providers/youtube';
import {
  saveWatchListPlaylist,
  syncWatchList,
  syncWatchLists,
  type WatchListSync,
} from '@/lib/learn/youtube/watch-list';
import { summariseWatchLists, type SummaryPassResult } from '@/lib/learn/youtube/summaries';
import { cutClips, type ClipPassResult } from '@/lib/learn/youtube/clip-run';
import { judgeWatchLists, type JudgePassResult } from '@/lib/learn/youtube/judging';
import {
  judgeFoundChannels,
  judgePendingChannels,
  type ChannelJudgePass,
  type JudgeChannelsResult,
} from '@/lib/learn/youtube/channel-judge';

/**
 * The YouTube library's work, run with the service-role client.
 *
 * Two callers: the scheduled run (app/api/cron/youtube-library), four times a
 * day, and the buttons on /learn/youtube, which check that the owner pressed
 * them before calling in. The catalogue belongs to nobody and the credits are
 * the owner's, so nothing here takes a user id except the spend row for
 * embedding, which goes to the owner.
 */

/** When a press stops starting transcript calls, from when it began. */
const PRESS_TRANSCRIBE_MS = 150_000;
/** When a press stops starting embedding calls. */
const PRESS_EMBED_MS = 240_000;

/** The scheduled run's budget, out of the route's 300 seconds. */
/** Your own playlist is read first: a few calls, and it is what you asked for. */
const TICK_WATCH_LIST_MS = 30_000;
/**
 * Then the list's summaries (plan #1069), four Haiku calls at a time: about
 * forty videos in the window, so a new playlist is summarised within a day.
 */
const TICK_SUMMARY_MS = 60_000;
/**
 * Then the judge (plan #1066): the title screen, ten videos a call, and the
 * verdicts on videos whose transcripts have arrived, four at a time. The
 * transcripts it asks for are fetched later in this run, inside its allowance.
 */
const TICK_JUDGE_MS = 95_000;
const TICK_LIST_MS = 115_000;
/**
 * Titles and descriptions are embedded until here, then the queue is topped
 * up. The pass always gets at least METADATA_SLICE_MS (60 seconds) from when it
 * starts, so a listing that runs to its deadline cannot eat it (plan #1147).
 */
const TICK_METADATA_MS = 175_000;
/** Transcripts: up to 40 fetches, which took at most about 40 seconds in September. */
const TICK_TRANSCRIBE_MS = 230_000;
/**
 * Then the channels found for a subject (plan #1196): their samples whose
 * transcripts this run fetched are judged, and a channel whose three are all
 * in gets its verdict.
 */
const TICK_CHANNELS_MS = 250_000;
/**
 * Then clips are cut from stored transcripts (plan #1398): up to twelve
 * videos, four Haiku calls at a time. No video is started after the first
 * mark, and a call still running at the second is abandoned and tried again
 * next run, so embedding keeps its slot. The deadlines are from the start of
 * the run, so on a run where the passes above had little to do this one gets
 * most of its two minutes back.
 */
const TICK_CLIPS_MS = 256_000;
const TICK_CLIPS_HARD_MS = 268_000;
const TICK_EMBED_MS = 270_000;

const ownerSchema = z.object({ userId: z.string() });

async function ownerId(learn: LearnSupabaseClient): Promise<string | null> {
  const { data, error } = await learn.schema('public').rpc('app_owner');
  if (error) return null;
  const parsed = ownerSchema.safeParse(data);
  return parsed.success ? parsed.data.userId : null;
}

async function embedNew(learn: LearnSupabaseClient, deadline: number): Promise<EmbedSweepResult | null> {
  if (!process.env.EMBEDDING_API_KEY?.trim()) return null;
  return embedVideoSegmentsOverRest(learn, { userId: await ownerId(learn), deadline, limit: 640 });
}

/**
 * Summarise the videos on everybody's list, each call recorded against the
 * person whose list it is. Nothing is written without an Anthropic key, and a
 * failure leaves the rest of the run to go ahead.
 */
async function summariseLists(learn: LearnSupabaseClient, deadline: number): Promise<SummaryPassResult | null> {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!anthropicApiKey) return null;
  const core = createCoreServiceSupabase();
  const rows: Promise<unknown>[] = [];
  try {
    return await summariseWatchLists(learn, {
      anthropicApiKey,
      deadline,
      onSpend: (userId, report) =>
        void rows.push(
          recordSpend(core, userId, { module: 'learn', operation: 'summarise-video', model: report.model, usage: report.usage }),
        ),
    });
  } catch (error) {
    console.error('[youtube-library] summarising your list', error instanceof Error ? error.message : error);
    return null;
  } finally {
    await Promise.all(rows);
  }
}

/**
 * Judge the videos on everybody's list, each call recorded against the person
 * whose list it is. Like the summaries, nothing without an Anthropic key.
 */
async function judgeLists(learn: LearnSupabaseClient, deadline: number): Promise<JudgePassResult | null> {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!anthropicApiKey) return null;
  const core = createCoreServiceSupabase();
  const rows: Promise<unknown>[] = [];
  try {
    return await judgeWatchLists(learn, {
      anthropicApiKey,
      deadline,
      jevEnabled: (userId) => jevEnabledFor(core, userId),
      onSpend: (userId, pass, report) =>
        void rows.push(
          recordSpend(core, userId, {
            module: 'learn',
            operation: pass === 'screen' ? 'screen-video' : 'judge-video',
            model: report.model,
            usage: report.usage,
          }),
        ),
    });
  } catch (error) {
    console.error('[youtube-library] judging your list', error instanceof Error ? error.message : error);
    return null;
  } finally {
    await Promise.all(rows);
  }
}

/**
 * Cut clips from the videos whose transcripts are stored, playlist first,
 * each call recorded against the person the clips are for.
 */
async function cutStoredClips(learn: LearnSupabaseClient, owner: string | null, started: number): Promise<ClipPassResult | null> {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!anthropicApiKey) return null;
  const core = createCoreServiceSupabase();
  const rows: Promise<unknown>[] = [];
  try {
    return await cutClips(learn, {
      anthropicApiKey,
      owner,
      deadline: started + TICK_CLIPS_MS,
      hardDeadline: started + TICK_CLIPS_HARD_MS,
      onSpend: (userId, report) =>
        void rows.push(recordSpend(core, userId, { module: 'learn', operation: 'cut-clips', model: report.model, usage: report.usage })),
    });
  } catch (error) {
    console.error('[youtube-library] cutting clips', error instanceof Error ? error.message : error);
    return null;
  } finally {
    await Promise.all(rows);
  }
}

/** The operation a channel-judging call is recorded under. */
function channelOperation(pass: ChannelJudgePass): 'judge-video' | 'judge-channel' {
  return pass === 'sample' ? 'judge-video' : 'judge-channel';
}

/** Judge the channels found for everybody's subjects, from what the queue has fetched. */
async function judgeChannels(learn: LearnSupabaseClient, deadline: number): Promise<TickReport['foundChannels']> {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!anthropicApiKey) return null;
  const core = createCoreServiceSupabase();
  const rows: Promise<unknown>[] = [];
  try {
    return await judgePendingChannels(learn, {
      anthropicApiKey,
      deadline,
      onSpend: (userId, pass, report) =>
        void rows.push(
          recordSpend(core, userId, { module: 'learn', operation: channelOperation(pass), model: report.model, usage: report.usage }),
        ),
    });
  } catch (error) {
    console.error('[youtube-library] judging found channels', error instanceof Error ? error.message : error);
    return null;
  } finally {
    await Promise.all(rows);
  }
}

export type TickReport = {
  channels: { name: string; result: ListChannelResult }[];
  transcripts: TranscribeResult | null;
  allowance: number;
  embedding: EmbedSweepResult | null;
  /** Titles and descriptions embedded for matching (learn migration 0059). */
  metadata?: MetadataEmbedResult | null;
  /** Transcripts queued because the video matched one of your ideas. */
  matched?: MatchQueueResult | null;
  /** Each pasted playlist read into learn.watch_list (plan #1065). */
  watchLists?: WatchListSync[];
  /** Summaries written for the videos on those lists (plan #1069). */
  summaries?: SummaryPassResult | null;
  /** Verdicts written and transcripts asked for on those lists (plan #1066). */
  judging?: JudgePassResult | null;
  /** Channels found for a subject and judged on their samples (plan #1196). */
  foundChannels?: Awaited<ReturnType<typeof judgePendingChannels>> | null;
  /** Clips cut from stored transcripts for the clip stream (plan #1398). */
  clips?: ClipPassResult | null;
};

/**
 * The scheduled run: read your playlist into your list, summarise and judge what is new on it, re-list every channel, queue the videos that best match
 * your ideas, then work through the queue within this run's share of the
 * month's credits, cut clips from stored transcripts, then embed what is new.
 */
export async function runYouTubeLibraryTick(): Promise<TickReport> {
  const started = Date.now();
  const learn = createLearnServiceSupabase();
  const report: TickReport = { channels: [], transcripts: null, allowance: 0, embedding: null };

  try {
    report.watchLists = await syncWatchLists(learn, { deadline: started + TICK_WATCH_LIST_MS });
  } catch (error) {
    console.error('[youtube-library] reading your playlist', error instanceof Error ? error.message : error);
  }
  report.summaries = await summariseLists(learn, started + TICK_SUMMARY_MS);
  report.judging = await judgeLists(learn, started + TICK_JUDGE_MS);

  for (const channel of await loadChannels(learn)) {
    if (Date.now() >= started + TICK_LIST_MS) break;
    try {
      const result = await listChannel(learn, channel, { deadline: started + TICK_LIST_MS });
      report.channels.push({ name: channel.name, result });
    } catch (error) {
      console.error(`[youtube-library] listing ${channel.name}`, error instanceof Error ? error.message : error);
    }
  }

  // Spend the month's credits on what you study: embed the titles and
  // descriptions of newly listed videos, then queue the best untranscribed
  // matches for your ideas. A failure here leaves the queue as it was.
  const owner = await ownerId(learn);
  const ledger = owner ? restLedger(learn, owner) : null;
  const spendRows: Promise<void>[] = [];
  try {
    report.metadata = await embedVideoMetadata(learn, {
      deadline: metadataEmbedDeadline(started, TICK_METADATA_MS, Date.now()),
      onSpend: ledger ? (spend) => void spendRows.push(ledger(spend)) : undefined,
    });
    if (owner) report.matched = await queueMatchingVideos(learn, owner);
  } catch (error) {
    console.error('[youtube-library] matching videos', error instanceof Error ? error.message : error);
  }
  await Promise.all(spendRows);

  const now = new Date();
  const credits = await loadCreditState(learn, now);
  report.allowance = scheduledRunAllowance(credits, now);
  const waiting = await waitingVideoIds(learn, report.allowance, now);
  if (waiting.length > 0) {
    report.transcripts = await transcribeVideos(learn, waiting, {
      trigger: 'scheduled',
      maxCredits: report.allowance,
      deadline: started + TICK_TRANSCRIBE_MS,
    });
  }
  report.foundChannels = await judgeChannels(learn, started + TICK_CHANNELS_MS);
  report.clips = await cutStoredClips(learn, owner, started);

  report.embedding = await embedNew(learn, started + TICK_EMBED_MS);
  return report;
}

// ---------------------------------------------------------------------------
// Presses. Each is called from a server action that has already checked the
// owner pressed it.
// ---------------------------------------------------------------------------

export type AddChannelReport =
  | { ok: true; name: string; slug: string; created: boolean; listing: ListChannelResult }
  | { ok: false; error: string };

export async function addAndListChannel(raw: string): Promise<AddChannelReport> {
  const started = Date.now();
  const learn = createLearnServiceSupabase();
  const added = await addChannel(learn, raw);
  if (!added.ok) return added;

  const listing = await listChannel(learn, added.channel, { playlists: true, deadline: started + 240_000 });
  return { ok: true, name: added.channel.name, slug: added.channel.slug, created: added.created, listing };
}

export async function relistChannel(providerId: string): Promise<ListChannelResult | null> {
  const started = Date.now();
  const learn = createLearnServiceSupabase();
  const channel = (await loadChannels(learn)).find((row) => row.id === providerId);
  if (!channel) return null;
  return listChannel(learn, channel, { playlists: true, deadline: started + 240_000 });
}

export async function setChannelAutoTranscribe(providerId: string, on: boolean): Promise<void> {
  const learn = createLearnServiceSupabase();
  const { error } = await learn
    .from('catalogue_providers')
    .update({ auto_transcribe: on })
    .eq('id', providerId)
    .not('youtube_channel_id', 'is', null);
  if (error) throw new Error(`Changing auto-transcribe failed: ${error.message}`);
}

export async function removeChannel(providerId: string): Promise<void> {
  await removeChannelFromLibrary(createLearnServiceSupabase(), providerId);
}

/**
 * Take a channel Learn followed for a subject back out of the library (plan
 * #1198). The caller checks the person pressed it; the row must be theirs.
 */
export async function unfollowSubjectChannelNow(userId: string, channelRowId: string): Promise<UnfollowResult> {
  return unfollowSubjectChannel(createLearnServiceSupabase(), { userId, channelRowId });
}

export type TranscribeReport = {
  transcripts: TranscribeResult;
  /** Asked for and still waiting, for the scheduled run. */
  queued: number;
  embedding: EmbedSweepResult | null;
};

/**
 * Fetch transcripts now, as far as the month's credits and the press's time
 * allow, and queue the rest for the scheduled run.
 */
export async function transcribeNow(videoIds: string[], requestedBy: RequestedBy): Promise<TranscribeReport> {
  const started = Date.now();
  const learn = createLearnServiceSupabase();

  await queueTranscripts(learn, videoIds, requestedBy);
  const credits = await loadCreditState(learn);
  const transcripts = await transcribeVideos(learn, videoIds, {
    trigger: 'press',
    maxCredits: credits.remaining,
    deadline: started + PRESS_TRANSCRIBE_MS,
  });

  const { count } = await learn
    .from('video_transcripts')
    .select('video_id', { count: 'exact', head: true })
    .in('video_id', videoIds)
    .eq('state', 'queued');

  const embedding = transcripts.segments > 0 ? await embedNew(learn, started + PRESS_EMBED_MS) : null;
  return { transcripts, queued: count ?? 0, embedding };
}

/**
 * Judge the channels found for one subject now (plan #1196): pick three
 * videos from each, fetch their transcripts inside the month's credits (at
 * most 15 for the subject), judge what arrived and give each channel whose
 * samples are all in its verdict. What the press could not fetch stays
 * queued, and the scheduled run finishes it. The caller checks the person
 * owns the subject; every call is recorded against them. `deadline` lets a
 * press that has already spent time searching stop sooner.
 */
export async function judgeSubjectChannelsNow(
  userId: string,
  subjectId: string,
  options: { deadline?: number } = {},
): Promise<JudgeChannelsResult> {
  const started = Date.now();
  const learn = createLearnServiceSupabase();
  const core = createCoreServiceSupabase();
  const rows: Promise<unknown>[] = [];
  const credits = await loadCreditState(learn);
  try {
    return await judgeFoundChannels({
      learn,
      userId,
      subjectId,
      trigger: 'press',
      maxCredits: credits.remaining,
      deadline: Math.min(started + PRESS_EMBED_MS, options.deadline ?? Infinity),
      // Two literal calls rather than channelOperation(pass), so the $ hint's
      // check (lib/core/spend/action-graph.ts) can read what a press records.
      onSpend: (pass, report) =>
        void rows.push(
          pass === 'sample'
            ? recordSpend(core, userId, { module: 'learn', operation: 'judge-video', model: report.model, usage: report.usage })
            : recordSpend(core, userId, { module: 'learn', operation: 'judge-channel', model: report.model, usage: report.usage }),
        ),
    });
  } finally {
    await Promise.all(rows);
  }
}

export type WatchListPlaylistReport =
  | { ok: true; playlistId: string | null; sync: WatchListSync | null }
  | { ok: false; error: string };

/**
 * Keep the playlist pasted into Learn settings and read it at once, so the
 * list fills without waiting for the next run. An empty paste forgets it.
 */
export async function setWatchListPlaylist(userId: string, raw: string): Promise<WatchListPlaylistReport> {
  const learn = createLearnServiceSupabase();
  if (!raw.trim()) {
    await saveWatchListPlaylist(learn, userId, null);
    return { ok: true, playlistId: null, sync: null };
  }
  const input = parsePlaylistInput(raw);
  if (!input.ok) return input;
  await saveWatchListPlaylist(learn, userId, input.playlistId);
  return { ok: true, playlistId: input.playlistId, sync: await syncWatchList(learn, userId, input.playlistId) };
}

/** A playlist's videos, in order, by catalogue item id of the playlist. */
export async function playlistVideoIds(courseItemId: string): Promise<string[]> {
  const learn = createLearnServiceSupabase();
  const { data, error } = await learn
    .from('catalogue_course_items')
    .select('position, member:catalogue_items!catalogue_course_items_member_item_id_fkey(external_id)')
    .eq('course_item_id', courseItemId)
    .order('position');
  if (error) throw new Error(`Reading the playlist failed: ${error.message}`);
  return ((data ?? []) as { member: { external_id: string } | { external_id: string }[] | null }[])
    .map((row) => (Array.isArray(row.member) ? row.member[0] : row.member)?.external_id)
    .filter((id): id is string => typeof id === 'string');
}

/** A stored transcript, read from the private bucket. */
export async function readTranscript(videoId: string) {
  return loadTranscript(createLearnServiceSupabase(), videoId);
}
