import 'server-only';

import { createHash } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import { sumByModel, type SpendReport } from '@/lib/core/spend/pricing';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { sentencesFromCues } from '@/lib/learn/youtube/clips';
import type { LearnerProfile } from '@/lib/learn/youtube/judge-video';
import { loadLearnerProfile } from '@/lib/learn/youtube/judging';
import { loadTranscript } from '@/lib/learn/youtube/transcripts';
import { scoreClipsFor, type ClipToScore } from './score-jev';

/**
 * Scoring clips from the library run, after cutting (plan #1401).
 *
 * Which clips: every clip with no score, and every clip not yet shown (and
 * not refused) whose score was given against a different set of tracks and
 * goals than the person has now. learn.video_clips.score_profile holds a
 * fingerprint of the track and goal ids each score was given against
 * (profileFingerprint); adding, deleting or finishing a track or goal changes
 * the person's fingerprint, and their unseen clips come up again. A clip
 * already shown keeps its score.
 *
 * The clip's words are read from the stored transcript, once per video,
 * between its start and end. Where the transcript cannot be read the caption
 * and the point the cutter wrote are scored alone.
 *
 * Runs with the service client, so every read and write names the person.
 */

/** Clips scored per person per scheduled run. Jev answers in under a second each. */
export const SCORES_PER_RUN = 160;
const PAGE = 1000;

export type ScorePassResult = {
  scored: number;
  byJev: number;
  byHaiku: number;
  /** Of those scored, clips that had a score already and were scored again for new tracks or goals. */
  rescored: number;
  /** Clips that came up and got no score; tried again next run. */
  unscored: number;
  /** Haiku calls that failed. */
  failed: number;
  stopped: string | null;
};

/** A short, stable fingerprint of the track and goal ids, whatever their order. */
export function fingerprintOf(trackIds: readonly string[], goalIds: readonly string[]): string {
  const text = `t:${[...trackIds].sort().join(',')}|g:${[...goalIds].sort().join(',')}`;
  return createHash('sha256').update(text).digest('hex').slice(0, 32);
}

/**
 * The person's current fingerprint: their tracks (not survey subjects) and
 * their open goals, read as loadLearnerProfile reads them. Two cheap reads,
 * so a person with nothing to score costs no profile load.
 */
export async function profileFingerprint(learn: LearnSupabaseClient, userId: string): Promise<string> {
  const subjects = await learn.from('subjects').select('id').eq('user_id', userId).eq('survey', false);
  if (subjects.error) throw new Error(`Reading your subjects failed: ${subjects.error.message}`);
  const goals = await learn
    .schema('goals')
    .from('items')
    .select('id')
    .eq('user_id', userId)
    .eq('level', 'goal')
    .eq('status', 'open')
    .is('archived_at', null)
    .is('dismissed_at', null);
  if (goals.error) throw new Error(`Reading your goals failed: ${goals.error.message}`);
  const ids = (rows: unknown) => ((rows ?? []) as { id: string }[]).map((row) => row.id);
  return fingerprintOf(ids(subjects.data), ids(goals.data));
}

/** Everyone with clips: one row per video cut, so a few hundred at most. */
export async function peopleWithClips(learn: LearnSupabaseClient): Promise<string[]> {
  const out = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await learn
      .from('video_clip_cuts')
      .select('user_id')
      .gt('clip_count', 0)
      .order('user_id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Reading who has clips failed: ${error.message}`);
    const rows = (data ?? []) as { user_id: string }[];
    for (const row of rows) out.add(row.user_id);
    if (rows.length < PAGE) return [...out];
  }
}

export type ClipRow = {
  id: string;
  video_id: string;
  start_seconds: number;
  end_seconds: number;
  caption: string;
  idea: string | null;
  serves: string | null;
  score: number | null;
  item: { title: string; author: string | null } | { title: string; author: string | null }[] | null;
};

export const CLIP_COLUMNS =
  'id, video_id, start_seconds, end_seconds, caption, idea, serves, score, item:catalogue_items!video_clips_item_id_fkey(title, author)';

/** The clips waiting for a score: unscored first, then unseen ones scored against old tracks and goals. */
export async function clipsToScore(
  learn: LearnSupabaseClient,
  userId: string,
  fingerprint: string,
  limit: number,
): Promise<ClipRow[]> {
  const unscored = await learn
    .from('video_clips')
    .select(CLIP_COLUMNS)
    .eq('user_id', userId)
    .is('score', null)
    .order('cut_at', { ascending: false })
    .limit(limit);
  if (unscored.error) throw new Error(`Reading the clips to score failed: ${unscored.error.message}`);
  const rows = (unscored.data ?? []) as unknown as ClipRow[];
  if (rows.length >= limit) return rows;
  const stale = await learn
    .from('video_clips')
    .select(CLIP_COLUMNS)
    .eq('user_id', userId)
    .is('shown_at', null)
    .is('not_interested_at', null)
    .not('score', 'is', null)
    .neq('score_profile', fingerprint)
    .order('cut_at', { ascending: false })
    .limit(limit - rows.length);
  if (stale.error) throw new Error(`Reading the clips to score again failed: ${stale.error.message}`);
  return [...rows, ...((stale.data ?? []) as unknown as ClipRow[])];
}

/** The clip's words, from the sentences that start inside it. */
export function clipWords(
  sentences: readonly { startSeconds: number; text: string }[],
  startSeconds: number,
  endSeconds: number,
): string | null {
  const text = sentences
    .filter((sentence) => sentence.startSeconds >= startSeconds - 0.5 && sentence.startSeconds < endSeconds)
    .map((sentence) => sentence.text)
    .join(' ')
    .trim();
  return text || null;
}

/** Each clip with its words, reading each video's transcript once. */
export async function withWords(learn: LearnSupabaseClient, rows: readonly ClipRow[]): Promise<ClipToScore[]> {
  const sentences = new Map<string, Promise<{ startSeconds: number; text: string }[] | null>>();
  const of = (videoId: string) => {
    let found = sentences.get(videoId);
    if (!found) {
      found = loadTranscript(learn, videoId)
        .then((stored) => (stored && stored.cues.length > 0 ? sentencesFromCues(stored.cues) : null))
        .catch(() => null);
      sentences.set(videoId, found);
    }
    return found;
  };
  return Promise.all(
    rows.map(async (row): Promise<ClipToScore> => {
      const item = Array.isArray(row.item) ? row.item[0] : row.item;
      const said = await of(row.video_id);
      return {
        id: row.id,
        caption: row.caption,
        idea: row.idea,
        serves: row.serves,
        title: item?.title ?? null,
        channel: item?.author ?? null,
        transcript: said ? clipWords(said, row.start_seconds, row.end_seconds) : null,
      };
    }),
  );
}

/** Score every person's waiting clips, until the cap or the time runs out. */
export async function scoreClips(
  learn: LearnSupabaseClient,
  options: {
    /** Null leaves the clips Jev could not answer for a run that has a key. */
    client: Pick<Anthropic, 'messages'> | null;
    /** Whether a person's text may go to Jev (jevEnabledFor). */
    jevEnabled: (userId: string) => Promise<boolean>;
    /** No call is started after this. */
    deadline: number;
    /** A Haiku call still running at this point is abandoned. */
    hardDeadline?: number;
    limit?: number;
    /** Once per model per person per run. */
    onSpend?: (userId: string, report: SpendReport) => void;
    jevApiKey?: string | null;
    jevFetch?: typeof fetch;
    now?: () => Date;
    /** Stands in for loadLearnerProfile, for tests. */
    profileFor?: (userId: string) => Promise<LearnerProfile>;
  },
): Promise<ScorePassResult> {
  const result: ScorePassResult = { scored: 0, byJev: 0, byHaiku: 0, rescored: 0, unscored: 0, failed: 0, stopped: null };
  const now = options.now ?? (() => new Date());
  for (const userId of await peopleWithClips(learn)) {
    if (Date.now() >= options.deadline) {
      result.stopped = 'out of time; the next run carries on';
      break;
    }
    try {
      const fingerprint = await profileFingerprint(learn, userId);
      const rows = await clipsToScore(learn, userId, fingerprint, options.limit ?? SCORES_PER_RUN);
      if (rows.length === 0) continue;
      const hadScore = new Set(rows.filter((row) => row.score !== null).map((row) => row.id));
      const profile = await (options.profileFor ? options.profileFor(userId) : loadLearnerProfile(learn, userId));
      const reports: SpendReport[] = [];
      const scored = await scoreClipsFor({
        profile,
        clips: await withWords(learn, rows),
        jevEnabled: await options.jevEnabled(userId),
        client: options.client,
        onSpend: (report) => reports.push(report),
        deadline: options.deadline,
        hardDeadline: options.hardDeadline,
        jevApiKey: options.jevApiKey,
        jevFetch: options.jevFetch,
      });
      for (const report of sumByModel(reports)) options.onSpend?.(userId, report);

      const stamp = now().toISOString();
      for (const score of scored.scores) {
        const { error } = await learn
          .from('video_clips')
          .update({
            score: score.score,
            score_by: score.by,
            score_confidence: score.confidence === null ? null : Math.round(score.confidence * 1000) / 1000,
            scored_at: stamp,
            score_profile: fingerprint,
          })
          .eq('id', score.id)
          .eq('user_id', userId);
        if (error) throw new Error(`Storing a clip's score failed: ${error.message}`);
        result.scored += 1;
        if (score.by === 'jev') result.byJev += 1;
        else result.byHaiku += 1;
        if (hadScore.has(score.id)) result.rescored += 1;
      }
      result.unscored += scored.unscored.length;
      result.failed += scored.failed;
    } catch (error) {
      result.failed += 1;
      console.error(`[clips] scoring for ${userId}`, error instanceof Error ? error.message : error);
    }
  }
  return result;
}
