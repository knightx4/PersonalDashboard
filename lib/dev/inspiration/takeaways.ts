import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import type { TranscriptCue } from '@/lib/learn/catalogue/segment';
import { THINKING_ROOM, forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { MODULES, type ModuleId } from '@/lib/modules';
import { MODELS } from '@/lib/core/models';

/**
 * Reading one inspiration video for takeaways about this app (plan #1409,
 * under #1406).
 *
 * One Sonnet call per video. It is given the transcript with a timestamp every
 * half minute or so, the app's vision and the dev workspace's vision, and the
 * list of workspaces, and reports up to eight takeaways: a short title, two or
 * three sentences on what the idea would mean here, the workspace it touches,
 * and the words in the video that make the point, with their moment. Sonnet
 * rather than Haiku because the work is judging which ideas fit this app, not
 * summarising.
 *
 * This file only extracts. What is done with the candidates (merged with the
 * ones already found in #1410, then stored) is lib/dev/inspiration/read.ts.
 */

export const TAKEAWAY_MODEL = MODELS.inspirationTakeaways;
const TOOL = 'report_takeaways';

/** The most takeaways one video gives. */
export const MAX_TAKEAWAYS = 8;

/**
 * How much transcript is sent, timestamps included: about 25,000 tokens, which
 * is an hour or so of speech. A longer video is read from its first hour, and
 * the prompt says so.
 */
export const TRANSCRIPT_CHARS = 100_000;

/** A new timestamp line starts once this many seconds have passed. */
const LINE_SECONDS = 30;

/** The value a takeaway names for the app as a whole; stored as a null module. */
export const WHOLE_APP = 'app' as const;

export type VideoForTakeaways = {
  title: string;
  channel: string | null;
  cues: readonly TranscriptCue[];
};

export type Visions = {
  /** The app's vision (module_visions under 'app'), when written. */
  app: string | null;
  /** The dev workspace's vision, when written. */
  dev: string | null;
};

/** One takeaway as the model found it in one video, before any merge. */
export type TakeawayCandidate = {
  title: string;
  /** Two or three sentences on what it would mean for this app. */
  body: string;
  /** The workspace it touches, or null for the app as a whole. */
  module: ModuleId | null;
  /** The video's own words that make the point. */
  quote: string;
  /** Where in the video the quote starts, or null when it cannot be placed. */
  startSeconds: number | null;
};

export type VideoTakeaways =
  | { outcome: 'read'; takeaways: TakeawayCandidate[]; cut: boolean }
  | { outcome: 'failed'; detail: string };

/** m:ss, or h:mm:ss past the hour. */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Reads `m:ss` or `h:mm:ss`, or a plain number of seconds. */
export function secondsFrom(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (/^\d+(\.\d+)?$/.test(text)) return Math.floor(Number(text));
  const parts = text.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!parts) return null;
  return Number(parts[1] ?? 0) * 3600 + Number(parts[2]) * 60 + Number(parts[3]);
}

/**
 * The transcript as timestamped lines, `[m:ss] words…`, one every half minute
 * or so, cut at a line end before the limit.
 */
export function timestampedTranscript(
  cues: readonly TranscriptCue[],
  limit: number = TRANSCRIPT_CHARS,
): { text: string; cut: boolean } {
  const lines: string[] = [];
  let start: number | null = null;
  let words: string[] = [];
  const flush = () => {
    if (start !== null && words.length > 0) lines.push(`[${clock(start)}] ${words.join(' ')}`);
    start = null;
    words = [];
  };
  for (const cue of cues) {
    const text = cue.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (start !== null && cue.startSeconds - start >= LINE_SECONDS) flush();
    if (start === null) start = cue.startSeconds;
    words.push(text);
  }
  flush();

  let length = 0;
  const kept: string[] = [];
  for (const line of lines) {
    if (length + line.length + 1 > limit) return { text: kept.join('\n'), cut: true };
    kept.push(line);
    length += line.length + 1;
  }
  return { text: kept.join('\n'), cut: false };
}

const normalise = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Where a quote starts in the transcript: the start of the cue its opening
 * words fall in. The model's own timestamp is the fallback, kept when it lands
 * inside the video, so a paraphrased quote still has its moment.
 */
export function placeQuote(cues: readonly TranscriptCue[], quote: string, claimed: number | null): number | null {
  const words = normalise(quote).split(' ').filter(Boolean);
  // Fewer than three words would match too much of any transcript.
  if (words.length >= 3) {
    let joined = '';
    const starts: { offset: number; seconds: number }[] = [];
    for (const cue of cues) {
      const text = normalise(cue.text);
      if (!text) continue;
      if (joined) joined += ' ';
      starts.push({ offset: joined.length, seconds: cue.startSeconds });
      joined += text;
    }
    // The opening words, fewer when the quote is short: enough to be unlikely
    // to match somewhere else, few enough to survive a small misquote later on.
    for (const take of new Set([Math.min(8, words.length), Math.min(5, words.length)])) {
      const needle = words.slice(0, take).join(' ');
      const at = joined.indexOf(needle);
      if (at >= 0) {
        let seconds = starts[0]?.seconds ?? 0;
        for (const start of starts) {
          if (start.offset > at) break;
          seconds = start.seconds;
        }
        return Math.floor(seconds);
      }
    }
  }
  if (claimed === null) return null;
  const last = cues.at(-1);
  const end = last ? (last.endSeconds ?? last.startSeconds) : 0;
  return claimed <= end + 5 ? claimed : null;
}

const SYSTEM = `You read a video the person saved because it might hold ideas for the app they
are building with an AI builder, and you write down the ideas in it that could
change that app.

The app is a personal dashboard with the workspaces listed below. You are
given what the app is for, what its dev workspace is for, and the video's
transcript with timestamps.

REPORT ZERO TO EIGHT TAKEAWAYS. A takeaway is an idea from the video that
would change how this app works or how it is built: a feature, a way of
working with the AI builder, a design rule, a practice. Leave out what the app
already plainly does, general advice that would change nothing here, and the
video's sponsor. A video with nothing that applies gets no takeaways, and that
is a fine answer.

FOR EACH TAKEAWAY WRITE:
- title: what to do, in at most ten words, as a plan step would name it.
- body: two or three sentences on what the idea would mean in this app, in
  plain words. Say what would change, not that the video "discusses" it.
- module: the one workspace it touches, by id, or "app" when it is about the
  whole app or how it is built.
- quote: the words from the transcript that make the point, copied exactly,
  one or two sentences.
- at: the timestamp of the line the quote is on, as m:ss or h:mm:ss.

Each takeaway makes one point. Two takeaways never make the same point. No
hype and no em dashes.`;

const replySchema = z.object({
  takeaways: z
    .array(
      z.object({
        title: z.string().default(''),
        body: z.string().default(''),
        module: z.string().nullable().optional(),
        quote: z.string().nullable().optional(),
        at: z.union([z.string(), z.number()]).nullable().optional(),
      }),
    )
    .default([]),
});

const MODULE_IDS = new Set<string>(MODULES.map((module) => module.id));

/** What the model is given about the app and the video. */
export function takeawayPrompt(video: VideoForTakeaways, visions: Visions): { prompt: string; cut: boolean } {
  const transcript = timestampedTranscript(video.cues);
  const lines = [
    'What the app is for:',
    visions.app?.trim() || '(not written yet)',
    '',
    'What the dev workspace is for (building the app with an AI builder):',
    visions.dev?.trim() || '(not written yet)',
    '',
    'Workspaces (module ids):',
    ...MODULES.map((module) => `- ${module.id}: ${module.label}. ${module.description}.`),
    `- ${WHOLE_APP}: the whole app, or how it is built.`,
    '',
    `Video: ${video.title}`,
  ];
  if (video.channel) lines.push(`Channel: ${video.channel}`);
  lines.push('', transcript.cut ? 'Transcript (the first hour or so; the rest is not shown):' : 'Transcript:');
  lines.push(transcript.text, '', `Call ${TOOL}.`);
  return { prompt: lines.join('\n'), cut: transcript.cut };
}

/** The model's reply, checked and trimmed to what can be stored. */
export function readTakeawayReply(input: unknown, cues: readonly TranscriptCue[]): TakeawayCandidate[] | null {
  const parsed = replySchema.safeParse(input);
  if (!parsed.success) return null;
  const seen = new Set<string>();
  const out: TakeawayCandidate[] = [];
  for (const raw of parsed.data.takeaways) {
    const title = raw.title.replace(/\s+/g, ' ').trim().slice(0, 200);
    const body = raw.body.trim().slice(0, 4000);
    if (!title || !body) continue;
    const key = normalise(title);
    if (seen.has(key)) continue;
    seen.add(key);
    const workspace = raw.module?.trim().toLowerCase() ?? '';
    const quote = (raw.quote ?? '').replace(/\s+/g, ' ').trim().slice(0, 2000);
    out.push({
      title,
      body,
      module: MODULE_IDS.has(workspace) ? (workspace as ModuleId) : null,
      quote,
      startSeconds: placeQuote(cues, quote, secondsFrom(raw.at)),
    });
    if (out.length === MAX_TAKEAWAYS) break;
  }
  return out;
}

/** Read one video for takeaways. Never throws. */
export async function extractVideoTakeaways(input: {
  video: VideoForTakeaways;
  visions: Visions;
  anthropicApiKey: string;
  client?: Pick<Anthropic, 'messages'>;
  onSpend?: SpendSink;
}): Promise<VideoTakeaways> {
  if (!input.video.cues.some((cue) => cue.text.trim())) {
    return { outcome: 'failed', detail: 'The transcript is empty.' };
  }
  const { prompt, cut } = takeawayPrompt(input.video, input.visions);
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  let response;
  try {
    response = await client.messages.create({
      model: TAKEAWAY_MODEL,
      max_tokens: 4096 + THINKING_ROOM,
      system: SYSTEM,
      tools: [
        {
          name: TOOL,
          description: 'Report the takeaways for this app, or none.',
          input_schema: {
            type: 'object',
            properties: {
              takeaways: {
                type: 'array',
                maxItems: MAX_TAKEAWAYS,
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    body: { type: 'string' },
                    module: { type: 'string', enum: [...MODULE_IDS, WHOLE_APP] },
                    quote: { type: 'string' },
                    at: { type: 'string', description: 'm:ss or h:mm:ss' },
                  },
                  required: ['title', 'body', 'module', 'quote', 'at'],
                },
              },
            },
            required: ['takeaways'],
          },
        },
      ],
      tool_choice: forceTool(TOOL, TAKEAWAY_MODEL),
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (error) {
    return { outcome: 'failed', detail: error instanceof Error ? error.message : 'Reading the video failed.' };
  }

  input.onSpend?.({ model: TAKEAWAY_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((part) => part.type === 'tool_use' && part.name === TOOL);
  if (!block || block.type !== 'tool_use') return { outcome: 'failed', detail: whyNoReport(response) };
  const takeaways = readTakeawayReply(block.input, input.video.cues);
  if (!takeaways) return { outcome: 'failed', detail: 'The takeaways came back malformed.' };
  return { outcome: 'read', takeaways, cut };
}
