import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { askJevAll, type JevQuestion, type JevResult, type JevScoreAnswer } from '@/lib/jev/client';
import { forceTool } from '@/lib/learn/graph/tool-call';
import { combinedRating } from './rank';
import { CLIP_SCORE_MODEL, type ClipToScore } from './score-jev';

/**
 * Rating a clip on three axes: educational value, entertainment and quality.
 *
 * The person asked for the clip stream to be ordered by what is good in a
 * clip, with Jev rating each one on those three. The ratings are about the
 * clip alone, not about the person's tracks (that is the relevance score in
 * score-jev.ts), so Jev reads the video's title, its channel, the caption and
 * the clip's own transcript, and no learner state. A clip is rated once.
 *
 * Jev gets the three as score questions in one request (askJevAll), so the
 * transcript is sent and charged once. Each answer is used whatever its
 * confidence, as the relevance score's is: a rating a few points off moves a
 * clip a few places, and a second model reading the same transcript would not
 * know more. A clip Jev could not rate on all three, because the call failed
 * or the account has not opted in (lib/jev/enabled.ts), goes to Haiku with the
 * same levels, up to forty clips a call.
 *
 * Nothing here touches the database; rate-run.ts reads the clips and writes
 * the ratings.
 */

/** Whether clips are put to Jev at all. An account also has to have opted in. */
export const CLIP_RATE_ON_JEV = true;

/** Five levels a question, lowest first. Haiku reads the same wording, numbered 1 to 5. */
export const RATING_QUESTIONS = {
  educational: {
    type: 'score',
    question:
      'A viewer watches this short clip cut from a video. How much would they learn from it: a clear idea, ' +
      'fact, method or argument they can take away? Judge from what the transcript says.',
    levels: [
      '1: Nothing to learn: chatter, an advert, housekeeping or a joke with no point.',
      '2: A passing remark or a claim with no explanation behind it.',
      '3: One useful point, stated but not explained.',
      '4: A clear point, explained well enough to use.',
      '5: A substantial idea explained clearly and completely: a viewer comes away knowing something new.',
    ],
  },
  entertainment: {
    type: 'score',
    question:
      'How engaging is this clip to watch: would a viewer want to keep watching it? Judge the delivery, the story, ' +
      'the humour or the energy in the transcript, not whether the topic is useful.',
    levels: [
      '1: Dull: flat, rambling or hard to sit through.',
      '2: Mostly dry, with little to hold attention.',
      '3: Holds attention without standing out.',
      '4: Engaging: a good story, example, turn of phrase or lively delivery.',
      '5: Gripping or very funny: a viewer would happily watch it again.',
    ],
  },
  quality: {
    type: 'score',
    question:
      'How well made is this clip as a piece on its own: does it start and end cleanly, make sense without the rest ' +
      'of the video, and say what it says clearly and accurately?',
    levels: [
      '1: Poor: starts or ends mid-thought, makes no sense alone, or is muddled or wrong.',
      '2: Hard to follow alone, or loose and repetitive.',
      '3: Understandable alone, with some loose ends or filler.',
      '4: Clean: stands alone and says its point clearly.',
      '5: Excellent: self-contained, tight and precise from first word to last.',
    ],
  },
} as const satisfies Record<string, JevQuestion>;

export type RatingAxis = keyof typeof RATING_QUESTIONS;
export const RATING_AXES = Object.keys(RATING_QUESTIONS) as RatingAxis[];

/** The highest level index, 0-based. */
const TOP = 4;

/** Jev's weighted score, 0 to 4, as a rating from 1 to 100. */
export function ratingFromJev(score: number): number {
  const spread = Math.round(1 + (Math.min(TOP, Math.max(0, score)) / TOP) * 99);
  return Math.min(100, Math.max(1, spread));
}

/** A level Haiku picked, 1 to 5, on the same scale: 1 is 1, 5 is 100. */
export function ratingFromLevel(level: number): number {
  return ratingFromJev(level - 1);
}

export type ClipRating = {
  id: string;
  educational: number;
  entertainment: number;
  quality: number;
  /** The three combined, as the stream ranks by it. */
  rating: number;
  by: 'jev' | 'haiku';
};

function rated(id: string, by: ClipRating['by'], values: Record<RatingAxis, number>): ClipRating {
  return {
    id,
    ...values,
    rating: combinedRating(values.educational, values.entertainment, values.quality),
    by,
  };
}

/** Transcript characters sent to Jev for one clip: ninety seconds of speech is about 1,400. */
const JEV_TRANSCRIPT_CHARS = 2_500;
/** And to Haiku, where forty clips share one call. */
const HAIKU_TRANSCRIPT_CHARS = 1_500;

function clipFields(clip: ClipToScore, chars: number): Record<string, string> {
  return {
    ...(clip.title ? { video: clip.title } : {}),
    ...(clip.channel ? { channel: clip.channel } : {}),
    caption: clip.caption,
    ...(clip.transcript ? { transcript: clip.transcript.slice(0, chars) } : {}),
  };
}

/** What Jev reads about one clip. */
export function ratingState(clip: ClipToScore): Record<string, unknown> {
  return { clip: clipFields(clip, JEV_TRANSCRIPT_CHARS) };
}

/** Jev's three answers as a rating, or null when any of them could not be read. */
export function readJevRatings(
  id: string,
  answers: Record<RatingAxis, JevResult<JevScoreAnswer>>,
): ClipRating | null {
  const values = {} as Record<RatingAxis, number>;
  for (const axis of RATING_AXES) {
    const answer = answers[axis];
    if (!answer.ok) return null;
    values[axis] = ratingFromJev(answer.answer.score);
  }
  return rated(id, 'jev', values);
}

// ---------------------------------------------------------------------------
// Haiku, for the clips Jev could not rate

/** Clips sent in one Haiku call. */
export const HAIKU_CLIPS_PER_CALL = 40;

const TOOL_NAME = 'report_clip_ratings';

const levelsText = (axis: RatingAxis) => RATING_QUESTIONS[axis].levels.join('\n');

const SYSTEM = `You rate short video clips on three things, each from 1 to 5. Each clip is
given as its number, the video's title and channel, its caption and its
transcript.

educational: ${RATING_QUESTIONS.educational.question}
${levelsText('educational')}

entertainment: ${RATING_QUESTIONS.entertainment.question}
${levelsText('entertainment')}

quality: ${RATING_QUESTIONS.quality.question}
${levelsText('quality')}

Most clips are 2 to 4 on each. Rate every clip you are given, by its number,
in one call.`;

const level = { type: 'integer', enum: [1, 2, 3, 4, 5] } as const;

const TOOL = {
  name: TOOL_NAME,
  description: 'Report the three ratings of every clip, by its number.',
  input_schema: {
    type: 'object' as const,
    properties: {
      ratings: {
        type: 'array',
        items: {
          type: 'object',
          properties: { number: { type: 'integer' }, educational: level, entertainment: level, quality: level },
          required: ['number', 'educational', 'entertainment', 'quality'],
        },
      },
    },
    required: ['ratings'],
  },
};

export function haikuPrompt(clips: readonly ClipToScore[]): string {
  const lines = ['CLIPS:'];
  clips.forEach((clip, index) => {
    lines.push('', `${index + 1}.`);
    for (const [key, value] of Object.entries(clipFields(clip, HAIKU_TRANSCRIPT_CHARS))) lines.push(`   ${key}: ${value}`);
  });
  return lines.join('\n');
}

const isLevel = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;

/** The levels in a reply, by clip number. A clip missing any of the three, or with one out of range, is dropped. */
export function readHaikuReply(input: unknown, count: number): Map<number, Record<RatingAxis, number>> {
  const out = new Map<number, Record<RatingAxis, number>>();
  const given = (input as { ratings?: unknown } | null)?.ratings;
  for (const item of Array.isArray(given) ? given : []) {
    const row = (item ?? {}) as Record<string, unknown>;
    const number = row.number;
    if (typeof number !== 'number' || !Number.isInteger(number) || number < 1 || number > count) continue;
    if (!RATING_AXES.every((axis) => isLevel(row[axis]))) continue;
    out.set(number, {
      educational: row.educational as number,
      entertainment: row.entertainment as number,
      quality: row.quality as number,
    });
  }
  return out;
}

async function haikuRatings(
  client: Pick<Anthropic, 'messages'>,
  clips: readonly ClipToScore[],
  onSpend: SpendSink | undefined,
  timeoutMs: number | undefined,
): Promise<ClipRating[]> {
  const response = await client.messages.create(
    {
      model: CLIP_SCORE_MODEL,
      max_tokens: 3_000,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: forceTool(TOOL_NAME, CLIP_SCORE_MODEL),
      messages: [{ role: 'user', content: haikuPrompt(clips) }],
    },
    timeoutMs !== undefined ? { timeout: Math.max(1_000, timeoutMs), maxRetries: 0 } : undefined,
  );
  onSpend?.({ model: CLIP_SCORE_MODEL, usage: usageFrom(response.usage) });
  const block = response.content.find((part) => part.type === 'tool_use' && part.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') throw new Error('The model reported no ratings.');
  return [...readHaikuReply(block.input, clips.length)].map(([number, levels]) =>
    rated(clips[number - 1].id, 'haiku', {
      educational: ratingFromLevel(levels.educational),
      entertainment: ratingFromLevel(levels.entertainment),
      quality: ratingFromLevel(levels.quality),
    }),
  );
}

// ---------------------------------------------------------------------------
// Both together

/** Jev calls in flight at once. */
const JEV_CONCURRENCY = 8;
/** A Haiku call is not started with less than this left before the hard deadline. */
const HAIKU_MIN_MS = 6_000;

export type RateClipsResult = {
  ratings: ClipRating[];
  /** Clips that got no rating this time: tried again next run. */
  unrated: string[];
  /** Haiku calls that failed. */
  failed: number;
};

/**
 * Rate one person's clips: Jev first, one request a clip, then Haiku for
 * whatever Jev could not rate. Never throws.
 */
export async function rateClipsFor(input: {
  clips: readonly ClipToScore[];
  /** Whether this account's text may go to Jev (jevEnabledFor). */
  jevEnabled: boolean;
  /** Null when there is no Anthropic key: Jev's ratings only. */
  client: Pick<Anthropic, 'messages'> | null;
  onSpend?: SpendSink;
  /** No call is started after this. */
  deadline?: number;
  /** A Haiku call still running at this point is abandoned. */
  hardDeadline?: number;
  jevApiKey?: string | null;
  jevFetch?: typeof fetch;
  now?: () => number;
}): Promise<RateClipsResult> {
  const now = input.now ?? Date.now;
  const late = () => input.deadline !== undefined && now() >= input.deadline;
  const ratings: ClipRating[] = [];
  let rest: ClipToScore[] = [...input.clips];

  if (CLIP_RATE_ON_JEV && input.jevEnabled) {
    const left = new Set<ClipToScore>();
    let next = 0;
    const worker = async () => {
      while (next < input.clips.length) {
        const clip = input.clips[next++];
        if (late()) {
          left.add(clip);
          continue;
        }
        const asked = await askJevAll({
          state: ratingState(clip),
          questions: RATING_QUESTIONS,
          onSpend: input.onSpend,
          apiKey: input.jevApiKey,
          fetch: input.jevFetch,
        });
        if (!asked.ok && asked.reason !== 'no-key') console.warn(`[clips] rating with Jev: ${asked.reason}: ${asked.detail}`);
        const rating = asked.ok ? readJevRatings(clip.id, asked.answers) : null;
        if (rating) ratings.push(rating);
        else left.add(clip);
      }
    };
    await Promise.all(Array.from({ length: Math.min(JEV_CONCURRENCY, input.clips.length) }, worker));
    rest = input.clips.filter((clip) => left.has(clip));
  }

  const unrated: string[] = [];
  let failed = 0;
  for (let from = 0; from < rest.length; from += HAIKU_CLIPS_PER_CALL) {
    const chunk = rest.slice(from, from + HAIKU_CLIPS_PER_CALL);
    const remaining = input.hardDeadline !== undefined ? input.hardDeadline - now() : undefined;
    if (!input.client || late() || (remaining !== undefined && remaining < HAIKU_MIN_MS)) {
      unrated.push(...chunk.map((clip) => clip.id));
      continue;
    }
    try {
      const got = await haikuRatings(input.client, chunk, input.onSpend, remaining);
      ratings.push(...got);
      const done = new Set(got.map((rating) => rating.id));
      unrated.push(...chunk.filter((clip) => !done.has(clip.id)).map((clip) => clip.id));
    } catch (error) {
      failed += 1;
      unrated.push(...chunk.map((clip) => clip.id));
      console.warn('[clips] rating with Haiku failed', error instanceof Error ? error.message : error);
    }
  }
  return { ratings, unrated, failed };
}
