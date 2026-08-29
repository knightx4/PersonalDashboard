import 'server-only';

import { safeFetch } from './ssrf';
import { htmlToText } from './generic';
import type { FetchedPosting } from './types';

/**
 * Recruitee's public offers feed, served from the company's own careers
 * subdomain rather than a central API.
 */

export interface RecruiteeOffer {
  id?: number;
  slug?: string;
  title?: string;
  description?: string;
  requirements?: string;
  location?: string;
  city?: string;
  country_code?: string;
  careers_url?: string;
  careers_apply_url?: string;
  remote?: boolean;
}

function bodyText(offer: RecruiteeOffer): string {
  return [offer.description, offer.requirements]
    .filter((section): section is string => Boolean(section))
    .map((section) => htmlToText(section))
    .join('\n\n')
    .trim();
}

function locationName(offer: RecruiteeOffer): string | null {
  const name = offer.location ?? [offer.city, offer.country_code].filter(Boolean).join(', ');
  if (offer.remote) return name ? `Remote — ${name}` : 'Remote';
  return name || null;
}

/** The shape assumption, kept separate from the fetch so it can be tested. */
export function toPosting(
  parsed: { offers?: RecruiteeOffer[] },
  company: string,
  slug: string | null,
): FetchedPosting {
  const offers = parsed.offers ?? [];

  // The URL slug carries a trailing id on some boards, so a prefix match is
  // what actually finds the offer.
  const offer = slug
    ? (offers.find((entry) => entry.slug === slug) ??
      offers.find((entry) => entry.slug && slug.startsWith(entry.slug)))
    : offers[0];

  if (!offer?.title) throw new Error('Recruitee returned no matching posting.');

  return {
    vendor: 'recruitee',
    title: offer.title,
    text: bodyText(offer),
    url: offer.careers_url ?? offer.careers_apply_url ?? null,
    location: locationName(offer),
    atsJobId: offer.id != null ? String(offer.id) : (offer.slug ?? slug),
    boardToken: company,
    questions: [],
  };
}

export async function fetchPosting(
  company: string,
  slug: string | null,
): Promise<FetchedPosting> {
  const { status, body } = await safeFetch(
    `https://${encodeURIComponent(company)}.recruitee.com/api/offers/`,
  );
  if (status !== 200) throw new Error(`Recruitee returned ${status} for that board.`);

  return toPosting(JSON.parse(body) as { offers?: RecruiteeOffer[] }, company, slug);
}
