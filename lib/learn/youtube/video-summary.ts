import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import type { TranscriptCue } from '@/lib/learn/catalogue/segment';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { MODELS } from '@/lib/core/models';

/**
 * The short summary and key points shown for a video on your list (plan
 * #1069).
 *
 * One Haiku call per video. It is written from the video's description when
 * there is no transcript, and written again from the transcript once one is
 * stored; `summary_from` on learn.watch_list says which, and the page says so
 * when it is the description. Haiku because it is one text in and a paragraph
 * out, run in the background for every video on the list.
 */

export const VIDEO_SUMMARY_MODEL = MODELS.learnVideoSummary;
const TOOL = 'report_summary';

/**
 * How much of a transcript is sent. About 10,000 tokens: an hour of speech is
 * roughly 50,000 characters, so a long lecture is summarised from its first
 * hour or so, which keeps one call near a cent.
 */
export const TRANSCRIPT_CHARS = 40_000;
/** A description is sent whole up to this, which covers all but link dumps. */
const DESCRIPTION_CHARS = 5_000;

export type VideoForSummary = {
  title: string;
  channel: string | null;
  description: string | null;
  /** The transcript as one text, or null when there is none yet. */
  transcript: string | null;
};

export type VideoSummary =
  | { outcome: 'written'; from: 'description' | 'transcript'; summary: string; keyPoints: string[] }
  /** The description says too little to summarise and there is no transcript. */
  | { outcome: 'too-little'; from: 'description' }
  | { outcome: 'failed'; detail: string };

const SYSTEM = `You summarise a video for the person who saved it to watch later, so they can
decide what it is worth and remember what it said.

WRITE THREE OR FOUR SENTENCES saying what the video argues or shows, in plain
words. Say what it claims, not that it "discusses" or "explores" something.

THEN THREE TO FIVE KEY POINTS, each one sentence a person could repeat to
somebody else. No point restates the summary's first sentence.

IF YOU HAVE ONLY THE DESCRIPTION, summarise what the description says the video
covers and do not invent what is said in it. Links, sponsor lines, social
handles and chapter timestamps are not content.

IF THE TEXT SAYS TOO LITTLE TO SUMMARISE (a description that is only links or
a line of promotion), set too_little true and leave the rest empty.

No hype, no "in this video", no em dashes.`;

const replySchema = z.object({
  summary: z.string().default(''),
  key_points: z.array(z.string()).default([]),
  too_little: z.boolean().optional(),
});

/** The transcript as one text, cut at a sentence end near the limit. */
export function transcriptText(cues: readonly TranscriptCue[], limit: number = TRANSCRIPT_CHARS): string {
  const whole = cues
    .map((cue) => cue.text.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ');
  if (whole.length <= limit) return whole;
  const cut = whole.slice(0, limit);
  const stop = cut.lastIndexOf('. ');
  return stop > limit * 0.8 ? cut.slice(0, stop + 1) : cut;
}

/** What the model is given about the video. */
export function summaryPrompt(video: VideoForSummary): string {
  const lines = [`Title: ${video.title}`];
  if (video.channel) lines.push(`Channel: ${video.channel}`);
  if (video.transcript) {
    lines.push('', 'Transcript:', video.transcript);
  } else {
    lines.push('', 'Description (there is no transcript yet):', (video.description ?? '').slice(0, DESCRIPTION_CHARS));
  }
  lines.push('', `Call ${TOOL}.`);
  return lines.join('\n');
}

/** The model's reply, checked: 3-4 sentences, three to five points. */
export function readSummaryReply(
  input: unknown,
  from: 'description' | 'transcript',
): VideoSummary {
  const parsed = replySchema.safeParse(input);
  if (!parsed.success) return { outcome: 'failed', detail: 'The summary came back malformed.' };
  if (parsed.data.too_little && from === 'description') return { outcome: 'too-little', from };
  const summary = parsed.data.summary.trim();
  const keyPoints = parsed.data.key_points.map((point) => point.trim()).filter(Boolean).slice(0, 5);
  if (!summary) return { outcome: 'failed', detail: 'The summary came back empty.' };
  return { outcome: 'written', from, summary, keyPoints };
}

/** Write one video's summary. Never throws. */
export async function writeVideoSummary(input: {
  video: VideoForSummary;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<VideoSummary> {
  const from = input.video.transcript ? 'transcript' : 'description';
  if (from === 'description' && !input.video.description?.trim()) return { outcome: 'too-little', from };

  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  let response;
  try {
    response = await client.messages.create({
      model: VIDEO_SUMMARY_MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      tools: [
        {
          name: TOOL,
          description: 'Report the summary and the key points.',
          input_schema: {
            type: 'object',
            properties: {
              summary: { type: 'string' },
              key_points: { type: 'array', items: { type: 'string' } },
              too_little: { type: 'boolean' },
            },
            required: ['summary', 'key_points'],
          },
        },
      ],
      tool_choice: forceTool(TOOL),
      messages: [{ role: 'user', content: summaryPrompt(input.video) }],
    });
  } catch (error) {
    return { outcome: 'failed', detail: error instanceof Error ? error.message : 'Writing the summary failed.' };
  }

  input.onSpend?.({ model: VIDEO_SUMMARY_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((part) => part.type === 'tool_use' && part.name === TOOL);
  if (!block || block.type !== 'tool_use') return { outcome: 'failed', detail: whyNoReport(response) };
  return readSummaryReply(block.input, from);
}
