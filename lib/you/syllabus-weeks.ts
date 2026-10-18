/**
 * A course's weeks, read from its syllabus (plan #2401.6, under #2401).
 *
 * Pressing "Lay out the weeks" under a course's syllabus has Dash read the
 * syllabus once and list the course's weeks, each with its topic, which the
 * Work & school tab keeps in you.course_weeks so every week shows as a slot
 * before any file sits in it. This is the part with no database and no model
 * in it: the tool the answer comes back through, turning the answer into
 * weeks, and folding a new read into the weeks already kept.
 *
 * The file goes to the model the way Summarise sends it (courseFileSource in
 * lib/you/course-file-read.ts), through askCourseFileModel with this tool in
 * place of the summary's. The reader behind "Tell it what you already know"
 * on Learn (lib/learn/graph/from-prior.ts) takes pasted text and refuses a
 * syllabus's topic lines by design, since it writes what the person knows; a
 * week-by-week outline is the opposite job, so only the file handling is
 * shared.
 */

import type { ExtractResult, ExtractSource } from '@/lib/goals/extract-model';
import { courseFileSource } from '@/lib/you/course-file-read';
import type { CourseWeek } from '@/lib/you/transcripts';

/** The one tool the model answers through. */
export const WEEKS_TOOL = 'list_weeks';

/** The most weeks kept from one read; a week number runs 0 to 60. */
export const WEEKS_MAX = 40;
const WEEK_LAST = 60;
const TITLE_MAX = 200;

/** One week as a read gives it. */
export type ReadWeek = { week: number; title: string | null };

export type SyllabusRead = { ok: true; weeks: ReadWeek[] } | { ok: false; error: string };

type JsonSchema = Record<string, unknown>;

/** The tool definition: the weeks, and why there are none when the syllabus gives none. */
export function weeksTool(): { name: string; description: string; input_schema: JsonSchema } {
  return {
    name: WEEKS_TOOL,
    description: "List the course's weeks and the topic of each, as the syllabus gives them.",
    input_schema: {
      type: 'object',
      properties: {
        weeks: {
          type: 'array',
          maxItems: WEEKS_MAX,
          items: {
            type: 'object',
            properties: {
              week: { type: 'integer', minimum: 0, maximum: WEEK_LAST, description: 'The week number.' },
              title: {
                type: ['string', 'null'],
                description:
                  "The week's topic in a few words, as the syllabus names it, such as \"Supply and demand\". Null when the syllabus names the week but gives no topic.",
              },
            },
            required: ['week', 'title'],
          },
          description: 'Every week the syllabus lays out, in order. Empty when it lays out none.',
        },
        no_weeks: {
          type: ['string', 'null'],
          description:
            'When the syllabus lays out no weeks, one short sentence saying why: it lists topics with no schedule, it is only the grading policy, it is blank. Null otherwise.',
        },
      },
      required: ['weeks', 'no_weeks'],
    },
  };
}

/** The system prompt for one read. */
export function weeksPrompt(courseTitle: string): string {
  return [
    `You read the syllabus of a course a person took, "${courseTitle}", and list the course's weeks.`,
    'For each week the schedule names, give its number and its topic in a few words, as the syllabus words it. Keep the topic short: "Elasticity", not "Lecture 5: Elasticity and its applications (read chapter 5)".',
    'Number the weeks as the syllabus does. A schedule by lecture or by date rather than by week is grouped into weeks in order, starting at week 1.',
    'Leave out exams, holidays and reading weeks unless the schedule gives them a week of their own, and then give the week with that as its topic.',
    'Do not invent weeks the syllabus does not lay out. When it lists topics with no schedule, or has no schedule at all, give no weeks and say why in no_weeks.',
    `Answer only through the ${WEEKS_TOOL} tool.`,
  ].join('\n');
}

/** What the file is sent with. */
export const WEEKS_INSTRUCTION = "List this course's weeks and the topic of each.";

/** Turn the tool's answer into weeks, or the reason there are none. */
export function readWeeksAnswer(input: unknown): SyllabusRead {
  const answer = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const byWeek = new Map<number, ReadWeek>();
  for (const raw of Array.isArray(answer.weeks) ? answer.weeks : []) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const week = typeof row.week === 'number' ? row.week : typeof row.week === 'string' ? Number(row.week) : NaN;
    if (!Number.isInteger(week) || week < 0 || week > WEEK_LAST || byWeek.has(week)) continue;
    const title = typeof row.title === 'string' ? clean(row.title).slice(0, TITLE_MAX).trim() : '';
    byWeek.set(week, { week, title: title || null });
    if (byWeek.size === WEEKS_MAX) break;
  }
  const weeks = [...byWeek.values()].sort((a, b) => a.week - b.week);
  if (weeks.length > 0) return { ok: true, weeks };
  const why = typeof answer.no_weeks === 'string' ? clean(answer.no_weeks) : '';
  if (why) return { ok: false, error: `Dash found no weeks in it. ${sentence(why)}` };
  return { ok: false, error: 'Dash found no weeks in the syllabus, so none were laid out.' };
}

/** One read of a syllabus: put it in shape, ask, and read the answer. Nothing is saved here. */
export async function readSyllabusWeeks(
  about: { name: string; bytes: Uint8Array; courseTitle: string },
  ask: (source: ExtractSource, prompt: string) => Promise<ExtractResult>,
): Promise<SyllabusRead> {
  const source = courseFileSource(about);
  if (!source.ok) return source;
  const answer = await ask(source.source, weeksPrompt(about.courseTitle));
  if (!answer.ok) return answer;
  return readWeeksAnswer(answer.input);
}

/** What folding a read into the kept weeks writes. */
export type WeeksChange = {
  /** New weeks, and kept ones whose title the read changed. */
  upsert: ReadWeek[];
  /** Kept weeks the read no longer names, by id. */
  remove: string[];
};

/**
 * Fold a new read into the weeks a course already keeps. A week the person
 * edited or removed is left exactly as it is, so an edited title survives
 * and a removed week does not come back. Every other kept week takes the
 * read's title, or goes when the read no longer names it, and a week only
 * the read names is added.
 */
export function mergeSyllabusWeeks(kept: CourseWeek[], read: ReadWeek[]): WeeksChange {
  const byWeek = new Map(kept.map((row) => [row.week, row]));
  const named = new Set(read.map((row) => row.week));
  const upsert: ReadWeek[] = [];
  for (const row of read) {
    const held = byWeek.get(row.week);
    if (!held) upsert.push(row);
    else if (!held.edited_at && !held.removed_at && held.title !== row.title) upsert.push(row);
  }
  const remove = kept
    .filter((row) => !row.edited_at && !row.removed_at && !named.has(row.week))
    .map((row) => row.id);
  return { upsert, remove };
}

/** A week's title from a form: blank is no title. */
export function parseWeekTitle(value: unknown): { ok: true; title: string | null } | { ok: false } {
  if (typeof value !== 'string') return { ok: true, title: null };
  const title = clean(value);
  if (title.length > TITLE_MAX) return { ok: false };
  return { ok: true, title: title || null };
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function sentence(text: string): string {
  const capital = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}
