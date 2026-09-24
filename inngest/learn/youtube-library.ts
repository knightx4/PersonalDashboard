import 'server-only';

import { z } from 'zod';
import { createLearnServiceSupabase } from '@/inngest/learn/supabase-admin';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { embedVideoSegmentsOverRest } from '@/lib/learn/catalogue/embed-rest';
import type { EmbedSweepResult } from '@/lib/learn/catalogue/embed-sweep';
import { scheduledRunAllowance } from '@/lib/learn/youtube/budget';
import { addChannel, listChannel, loadChannels, type ListChannelResult } from '@/lib/learn/youtube/library';
import {
  loadCreditState,
  loadTranscript,
  queueTranscripts,
  transcribeVideos,
  waitingVideoIds,
  type RequestedBy,
  type TranscribeResult,
} from '@/lib/learn/youtube/transcripts';

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
const TICK_LIST_MS = 90_000;
const TICK_TRANSCRIBE_MS = 210_000;
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

export type TickReport = {
  channels: { name: string; result: ListChannelResult }[];
  transcripts: TranscribeResult | null;
  allowance: number;
  embedding: EmbedSweepResult | null;
};

/**
 * The scheduled run: re-list every channel, then work through the queue
 * within this run's share of the month's credits, then embed what is new.
 */
export async function runYouTubeLibraryTick(): Promise<TickReport> {
  const started = Date.now();
  const learn = createLearnServiceSupabase();
  const report: TickReport = { channels: [], transcripts: null, allowance: 0, embedding: null };

  for (const channel of await loadChannels(learn)) {
    if (Date.now() >= started + TICK_LIST_MS) break;
    try {
      const result = await listChannel(learn, channel, { deadline: started + TICK_LIST_MS });
      report.channels.push({ name: channel.name, result });
    } catch (error) {
      console.error(`[youtube-library] listing ${channel.name}`, error instanceof Error ? error.message : error);
    }
  }

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
  const learn = createLearnServiceSupabase();
  // Only channels added here. The seeded providers keep their row and lose
  // the channel, so the OCW transcript adapter and anything pointing at them
  // keep working.
  const { data, error } = await learn
    .from('catalogue_providers')
    .select('slug, ingest_note')
    .eq('id', providerId)
    .maybeSingle();
  if (error) throw new Error(`Reading the channel failed: ${error.message}`);
  if (!data) return;

  const addedHere = (data as { ingest_note: string }).ingest_note.startsWith('Videos and playlists listed');
  const result = addedHere
    ? await learn.from('catalogue_providers').delete().eq('id', providerId)
    : await learn
        .from('catalogue_providers')
        .update({
          youtube_channel_id: null,
          youtube_handle: null,
          youtube_uploads_playlist_id: null,
          youtube_listed_at: null,
          auto_transcribe: false,
        })
        .eq('id', providerId);
  if (result.error) throw new Error(`Removing the channel failed: ${result.error.message}`);
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
