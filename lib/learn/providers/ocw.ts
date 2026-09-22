import 'server-only';

import type { TranscriptCue } from '@/lib/learn/catalogue/segment';
import { fetchDocument } from './fetch';

/**
 * MIT OpenCourseWare, for the words spoken in a lecture.
 *
 * YouTube gives the lecture list and its order (lib/learn/providers/youtube.ts)
 * but not the captions, so docs/LEARN-SOURCES-SPEC.md sends the transcript to
 * the institution. MIT publishes one per lecture, CC BY-NC-SA, as a WebVTT
 * caption track on the lecture's own page. This module finds that track for a
 * YouTube video and reads it into cues.
 *
 * The key between the two sites is the YouTube video id, and it is on both
 * sides, so nothing here matches on titles:
 *
 *   1. Every mitocw video description says "View the complete course:
 *      http://ocw.mit.edu/18-06S05". That short link redirects to the course.
 *   2. The course page's nav links its video galleries
 *      (`/courses/<course>/video_galleries/<gallery>/`).
 *   3. Each gallery card links a lecture's resource page and shows the
 *      video's thumbnail from `img.youtube.com/vi/<video id>/`.
 *   4. The resource page carries `<track kind="captions" src="….vtt">`, and
 *      the file name ends in `_<video id>.vtt`.
 *
 * Steps 1 to 3 are done once per course and kept, so a forty-lecture course
 * costs about eighty-three fetches: the course, its galleries, then a page
 * and a caption file per lecture.
 *
 * Every page shape is parsed by a pure function below, tested against
 * excerpts of the real pages in lib/learn/providers/fixtures/ocw/.
 */

const OCW_HOST = 'ocw.mit.edu';
/** A course has one or two galleries (lectures, recitations). Runaway guard. */
const MAX_GALLERIES = 6;

/** An 11-character YouTube id, as it appears in a thumbnail or a file name. */
const VIDEO_ID = '[A-Za-z0-9_-]{11}';

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/**
 * The OCW course a video belongs to, from the link in its description.
 *
 * The link is written `http://ocw.mit.edu/18-06S05` on older uploads and
 * `https://ocw.mit.edu/6-006S20` or a full `/courses/…` address on newer ones.
 * The first link that is not the site's own root or its licence page is the
 * course. Always returned as https, because the fetch path refuses http.
 */
export function ocwCourseUrlFromDescription(description: string): string | null {
  const links = description.match(/(?:https?:\/\/)?(?:www\.)?ocw\.mit\.edu\/[^\s"'<>)\]]*/gi) ?? [];
  for (const raw of links) {
    const path = raw.replace(/^(?:https?:\/\/)?(?:www\.)?ocw\.mit\.edu/i, '').replace(/[.,;:]+$/, '');
    const trimmed = path.replace(/\/+$/, '');
    if (trimmed === '' || /^\/(terms|help|about|search)\b/i.test(trimmed)) continue;
    return `https://${OCW_HOST}${path}`;
  }
  return null;
}

/** Only ocw.mit.edu addresses are followed from a page this module read. */
function onOcw(href: string, base: string): string | null {
  try {
    const url = new URL(decodeEntities(href), base);
    if (url.hostname !== OCW_HOST) return null;
    url.protocol = 'https:';
    url.hash = '';
    url.search = '';
    return url.toString();
  } catch {
    return null;
  }
}

/** The course's video galleries, in the order the page links them. */
export function galleryUrlsFromCoursePage(html: string, pageUrl: string): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(/href="([^"]*\/video_galleries\/[^"]+)"/g)) {
    const url = onOcw(match[1], pageUrl);
    if (url && !found.includes(url)) found.push(url);
  }
  return found.slice(0, MAX_GALLERIES);
}

/** Video id to lecture page, read off one gallery's cards. */
export function lecturePagesFromGallery(html: string, pageUrl: string): Map<string, string> {
  const pages = new Map<string, string>();
  const card = new RegExp(
    `<a[^>]*class="video-link"[^>]*href="([^"]+)"[\\s\\S]*?img\\.youtube\\.com\\/vi\\/(${VIDEO_ID})\\/[\\s\\S]*?<\\/a>`,
    'g',
  );
  for (const match of html.matchAll(card)) {
    const url = onOcw(match[1], pageUrl);
    if (url && !pages.has(match[2])) pages.set(match[2], url);
  }
  return pages;
}

/**
 * The English caption file on a lecture page, when it is the one for this
 * video.
 *
 * The file name is checked against the id as well as the page being found
 * from the id, because a page can embed more than one video and the caption
 * that belongs to another one is worse than none.
 */
export function captionUrlFromLecturePage(html: string, pageUrl: string, videoId: string): string | null {
  const tracks = [...html.matchAll(/<track\b[^>]*>/g)].map((match) => match[0]);
  const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null;

  const candidates = tracks
    .filter((tag) => /^(captions|subtitles)$/.test(attr(tag, 'kind') ?? 'subtitles'))
    .map((tag) => ({ src: attr(tag, 'src'), lang: (attr(tag, 'srclang') ?? '').toLowerCase() }))
    .filter((track): track is { src: string; lang: string } => track.src !== null)
    .filter((track) => track.src.includes(`_${videoId}.`) || track.src.includes(`/${videoId}.`));

  const english = candidates.find((track) => track.lang === '' || track.lang.startsWith('en'));
  return english ? onOcw(english.src, pageUrl) : null;
}

function parseTimestamp(value: string): number | null {
  const match = value.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
  if (!match) return null;
  const [, hours, minutes, seconds, fraction] = match;
  return (
    Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(fraction.padEnd(3, '0')) / 1000
  );
}

/**
 * A WebVTT file into cues.
 *
 * OCW's captions break one spoken sentence over several short cues, each with
 * a start and an end; the cutter in lib/learn/catalogue/segment.ts joins them
 * back up and cuts on the sentence ends. Inline tags (`<i>`, `<c.speaker>`)
 * and a leading `>>` speaker-change marker are dropped, and a cue's lines are
 * joined with a space.
 */
export function cuesFromVtt(text: string): TranscriptCue[] {
  const cues: TranscriptCue[] = [];
  const blocks = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);

  for (const block of blocks) {
    const lines = block.split('\n');
    const timing = lines.findIndex((line) => line.includes('-->'));
    if (timing < 0) continue;

    const [rawStart, rawRest] = lines[timing].split('-->');
    const start = parseTimestamp(rawStart);
    const end = parseTimestamp((rawRest ?? '').trim().split(/\s+/)[0] ?? '');
    if (start === null) continue;

    const words = decodeEntities(
      lines
        .slice(timing + 1)
        .join(' ')
        .replace(/<[^>]*>/g, ''),
    )
      .replace(/^\s*>>\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!words) continue;

    cues.push({ startSeconds: start, endSeconds: end !== null && end >= start ? end : null, text: words });
  }

  return cues;
}

/** Fetch a page and hand back its text, or null for anything but a readable page. */
async function getText(url: string): Promise<{ url: string; text: string } | null> {
  const fetched = await fetchDocument(url);
  if (!fetched.ok || fetched.contentType === 'pdf' || fetched.contentType === 'json') return null;
  return { url: fetched.url, text: fetched.text };
}

/** Video id to lecture page, for every gallery a course links. */
async function lecturePagesForCourse(courseUrl: string): Promise<Map<string, string>> {
  const pages = new Map<string, string>();
  const course = await getText(courseUrl);
  if (!course) return pages;

  for (const galleryUrl of galleryUrlsFromCoursePage(course.text, course.url)) {
    const gallery = await getText(galleryUrl);
    if (!gallery) continue;
    for (const [videoId, page] of lecturePagesFromGallery(gallery.text, gallery.url)) {
      if (!pages.has(videoId)) pages.set(videoId, page);
    }
  }
  return pages;
}

export type OcwVideo = { videoId: string; description: string };

/**
 * A transcript lookup for OCW lectures, remembering each course it has read.
 *
 * Make one per sweep. Null for anything that cannot be followed to a caption
 * file -- a description with no OCW link, a course with no video gallery, a
 * lecture with no track, a page that did not load -- because the sweep falls
 * back to chapters or a whole-video segment and that is an ordinary answer.
 */
export function ocwTranscriptLookup(): (video: OcwVideo) => Promise<TranscriptCue[] | null> {
  const courses = new Map<string, Promise<Map<string, string>>>();

  return async (video) => {
    const courseUrl = ocwCourseUrlFromDescription(video.description);
    if (!courseUrl) return null;

    let lectures = courses.get(courseUrl);
    if (!lectures) {
      lectures = lecturePagesForCourse(courseUrl);
      courses.set(courseUrl, lectures);
    }

    const pageUrl = (await lectures).get(video.videoId);
    if (!pageUrl) return null;

    const page = await getText(pageUrl);
    if (!page) return null;
    const captionUrl = captionUrlFromLecturePage(page.text, page.url, video.videoId);
    if (!captionUrl) return null;

    const captions = await getText(captionUrl);
    if (!captions) return null;
    const cues = cuesFromVtt(captions.text);
    return cues.length > 0 ? cues : null;
  };
}
