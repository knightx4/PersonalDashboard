/**
 * Reading the courses off a transcript (plan #1307, under #1304).
 *
 * You give it a transcript as a PDF, a Word file, a photo or pasted text, and
 * it hands back every course on it as a draft for you to check. Nothing is
 * saved here: the Education tab (plan #1308) shows the draft, lets you fix a
 * misread row, and saves what you confirm into obsidian.courses.
 *
 * The file handling is the goals document reader's (extractSource in
 * lib/goals/extract-read.ts): the same kinds of file, the same 20 MB limit,
 * and a Word file sent as its text. The model call is askTranscriptModel in
 * lib/vault/transcript-model.ts, passed in here so the tests stub it.
 *
 * Term, grade and credits are kept as the transcript writes them. A letter
 * grade stays "A-", a pass stays "P", and a transfer credit with no grade has
 * none, so what you check is what the page says rather than a conversion.
 */

import { extractSource, type ReadInput } from '@/lib/goals/extract-read';
import type { ExtractResult, ExtractSource } from '@/lib/goals/extract-model';

export type { ReadInput };

/** The one tool the model answers through. */
export const TRANSCRIPT_TOOL = 'list_courses';

/** The most courses one read hands back; a four-year transcript has about fifty. */
export const COURSES_MAX = 300;

/** The longest of each field kept from the model: obsidian.courses' own limits. */
const MAX = { school: 200, code: 50, title: 300, term: 50, grade: 20, note: 300 } as const;

/** A course as read, before you check it. Mirrors obsidian.courses without the ids. */
export type DraftCourse = {
  /** The school the course was taken at; null when the transcript does not say. */
  school: string | null;
  code: string | null;
  title: string;
  /** As written: "Fall 2019", "2019-20 Semester 1", "Michaelmas". */
  term: string | null;
  /** The calendar year the term falls in, when the transcript gives one. */
  year: number | null;
  credits: number | null;
  /** As written: "A-", "P", "TR", "85". Null when there is none. */
  grade: string | null;
  position: number;
};

export type TranscriptRead =
  | {
      ok: true;
      /** The school the transcript is from; null when it names none. */
      school: string | null;
      courses: DraftCourse[];
    }
  | { ok: false; error: string };

type JsonSchema = Record<string, unknown>;

const nullableString = (description: string): JsonSchema => ({ type: ['string', 'null'], description });

/** The tool definition: the transcript's school and one entry per course. */
export function transcriptTool(): { name: string; description: string; input_schema: JsonSchema } {
  return {
    name: TRANSCRIPT_TOOL,
    description: 'List every course on the transcript, exactly as it is written.',
    input_schema: {
      type: 'object',
      properties: {
        school: nullableString(
          'The school or university that issued the transcript, as written. Null when it names none.',
        ),
        courses: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              school: nullableString(
                'The school the course was taken at, when it differs from the issuing school: a transfer credit or a study-abroad term. Null otherwise.',
              ),
              code: nullableString('The course code or number, as written: "CS 101". Null when there is none.'),
              title: { type: 'string', description: 'The course title, as written.' },
              term: nullableString(
                'The term the course was taken in, as written: "Fall 2019", "Semester 1 2020". Null when none is given.',
              ),
              year: {
                type: ['integer', 'null'],
                description: 'The calendar year the term falls in, when one is given. Null otherwise.',
              },
              credits: {
                type: ['number', 'null'],
                description: 'The credits or units, as a number. Null when none are given.',
              },
              grade: nullableString(
                'The grade exactly as written: "A-", "B+", "P", "TR", "85". Null when the course has no grade.',
              ),
            },
            required: ['school', 'code', 'title', 'term', 'year', 'credits', 'grade'],
          },
        },
        unreadable: nullableString(
          'When no courses can be listed, one short sentence saying why: the page is not a transcript, or it is too blurred to read. Null otherwise.',
        ),
      },
      required: ['school', 'courses', 'unreadable'],
    },
  };
}

/** The system prompt for the read. */
export function transcriptPrompt(): string {
  return [
    'You read academic transcripts and list the courses on them.',
    'List every course the transcript shows, in the order it shows them, with its code, title, term, credits and grade copied exactly as written.',
    'Do not convert grades, expand abbreviations, correct spellings or fill in anything the page does not say. A course with no grade, such as a transfer credit or one in progress, has a null grade.',
    'Leave out term and cumulative totals, GPA lines, headings and anything else that is not a course.',
    'When the transcript covers more than one school, such as transfer credits from another college, give each such course its own school.',
    'When the page is a scan or a photo, read what you can; a course whose title you cannot make out is left out rather than guessed.',
    `Answer only through the ${TRANSCRIPT_TOOL} tool.`,
  ].join('\n');
}

/**
 * Read a transcript: work out what the input is, ask, and turn the answer
 * into draft courses. A file that cannot be read, or one with no courses in
 * it, comes back as a message rather than an empty list.
 */
export async function readTranscript(
  input: ReadInput,
  ask: (source: ExtractSource) => Promise<ExtractResult>,
): Promise<TranscriptRead> {
  const source = extractSource(input);
  if (!source.ok) return source;
  const answer = await ask(source.source);
  if (!answer.ok) return answer;

  const read = readTranscriptAnswer(answer.input);
  if (read.courses.length === 0) {
    const why = read.unreadable ? ` ${sentence(read.unreadable)}` : '';
    return {
      ok: false,
      error: `No courses could be read from that.${why} Try a clearer copy, or paste the text.`,
    };
  }
  return { ok: true, school: read.school, courses: read.courses };
}

/** Turn the model's tool input into draft courses, dropping anything malformed. */
export function readTranscriptAnswer(input: unknown): {
  school: string | null;
  courses: DraftCourse[];
  unreadable: string | null;
} {
  const record = isRecord(input) ? input : {};
  const school = text(record.school, MAX.school);
  const unreadable = text(record.unreadable, MAX.note);
  const raw = Array.isArray(record.courses) ? record.courses : [];

  const courses: DraftCourse[] = [];
  for (const item of raw) {
    if (courses.length >= COURSES_MAX) break;
    if (!isRecord(item)) continue;
    const title = text(item.title, MAX.title);
    if (!title) continue;
    const term = text(item.term, MAX.term);
    courses.push({
      school: text(item.school, MAX.school) ?? school,
      code: text(item.code, MAX.code),
      title,
      term,
      year: year(item.year) ?? yearIn(term),
      credits: credits(item.credits),
      grade: text(item.grade, MAX.grade),
      position: courses.length,
    });
  }
  return { school, courses, unreadable };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed || /^(null|n\/a|none)$/i.test(trimmed)) return null;
  return trimmed.slice(0, max);
}

function year(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof n !== 'number' || !Number.isInteger(n)) return null;
  return n >= 1900 && n <= 2100 ? n : null;
}

/** The first four-digit year in a term such as "Fall 2019" or "2019-20". */
function yearIn(term: string | null): number | null {
  const match = term?.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function credits(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  // numeric(6, 2) in obsidian.courses.
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n >= 10_000) return null;
  return Math.round(n * 100) / 100;
}

function sentence(value: string): string {
  const capped = value.charAt(0).toUpperCase() + value.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}
