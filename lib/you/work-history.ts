/**
 * The jobs on You's Work & school tab (plan #1991.4): what a row holds, how
 * its dates are written and read, and the rule a new read of the résumé
 * follows. The read itself is lib/you/work-history-read.ts.
 *
 * A date is a year ('2020') or a year and month ('2020-05'), as You's places
 * keep them. An empty `ended` means the job is the one held now.
 */
import { z } from 'zod';
import { EDUCATION_HREF } from '@/lib/you/education';

/** One row of you.work_history. */
export type Job = {
  id: string;
  user_id: string;
  employer: string;
  title: string | null;
  place: string | null;
  started: string | null;
  ended: string | null;
  note: string | null;
  edited: boolean;
  resume_id: string | null;
  resume_hash: string | null;
  /** Null for a job read from the résumé or added by hand; 'linkedin' for one the import wrote (plan #2432.7). */
  source: string | null;
  position: number;
  created_at: string;
  updated_at: string;
};

/** A job as read off a résumé, before it is saved. */
export type DraftJob = {
  employer: string;
  title: string | null;
  place: string | null;
  started: string | null;
  ended: string | null;
};

/** The anchor a job's row carries on the Work & school tab. */
export function jobAnchor(id: string): string {
  return `job-${id}`;
}

/** Where one job opens: its row on the Work & school tab. */
export function jobHref(id: string): string {
  return `${EDUCATION_HREF}#${jobAnchor(id)}`;
}

/** Where the résumés are kept in Jobs. */
export const RESUMES_HREF = '/jobs/material?part=resumes';

const MONTH_DATE = /^(\d{4})(?:-(0[1-9]|1[0-2]))?$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A stored date as a person reads it: "2020" or "May 2020". */
export function dateLabel(value: string): string {
  const match = MONTH_DATE.exec(value);
  if (!match) return value;
  return match[2] ? `${MONTHS[Number(match[2]) - 1]} ${match[1]}` : match[1];
}

/** A job's dates as one line: "2020 – 2023", "May 2025 – now", "Until 2019". */
export function jobDates(job: Pick<Job, 'started' | 'ended'>): string | null {
  if (job.started && job.ended) {
    return job.started === job.ended ? dateLabel(job.started) : `${dateLabel(job.started)} – ${dateLabel(job.ended)}`;
  }
  if (job.started) return `${dateLabel(job.started)} – now`;
  if (job.ended) return `Until ${dateLabel(job.ended)}`;
  return null;
}

/**
 * Read what a person typed as a date: "2020", "2020-5", "2020-05", "5/2020",
 * "May 2020" or "2020 May". Empty is null. Anything else is not a date.
 */
export function parseMonthDate(raw: string): { ok: true; value: string | null } | { ok: false } {
  const text = raw.trim();
  if (text === '') return { ok: true, value: null };
  const pad = (month: number) => String(month).padStart(2, '0');
  const year = (value: string) => {
    const n = Number(value);
    return n >= 1900 && n <= 2200;
  };

  let match = /^(\d{4})$/.exec(text);
  if (match && year(match[1])) return { ok: true, value: match[1] };
  match = /^(\d{4})[-/.](\d{1,2})$/.exec(text) ?? null;
  if (match && year(match[1]) && Number(match[2]) >= 1 && Number(match[2]) <= 12) {
    return { ok: true, value: `${match[1]}-${pad(Number(match[2]))}` };
  }
  match = /^(\d{1,2})[-/.](\d{4})$/.exec(text);
  if (match && year(match[2]) && Number(match[1]) >= 1 && Number(match[1]) <= 12) {
    return { ok: true, value: `${match[2]}-${pad(Number(match[1]))}` };
  }
  const words = /^([a-z]+)\.?,?\s+(\d{4})$/i.exec(text) ?? /^(\d{4})\s+([a-z]+)\.?$/i.exec(text);
  if (words) {
    const [name, y] = /^\d/.test(words[1]) ? [words[2], words[1]] : [words[1], words[2]];
    const month = MONTHS.findIndex((m) => name.toLowerCase().startsWith(m.toLowerCase()));
    if (month >= 0 && year(y)) return { ok: true, value: `${y}-${pad(month + 1)}` };
  }
  return { ok: false };
}

const optional = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} can be at most ${max} characters.`)
    .transform((value) => (value === '' ? null : value));

const JobFields = z.object({
  employer: z
    .string()
    .trim()
    .min(1, 'Say where you worked.')
    .max(200, 'The employer can be at most 200 characters.'),
  title: optional(200, 'The title'),
  place: optional(200, 'The place'),
  note: optional(4000, 'The note'),
});

export type JobInput = DraftJob & { note: string | null };

/** Read the edit form. Errors name the field they are on. */
export function parseJob(
  get: (field: string) => string,
): { ok: true; job: JobInput } | { ok: false; error: string; field: string } {
  const fields = JobFields.safeParse({
    employer: get('employer'),
    title: get('title'),
    place: get('place'),
    note: get('note'),
  });
  if (!fields.success) {
    const issue = fields.error.issues[0];
    return { ok: false, error: issue?.message ?? 'That job could not be saved.', field: String(issue?.path[0] ?? '') };
  }
  const started = parseMonthDate(get('started'));
  if (!started.ok) return { ok: false, error: 'Write the start as a year, or a month and year: 2020 or May 2020.', field: 'started' };
  const ended = parseMonthDate(get('ended'));
  if (!ended.ok) return { ok: false, error: 'Write the end as a year, or a month and year, or leave it empty if you work there now.', field: 'ended' };
  if (started.value && ended.value && ended.value < started.value && ended.value.slice(0, 4) !== started.value.slice(0, 4)) {
    return { ok: false, error: 'The end is before the start.', field: 'ended' };
  }
  return { ok: true, job: { ...fields.data, started: started.value, ended: ended.value } };
}

/** Newest first: the job held now, then by start, then in the résumé's order. */
export function sortJobs<T extends Pick<Job, 'started' | 'ended' | 'position'>>(jobs: readonly T[]): T[] {
  const key = (value: string | null) => value ?? '';
  return [...jobs].sort((a, b) => {
    const current = Number(b.ended === null && b.started !== null) - Number(a.ended === null && a.started !== null);
    if (current !== 0) return current;
    const start = key(b.started).localeCompare(key(a.started));
    if (start !== 0) return start;
    const end = key(b.ended).localeCompare(key(a.ended));
    if (end !== 0) return end;
    return a.position - b.position;
  });
}

/** A name as two rows are compared by: lower case, no punctuation, no "Inc" or "LLC". */
export const normal = (value: string | null) =>
  (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(inc|llc|ltd|llp|plc|corp|co|the)\b/g, '')
    .trim();

/** Whether a job read off a résumé is one the person already keeps. */
function sameJob(kept: Pick<Job, 'employer' | 'title' | 'started'>, read: DraftJob): boolean {
  if (normal(kept.employer) !== normal(read.employer)) return false;
  if (kept.started && read.started) return kept.started.slice(0, 4) === read.started.slice(0, 4);
  return normal(kept.title) === normal(read.title);
}

/**
 * What a new read of the résumé changes (plan #1991.4). Every row Dash wrote
 * and the person has not touched is replaced by the new read; every row they
 * edited or added, and every row the LinkedIn import wrote, stays as it is, and a job the read finds that matches one
 * of those (same employer, and the same start year or the same title) is not
 * added a second time. Those kept rows are named in `confirmed`, so the read
 * can mark them as found on this résumé without changing what they say.
 */
export function planRead(
  existing: readonly (Pick<Job, 'id' | 'employer' | 'title' | 'started' | 'edited'> & { source?: string | null })[],
  read: readonly DraftJob[],
): { remove: string[]; add: DraftJob[]; kept: number; confirmed: string[] } {
  // A row the LinkedIn import wrote or filled in is the person's too: a read never replaces it.
  const kept = existing.filter((job) => job.edited || job.source != null);
  return {
    remove: existing.filter((job) => !kept.includes(job)).map((job) => job.id),
    add: read.filter((job) => !kept.some((mine) => sameJob(mine, job))),
    kept: kept.length,
    confirmed: kept.filter((mine) => read.some((job) => sameJob(mine, job))).map((job) => job.id),
  };
}

/** The résumé a read takes: the default, or the newest with text when none is marked. */
export type ResumeChoice = { id: string; label: string; hash: string };

/**
 * Whether the tab should offer to read the résumé again: there is one, and no
 * row came from its current text.
 */
export function resumeChanged(resume: ResumeChoice | null, jobs: readonly Pick<Job, 'resume_hash'>[]): boolean {
  if (!resume) return false;
  const read = jobs.filter((job) => job.resume_hash !== null);
  if (read.length === 0) return false;
  return !read.some((job) => job.resume_hash === resume.hash);
}
