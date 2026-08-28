import 'server-only';

import { safeFetch } from './ssrf';
import { htmlToText } from './generic';
import type { FetchedPosting } from './types';

/**
 * Rippling's ATS board API. Board-at-a-time, matched on the posting uuid from
 * the URL.
 */

const BASE = 'https://api.rippling.com/platform/api/ats/v1/board';

export interface RipplingJob {
  uuid?: string;
  id?: string;
  name?: string;
  descriptionHtml?: string;
  description?: string;
  url?: string;
  workLocation?: { label?: string; city?: string; state?: string; country?: string };
  workplaceType?: string;
}

function locationName(job: RipplingJob): string | null {
  const location = job.workLocation;
  if (!location) return job.workplaceType === 'REMOTE' ? 'Remote' : null;
  const name =
    location.label ?? [location.city, location.state, location.country].filter(Boolean).join(', ');
  if (job.workplaceType === 'REMOTE') return name ? `Remote — ${name}` : 'Remote';
  return name || null;
}

/** The shape assumption, kept separate from the fetch so it can be tested. */
export function toPosting(
  parsed: RipplingJob[] | { items?: RipplingJob[] },
  boardSlug: string,
  jobId: string | null,
): FetchedPosting {
  const jobs = Array.isArray(parsed) ? parsed : (parsed.items ?? []);

  const job = jobId
    ? (jobs.find((entry) => entry.uuid === jobId) ?? jobs.find((entry) => entry.id === jobId))
    : jobs[0];

  if (!job?.name) throw new Error('Rippling returned no matching posting.');

  return {
    vendor: 'rippling',
    title: job.name,
    text: htmlToText(job.descriptionHtml ?? job.description ?? ''),
    url: job.url ?? null,
    location: locationName(job),
    atsJobId: job.uuid ?? job.id ?? jobId,
    boardToken: boardSlug,
    questions: [],
  };
}

export async function fetchPosting(
  boardSlug: string,
  jobId: string | null,
): Promise<FetchedPosting> {
  const { status, body } = await safeFetch(`${BASE}/${encodeURIComponent(boardSlug)}/jobs`);
  if (status !== 200) throw new Error(`Rippling returned ${status} for that board.`);

  return toPosting(
    JSON.parse(body) as RipplingJob[] | { items?: RipplingJob[] },
    boardSlug,
    jobId,
  );
}
