import type { LinkedInArchive, SavedJobRecord } from '@/lib/linkedin/archive';

// Which LinkedIn saved jobs are recent enough to become leads (plan #2432.6).
// A posting cannot be checked for being open, so only a job saved within
// SAVED_JOB_DAYS of the export's date is imported; an older one is counted as
// skipped. The companies and roles mappers and the leads mapper all ask this,
// so a saved job is either imported by all three or by none.

export const SAVED_JOB_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The day the export was made: the one the caller gave (from the zip's
 * name), else the latest date anything in the export carries.
 */
export function exportDay(archive: LinkedInArchive): string | null {
  if (archive.exportedOn) return archive.exportedOn.slice(0, 10);
  const dates: (string | null)[] = [
    ...archive.applications.map((a) => a.appliedAt),
    ...archive.savedJobs.map((s) => s.savedAt),
    ...archive.companyFollows.map((f) => f.followedAt),
    ...archive.savedJobAlerts.map((a) => a.alertDate),
    ...archive.messages.map((m) => m.sentAt),
    ...archive.invitations.map((i) => i.sentAt),
    ...archive.connections.map((c) => c.connectedOn),
  ];
  let latest = Number.NEGATIVE_INFINITY;
  for (const d of dates) {
    const ms = d ? Date.parse(d) : Number.NaN;
    if (!Number.isNaN(ms) && ms > latest) latest = ms;
  }
  return Number.isFinite(latest) ? new Date(latest).toISOString().slice(0, 10) : null;
}

/** Why a saved job is not imported, or null when it is: it names a company and a title and is recent. */
export function savedJobSkip(job: SavedJobRecord, day: string | null): string | null {
  if (!job.companyName?.trim() || !job.jobTitle?.trim()) return 'It names no company or no job title.';
  const saved = job.savedAt ? Date.parse(job.savedAt) : Number.NaN;
  if (Number.isNaN(saved)) return 'It has no saved date, so it cannot be told apart from postings long closed.';
  if (!day) return 'The export has no date to measure it against.';
  if (saved < Date.parse(`${day}T00:00:00Z`) - SAVED_JOB_DAYS * DAY_MS) {
    return `Saved more than ${SAVED_JOB_DAYS} days before the export; the posting has most likely closed.`;
  }
  return null;
}

/** The saved jobs that become roles and leads, minus any the applications already cover. */
export function recentSavedJobs(archive: LinkedInArchive): SavedJobRecord[] {
  const day = exportDay(archive);
  const applied = new Set(archive.applications.map((a) => a.key));
  return archive.savedJobs.filter((s) => !applied.has(s.key) && savedJobSkip(s, day) === null);
}
