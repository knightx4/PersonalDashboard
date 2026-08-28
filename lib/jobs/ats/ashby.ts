import 'server-only';

import { safeFetch } from './ssrf';
import type { FetchedPosting } from './types';

/**
 * Ashby's public job board API. Returns every published posting for a board in
 * one call, so an individual posting is found by id within that payload.
 * `includeCompensation=true` is free and gives the comp band when the company
 * publishes it.
 */

interface AshbyJob {
  id?: string;
  title?: string;
  location?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
  jobUrl?: string;
  applyUrl?: string;
  compensation?: {
    summaryComponents?: Array<{
      compensationType?: string;
      minValue?: number;
      maxValue?: number;
      currencyCode?: string;
    }>;
  };
}

export async function fetchPosting(
  boardName: string,
  jobId: string | null,
): Promise<FetchedPosting> {
  const { status, body } = await safeFetch(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(boardName)}?includeCompensation=true`,
  );
  if (status !== 200) throw new Error(`Ashby returned ${status} for that board.`);

  const parsed = JSON.parse(body) as { jobs?: AshbyJob[] };
  const jobs = parsed.jobs ?? [];
  const job = jobId ? jobs.find((j) => j.id === jobId) : jobs[0];
  if (!job?.title) throw new Error('Ashby returned no matching posting.');

  return {
    vendor: 'ashby',
    title: job.title,
    text: job.descriptionPlain ?? stripHtml(job.descriptionHtml ?? ''),
    url: job.jobUrl ?? job.applyUrl ?? null,
    location: job.location ?? null,
    atsJobId: job.id ?? jobId,
    boardToken: boardName,
    questions: [],
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/** Comp band in integer cents, when the board publishes one. */
export function compensationFromAshby(job: AshbyJob): {
  minCents: number | null;
  maxCents: number | null;
} {
  const salary = job.compensation?.summaryComponents?.find(
    (c) => c.compensationType === 'Salary',
  );
  return {
    minCents: salary?.minValue != null ? Math.round(salary.minValue * 100) : null,
    maxCents: salary?.maxValue != null ? Math.round(salary.maxValue * 100) : null,
  };
}
