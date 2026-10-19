// What the LinkedIn section of Jobs settings shows (plan #2432.9): the plan an
// uploaded export would carry out, and the runs already applied. Plain data,
// read by the page, its server actions and the gallery alike.

import type { Counts, ImportPlan } from '@/lib/imports/types';
import { formatNumber } from '@/lib/money';

/** The private bucket the browser uploads export zips to, one folder per account. */
export const IMPORTS_BUCKET = 'imports';

/** The bucket's own limit (migration 0265). */
export const IMPORT_MAX_BYTES = 200 * 1024 * 1024;

/** Where an upload goes: the person's folder, a fresh id, and the file's own name. */
export function importUploadPath(userId: string, id: string, fileName: string): string {
  const safe = fileName.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120) || 'export.zip';
  return `${userId}/${id}-${safe}`;
}

/** The order the outcomes are shown in, and their column headings. */
export const OUTCOMES = [
  { outcome: 'added', label: 'Add' },
  { outcome: 'updated', label: 'Change' },
  { outcome: 'unchanged', label: 'Same' },
  { outcome: 'kept', label: 'Kept' },
  { outcome: 'skipped', label: 'Skip' },
] as const satisfies readonly { outcome: keyof Counts; label: string }[];

const KIND_LABELS: Record<string, string> = {
  applications: 'Applications',
  screeningAnswers: 'Screening answers',
  answers: 'Screening answers',
  connections: 'Connections',
  contacts: 'Connections',
  messages: 'Messages',
  invitations: 'Invitations',
  savedJobs: 'Saved jobs',
  companyFollows: 'Followed companies',
  jobSeekerPreferences: 'Job preferences',
  savedJobAlerts: 'Job alerts',
  positions: 'Positions',
  education: 'Education',
  courses: 'Profile courses',
  certifications: 'Certifications',
  honors: 'Honours',
  skills: 'Skills',
  learning: 'LinkedIn Learning',
  receipts: 'Receipts',
  identityAssets: 'Resumes',
};

/** A kind's name as the page says it: "savedJobs" reads "Saved jobs". */
export function kindLabel(kind: string): string {
  if (KIND_LABELS[kind]) return KIND_LABELS[kind];
  const words = kind
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface KindCountsView {
  kind: string;
  label: string;
  counts: Counts;
}

export interface SkippedFileView {
  path: string;
  reason: string;
}

/** What an uploaded export would do, shown before anything is written. */
export interface LinkedInPlanView {
  /** The upload, which Import applies. */
  path: string;
  fileName: string;
  /** The day LinkedIn made the export, as the page words it, when its name says. */
  exportDate: string | null;
  /** How many files the zip holds. */
  files: number;
  kinds: KindCountsView[];
  totals: Counts;
  skipped: SkippedFileView[];
}

/** One applied (or failed) import, for the history under the upload. */
export interface LinkedInRunView {
  id: string;
  /** When it ran, as the page words it. */
  ranOn: string;
  /** The day the export was made, as the page words it; null when unknown. */
  exportDate: string | null;
  status: 'running' | 'applied' | 'failed';
  error: string | null;
  kinds: KindCountsView[];
  totals: Counts;
  skipped: SkippedFileView[];
}

export function emptyCountsView(): Counts {
  return { added: 0, updated: 0, unchanged: 0, kept: 0, skipped: 0 };
}

function countsOf(value: unknown): Counts {
  const out = emptyCountsView();
  if (value && typeof value === 'object') {
    for (const key of Object.keys(out) as (keyof Counts)[]) {
      const n = Number((value as Record<string, unknown>)[key]);
      if (Number.isFinite(n)) out[key] = n;
    }
  }
  return out;
}

function sum(kinds: KindCountsView[]): Counts {
  const totals = emptyCountsView();
  for (const kind of kinds) {
    for (const key of Object.keys(totals) as (keyof Counts)[]) totals[key] += kind.counts[key];
  }
  return totals;
}

function skippedOf(value: unknown): SkippedFileView[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((f): f is { path: string; reason: string } => !!f && typeof f.path === 'string')
    .map((f) => ({ path: f.path, reason: typeof f.reason === 'string' ? f.reason : '' }));
}

/** The plan as the page shows it. */
export function planView(
  plan: ImportPlan,
  meta: { path: string; fileName: string; exportDate: string | null; files: number; skipped: SkippedFileView[] },
): LinkedInPlanView {
  const kinds = plan.kinds.map((k) => ({ kind: k.kind, label: kindLabel(k.kind), counts: { ...k.counts } }));
  return { ...meta, kinds, totals: sum(kinds) };
}

/** A core.import_runs row as the history shows it. Dates come formatted by the page. */
export function runView(
  row: {
    id: string;
    created_at: string;
    archive_date: string | null;
    status: string;
    counts: unknown;
    error: string | null;
    skipped_files?: unknown;
  },
  format: { ran: (iso: string) => string; exported: (day: string) => string },
): LinkedInRunView {
  const counts = row.counts && typeof row.counts === 'object' ? (row.counts as Record<string, unknown>) : {};
  const kinds = Object.keys(counts).map((kind) => ({ kind, label: kindLabel(kind), counts: countsOf(counts[kind]) }));
  const status = row.status === 'applied' || row.status === 'failed' ? row.status : 'running';
  return {
    id: row.id,
    ranOn: format.ran(row.created_at),
    exportDate: row.archive_date ? format.exported(row.archive_date) : null,
    status,
    error: row.error,
    kinds,
    totals: sum(kinds),
    skipped: skippedOf(row.skipped_files),
  };
}

/** "392 to add, 4 to change": the outcomes with anything in them, in words. */
export function countsSentence(counts: Counts, tense: 'plan' | 'done'): string {
  const words =
    tense === 'plan'
      ? { added: 'to add', updated: 'to change', unchanged: 'same', kept: 'kept', skipped: 'skipped' }
      : { added: 'added', updated: 'changed', unchanged: 'same', kept: 'kept', skipped: 'skipped' };
  const parts = OUTCOMES.filter(({ outcome }) => counts[outcome] > 0).map(
    ({ outcome }) => `${formatNumber(counts[outcome])} ${words[outcome]}`,
  );
  return parts.length > 0 ? parts.join(', ') : 'Nothing';
}
