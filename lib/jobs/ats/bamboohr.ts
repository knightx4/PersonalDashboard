import 'server-only';

import { safeFetch } from './ssrf';
import { htmlToText } from './generic';
import type { FetchedPosting } from './types';

/**
 * BambooHR's careers site, which is a JSON API wearing a page.
 *
 * Two calls rather than one: the list endpoint has titles and locations, the
 * detail endpoint has the description. Going straight to detail is fine and is
 * what this does — the list is only consulted when the URL gave us no id.
 */

export interface BambooDetail {
  id?: number | string;
  jobOpeningName?: string;
  jobOpeningShareUrl?: string;
  description?: string;
  location?: { city?: string; state?: string; country?: string };
  atsLocation?: { city?: string; state?: string; country?: string };
  isRemote?: boolean;
  locationType?: string;
}

function locationName(detail: BambooDetail): string | null {
  const location = detail.atsLocation ?? detail.location;
  if (!location) return detail.isRemote ? 'Remote' : null;
  const name = [location.city, location.state, location.country].filter(Boolean).join(', ');
  if (detail.isRemote || detail.locationType === 'remote') {
    return name ? `Remote — ${name}` : 'Remote';
  }
  return name || null;
}

export async function fetchPosting(
  subdomain: string,
  jobId: string | null,
): Promise<FetchedPosting> {
  const id = jobId ?? (await firstOpeningId(subdomain));
  if (!id) throw new Error('BambooHR returned no postings for that board.');

  const { status, body } = await safeFetch(
    `https://${encodeURIComponent(subdomain)}.bamboohr.com/careers/${encodeURIComponent(id)}/detail`,
  );
  if (status !== 200) throw new Error(`BambooHR returned ${status} for that posting.`);

  return toPosting(JSON.parse(body) as { result?: BambooDetail } | BambooDetail, subdomain, id);
}

/** The shape assumption, kept separate from the fetch so it can be tested. */
export function toPosting(
  parsed: { result?: BambooDetail } | BambooDetail,
  subdomain: string,
  id: string,
): FetchedPosting {
  const detail = 'result' in parsed && parsed.result ? parsed.result : (parsed as BambooDetail);
  if (!detail.jobOpeningName) throw new Error('BambooHR returned no posting.');

  return {
    vendor: 'bamboohr',
    title: detail.jobOpeningName,
    text: htmlToText(detail.description ?? ''),
    url: detail.jobOpeningShareUrl ?? null,
    location: locationName(detail),
    atsJobId: detail.id != null ? String(detail.id) : id,
    boardToken: subdomain,
    questions: [],
  };
}

async function firstOpeningId(subdomain: string): Promise<string | null> {
  const list = await fetchList(subdomain);
  const id = list[0]?.id;
  return id != null ? String(id) : null;
}

export interface BambooListing {
  id?: number | string;
  jobOpeningName?: string;
  location?: { city?: string; state?: string; country?: string };
  atsLocation?: { city?: string; state?: string; country?: string };
  isRemote?: boolean;
  locationType?: string;
}

async function fetchList(subdomain: string): Promise<BambooListing[]> {
  const { status, body } = await safeFetch(
    `https://${encodeURIComponent(subdomain)}.bamboohr.com/careers/list`,
  );
  if (status !== 200) throw new Error(`BambooHR returned ${status} for that board.`);
  const parsed = JSON.parse(body) as { result?: BambooListing[] };
  return parsed.result ?? [];
}

/**
 * The board index, titles only.
 *
 * BambooHR keeps the description on a per-posting endpoint, so these come back
 * with an empty `text` and the caller hydrates the one it matched.
 */
export async function fetchBoard(subdomain: string): Promise<FetchedPosting[]> {
  return toPostings(await fetchList(subdomain), subdomain);
}

export function toPostings(listings: BambooListing[], subdomain: string): FetchedPosting[] {
  return listings
    .filter((listing) => Boolean(listing.jobOpeningName) && listing.id != null)
    .map((listing) => ({
      vendor: 'bamboohr',
      title: listing.jobOpeningName ?? '',
      text: '',
      url: null,
      location: locationName(listing as BambooDetail),
      atsJobId: String(listing.id),
      boardToken: subdomain,
      questions: [],
    }));
}
