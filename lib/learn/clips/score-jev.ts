import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { decideWithJev } from '@/lib/jev/decide';
import type { JevState } from '@/lib/jev/client';
import { forceTool } from '@/lib/learn/graph/tool-call';
import { learnerState } from '@/lib/learn/youtube/judge-jev-question';
import { JUDGE_VIDEO_MODEL, profileText, type LearnerProfile } from '@/lib/learn/youtube/judge-video';

/**
 * Scoring a clip from 1 to 100 for how much it serves what the person is
 * learning now (plan #1401, under #1395). The stream is ranked by it.
 *
 * Each clip is one Jev score question with ten levels, each worded from what
 * that level means. Jev takes at most ten levels, so the 1 to 100 comes from
 * the score it returns, weighted by how likely it finds each level: 0 to 9,
 * falling between levels, spread over 1 to 100 (scoreFromJev). Jev's answer
 * is used whatever its confidence, as newsletter importance does
 * (lib/news/issues/importance-jev.ts): on ten levels its belief spreads over
 * neighbours, the weighted score already carries that spread, and a clip
 * ranked a few places off costs little.
 *
 * A clip Jev could not answer, because the call failed or the account has not
 * opted in (lib/jev/enabled.ts), goes to Haiku with the same ten levels, up to
 * forty clips a call, and the level Haiku picks is mapped the same way.
 *
 * Nothing here touches the database; score-run.ts reads the clips and writes
 * the scores.
 */

/**
 * Whether clips are put to Jev at all. An account also has to have opted in.
 * Setting this to false puts every account on Haiku alone.
 */
export const CLIP_SCORE_ON_JEV = true;

export const CLIP_SCORE_MODEL = JUDGE_VIDEO_MODEL;

/** The ten levels, lowest first. Haiku reads the same wording, numbered 1 to 10. */
export const CLIP_LEVELS = [
  '1: Serves none of their tracks, goals or ideas, or makes no real point at all: chatter, an advert, housekeeping.',
  '2: A clear point, but on a topic far from anything they are learning.',
  '3: Touches one of their tracks, goals or ideas only in passing, through a shared word or a distant neighbouring topic.',
  '4: A neighbouring topic to one of their tracks or goals that might help them indirectly.',
  '5: On one of their tracks, goals or ideas, but generic, or something they have most likely already settled.',
  '6: A useful, concrete point for one of their goals or ideas, though not on a track they are working through.',
  '7: On one of their tracks with a useful point, but well behind or well ahead of where they are now.',
  '8: On one of their tracks or goals, close to where they are, with a concrete point they can use.',
  '9: On an active track near where they are, making a clear point that moves them forward.',
  '10: Squarely on an active track at their level: the next thing they are working out, made clearly and completely.',
] as const;

export const CLIP_SCORE_QUESTION = {
  type: 'score',
  question:
    'The learner watches short clips cut from videos, one after another. From the clip\'s caption, the point it makes and its transcript, how much does it serve what they are learning right now: their tracks and where they are in each, their open goals, and their recent ideas? Judge what the clip says, not how well the video is made. Most clips are 3 to 6; 10 is for the few squarely on what they are working on now.',
  levels: CLIP_LEVELS,
} as const;

/** The highest index Jev's weighted score can take. */
const TOP = CLIP_LEVELS.length - 1;

/** Jev's weighted score, 0 to 9, as the clip's score, 1 to 100. */
export function scoreFromJev(score: number): number {
  const spread = Math.round(1 + (Math.min(TOP, Math.max(0, score)) / TOP) * 99);
  return Math.min(100, Math.max(1, spread));
}

/** A level Haiku picked, 1 to 10, on the same scale: 1 is 1, 10 is 100. */
export function scoreFromLevel(level: number): number {
  return scoreFromJev(level - 1);
}

/** One clip as the scorer reads it. */
export type ClipToScore = {
  id: string;
  caption: string;
  idea: string | null;
  serves: string | null;
  /** The video's title and channel, where the catalogue row is still there. */
  title: string | null;
  channel: string | null;
  /** The clip's own words from the stored transcript, or null when it could not be read. */
  transcript: string | null;
};

/** Transcript characters sent to Jev for one clip: ninety seconds of speech is about 1,400. */
const JEV_TRANSCRIPT_CHARS = 2_500;
/** And to Haiku, where forty clips share one call. */
const HAIKU_TRANSCRIPT_CHARS = 1_500;

function clipFields(clip: ClipToScore, chars: number): Record<string, string> {
  return {
    ...(clip.title ? { video: clip.title } : {}),
    ...(clip.channel ? { channel: clip.channel } : {}),
    caption: clip.caption,
    ...(clip.idea ? { point: clip.idea } : {}),
    ...(clip.serves ? { closest_track_or_goal: clip.serves } : {}),
    ...(clip.transcript ? { transcript: clip.transcript.slice(0, chars) } : {}),
  };
}

export function clipState(profile: LearnerProfile, clip: ClipToScore): JevState {
  return { learner: learnerState(profile), clip: clipFields(clip, JEV_TRANSCRIPT_CHARS) };
}

export type ClipScore = {
  id: string;
  score: number;
  by: 'jev' | 'haiku';
  /** Jev's confidence, 0 to 1; null for Haiku. */
  confidence: number | null;
};

// ---------------------------------------------------------------------------
// Haiku, for the clips Jev could not answer

/** Clips sent in one Haiku call. */
export const HAIKU_CLIPS_PER_CALL = 40;

const TOOL_NAME = 'report_clip_scores';

const SYSTEM = `You score short video clips for one person by how much each serves what they
are learning right now: their tracks and where they are in each, their open
goals, and their recent ideas. Judge what the clip says, not how well the video
is made. Each clip is given as its number, its caption, the point it makes and
its transcript.

Pick one level for each clip:
${CLIP_LEVELS.join('\n')}

Most clips are 3 to 6; 10 is for the few squarely on what they are working on
now. Score every clip you are given, by its number, in one call.`;

const TOOL = {
  name: TOOL_NAME,
  description: 'Report the level of every clip, by its number.',
  input_schema: {
    type: 'object' as const,
    properties: {
      scores: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            number: { type: 'integer' },
            level: { type: 'integer', enum: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
          },
          required: ['number', 'level'],
        },
      },
    },
    required: ['scores'],
  },
};

export function haikuPrompt(profile: LearnerProfile, clips: readonly ClipToScore[]): string {
  const lines = [profileText({ ...profile, filed: [] }), '', 'CLIPS:'];
  clips.forEach((clip, index) => {
    const fields = clipFields(clip, HAIKU_TRANSCRIPT_CHARS);
    lines.push('', `${index + 1}.`);
    for (const [key, value] of Object.entries(fields)) lines.push(`   ${key}: ${value}`);
  });
  return lines.join('\n');
}

/** The levels in a reply, by clip number. A level that is not a whole number from 1 to 10 is dropped. */
export function readHaikuReply(input: unknown, count: number): Map<number, number> {
  const out = new Map<number, number>();
  const given = (input as { scores?: unknown } | null)?.scores;
  for (const item of Array.isArray(given) ? given : []) {
    const { number, level } = (item ?? {}) as Record<string, unknown>;
    if (typeof number !== 'number' || !Number.isInteger(number) || number < 1 || number > count) continue;
    if (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > 10) continue;
    out.set(number, level);
  }
  return out;
}

/** One Haiku call scoring up to forty clips. Throws on a failed call. */
async function haikuScores(
  client: Pick<Anthropic, 'messages'>,
  profile: LearnerProfile,
  clips: readonly ClipToScore[],
  onSpend: SpendSink | undefined,
  timeoutMs: number | undefined,
): Promise<ClipScore[]> {
  const response = await client.messages.create(
    {
      model: CLIP_SCORE_MODEL,
      max_tokens: 2_000,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: forceTool(TOOL_NAME),
      messages: [{ role: 'user', content: haikuPrompt(profile, clips) }],
    },
    timeoutMs !== undefined ? { timeout: Math.max(1_000, timeoutMs), maxRetries: 0 } : undefined,
  );
  onSpend?.({ model: CLIP_SCORE_MODEL, usage: usageFrom(response.usage) });
  const block = response.content.find((part) => part.type === 'tool_use' && part.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') throw new Error('The model reported no scores.');
  const levels = readHaikuReply(block.input, clips.length);
  return [...levels].map(([number, level]) => ({
    id: clips[number - 1].id,
    score: scoreFromLevel(level),
    by: 'haiku' as const,
    confidence: null,
  }));
}

// ---------------------------------------------------------------------------
// Both together

/** Jev calls in flight at once. */
const JEV_CONCURRENCY = 8;
/** A Haiku call is not started with less than this left before the hard deadline. */
const HAIKU_MIN_MS = 6_000;

export type ScoreClipsResult = {
  scores: ClipScore[];
  /** Clips that got no score this time: Haiku failed, was not available, or time ran out. */
  unscored: string[];
  /** Haiku calls that failed. */
  failed: number;
};

/**
 * Score one person's clips: Jev first, one clip at a time, then Haiku for
 * whatever Jev could not answer. Never throws; a clip left unscored is tried
 * again on the next run.
 */
export async function scoreClipsFor(input: {
  profile: LearnerProfile;
  clips: readonly ClipToScore[];
  /** Whether this account's text may go to Jev (jevEnabledFor). */
  jevEnabled: boolean;
  /** Null when there is no Anthropic key: Jev's scores only. */
  client: Pick<Anthropic, 'messages'> | null;
  /** Every model call's cost, Jev's and Haiku's. */
  onSpend?: SpendSink;
  /** No Jev or Haiku call is started after this. */
  deadline?: number;
  /** A Haiku call still running at this point is abandoned. */
  hardDeadline?: number;
  jevApiKey?: string | null;
  jevFetch?: typeof fetch;
  now?: () => number;
}): Promise<ScoreClipsResult> {
  const now = input.now ?? Date.now;
  const late = () => input.deadline !== undefined && now() >= input.deadline;
  const scores: ClipScore[] = [];
  let rest: ClipToScore[] = [...input.clips];

  if (CLIP_SCORE_ON_JEV && input.jevEnabled) {
    const left: ClipToScore[] = [];
    let next = 0;
    const worker = async () => {
      while (next < input.clips.length) {
        const clip = input.clips[next++];
        if (late()) {
          left.push(clip);
          continue;
        }
        const decided = await decideWithJev<typeof CLIP_SCORE_QUESTION, ClipScore | null>({
          state: clipState(input.profile, clip),
          question: CLIP_SCORE_QUESTION,
          read: (answer) => ({ id: clip.id, score: scoreFromJev(answer.score), by: 'jev', confidence: answer.confidence }),
          fallback: async () => null,
          floor: 0,
          onSpend: input.onSpend,
          apiKey: input.jevApiKey,
          fetch: input.jevFetch,
        });
        if (decided.value) scores.push(decided.value);
        else left.push(clip);
      }
    };
    await Promise.all(Array.from({ length: Math.min(JEV_CONCURRENCY, input.clips.length) }, worker));
    rest = input.clips.filter((clip) => left.includes(clip));
  }

  const unscored: string[] = [];
  let failed = 0;
  for (let from = 0; from < rest.length; from += HAIKU_CLIPS_PER_CALL) {
    const chunk = rest.slice(from, from + HAIKU_CLIPS_PER_CALL);
    const remaining = input.hardDeadline !== undefined ? input.hardDeadline - now() : undefined;
    if (!input.client || late() || (remaining !== undefined && remaining < HAIKU_MIN_MS)) {
      unscored.push(...chunk.map((clip) => clip.id));
      continue;
    }
    try {
      const got = await haikuScores(input.client, input.profile, chunk, input.onSpend, remaining);
      scores.push(...got);
      const done = new Set(got.map((score) => score.id));
      unscored.push(...chunk.filter((clip) => !done.has(clip.id)).map((clip) => clip.id));
    } catch (error) {
      failed += 1;
      unscored.push(...chunk.map((clip) => clip.id));
      console.warn('[clips] scoring with Haiku failed', error instanceof Error ? error.message : error);
    }
  }
  return { scores, unscored, failed };
}

/** A client for the run, or null without a key. */
export function haikuClient(anthropicApiKey: string | null | undefined): Anthropic | null {
  return anthropicApiKey?.trim() ? new Anthropic({ apiKey: anthropicApiKey.trim() }) : null;
}
