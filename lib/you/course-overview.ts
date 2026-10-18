/**
 * What a course was about, pulled together from its files (plan #2401.7,
 * under #2401).
 *
 * Once two or more of a course's files have been summarised, pressing "Pull
 * it together" has Dash read those summaries and key points (not the files
 * again) and write what the course was about and the ideas that came back in
 * more than one lecture or reading. The Work & school tab keeps the answer
 * in you.course_overviews. This is the part with no database and no model in
 * it: what is sent, the tool the answer comes back through, and turning the
 * answer into what is kept.
 *
 * The block also lists the person's own vault notes about the course, found
 * each time the page loads by the course's code or title appearing in a
 * note. Those are theirs and are never sent to the model; the helpers for
 * finding them are at the foot of this file.
 */

import type { ExtractResult, ExtractSource } from '@/lib/goals/extract-model';
import { COURSE_FILE_KIND_LABELS, type Course, type CourseFile } from '@/lib/you/transcripts';

/** The one tool the model answers through. */
export const OVERVIEW_TOOL = 'pull_course_together';

/** How many read files an overview needs before it can be asked for. */
export const OVERVIEW_MIN_READ = 2;

/** The most recurring ideas kept, as you.course_overviews allows. */
export const RECURRING_MAX = 8;

const ABOUT_MAX = 1500;
const IDEA_MAX = 300;

/** One idea that came back, and the files it came back in, by id. */
export type RecurringIdea = { idea: string; file_ids: string[] };

/** A row of you.course_overviews, without its keys. */
export type CourseOverview = {
  about: string;
  recurring: RecurringIdea[];
  /** Every file whose summary the overview was read from. */
  file_ids: string[];
  model: string;
  read_at: string;
};

export type OverviewRead =
  | { ok: true; about: string; recurring: RecurringIdea[]; fileIds: string[] }
  | { ok: false; error: string };

/** A file as the overview reads it: one that has a summary. */
type ReadFile = Pick<CourseFile, 'id' | 'kind' | 'title' | 'week'> & {
  summary: NonNullable<CourseFile['summary']>;
};

/** The files with a summary, which are all an overview reads. */
export function readFiles(files: CourseFile[]): ReadFile[] {
  return files.filter((file): file is CourseFile & ReadFile => Boolean(file.summary));
}

/**
 * How many more files must be read before an overview can be asked for, or
 * 0 when it can be.
 */
export function overviewNeed(files: CourseFile[]): number {
  return Math.max(0, OVERVIEW_MIN_READ - readFiles(files).length);
}

/**
 * Files summarised since the overview was written: read now and either not
 * among the files it stood on or summarised again after it.
 */
export function newerSummaries(files: CourseFile[], overview: CourseOverview): number {
  const stood = new Set(overview.file_ids);
  return readFiles(files).filter((file) => !stood.has(file.id) || file.summary.read_at > overview.read_at).length;
}

type JsonSchema = Record<string, unknown>;

/** The tool definition: what the course was about and the ideas that recurred. */
export function overviewTool(): { name: string; description: string; input_schema: JsonSchema } {
  return {
    name: OVERVIEW_TOOL,
    description: 'Say what the course was about and which ideas came back in more than one of its files.',
    input_schema: {
      type: 'object',
      properties: {
        about: {
          type: 'string',
          description:
            'Two to four plain sentences on what the course was about as a whole: its subject, the question it kept asking, how it moved from start to end.',
        },
        recurring: {
          type: 'array',
          maxItems: RECURRING_MAX,
          items: {
            type: 'object',
            properties: {
              idea: {
                type: 'string',
                description: 'The idea in one sentence that makes sense on its own.',
              },
              files: {
                type: 'array',
                items: { type: 'integer' },
                minItems: 2,
                description: 'The numbers of the files it came back in, two or more.',
              },
            },
            required: ['idea', 'files'],
          },
          description: `Up to ${RECURRING_MAX} ideas that came back in two or more of the files, most important first. Empty when no idea came back.`,
        },
      },
      required: ['about', 'recurring'],
    },
  };
}

/** The system prompt for one read. */
export function overviewPrompt(courseTitle: string, total: number, read: number): string {
  const share = read === total ? `all ${read} of its files` : `${read} of its ${total} files`;
  return [
    `You read Dash's summaries of the files a person kept from a course they took, "${courseTitle}". Summaries exist for ${share}; each comes numbered, with its week and kind, a summary and its key points.`,
    'Say what the course was about as a whole in two to four plain sentences, for someone who took it and wants to remember it. Draw only on what the summaries say; where only some files were read, do not guess at the rest.',
    `Then list up to ${RECURRING_MAX} ideas that came back in two or more of the files, each as one sentence that makes sense on its own, with the numbers of the files it came back in. An idea in one file only is not recurring; leave it out.`,
    'Say what the course says, not what the summaries look like: no "the summaries show" or "file 3 mentions".',
    `Answer only through the ${OVERVIEW_TOOL} tool.`,
  ].join('\n');
}

/** The summaries as the model reads them, numbered from 1 in the order given. */
export function overviewText(files: ReadFile[]): string {
  return files
    .map((file, index) => {
      const where = [file.week === null ? null : `Week ${file.week}`, COURSE_FILE_KIND_LABELS[file.kind]]
        .filter(Boolean)
        .join(' · ');
      return [
        `[${index + 1}] ${where}: ${file.title}`,
        file.summary.summary,
        ...file.summary.points.map((point) => `- ${point}`),
      ].join('\n');
    })
    .join('\n\n');
}

/** What the summaries are sent with. */
export const OVERVIEW_INSTRUCTION = 'Say what this course was about and which ideas came back across its files.';

/** Turn the tool's answer into what is kept, mapping file numbers back to ids. */
export function readOverviewAnswer(input: unknown, files: Pick<ReadFile, 'id'>[]): OverviewRead {
  const answer = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const about = typeof answer.about === 'string' ? clean(answer.about).slice(0, ABOUT_MAX).trim() : '';
  if (!about) return { ok: false, error: 'Dash could not say what the course was about, so nothing was kept.' };

  const seen = new Set<string>();
  const recurring: RecurringIdea[] = [];
  for (const raw of Array.isArray(answer.recurring) ? answer.recurring : []) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const idea = typeof row.idea === 'string' ? clean(row.idea).replace(/^(?:[-*•]\s*)/, '').slice(0, IDEA_MAX).trim() : '';
    const key = idea.toLowerCase();
    if (!idea || seen.has(key)) continue;
    const ids = new Set<string>();
    for (const n of Array.isArray(row.files) ? row.files : []) {
      const index = typeof n === 'number' ? n : typeof n === 'string' ? Number(n) : NaN;
      const file = Number.isInteger(index) ? files[index - 1] : undefined;
      if (file) ids.add(file.id);
    }
    // Recurring means two files or more; one the model tied to a single file is left out.
    if (ids.size < 2) continue;
    seen.add(key);
    recurring.push({ idea, file_ids: [...ids] });
    if (recurring.length === RECURRING_MAX) break;
  }
  return { ok: true, about, recurring, fileIds: files.map((file) => file.id) };
}

/**
 * One read: refuse too few summaries, ask, and read the answer. Nothing is
 * saved here; the action keeps a read that comes back ok.
 */
export async function readCourseOverview(
  about: { courseTitle: string; files: CourseFile[] },
  ask: (source: ExtractSource, prompt: string) => Promise<ExtractResult>,
): Promise<OverviewRead> {
  const read = readFiles(about.files);
  if (read.length < OVERVIEW_MIN_READ) {
    return { ok: false, error: `Summarise ${OVERVIEW_MIN_READ - read.length} more ${OVERVIEW_MIN_READ - read.length === 1 ? 'file' : 'files'} first.` };
  }
  const answer = await ask(
    { kind: 'text', text: overviewText(read) },
    overviewPrompt(about.courseTitle, about.files.length, read.length),
  );
  if (!answer.ok) return answer;
  return readOverviewAnswer(answer.input, read);
}

/** A stored overview's recurring list, read defensively from its jsonb. */
export function storedRecurring(value: unknown): RecurringIdea[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as Record<string, unknown>;
    if (typeof row.idea !== 'string' || !row.idea.trim()) return [];
    const ids = Array.isArray(row.file_ids) ? row.file_ids.filter((id): id is string => typeof id === 'string') : [];
    return [{ idea: row.idea, file_ids: ids }];
  });
}

// ---------------------------------------------------------------------------
// The person's own notes about a course
// ---------------------------------------------------------------------------

/** The most notes listed under one course. */
export const COURSE_NOTES_MAX = 6;

/** A vault note that names the course, as the block lists it. */
export type CourseNote = { id: string; path: string; title: string; excerpt: string | null };

/**
 * A title of one word, or shorter than this, is too common a phrase to find
 * a course by: "Customer" turns up in every note about work.
 */
const TITLE_MIN = 12;
const CODE_MIN = 4;

/**
 * What a note has to contain to be about a course: its code, written with or
 * without the space ("ECON 101", "ECON101"), and its title when that is two
 * words or more and long enough not to turn up in every note. Characters PostgREST reads as syntax
 * in a filter are dropped.
 */
export function courseNoteNeedles(course: Pick<Course, 'code' | 'title'>): string[] {
  const out = new Set<string>();
  const code = safe(course.code ?? '');
  if (code.length >= CODE_MIN) {
    out.add(code);
    out.add(code.replace(/\s+/g, ''));
  }
  const title = safe(course.title);
  if (title.length >= TITLE_MIN && title.includes(' ')) out.add(title);
  return [...out];
}

/** The PostgREST `or` filter for notes whose title or text holds any needle, or null for none. */
export function courseNotesFilter(needles: string[]): string | null {
  if (needles.length === 0) return null;
  // Quoted, so a space in a code or title stays part of the value.
  return needles.flatMap((needle) => [`title.ilike."*${needle}*"`, `body.ilike."*${needle}*"`]).join(',');
}

/** The line of a note around its first mention of the course, or null when the mention is only in its title. */
export function noteExcerpt(body: string, needles: string[], width = 160): string | null {
  const lower = body.toLowerCase();
  let at = -1;
  let length = 0;
  for (const needle of needles) {
    const found = lower.indexOf(needle.toLowerCase());
    if (found !== -1 && (at === -1 || found < at)) {
      at = found;
      length = needle.length;
    }
  }
  if (at === -1) return null;
  const half = Math.max(0, Math.floor((width - length) / 2));
  const start = Math.max(0, at - half);
  const end = Math.min(body.length, at + length + half);
  const text = clean(body.slice(start, end).replace(/[#>*_`[\]]/g, ' '));
  if (!text) return null;
  return `${start > 0 ? '…' : ''}${text}${end < body.length ? '…' : ''}`;
}

function safe(text: string): string {
  return text.replace(/[%_,*()"\\:.]/g, ' ').replace(/\s+/g, ' ').trim();
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
