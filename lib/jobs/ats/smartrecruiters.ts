import 'server-only';

import { safeFetch } from './ssrf';
import { htmlToText } from './generic';
import type { FetchedPosting } from './types';

/**
 * SmartRecruiters' public posting API.
 *
 * The job ad arrives as named sections rather than one blob, which is better
 * than it sounds: the requirements section is the input to requirement
 * mapping, and keeping the headings means the extracted text reads like the
 * posting rather than like a wall.
 */

const BASE = 'https://api.smartrecruiters.com/v1/companies';

interface Section {
  title?: string;
  text?: string;
}

export interface SmartRecruitersPosting {
  id?: string;
  name?: string;
  applyUrl?: string;
  postingUrl?: string;
  location?: { city?: string; region?: string; country?: string; remote?: boolean };
  typeOfEmployment?: { label?: string };
  jobAd?: {
    sections?: {
      companyDescription?: Section;
      jobDescription?: Section;
      qualifications?: Section;
      additionalInformation?: Section;
    };
  };
}

function sectionsToText(posting: SmartRecruitersPosting): string {
  const sections = posting.jobAd?.sections;
  if (!sections) return '';

  const ordered = [
    sections.companyDescription,
    sections.jobDescription,
    sections.qualifications,
    sections.additionalInformation,
  ];

  return ordered
    .filter((section): section is Section => Boolean(section?.text))
    .map((section) => {
      const body = htmlToText(section.text ?? '');
      return section.title ? `${section.title}\n${body}` : body;
    })
    .join('\n\n')
    .trim();
}

function locationName(posting: SmartRecruitersPosting): string | null {
  const location = posting.location;
  if (!location) return null;
  const parts = [location.city, location.region, location.country].filter(Boolean);
  const name = parts.join(', ');
  if (location.remote) return name ? `Remote — ${name}` : 'Remote';
  return name || null;
}

/** The shape assumption, kept separate from the fetch so it can be tested. */
export function toPosting(
  posting: SmartRecruitersPosting,
  companyId: string,
  postingId: string,
): FetchedPosting {
  if (!posting.name) throw new Error('SmartRecruiters returned no posting.');

  return {
    vendor: 'smartrecruiters',
    title: posting.name,
    text: sectionsToText(posting),
    url: posting.postingUrl ?? posting.applyUrl ?? null,
    location: locationName(posting),
    atsJobId: posting.id ?? postingId,
    boardToken: companyId,
    // The application form is behind the apply flow, not the posting API.
    questions: [],
  };
}

export async function fetchPosting(
  companyId: string,
  postingId: string,
): Promise<FetchedPosting> {
  const { status, body } = await safeFetch(
    `${BASE}/${encodeURIComponent(companyId)}/postings/${encodeURIComponent(postingId)}`,
  );

  if (status !== 200) {
    throw new Error(`SmartRecruiters returned ${status} for that posting.`);
  }

  return toPosting(JSON.parse(body) as SmartRecruitersPosting, companyId, postingId);
}

/**
 * The board index, which carries titles and locations but no job ad.
 *
 * Unlike the board-at-a-time vendors, the description here needs a second call
 * per posting — so these come back with an empty `text` and the caller hydrates
 * only the one it actually matched. Forty titles for one request beats forty
 * requests for forty descriptions nobody wanted.
 */
export async function fetchBoard(companyId: string): Promise<FetchedPosting[]> {
  const { status, body } = await safeFetch(
    `${BASE}/${encodeURIComponent(companyId)}/postings?limit=100`,
  );
  if (status !== 200) throw new Error(`SmartRecruiters returned ${status} for that board.`);

  return toPostings(JSON.parse(body) as { content?: SmartRecruitersPosting[] }, companyId);
}

export function toPostings(
  parsed: { content?: SmartRecruitersPosting[] },
  companyId: string,
): FetchedPosting[] {
  return (parsed.content ?? [])
    .filter((posting) => Boolean(posting.name) && Boolean(posting.id))
    .map((posting) => ({
      vendor: 'smartrecruiters',
      title: posting.name ?? '',
      text: sectionsToText(posting),
      url: posting.postingUrl ?? posting.applyUrl ?? null,
      location: locationName(posting),
      atsJobId: posting.id ?? null,
      boardToken: companyId,
      questions: [],
    }));
}
