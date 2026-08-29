import 'server-only';

import { safeFetch } from './ssrf';
import { htmlToText } from './generic';
import type { FetchedPosting } from './types';

/**
 * Workable's public job board widget.
 *
 * Board-at-a-time like Ashby rather than posting-at-a-time, so the shortcode
 * from the URL is matched inside the payload. `details=true` is what makes the
 * description come back at all — without it the widget returns titles only,
 * which looks like a successful fetch and produces an empty JD.
 */

export interface WorkableJob {
  id?: string;
  shortcode?: string;
  title?: string;
  description?: string;
  requirements?: string;
  benefits?: string;
  url?: string;
  application_url?: string;
  location?: { city?: string; region?: string; country?: string; workplace_type?: string };
  employment_type?: string;
}

function bodyText(job: WorkableJob): string {
  return [job.description, job.requirements, job.benefits]
    .filter((section): section is string => Boolean(section))
    .map((section) => htmlToText(section))
    .join('\n\n')
    .trim();
}

function locationName(job: WorkableJob): string | null {
  const location = job.location;
  if (!location) return null;
  const parts = [location.city, location.region, location.country].filter(Boolean);
  const name = parts.join(', ');
  if (location.workplace_type && location.workplace_type !== 'onsite') {
    return name ? `${location.workplace_type} — ${name}` : location.workplace_type;
  }
  return name || null;
}

/** The shape assumption, kept separate from the fetch so it can be tested. */
export function toPosting(
  parsed: { jobs?: WorkableJob[] },
  subdomain: string,
  shortcode: string | null,
): FetchedPosting {
  const jobs = parsed.jobs ?? [];
  const job = shortcode
    ? jobs.find((entry) => entry.shortcode?.toLowerCase() === shortcode.toLowerCase())
    : jobs[0];

  if (!job?.title) throw new Error('Workable returned no matching posting.');

  return {
    vendor: 'workable',
    title: job.title,
    text: bodyText(job),
    url: job.url ?? job.application_url ?? null,
    location: locationName(job),
    atsJobId: job.shortcode ?? job.id ?? shortcode,
    boardToken: subdomain,
    questions: [],
  };
}

export async function fetchPosting(
  subdomain: string,
  shortcode: string | null,
): Promise<FetchedPosting> {
  const { status, body } = await safeFetch(
    `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(subdomain)}?details=true`,
  );
  if (status !== 200) throw new Error(`Workable returned ${status} for that board.`);

  return toPosting(JSON.parse(body) as { jobs?: WorkableJob[] }, subdomain, shortcode);
}
