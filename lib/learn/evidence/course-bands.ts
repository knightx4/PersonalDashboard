/**
 * A graded course marks the frame topics it covered as a band of likely
 * levels (plan #2172.4.1, decision #2172.3). Pure, so the rules can be tested
 * without a database or a model; the call is ./course-band-call and the
 * store that runs both is ./course-band-store.
 *
 * One call per course reads what the course is known by (its name, school
 * and year, a catalogue description and its notes) and a shortlist of the
 * frame topics nearest it, and names the topics the course taught and how
 * deep the course went. A course with neither notes nor a description is
 * named from its title alone, and its topics are flagged as guessed.
 *
 * The band always starts at level 1. Its top is the course's depth (an
 * introductory course reaches level 2 at most, an intermediate one 3, an
 * advanced or graduate one 4), times the grade and the fade of the years
 * since (./courses), rounded and never under 1. So an A in an introductory
 * course ten years ago reads "likely level 1", and an honours grade in a
 * graduate course last year "likely level 1 to 4". No course reads past 4:
 * that is what an explain prompt about the course is for (#2172.4.2).
 */

import { ageFactor, courseBasis, courseWeight, gradeFactor, isTitleOnly, type CourseSource } from './courses';

export const COURSE_DEPTHS = ['intro', 'intermediate', 'advanced'] as const;
export type CourseDepth = (typeof COURSE_DEPTHS)[number];

/** The highest level a course of each depth can mark, before its grade and age. */
export const DEPTH_TOP: Record<CourseDepth, number> = { intro: 2, intermediate: 3, advanced: 4 };

const DEPTH_WORDS: Record<CourseDepth, string> = {
  intro: 'an introductory course',
  intermediate: 'an intermediate course',
  advanced: 'an advanced course',
};

/** The most topics one course marks. */
export const TOPICS_PER_COURSE = 8;
/** Frame topics nearest the course offered to the call. */
export const CANDIDATES_PER_COURSE = 40;
/** How sure a named topic is, as the similarity its link carries. */
export const NAMED_SIMILARITY = 0.8;
/** The same for a course named from its title alone. */
export const GUESSED_SIMILARITY = 0.6;
/** The most of a course's notes and description the call reads. */
const NAMING_TEXT_MAX_CHARS = 4_000;

export type Band = { low: number; high: number };

/** Whether a course's grade counts at all; a course in progress or waived marks nothing. */
export function isGraded(course: Pick<CourseSource, 'grade'>): boolean {
  return gradeFactor(course.grade) > 0;
}

/** The band a course marks, or null when its grade counts for nothing. */
export function courseBand(
  course: Pick<CourseSource, 'grade' | 'year'>,
  depth: CourseDepth,
  nowYear: number,
): Band | null {
  const grade = gradeFactor(course.grade);
  if (grade <= 0) return null;
  const top = DEPTH_TOP[depth];
  const high = Math.max(1, Math.min(top, Math.round(top * grade * ageFactor(course.year, nowYear))));
  return { low: 1, high };
}

/** "likely level 1" or "likely level 1 to 3". */
export function bandWords(band: Band): string {
  return band.low === band.high ? `likely level ${band.low}` : `likely level ${band.low} to ${band.high}`;
}

/**
 * The reason beside the band, as the mark's basis:
 * "from MGT 847 Private Equity, H, 2025: an advanced course reaches level 4
 * at most, and the grade and a year since keep 4. Topics guessed from the
 * course title."
 */
export function bandBasis(
  course: Pick<CourseSource, 'code' | 'title' | 'grade' | 'year'>,
  depth: CourseDepth,
  band: Band,
  guessed: boolean,
  nowYear: number,
): string {
  const top = DEPTH_TOP[depth];
  const years = course.year === null ? null : Math.max(0, nowYear - course.year);
  const since = years === null ? ' and an unknown year' : years === 0 ? '' : years === 1 ? ' and a year since' : ` and ${years} years since`;
  const one = since === '';
  const verb = band.high === top ? (one ? 'keeps' : 'keep') : one ? 'leaves' : 'leave';
  const left = `the grade${since} ${verb} ${band.high}`;
  const reason = `${courseBasis(course)}: ${DEPTH_WORDS[depth]} reaches level ${top} at most, and ${left}.`;
  return guessed ? `${reason} Topics guessed from the course title.` : reason;
}

/**
 * What the call reads about a course: its name, where and when, and the
 * start of its description and notes. The stored copy is how the run knows a
 * course needs naming again.
 */
export function namingText(course: CourseSource): string {
  const head = [
    `Course: ${course.code?.trim() ? `${course.code.trim()} ` : ''}${course.title.trim()}`,
    `School: ${course.school.trim()}`,
    course.term?.trim() || course.year ? `Taken: ${course.term?.trim() || course.year}` : '',
  ].filter(Boolean);
  const detail = [course.catalogue_description?.trim() ?? '', ...course.notes.map((n) => n.trim())]
    .filter(Boolean)
    .join('\n\n');
  const body = detail.length > NAMING_TEXT_MAX_CHARS ? detail.slice(0, NAMING_TEXT_MAX_CHARS) : detail;
  return body ? `${head.join('\n')}\n\n${body}` : head.join('\n');
}

/** Whether the course's topics are guessed from its title alone. */
export function isGuessed(course: CourseSource): boolean {
  return isTitleOnly(course);
}

export type Candidate = { id: string; title: string; level: number; similarity: number };

/** A frame topic by any of its names, lowercased: its title and its aliases. */
export type FrameNames = ReadonlyMap<string, string>;

export function frameNames(articles: readonly { id: string; title: string; aliases: string[] | null }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const a of articles) {
    for (const name of [a.title, ...(a.aliases ?? [])]) {
      const key = name.trim().toLowerCase();
      if (key && !out.has(key)) out.set(key, a.id);
    }
  }
  return out;
}

export type NamedTopic = { id: string; similarity: number };

/**
 * The topics a call named, as frame topic ids: its picks from the shortlist
 * by key (T1, T2, ...) first, then any title it gave that is a frame topic's
 * name. Unknown keys and names are dropped, each topic once, at most
 * TOPICS_PER_COURSE.
 */
export function resolveNamedTopics(
  reply: { picks: readonly string[]; others: readonly string[] },
  candidates: readonly Candidate[],
  names: FrameNames,
  guessed: boolean,
): NamedTopic[] {
  const similarity = guessed ? GUESSED_SIMILARITY : NAMED_SIMILARITY;
  const ids: string[] = [];
  const add = (id: string | undefined) => {
    if (id && !ids.includes(id) && ids.length < TOPICS_PER_COURSE) ids.push(id);
  };
  for (const key of reply.picks) {
    const m = /^T(\d+)$/i.exec(key.trim());
    if (m) add(candidates[Number(m[1]) - 1]?.id);
  }
  for (const name of reply.others) add(names.get(name.trim().toLowerCase()));
  return ids.map((id) => ({ id, similarity }));
}

/** A course band as a row of learn.evidence_links, less the user id the store adds. */
export type BandLinkRow = {
  target_kind: 'topic';
  target_id: string;
  source_kind: 'course';
  source_id: string;
  similarity: number;
  weight: number;
  basis: string;
  matched_by: null;
  held_reason: null;
  /** Null once the course's explain prompt tested the topic (plan #2172.4.2). */
  band_low: number | null;
  band_high: number | null;
  /** The level the explain prompt showed, in place of the band; null until then. */
  tested_level: number | null;
  found_at: string;
};

/** A course's explain marks, as learn.course_explains holds them (plan #2172.4.2). */
export type CourseExplainMarks = {
  course_id: string;
  marks: readonly { topic_id: string; level: number; basis: string }[];
};

/** A course's stored naming, as learn.course_topics holds it. */
export type CourseNaming = {
  course_id: string;
  depth: CourseDepth;
  guessed: boolean;
  topics: NamedTopic[];
  named_at: string;
};

/**
 * The band links every naming makes. A course gone from the transcript, or
 * whose grade no longer counts, makes none. The weight is the course's grade
 * times its age, as every course link's is (./courses), so the kind's
 * ceiling holds as it does today.
 *
 * A topic the course's explain prompt marked (plan #2172.4.2) takes its
 * tested level in place of the band, with the mark's basis; one marked 0
 * makes no link. learn.apply_course_explain writes the same from a press.
 */
export function bandLinks(
  namings: readonly CourseNaming[],
  courses: readonly CourseSource[],
  nowYear: number,
  explains: readonly CourseExplainMarks[] = [],
): BandLinkRow[] {
  const byId = new Map(courses.map((c) => [c.course_id, c]));
  const marked = new Map(
    explains.map((e) => [e.course_id, new Map(e.marks.map((m) => [m.topic_id, m]))]),
  );
  const rows: BandLinkRow[] = [];
  for (const naming of namings) {
    const course = byId.get(naming.course_id);
    if (!course) continue;
    const band = courseBand(course, naming.depth, nowYear);
    if (!band) continue;
    const weight = courseWeight(course, nowYear);
    const basis = bandBasis(course, naming.depth, band, naming.guessed, nowYear);
    const marks = marked.get(course.course_id);
    for (const topic of naming.topics) {
      const mark = marks?.get(topic.id);
      if (mark && mark.level <= 0) continue;
      const tested = mark ? Math.min(10, Math.round(mark.level)) : null;
      rows.push({
        target_kind: 'topic',
        target_id: topic.id,
        source_kind: 'course',
        source_id: course.course_id,
        similarity: Math.min(1, Math.max(0, topic.similarity)),
        weight,
        basis: mark ? mark.basis : basis,
        matched_by: null,
        held_reason: null,
        band_low: tested ? null : band.low,
        band_high: tested ? null : band.high,
        tested_level: tested,
        found_at: naming.named_at,
      });
    }
  }
  return rows;
}

/** The key a link is upserted on, less the user and the target kind. */
export function bandKey(row: { target_id: string; source_id: string }): string {
  return `${row.source_id} ${row.target_id}`;
}
