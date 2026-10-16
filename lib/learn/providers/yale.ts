import 'server-only';

import type { StructureDocumentInput, StructureReading, StructureUnit } from '@/lib/learn/catalogue/structure';
import { fetchDocument } from './fetch';

/**
 * Open Yale Courses lecture lists (plan #2247.9).
 *
 * A course page on oyc.yale.edu has an About tab, a Syllabus tab and a
 * Sessions tab, all in the one page's HTML. The Sessions tab is the ordered
 * list of lectures, each a link to a lecture page. A lecture page holds the
 * video embed, the chapter headings, an mp3 link and, for most lectures, the
 * whole transcript inline.
 *
 * The document keeps the lectures as units in the order listed. Each unit's
 * topics are the lecture's chapter headings, and its readings are the lecture
 * page (which carries the transcript), the video and the audio.
 *
 * Licence: "show". The site states that most lectures and course material
 * are licensed Creative Commons Attribution-NonCommercial-ShareAlike 3.0,
 * with third-party content in a lecture's Credits section excluded. That
 * allows the text to be shown with attribution, and a personal learning
 * dashboard is a non-commercial use. The attribution lives in `author` and
 * `institution`. The transcripts themselves are not copied into the document:
 * raw text holds the course page's text and the lecture list, and each
 * lecture links to the page the transcript is on.
 *
 * Pure parsers over page text; `pullYaleCourse` fetches and assembles and
 * writes nothing. Only https://oyc.yale.edu/<subject>/<code> is accepted.
 */

const YALE_HOST = 'oyc.yale.edu';
const COURSE_PATH = /^\/([a-z0-9-]+)\/([a-z0-9-]+)\/?$/i;
/** A course has some thirty lectures at most. Runaway guard for a page that changes shape. */
const MAX_LECTURES = 60;

export const YALE_HIST_116_URL = `https://${YALE_HOST}/history/hist-116`;

export type YaleLectureLink = { number: string; title: string; url: string };

export type YaleCourse = {
  title: string;
  courseCode: string | null;
  professor: string | null;
  about: string;
  /** The Texts list of the syllabus, one entry per line. */
  texts: string[];
  /** "Spring 2010", read from the course structure paragraph. */
  term: string | null;
  lectures: YaleLectureLink[];
};

export type YaleLecture = {
  chapters: string[];
  youtubeUrl: string | null;
  audioUrl: string | null;
  /** Whether the page carries a transcript. */
  hasTranscript: boolean;
};

export type YaleFailure = { ok: false; reason: 'not-allowlisted' | 'fetch-failed' | 'unparseable'; detail: string };
export type YaleResult = { ok: true; document: StructureDocumentInput } | YaleFailure;

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;|&apos;/g, "'")
    .replace(/&rsquo;/g, '’')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

function plain(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function fieldContent(html: string, fieldClass: string): string | null {
  const re = new RegExp(`views-field-${fieldClass}"[^>]*>[\\s\\S]*?<div class="field-content">([\\s\\S]*?)</div></div>`, 'i');
  return re.exec(html)?.[1] ?? null;
}

/** The course page: title, number, professor, about text, texts and the lectures in listed order. */
export function parseYaleCourse(html: string, pageUrl: string): YaleCourse {
  const title = plain(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? '');
  const code = fieldContent(html, 'field-course-number');
  const professorRaw = fieldContent(html, 'field-course-professor-last-name');
  const about = fieldContent(html, 'body');
  const texts = fieldContent(html, 'field-course-syllabus-texts');
  const structure = fieldContent(html, 'field-course-structure');
  const termMatch = structure ? /\b(Spring|Fall|Summer|Winter)\s+(\d{4})\b/.exec(plain(structure)) : null;

  const lectures: YaleLectureLink[] = [];
  const seen = new Set<string>();
  const rows = html.matchAll(
    /field-session-display-number">([\s\S]*?)<\/td>\s*<td[^>]*field-session-display-title">\s*<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
  );
  for (const row of rows) {
    let url: URL;
    try {
      url = new URL(decodeEntities(row[2]), pageUrl);
    } catch {
      continue;
    }
    if (url.hostname !== YALE_HOST || seen.has(url.href)) continue;
    seen.add(url.href);
    lectures.push({ number: plain(row[1]), title: plain(row[3]), url: url.href });
    if (lectures.length >= MAX_LECTURES) break;
  }

  return {
    title,
    courseCode: code ? plain(code) : null,
    professor: professorRaw ? plain(professorRaw) : null,
    about: about ? plain(about) : '',
    texts: texts ? [...texts.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => plain(m[1])).filter(Boolean) : [],
    term: termMatch ? `${termMatch[1]} ${termMatch[2]}` : null,
    lectures,
  };
}

/** A lecture page: its chapter headings, video, audio and whether the transcript is on the page. */
export function parseYaleLecture(html: string, pageUrl: string): YaleLecture {
  const chapterList = /Lecture Chapters[\s\S]*?<\/ol>/i.exec(html)?.[0] ?? '';
  const chapters = [...chapterList.matchAll(/field-session-chapters-name"><div class="field-content">([\s\S]*?)<\/div>/gi)]
    .map((m) => plain(m[1]))
    .filter(Boolean);
  const video = /youtube\.com\/embed\/([\w-]{6,20})/i.exec(html)?.[1];
  const audio = /href="([^"]+\.mp3)"/i.exec(html)?.[1];
  let audioUrl: string | null = null;
  if (audio) {
    try {
      const url = new URL(decodeEntities(audio), pageUrl);
      if (url.hostname === YALE_HOST) audioUrl = url.href;
    } catch {
      // an unusable link is no link
    }
  }
  return {
    chapters,
    youtubeUrl: video ? `https://www.youtube.com/watch?v=${video}` : null,
    audioUrl,
    hasTranscript: /id="transcript-top"/i.test(html) && /\[end of transcript\]/i.test(html),
  };
}

/** The course as the document the store keeps. `details` maps a lecture URL to what its page held. */
export function yaleDocument(course: YaleCourse, pageUrl: URL, details: Map<string, YaleLecture>): StructureDocumentInput {
  const units: StructureUnit[] = course.lectures.map((lecture) => {
    const detail = details.get(lecture.url);
    const readings: StructureReading[] = [
      {
        title: detail?.hasTranscript ? `${lecture.title} (lecture page with transcript)` : `${lecture.title} (lecture page)`,
        url: lecture.url,
      },
    ];
    if (detail?.youtubeUrl) readings.push({ title: `${lecture.title} (video)`, url: detail.youtubeUrl });
    if (detail?.audioUrl) readings.push({ title: `${lecture.title} (audio)`, url: detail.audioUrl });
    return { label: lecture.number || null, heading: lecture.title, topics: detail?.chapters ?? [], readings };
  });

  const raw = [
    `${course.title}${course.courseCode ? ` (${course.courseCode})` : ''}`,
    pageUrl.href,
    course.professor ? `Professor: ${course.professor}` : '',
    course.about,
    course.texts.length > 0 ? `Texts:\n${course.texts.join('\n')}` : '',
    `Lectures:\n${course.lectures.map((l) => `${l.number}: ${l.title}\n${l.url}`).join('\n')}`,
  ];

  const professorName = course.professor?.replace(/\s+Professor\b.*$/i, '').trim();
  return {
    providerSlug: 'yale-courses',
    externalId: pageUrl.pathname.replace(/^\/|\/$/g, '').split('/').pop()!.toLowerCase(),
    title: course.title,
    canonicalUrl: pageUrl.href,
    sourceUrl: pageUrl.href,
    author: professorName ? `${professorName}, Yale University` : 'Yale University',
    institution: 'Yale University, Open Yale Courses (CC BY-NC-SA 3.0)',
    courseCode: course.courseCode,
    term: course.term,
    licenceMode: 'show',
    rawText: raw.filter((part) => part !== '').join('\n\n'),
    textbooks: course.texts,
    units,
  };
}

/** The course page address, or null when it is not a course page on oyc.yale.edu. */
export function yaleCourseUrl(rawUrl: string): URL | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== YALE_HOST || !COURSE_PATH.test(url.pathname)) return null;
  url.search = '';
  url.hash = '';
  return url;
}

/**
 * Pull a course by its page address, confirming it by fetch. Each lecture page
 * is fetched once for its chapters, video and transcript; one that will not
 * load keeps its link and no topics. The result is ready for `storeStructure`.
 */
export async function pullYaleCourse(rawUrl: string): Promise<YaleResult> {
  const url = yaleCourseUrl(rawUrl);
  if (!url) return { ok: false, reason: 'not-allowlisted', detail: `${rawUrl} is not a course page on ${YALE_HOST}.` };
  const page = await fetchDocument(url.href);
  if (!page.ok) return { ok: false, reason: 'fetch-failed', detail: `${page.reason}: ${page.detail}` };
  const course = parseYaleCourse(page.text, url.href);
  if (!course.title || course.lectures.length === 0) {
    return { ok: false, reason: 'unparseable', detail: 'No lectures in the Yale course page.' };
  }
  const details = new Map<string, YaleLecture>();
  for (const lecture of course.lectures) {
    const lecturePage = await fetchDocument(lecture.url);
    if (lecturePage.ok) details.set(lecture.url, parseYaleLecture(lecturePage.text, lecture.url));
  }
  return { ok: true, document: yaleDocument(course, url, details) };
}
