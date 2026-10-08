import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import type { TranscriptCue } from '@/lib/learn/catalogue/segment';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { forceTool } from '@/lib/learn/graph/tool-call';
import { timestampedTranscript } from './takeaways';
import { MODELS } from '@/lib/core/models';

/**
 * A short summary of each inspiration video (note b0594be6): three to five
 * points on what the video says, whether or not any of it applies to this
 * app, for the tab to show under the video's title.
 *
 * Its own pass rather than part of the takeaways read, so a video read before
 * summaries existed gets one without its takeaways being read again. Haiku,
 * because this is summarising, not judging what fits the app.
 */

export const SUMMARY_MODEL = MODELS.inspirationSummary;
const TOOL = 'report_summary';

/** The most points one summary keeps. */
export const MAX_POINTS = 5;

/** Less transcript than the takeaways read: the gist is in the first forty minutes or so. */
const SUMMARY_CHARS = 60_000;

const SYSTEM = `You summarise a video for someone deciding whether to watch it.

Write three to five points on what the video says: its main claims, methods or
examples, each one short sentence of at most twenty words. Say what the video
says, not that it "discusses" or "explores" something. Plain words, no hype and
no em dashes.`;

const replySchema = z.object({ points: z.array(z.string()).default([]) });

/** The model's reply, trimmed to what can be stored, or null when unusable. */
export function readSummaryReply(input: unknown): string[] | null {
  const parsed = replySchema.safeParse(input);
  if (!parsed.success) return null;
  const points = parsed.data.points
    .map((point) => point.replace(/\s+/g, ' ').trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, MAX_POINTS);
  return points.length > 0 ? points : null;
}

/** Summarise one video. Null when the model gave nothing usable; never throws. */
export async function summariseVideo(input: {
  title: string;
  cues: readonly TranscriptCue[];
  client: Pick<Anthropic, 'messages'>;
  onSpend?: SpendSink;
}): Promise<string[] | null> {
  const transcript = timestampedTranscript(input.cues, SUMMARY_CHARS);
  if (!transcript.text) return null;
  try {
    const response = await input.client.messages.create({
      model: SUMMARY_MODEL,
      max_tokens: 600,
      system: SYSTEM,
      tools: [
        {
          name: TOOL,
          description: 'Report the points the video makes.',
          input_schema: {
            type: 'object',
            properties: { points: { type: 'array', maxItems: MAX_POINTS, items: { type: 'string' } } },
            required: ['points'],
          },
        },
      ],
      tool_choice: forceTool(TOOL, SUMMARY_MODEL),
      messages: [
        {
          role: 'user',
          content: `Video: ${input.title}\n\nTranscript${transcript.cut ? ' (the start only)' : ''}:\n${transcript.text}\n\nCall ${TOOL}.`,
        },
      ],
    });
    input.onSpend?.({ model: SUMMARY_MODEL, usage: usageFrom(response.usage) });
    const block = response.content.find((part) => part.type === 'tool_use' && part.name === TOOL);
    return block && block.type === 'tool_use' ? readSummaryReply(block.input) : null;
  } catch {
    return null;
  }
}

/** What the pass touches, narrowed so a test can hold it in memory. */
export type SummaryStore = {
  /** Read videos with a transcript and no summary yet. */
  unsummarisedVideos(userId: string): Promise<Array<{ id: string; videoId: string; title: string }>>;
  saveSummary(userId: string, videoRowId: string, points: string[]): Promise<void>;
};

/**
 * Summarise every read video of one person's that has no summary, until the
 * deadline. A video the model gave nothing for is tried again next run.
 * Returns how many were summarised.
 */
export async function summariseVideos(
  store: SummaryStore,
  loadCues: (videoId: string) => Promise<{ cues: TranscriptCue[] } | null>,
  userId: string,
  options: { client: Pick<Anthropic, 'messages'>; deadline?: number; onSpend?: SpendSink },
): Promise<number> {
  let done = 0;
  for (const video of await store.unsummarisedVideos(userId)) {
    if (options.deadline !== undefined && Date.now() >= options.deadline) break;
    const transcript = await loadCues(video.videoId);
    if (!transcript) continue;
    const points = await summariseVideo({ title: video.title, cues: transcript.cues, client: options.client, onSpend: options.onSpend });
    if (!points) continue;
    await store.saveSummary(userId, video.id, points);
    done += 1;
  }
  return done;
}

/** The store over the service-role client, every query filtered by the person. */
export function supabaseSummaryStore(learn: LearnSupabaseClient): SummaryStore {
  const db = learn.schema('public');
  return {
    async unsummarisedVideos(userId) {
      const { data, error } = await db
        .from('inspiration_videos')
        .select('id, video_id, title')
        .eq('user_id', userId)
        .eq('transcript_state', 'fetched')
        .not('processed_at', 'is', null)
        .is('summary_points', null)
        .order('playlist_position', { ascending: true, nullsFirst: false });
      if (error) throw new Error(`Reading the videos to summarise failed: ${error.message}`);
      return ((data ?? []) as { id: string; video_id: string; title: string | null }[]).map((row) => ({
        id: row.id,
        videoId: row.video_id,
        title: row.title ?? row.video_id,
      }));
    },
    async saveSummary(userId, videoRowId, points) {
      const { error } = await db
        .from('inspiration_videos')
        .update({ summary_points: points })
        .eq('user_id', userId)
        .eq('id', videoRowId);
      if (error) throw new Error(`Saving the video summary failed: ${error.message}`);
    },
  };
}
