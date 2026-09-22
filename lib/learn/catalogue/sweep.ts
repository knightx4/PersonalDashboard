import type postgres from 'postgres';
import {
  chaptersFromDescription,
  fetchYouTubePlaylist,
  lectureLabel,
  type YouTubeVideo,
} from '@/lib/learn/providers/youtube';
import { fetchWikipediaArticle } from '@/lib/learn/providers/wikipedia';
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
}) => Promise<TranscriptCue[] | null>;

/** The default: no institution adapter is wired up yet. */
export const noTranscripts: TranscriptLookup = async () => null;

export type CourseSweepResult =
  | ({
      ok: true;
      title: string;
      /** How many lectures were cut each of the three ways. */
      cutBy: { transcript: number; chapters: number; whole: number };
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

/**
 * Naming a playlist and having a course stored.
 *
 * Walk, cut, write, in the order the spec's build order puts them: the
 * catalogue is filled here and nothing is embedded, because a press only
 * searches again once something has been embedded since it last looked. So
 * pulling a course in is two moves, and the second is
 * `npm run catalogue -- --embed`.
 *
 * A refusal is returned rather than thrown, the same as the article sweep: a
 * playlist id typed by hand can be wrong, and a spent daily quota is an
 * ordinary Tuesday.
 */
export async function sweepYouTubeCourse(
  sql: postgres.Sql,
  options: { providerSlug: string; playlistId: string; transcripts?: TranscriptLookup },
): Promise<CourseSweepResult> {
  const playlist = await fetchYouTubePlaylist(options.playlistId);
  if (!playlist.ok) return { ok: false, reason: playlist.reason, detail: playlist.detail };

  const transcripts = options.transcripts ?? noTranscripts;
  const cutBy = { transcript: 0, chapters: 0, whole: 0 };
  const videos: CourseVideoInput[] = [];

  for (const video of playlist.videos) {
    const cues = await transcripts({
      videoId: video.videoId,
      title: video.title,
      canonicalUrl: video.canonicalUrl,
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

  return { ok: true, title: playlist.title, cutBy, ...written };
}
