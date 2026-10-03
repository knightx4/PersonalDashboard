/**
 * Where a resume version's PDF sits in the job-search bucket.
 *
 * The browser uploads the file on your session (job search migration 0042
 * gives you your own folder there), and the server only ever stores a path it
 * has checked is in that folder. The settings page opens the file through
 * /jobs/resume/<id>, which signs a short-lived link to it.
 */

/** A two-page resume is well under a megabyte; ten leaves room for a scan. */
export const RESUME_MAX_BYTES = 10 * 1024 * 1024;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** A fresh path for an upload, under your folder. */
export function resumePath(userId: string, fileId: string): string {
  return `${userId}/resumes/${fileId}.pdf`;
}

/** Whether a path came from resumePath for this person. */
export function ownsResumePath(userId: string, path: string): boolean {
  if (!path.startsWith(`${userId}/resumes/`)) return false;
  return new RegExp(`^${UUID}\\.pdf$`, 'i').test(path.slice(userId.length + '/resumes/'.length));
}

/** Why a picked file cannot be kept, or null when it can. */
export function resumeFileProblem(file: { name: string; type: string; size: number }): string | null {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf) return 'Pick a PDF.';
  if (file.size > RESUME_MAX_BYTES) return 'That PDF is over 10 MB.';
  if (file.size === 0) return 'That file is empty.';
  return null;
}
