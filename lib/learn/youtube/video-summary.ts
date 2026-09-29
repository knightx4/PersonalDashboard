import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import type { TranscriptCue } from '@/lib/learn/catalogue/segment';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';

/**
 * The gist and takeaways shown for a video on your list (plan #1069).
 *
 * One Haiku call per video, and only from its transcript. The aim is that
 * reading the takeaways gives most of what watching would, in a small share
 * of the time, so they carry the practical detail: the steps, numbers,
 * examples and wording the video gives, not a description of its topics. A
 * description says what a video is about, never what it says, so a video with
 * no transcript gets no summary. How many takeaways scales with the video's
 * length.
 */

export const VIDEO_SUMMARY_MODEL = 'claude-haiku-4-5';
const TOOL = 'report_summary';

/**
 * When the current prompt was written. A transcript summary stamped before
 * this was written to an older brief and is rewritten; move it forward
 * whenever SYSTEM changes enough to be worth paying for again.
 */
export const SUMMARY_PROMPT_SINCE = '2026-09-29T21:00:00Z';

/**
 * How much of a transcript is sent. About 10,000 tokens: an hour of speech is
 * roughly 50,000 characters, so a long lecture is summarised from its first
 * hour or so, which keeps one call near a cent.
 */
export const TRANSCRIPT_CHARS = 40_000;

/** Takeaways kept at most, for a long video. */
export const MAX_POINTS = 12;

export type VideoForSummary = {
  title: string;
  channel: string | null;
  durationSeconds: number | null;
  /** The transcript as one text. */
  transcript: string;
};

export type VideoSummary =
  | { outcome: 'written'; summary: string; keyPoints: string[] }
  /** The transcript has nothing to summarise: music, silence, a trailer. */
  | { outcome: 'too-little' }
  | { outcome: 'failed'; detail: string };

const SYSTEM = `You condense a video for the person who saved it, so they get most of what
watching it would give them in a minute or two of reading. They will often
read this instead of watching, so what you leave out is lost to them.

THE GIST: one or two sentences giving the video's main answer or claim, the
thing someone would say if asked "so what did it say?". Not what it is about.

THE TAKEAWAYS carry the value. Each is one to three sentences a person can act
on or repeat without having seen the video:
- Where the video teaches how to do something, write the how: the steps in
  order, the exact phrasing or question it suggests, the rule of thumb, the
  numbers, the example it uses to show it. "Ask 'is that what you mean?' before
  answering" beats "check your understanding".
- Where it argues a point, give the claim and the reason or evidence it gives,
  with the figures and names it cites.
- Keep a named framework or list whole (all its parts, in its order) rather
  than naming it.
- Follow the video's order. Skip the intro, the sponsor, the calls to
  subscribe and anything said only to fill time.
- Plain, direct words. No "the speaker explains", "the video discusses", "in
  this video". Say the thing itself.

HOW MANY: about one takeaway per two minutes of video, at least three and at
most ${MAX_POINTS}. Fewer when the video repeats itself; never pad.

IF THE TRANSCRIPT HAS NOTHING TO SUMMARISE (music, no speech, a trailer), set
too_little true and leave the rest empty.

No hype and no em dashes.`;

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

function minutes(seconds: number): string {
  const whole = Math.max(1, Math.round(seconds / 60));
  return `${whole} minute${whole === 1 ? '' : 's'}`;
}

/** What the model is given about the video. */
export function summaryPrompt(video: VideoForSummary): string {
  const lines = [`Title: ${video.title}`];
  if (video.channel) lines.push(`Channel: ${video.channel}`);
  if (video.durationSeconds) lines.push(`Length: ${minutes(video.durationSeconds)}`);
  lines.push('', 'Transcript:', video.transcript, '', `Call ${TOOL}.`);
  return lines.join('\n');
}

/** The model's reply, checked: a gist and at most MAX_POINTS takeaways. */
export function readSummaryReply(input: unknown): VideoSummary {
  const parsed = replySchema.safeParse(input);
  if (!parsed.success) return { outcome: 'failed', detail: 'The summary came back malformed.' };
  if (parsed.data.too_little) return { outcome: 'too-little' };
  const summary = parsed.data.summary.trim();
  const keyPoints = parsed.data.key_points.map((point) => point.trim()).filter(Boolean).slice(0, MAX_POINTS);
  if (!summary) return { outcome: 'failed', detail: 'The summary came back empty.' };
  return { outcome: 'written', summary, keyPoints };
}

/** Write one video's summary. Never throws. */
export async function writeVideoSummary(input: {
  video: VideoForSummary;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<VideoSummary> {
  if (!input.video.transcript.trim()) return { outcome: 'too-little' };

  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  let response;
  try {
    response = await client.messages.create({
      model: VIDEO_SUMMARY_MODEL,
      max_tokens: 2048,
      system: SYSTEM,
      tools: [
        {
          name: TOOL,
          description: 'Report the gist and the takeaways.',
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
  return readSummaryReply(block.input);
}
