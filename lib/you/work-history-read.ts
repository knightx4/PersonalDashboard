/**
 * Reading the jobs off a résumé for You's Work & school tab (plan #1991.4).
 *
 * The résumé is the text Jobs already keeps for it
 * (job_search.resume_versions.text_content), so the read is one model call
 * on text, made in lib/you/work-history-model.ts and passed in here so the
 * tests stub it. This file builds the tool and turns its answer into jobs.
 *
 * Dates come back as a year or a year and month, the way you.work_history
 * keeps them, and a job the résumé says is current has no end.
 */
import { parseMonthDate, type DraftJob } from '@/lib/you/work-history';

/** The one tool the model answers through. */
export const WORK_HISTORY_TOOL = 'list_jobs';

/** The most jobs one read keeps; a long career on one résumé has about fifteen. */
export const JOBS_MAX = 60;

/** The longest résumé text sent; a two-page résumé is about six thousand characters. */
export const RESUME_TEXT_MAX = 40_000;

export type WorkHistoryAnswer = { ok: true; input: unknown } | { ok: false; error: string };

export type WorkHistoryRead = { ok: true; jobs: DraftJob[] } | { ok: false; error: string };

type JsonSchema = Record<string, unknown>;

const nullableString = (description: string): JsonSchema => ({ type: ['string', 'null'], description });

/** The tool definition: one entry per job. */
export function workHistoryTool(): { name: string; description: string; input_schema: JsonSchema } {
  const date = (which: string) =>
    nullableString(
      `When the job ${which}, as "YYYY" or "YYYY-MM". Use the month only when the résumé gives one. Null when it gives none.`,
    );
  return {
    name: WORK_HISTORY_TOOL,
    description: 'List every job on the résumé, as it is written.',
    input_schema: {
      type: 'object',
      properties: {
        jobs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              employer: { type: 'string', description: 'The company or organisation, as written.' },
              title: nullableString('The job title, as written. Null when none is given.'),
              place: nullableString('Where the job was, as written: "Dallas, TX", "Remote". Null when none is given.'),
              started: date('started'),
              ended: date('ended, or null when the résumé says it is current ("Present", "Now", "Current")'),
              current: {
                type: 'boolean',
                description: 'True when the résumé says this is a job held now.',
              },
            },
            required: ['employer', 'title', 'place', 'started', 'ended', 'current'],
          },
        },
      },
      required: ['jobs'],
    },
  };
}

/** The system prompt for the read. */
export function workHistoryPrompt(): string {
  return [
    'You read résumés and list the jobs on them.',
    'List every job in the professional experience, with its employer, title, place and dates copied as written. Internships, part-time and advisory roles count; degrees, courses, volunteering listed as education, and skills do not.',
    'When one employer lists two titles with their own dates, give each title its own entry.',
    'Do not fill in anything the résumé does not say. A year range such as "2020 - 2023" is started 2020 and ended 2023; "Jan 2020" is 2020-01.',
    `Answer only through the ${WORK_HISTORY_TOOL} tool.`,
  ].join('\n');
}

/** Read a résumé's text into jobs. A résumé with no jobs in it comes back as a message. */
export async function readWorkHistory(
  text: string,
  ask: (text: string) => Promise<WorkHistoryAnswer>,
): Promise<WorkHistoryRead> {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, error: 'Your résumé in Jobs has no text to read. Upload it there again.' };
  const answer = await ask(trimmed.slice(0, RESUME_TEXT_MAX));
  if (!answer.ok) return answer;
  const jobs = readWorkHistoryAnswer(answer.input);
  if (jobs.length === 0) return { ok: false, error: 'No jobs could be read from your résumé. Add them here yourself.' };
  return { ok: true, jobs };
}

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed === '' ? null : trimmed.slice(0, max);
};

const date = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const parsed = parseMonthDate(value);
  return parsed.ok ? parsed.value : null;
};

/** Turn the model's tool input into jobs, dropping anything malformed. */
export function readWorkHistoryAnswer(input: unknown): DraftJob[] {
  const list = (input as { jobs?: unknown } | null)?.jobs;
  if (!Array.isArray(list)) return [];
  const jobs: DraftJob[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const employer = text(row.employer, 200);
    if (!employer) continue;
    const started = date(row.started);
    let ended = row.current === true ? null : date(row.ended);
    // An end before the start is a misread; keep the start alone.
    if (started && ended && ended < started && ended.slice(0, 4) !== started.slice(0, 4)) ended = null;
    jobs.push({ employer, title: text(row.title, 200), place: text(row.place, 200), started, ended });
    if (jobs.length === JOBS_MAX) break;
  }
  return jobs;
}
