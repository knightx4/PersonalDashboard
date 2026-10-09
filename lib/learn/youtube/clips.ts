import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import type { TranscriptCue } from '@/lib/learn/catalogue/segment';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { clockTime } from './format';
import { JUDGE_VIDEO_MODEL, profileText, type LearnerProfile } from './judge-video';

/**
 * Cutting one video's transcript into short clips (plan #1398, under #1395).
 *
 * The timed lines from the stored transcript are joined into sentences, each
 * labelled with the second it starts at, and sent to Haiku with what Learn
 * knows about the person (the profile the video judge reads). Haiku names the
 * stretches that each make one complete point on their own, by the labels of
 * their first and last sentence, so every clip starts and ends on a sentence
 * boundary. Intros, sponsor reads and sign-offs are left out, and a clip that
 * leans on what came before it is reported as not standing alone and dropped.
 *
 * Haiku finds the clips; it does not score them. Jev ranks them in #1401, so
 * every clip leaves here with no score.
 *
 * The call is here and the database is in clip-run.ts, so the prompt, the
 * reply checks and the arithmetic from sentences to seconds are tested
 * without either.
 */

export const CLIP_MODEL = JUDGE_VIDEO_MODEL;

/** The longest clip kept. The table allows 180; the step's done-when says 90. */
export const MAX_CLIP_SECONDS = 90;
/** The shortest: anything briefer is a fragment, not a point. */
export const MIN_CLIP_SECONDS = 10;
/** Clips kept from one video. */
export const MAX_CLIPS_PER_VIDEO = 30;
/**
 * Transcript text sent, all told: about two hours of speech. A longer video is
 * cut from its first two hours only.
 */
const TEXT_BUDGET = 120_000;
/** A sentence with no full stop in sight is closed after this long or this many characters. */
const MAX_SENTENCE_SECONDS = 15;
const MAX_SENTENCE_CHARS = 300;

const CAPTION_CHARS = 300;
const IDEA_CHARS = 1_000;
const SERVES_CHARS = 300;

/** One sentence of the transcript, as the prompt numbers it. */
export type Sentence = { startSeconds: number; endSeconds: number; text: string };

function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The cues joined into sentences. A sentence closes at a full stop, question
 * or exclamation mark, or, for captions with no punctuation, once it has run
 * fifteen seconds or three hundred characters. A cue with no end runs to the
 * next cue's start.
 */
export function sentencesFromCues(cues: readonly TranscriptCue[]): Sentence[] {
  const usable = cues.filter((cue) => cue.startSeconds >= 0 && tidy(cue.text) !== '');
  const out: Sentence[] = [];
  let open: Sentence | null = null;
  usable.forEach((cue, index) => {
    const end = cue.endSeconds ?? usable[index + 1]?.startSeconds ?? cue.startSeconds + 2;
    const text = tidy(cue.text);
    if (open) {
      open.text = `${open.text} ${text}`;
      open.endSeconds = Math.max(open.endSeconds, end);
    } else {
      open = { startSeconds: cue.startSeconds, endSeconds: Math.max(end, cue.startSeconds), text };
    }
    const closes =
      /[.?!]["')\]]?$/.test(text) ||
      open.endSeconds - open.startSeconds >= MAX_SENTENCE_SECONDS ||
      open.text.length >= MAX_SENTENCE_CHARS;
    if (closes) {
      out.push(open);
      open = null;
    }
  });
  if (open) out.push(open);
  return out;
}

/** The sentences that fit the text budget, from the start. */
function withinBudget(sentences: readonly Sentence[]): Sentence[] {
  let used = 0;
  const out: Sentence[] = [];
  for (const sentence of sentences) {
    used += sentence.text.length + 8;
    if (used > TEXT_BUDGET) break;
    out.push(sentence);
  }
  return out;
}

export type VideoToCut = {
  title: string;
  channel: string | null;
  durationSeconds: number | null;
  sentences: Sentence[];
};

const CUT_TOOL = 'report_clips';

const CUT_SYSTEM = `You cut a video into short clips for a person who watches them one after
another, like a feed. You have the video's transcript as numbered sentences;
each number is the second that sentence starts at. You are told what the
person is learning.

A CLIP is a run of whole sentences, about 20 to 90 seconds long, that makes
ONE complete point on its own: someone who saw nothing before it understands
it, and it ends where the point lands. Never cut mid-thought.

Leave out: intros and greetings, "in this video we will", sponsor reads and
ads, requests to like or subscribe, housekeeping, and sign-offs. Leave out a
stretch that only makes sense with what came before it ("as we just saw",
"so that is why"), unless the clip can start earlier and still stay under 90
seconds. Prefer the stretches that serve the person's tracks and goals, but a
clear, self-contained point on another topic is still a clip.

For each clip report:
- start: the number of its first sentence, exactly as given.
- end: the number of its last sentence, exactly as given: the second that
  sentence starts at, not the second the clip ends.
- caption: one line shown over the clip, at most 100 characters, saying what
  it shows, in plain words. No hype, no em dashes, no "in this clip".
- idea: the point it makes, in one sentence.
- serves: every track and goal it serves, each name copied exactly from the
  list, most relevant first; an empty list when it serves none. Never the
  video's own title.
- stands_alone: true only if it makes sense to someone who saw nothing before
  it.

At most one clip for every two minutes of video, in order, never overlapping.
A video with nothing worth a clip gets an empty list.`;

export function cutPrompt(profile: LearnerProfile, video: VideoToCut): string {
  const lines = [profileText(profile), '', `VIDEO: "${video.title}"`];
  if (video.channel) lines.push(`Channel: ${video.channel}`);
  if (video.durationSeconds !== null) lines.push(`Length: ${clockTime(video.durationSeconds)}`);
  lines.push('', 'TRANSCRIPT (each number is the second the sentence starts at):');
  for (const sentence of withinBudget(video.sentences)) lines.push(`[${Math.floor(sentence.startSeconds)}] ${sentence.text}`);
  lines.push('', `Call ${CUT_TOOL}.`);
  return lines.join('\n');
}

const cutReplySchema = z.object({
  clips: z
    .array(
      z.object({
        start: z.coerce.number(),
        end: z.coerce.number(),
        caption: z.string(),
        idea: z.string().optional().nullable(),
        serves: z.union([z.array(z.string()), z.string()]).optional().nullable(),
        stands_alone: z.boolean().optional().default(true),
      }),
    )
    .default([]),
});

/** A clip as it is stored, before the person and the video are added. */
export type Clip = {
  startSeconds: number;
  endSeconds: number;
  caption: string;
  idea: string | null;
  serves: string | null;
  /** The first track it serves; the ranker's theme lean reads it. */
  subjectId: string | null;
  goalId: string | null;
  /** Every track it serves, first match first: one learn.video_clip_subjects row each. */
  subjectIds: string[];
};

function cap(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

function key(name: string): string {
  return name
    .toLowerCase()
    .replace(/["'“”‘’]/g, '')
    .replace(/^(track|goal)\s*:?\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Names the cutter may give one clip; any past this are ignored. */
const MAX_SERVES_NAMES = 10;

/** What a clip serves, read from the names the cutter gave. */
export type ServesMatch = {
  /** The name kept in video_clips.serves: the first track matched, else the first goal, else the first name of the profile. */
  serves: string | null;
  /** The first track matched, as before (plan #1695). */
  subjectId: string | null;
  /** The first goal matched, only when no track was. */
  goalId: string | null;
  /** Every track matched, in the cutter's order, each once. */
  subjectIds: string[];
};

/**
 * The tracks and goals the names point at, when they match one by name. Every
 * track named is kept (plan #1695); a name that matches nothing in the
 * profile, most often the video's own title, serves nothing.
 */
export function matchServes(names: readonly string[] | string | null, profile: LearnerProfile): ServesMatch {
  const list = (typeof names === 'string' ? [names] : (names ?? []))
    .map((name) => tidy(name))
    .filter(Boolean)
    .slice(0, MAX_SERVES_NAMES);
  const subjectIds: string[] = [];
  let firstTrack: string | null = null;
  let firstGoal: { id: string; name: string } | null = null;
  let firstNamed: string | null = null;
  for (const name of list) {
    const wanted = key(name);
    const tracks = profile.tracks.filter((track) => key(track.name) === wanted);
    const goals = profile.goals.filter((goal) => key(goal.title) === wanted);
    if (tracks.length === 0 && goals.length === 0) continue;
    firstNamed ??= name;
    const track = tracks.find((candidate) => candidate.id);
    if (track?.id) {
      firstTrack ??= name;
      if (!subjectIds.includes(track.id)) subjectIds.push(track.id);
      continue;
    }
    const goal = goals.find((candidate) => candidate.id);
    if (goal?.id && !firstGoal) firstGoal = { id: goal.id, name };
  }
  const subjectId = subjectIds[0] ?? null;
  const goalId = subjectId ? null : (firstGoal?.id ?? null);
  const serves = firstTrack ?? firstGoal?.name ?? firstNamed;
  return { serves: serves ? cap(serves, SERVES_CHARS) : null, subjectId, goalId, subjectIds };
}

/** A caption with its em dashes turned into commas, which the prompt asks for and Haiku does not always give. */
function plainCaption(text: string): string {
  return tidy(text.replace(/\s*—\s*/g, ', '));
}

/** The sentence a number names: the one starting at that second, or the nearest within two seconds. */
function sentenceAt(sentences: readonly Sentence[], second: number): number {
  let best = -1;
  let distance = Infinity;
  sentences.forEach((sentence, index) => {
    const gap = Math.abs(Math.floor(sentence.startSeconds) - second);
    if (gap < distance) {
      best = index;
      distance = gap;
    }
  });
  return distance <= 2 ? best : -1;
}

/**
 * The reply, turned into clips with times in whole seconds.
 *
 * Dropped: a clip whose start or end names no sentence, one reported as not
 * standing alone, one with no caption, one shorter than ten seconds or longer
 * than ninety, and one that overlaps a clip before it. What is left is in
 * order, at most thirty. What a clip serves is kept only when it names one of
 * the person's tracks or goals, and every track it names is kept.
 */
export function readCutReply(input: unknown, sentences: readonly Sentence[], profile: LearnerProfile): Clip[] | null {
  const parsed = cutReplySchema.safeParse(input);
  if (!parsed.success) return null;
  const candidates: Clip[] = [];
  for (const row of parsed.data.clips) {
    if (!row.stands_alone) continue;
    const caption = plainCaption(row.caption);
    if (!caption) continue;
    let first = sentenceAt(sentences, Math.round(row.start));
    let last = sentenceAt(sentences, Math.round(row.end));
    if (first < 0 || last < 0) continue;
    if (last < first) [first, last] = [last, first];
    const startSeconds = Math.floor(sentences[first].startSeconds);
    const endSeconds = Math.ceil(sentences[last].endSeconds);
    const span = endSeconds - startSeconds;
    if (span < MIN_CLIP_SECONDS || span > MAX_CLIP_SECONDS) continue;
    candidates.push({
      startSeconds,
      endSeconds,
      caption: cap(caption, CAPTION_CHARS),
      idea: tidy(row.idea ?? '') ? cap(tidy(row.idea ?? ''), IDEA_CHARS) : null,
      ...matchServes(row.serves ?? null, profile),
    });
  }
  candidates.sort((a, b) => a.startSeconds - b.startSeconds);
  const kept: Clip[] = [];
  for (const clip of candidates) {
    const previous = kept[kept.length - 1];
    if (previous && clip.startSeconds < previous.endSeconds) continue;
    kept.push(clip);
    if (kept.length >= MAX_CLIPS_PER_VIDEO) break;
  }
  return kept;
}

export type CutResult =
  | { outcome: 'cut'; clips: Clip[] }
  /** The reply came back but could not be read. Recorded, so the video is not sent again. */
  | { outcome: 'unreadable'; detail: string }
  /** The call itself failed or ran out of time. Not recorded, so the next run tries again. */
  | { outcome: 'failed'; detail: string };

/** Cut one video. Never throws. */
export async function cutVideo(input: {
  profile: LearnerProfile;
  video: VideoToCut;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
  /** Milliseconds the call may take before it is abandoned. */
  timeoutMs?: number;
}): Promise<CutResult> {
  if (input.video.sentences.length === 0) return { outcome: 'cut', clips: [] };
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  let response;
  try {
    response = await client.messages.create(
      {
        model: CLIP_MODEL,
        max_tokens: 6000,
        system: CUT_SYSTEM,
        tools: [
          {
            name: CUT_TOOL,
            description: 'Report the clips cut from the video, in order.',
            input_schema: {
              type: 'object',
              properties: {
                clips: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      start: { type: 'integer', description: 'The number of the first sentence.' },
                      end: { type: 'integer', description: 'The number of the last sentence.' },
                      caption: { type: 'string' },
                      idea: { type: 'string' },
                      serves: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Every track and goal it serves, names copied exactly from the list.',
                      },
                      stands_alone: { type: 'boolean' },
                    },
                    required: ['start', 'end', 'caption', 'idea', 'serves', 'stands_alone'],
                  },
                },
              },
              required: ['clips'],
            },
          },
        ],
        tool_choice: forceTool(CUT_TOOL, CLIP_MODEL),
        messages: [{ role: 'user', content: cutPrompt(input.profile, input.video) }],
      },
      input.timeoutMs !== undefined ? { timeout: Math.max(1_000, input.timeoutMs), maxRetries: 0 } : undefined,
    );
  } catch (error) {
    return { outcome: 'failed', detail: error instanceof Error ? error.message : 'Cutting the video failed.' };
  }
  input.onSpend?.({ model: CLIP_MODEL, usage: usageFrom(response.usage) });
  const block = response.content.find((part) => part.type === 'tool_use' && part.name === CUT_TOOL);
  if (!block || block.type !== 'tool_use') return { outcome: 'unreadable', detail: whyNoReport(response) };
  const clips = readCutReply(block.input, input.video.sentences, input.profile);
  return clips ? { outcome: 'cut', clips } : { outcome: 'unreadable', detail: 'The clips came back malformed.' };
}
