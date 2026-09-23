import type postgres from 'postgres';
import {
  chaptersFromDescription,
  fetchYouTubePlaylist,
  lectureLabel,
  type YouTubeVideo,
} from '@/lib/learn/providers/youtube';
import { fetchWikipediaArticle } from '@/lib/learn/providers/wikipedia';
import { ocwTranscriptLookup } from '@/lib/learn/providers/ocw';
import { segmentsForVideo, type TranscriptCue } from './segment';
import {
  storeArticle,
  storeCourse,
  type CourseVideoInput,
  type StoredArticle,
  type StoredCourse,
} from './store';

/**
 * Naming an article and having it stored.
 *
 * Fetch, split, write -- the whole of the Wikipedia sweep, in the order
 * docs/LEARN-SOURCES-SPEC.md puts it: the catalogue is filled before anything
 * is embedded, and embedding is a second pass over the segments this leaves
 * behind with a null `embedding`.
 *
 * A refusal is returned rather than thrown. A mistyped title is an ordinary
 * outcome of naming an article by hand, and the caller wants to print it
 * rather than catch it.
 */

export type SweepResult =
  | ({ ok: true; title: string } & StoredArticle)
  | { ok: false; reason: string; detail: string };

export async function sweepWikipediaArticle(
  sql: postgres.Sql,
  title: string,
): Promise<SweepResult> {
  const article = await fetchWikipediaArticle(title);
  if (!article.ok) return { ok: false, reason: article.reason, detail: article.detail };

  const stored = await storeArticle(sql, article);
  return { ok: true, title: article.title, ...stored };
}

/**
 * Where a lecture's words come from.
 *
 * Not from YouTube: `captions.download` needs an OAuth token from the account
 * that owns the video and answers 403 for anything else, which is why
 * docs/LEARN-SOURCES-SPEC.md sends this to the institution instead. MIT, Yale
 * and TED each publish transcripts on their own site, in their own shape, so
 * each is an adapter rather than a shared fetch.
 *
 * A port, so this module composes the same way whether an adapter exists or
 * not. Null means no transcript could be reached, which is an ordinary answer
 * and not a failure: the lecture falls back to its chapter markers, and then
 * to one segment for the whole video.
 */
export type TranscriptLookup = (video: {
  videoId: string;
  title: string;
  canonicalUrl: string;
  /** Where an institution's uploads say which course a lecture belongs to. */
  description: string;
}) => Promise<TranscriptCue[] | null>;

/** The default for a provider with no institution adapter. */
export const noTranscripts: TranscriptLookup = async () => null;

/**
 * The adapter for a provider's transcripts, by its slug in
 * `learn.catalogue_providers`. A fresh one per call, because the OCW adapter
 * remembers the courses it has read and that memory belongs to one sweep.
 */
export function transcriptsForProvider(
  providerSlug: string,
  onRefused?: (detail: string) => void,
): TranscriptLookup {
  if (providerSlug === 'mit-ocw') return ocwTranscriptLookup(onRefused);
  return noTranscripts;
}

/**
 * The provider a course belongs to unless another is named. MIT
 * OpenCourseWare is the one docs/LEARN-SOURCES-SPEC.md puts first, and the
 * slug has to match a row seeded in `learn.catalogue_providers`.
 */
export const DEFAULT_COURSE_PROVIDER = 'mit-ocw';

export type CourseSweepResult =
  | ({
      ok: true;
      title: string;
      /**
       * How many lectures were cut each of the three ways this time. A lecture
       * kept as it was stored is in none of them; it is counted in `kept`.
       */
      cutBy: { transcript: number; chapters: number; whole: number };
      /**
       * Lectures whose transcript was not looked for because the deadline had
       * passed. They are stored with the chapter or whole-video cut, and the
       * next sweep that is given `keep` looks for their transcripts again.
       */
      notReached: number;
      /** Pages the transcript site would not hand over, one line each. */
      refused: string[];
    } & StoredCourse)
  | { ok: false; reason: string; detail: string };

function videoToStore(video: YouTubeVideo, cues: TranscriptCue[] | null): {
  input: CourseVideoInput;
  cutBy: 'transcript' | 'chapters' | 'whole';
} {
  const { segments, cutBy } = segmentsForVideo(
    {
      title: video.title,
      description: video.description,
      durationSeconds: video.durationSeconds,
      chapters: chaptersFromDescription(video.description),
    },
    cues,
  );

  return {
    cutBy,
    input: {
      externalId: video.videoId,
      title: video.title,
      kind: 'video',
      canonicalUrl: video.canonicalUrl,
      lengthChars: null,
      durationSeconds: video.durationSeconds,
      publishedAt: video.publishedAt,
      providerLabel: lectureLabel(video.title),
      segments,
    },
  };
}

export type CourseSweepOptions = {
  providerSlug: string;
  playlistId: string;
  transcripts?: TranscriptLookup;
  /**
   * Which of these lectures to leave as they are stored, asked once the
   * playlist is known. A lecture it names is not looked up and its segments
   * are not rewritten. Absent, every lecture is cut afresh, which is what the
   * script does.
   */
  keep?: (videoIds: string[]) => Promise<Set<string>>;
  /**
   * Epoch milliseconds after which no further transcript is looked up. The
   * lectures left are stored with their fallback cut, so the course is whole
   * and in order even when the time ran out.
   */
  deadline?: number;
  now?: () => number;
};

/**
 * Naming a playlist and having a course stored.
 *
 * Walk, cut, write, in the order the spec's build order puts them: the
 * catalogue is filled here and nothing is embedded, because a press only
 * searches again once something has been embedded since it last looked. So
 * pulling a course in is two moves: this, then the embedding pass, which the
 * script runs with `--embed` and the subject page's course form runs in the
 * same press.
 *
 * A refusal is returned rather than thrown, the same as the article sweep: a
 * playlist id typed by hand can be wrong, and a spent daily quota is an
 * ordinary Tuesday.
 */
export async function sweepYouTubeCourse(
  sql: postgres.Sql,
  options: CourseSweepOptions,
): Promise<CourseSweepResult> {
  const playlist = await fetchYouTubePlaylist(options.playlistId);
  if (!playlist.ok) return { ok: false, reason: playlist.reason, detail: playlist.detail };

  const refused: string[] = [];
  const transcripts =
    options.transcripts ??
    transcriptsForProvider(options.providerSlug, (detail) => refused.push(detail));
  const keep = options.keep
    ? await options.keep(playlist.videos.map((video) => video.videoId))
    : new Set<string>();
  const now = options.now ?? Date.now;
  const cutBy = { transcript: 0, chapters: 0, whole: 0 };
  let notReached = 0;
  const videos: CourseVideoInput[] = [];

  for (const video of playlist.videos) {
    if (keep.has(video.videoId)) {
      videos.push({ ...videoToStore(video, null).input, segments: null });
      continue;
    }

    const late = options.deadline !== undefined && now() >= options.deadline;
    if (late) notReached += 1;
    const cues = late ? null : await transcripts({
      videoId: video.videoId,
      title: video.title,
      canonicalUrl: video.canonicalUrl,
      description: video.description,
    });
    const stored = videoToStore(video, cues);
    cutBy[stored.cutBy] += 1;
    videos.push(stored.input);
  }

  const written = await storeCourse(sql, {
    providerSlug: options.providerSlug,
    channelId: playlist.channelId,
    externalId: playlist.playlistId,
    title: playlist.title,
    canonicalUrl: playlist.canonicalUrl,
    videos,
  });

  return { ok: true, title: playlist.title, cutBy, notReached, refused, ...written };
}
