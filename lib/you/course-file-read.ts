/**
 * Dash's summary of one file kept under a course (plan #2401.4, under #2401).
 *
 * Pressing Summarise on a file has Dash read it once and write a short
 * summary and up to five points worth keeping, which the Work & school tab
 * keeps in you.course_file_summaries so the file is not read again to show
 * them. This is the part with no database and no model in it: what is sent,
 * the tool the answer comes back through, and turning the answer into what is
 * kept, or into the reason nothing is.
 *
 * The file handling is the goals document reader's (extractSource in
 * lib/goals/extract-read.ts): a PDF or a photo goes as itself, a Word file and
 * a text file as their text. A PowerPoint file, which that reader does not
 * take, goes as its slides' words and speaker notes (lib/you/pptx.ts). The
 * model call is askCourseFileModel in lib/you/course-file-model.ts, passed in
 * here so the tests stub it.
 */

import { PASTE_MAX } from '@/lib/goals/extract';
import { extractSource } from '@/lib/goals/extract-read';
import type { ExtractResult, ExtractSource } from '@/lib/goals/extract-model';
import { pptxText } from '@/lib/you/pptx';
import { COURSE_FILE_KIND_LABELS, type CourseFileKind } from '@/lib/you/transcripts';

/** The one tool the model answers through. */
export const SUMMARY_TOOL = 'summarise_file';

/** The most key points kept for one file. */
export const POINTS_MAX = 5;

/** you.course_file_summaries' own limits. */
const SUMMARY_MAX = 2000;
const POINT_MAX = 400;

/** What is kept from one read. */
export type CourseFileSummary = {
  summary: string;
  points: string[];
};

export type CourseFileRead = ({ ok: true } & CourseFileSummary) | { ok: false; error: string };

/** The file as Dash is told about it: what it is and which course it is from. */
export type CourseFileAbout = {
  /** The stored path or the file's name; its extension says how it is read. */
  name: string;
  bytes: Uint8Array;
  title: string;
  kind: CourseFileKind;
  week: number | null;
  courseTitle: string;
};

type JsonSchema = Record<string, unknown>;

/** The tool definition: a summary, the points, and why there are none when the file cannot be read. */
export function summaryTool(): { name: string; description: string; input_schema: JsonSchema } {
  return {
    name: SUMMARY_TOOL,
    description: 'Give a short summary of the file and the points in it worth keeping.',
    input_schema: {
      type: 'object',
      properties: {
        summary: {
          type: ['string', 'null'],
          description:
            'Two to four plain sentences on what the file covers and argues. Null when the file cannot be made sense of.',
        },
        points: {
          type: 'array',
          maxItems: POINTS_MAX,
          items: { type: 'string' },
          description: `Up to ${POINTS_MAX} points worth keeping from it, each one sentence that makes sense on its own: an idea, a claim, a definition, a result. Empty when the file cannot be made sense of.`,
        },
        unreadable: {
          type: ['string', 'null'],
          description:
            'When the file cannot be made sense of, one short sentence saying why: it is blank, it is a scan too blurred to read, it holds only pictures with no words. Null otherwise.',
        },
      },
      required: ['summary', 'points', 'unreadable'],
    },
  };
}

/** The system prompt for one read. */
export function summaryPrompt(about: Pick<CourseFileAbout, 'title' | 'kind' | 'week' | 'courseTitle'>): string {
  const what = COURSE_FILE_KIND_LABELS[about.kind].toLowerCase();
  const week = about.week === null ? '' : `, from week ${about.week}`;
  return [
    `You read a file a person kept from a course they took, "${about.courseTitle}". It is the course's ${what}${week}, titled "${about.title}".`,
    'Write a summary of what it covers and argues, in two to four plain sentences, for someone who took the course and wants to remember it.',
    `Then list up to ${POINTS_MAX} points worth keeping from it: the ideas, claims, definitions or results a person would want to recall years later. Each point is one sentence that makes sense without the file. Leave out housekeeping such as dates, deadlines, grading and reading lists, unless the file is only that.`,
    'Say what the file says, not what it looks like: no "this slide deck" or "the author then".',
    'A deck of slides arrives as each slide\'s words and its speaker notes. A scan or a photo is read as far as it can be.',
    'When there is too little in the file to say anything true about it, give no summary and no points, and say why in unreadable.',
    `Answer only through the ${SUMMARY_TOOL} tool.`,
  ].join('\n');
}

/** Put the file in the shape the model takes, or say why it cannot be read. */
export function courseFileSource(
  input: Pick<CourseFileAbout, 'name' | 'bytes'>,
): { ok: true; source: ExtractSource } | { ok: false; error: string } {
  if (/\.pptx$/i.test(input.name.trim())) {
    if (input.bytes.length === 0) return { ok: false, error: 'That file is empty.' };
    const text = pptxText(input.bytes);
    if (text === null) return { ok: false, error: 'That PowerPoint file could not be opened.' };
    if (!text) {
      return {
        ok: false,
        error:
          'Its slides hold no words Dash can read. Slides made of pictures are read from a PDF: save the deck as a PDF and add that.',
      };
    }
    return { ok: true, source: { kind: 'text', text: text.slice(0, PASTE_MAX) } };
  }
  return extractSource({ name: input.name, bytes: input.bytes });
}

/** Turn the tool's answer into what is kept, or the reason nothing is. */
export function readSummaryAnswer(input: unknown): CourseFileRead {
  const answer = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const summary = typeof answer.summary === 'string' ? clean(answer.summary).slice(0, SUMMARY_MAX).trim() : '';
  const seen = new Set<string>();
  const points: string[] = [];
  for (const raw of Array.isArray(answer.points) ? answer.points : []) {
    if (typeof raw !== 'string') continue;
    const point = clean(raw).replace(/^(?:[-*•]\s*|\d{1,2}[.)]\s+)/, '').slice(0, POINT_MAX).trim();
    const key = point.toLowerCase();
    if (!point || seen.has(key)) continue;
    seen.add(key);
    points.push(point);
    if (points.length === POINTS_MAX) break;
  }

  if (summary && points.length > 0) return { ok: true, summary, points };
  const why = typeof answer.unreadable === 'string' ? clean(answer.unreadable) : '';
  if (why) return { ok: false, error: `Dash could not make sense of it. ${sentence(why)}` };
  return { ok: false, error: 'Dash could not make sense of it, so nothing was kept.' };
}

/**
 * One read: put the file in shape, ask, and read the answer. Nothing is
 * saved here; the action keeps a read that comes back ok.
 */
export async function readCourseFile(
  about: CourseFileAbout,
  ask: (source: ExtractSource, prompt: string) => Promise<ExtractResult>,
): Promise<CourseFileRead> {
  const source = courseFileSource(about);
  if (!source.ok) return source;
  const answer = await ask(source.source, summaryPrompt(about));
  if (!answer.ok) return answer;
  return readSummaryAnswer(answer.input);
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function sentence(text: string): string {
  const capital = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}
