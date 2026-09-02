import 'server-only';

import { safeFetch } from './ssrf';
import { htmlToText } from './generic';
import type { FetchedPosting } from './types';

/**
 * Breezy publishes its whole board as JSON at a fixed path on the company's
 * own subdomain. No API key, no board token beyond the subdomain itself.
 */

export interface BreezyPosition {
  id?: string;
  name?: string;
  description?: string;
  friendly_id?: string;
  url?: string;
  location?: { name?: string; city?: string; country?: { name?: string }; is_remote?: boolean };
  type?: { name?: string };
}

function locationName(position: BreezyPosition): string | null {
  const location = position.location;
  if (!location) return null;
  const name =
    location.name ?? [location.city, location.country?.name].filter(Boolean).join(', ');
  if (location.is_remote) return name ? `Remote — ${name}` : 'Remote';
  return name || null;
}

/** The shape assumption, kept separate from the fetch so it can be tested. */
export function toPosting(
  parsed: BreezyPosition[] | { positions?: BreezyPosition[] },
  company: string,
  positionId: string | null,
): FetchedPosting {
  const positions = Array.isArray(parsed) ? parsed : (parsed.positions ?? []);

  const position = positionId
    ? (positions.find((entry) => entry.id === positionId) ??
      positions.find((entry) => entry.friendly_id === positionId))
    : positions[0];

  if (!position?.name) throw new Error('Breezy returned no matching posting.');

  return mapPosition(position, company, positionId);
}

function mapPosition(
  position: BreezyPosition,
  company: string,
  fallbackId: string | null,
): FetchedPosting {
  return {
    vendor: 'breezy',
    title: position.name ?? '',
    text: htmlToText(position.description ?? ''),
    url: position.url ?? null,
    location: locationName(position),
    atsJobId: position.id ?? position.friendly_id ?? fallbackId,
    boardToken: company,
    questions: [],
  };
}

export function toPostings(
  parsed: BreezyPosition[] | { positions?: BreezyPosition[] },
  company: string,
): FetchedPosting[] {
  const positions = Array.isArray(parsed) ? parsed : (parsed.positions ?? []);
  return positions
    .filter((position) => Boolean(position.name))
    .map((position) => mapPosition(position, company, null));
}

/** The whole board in one call — the same call a single posting already makes. */
export async function fetchBoard(company: string): Promise<FetchedPosting[]> {
  const { status, body } = await safeFetch(`https://${encodeURIComponent(company)}.breezy.hr/json`);
  if (status !== 200) throw new Error(`Breezy returned ${status} for that board.`);

  return toPostings(
    JSON.parse(body) as BreezyPosition[] | { positions?: BreezyPosition[] },
    company,
  );
}

export async function fetchPosting(
  company: string,
  positionId: string | null,
): Promise<FetchedPosting> {
  const { status, body } = await safeFetch(`https://${encodeURIComponent(company)}.breezy.hr/json`);
  if (status !== 200) throw new Error(`Breezy returned ${status} for that board.`);

  return toPosting(
    JSON.parse(body) as BreezyPosition[] | { positions?: BreezyPosition[] },
    company,
    positionId,
  );
}
