/**
 * A Jobs write's refusal, the sentence the model reads and says in words
 * (runJobsWrite in lib/dash/jobs-writes.ts). Kept in a file of its own so the
 * writes split out of jobs-writes.ts (lib/dash/career-writes.ts) can throw it
 * without importing that file, which imports them.
 */
export class JobsRefused extends Error {}
