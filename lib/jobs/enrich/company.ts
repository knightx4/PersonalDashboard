/**
 * Turning a Wikidata hit into a company record, and deciding whether to trust
 * it in the first place.
 *
 * Pure, because the two judgements worth testing are here: is this the right
 * company, and which fields may this overwrite. The answer to the second is
 * "none" — enrichment fills blanks and never argues with something you typed.
 */

import type { WikidataCompany } from './wikidata';

export interface CompanyIdentity {
  name: string;
  /** Domains already recorded for the company; these are what verify a match. */
  domains: readonly string[];
  website?: string | null;
  careersUrl?: string | null;
}

export interface RankedCandidate {
  company: WikidataCompany;
  /** True when the entity's official website matches a domain we already hold. */
  verified: boolean;
  score: number;
}

function normaliseName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|gmbh|plc|sa|nv|ab|oy)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Every domain we hold for this company, from any of the places it hides. */
export function knownDomains(identity: CompanyIdentity): string[] {
  const domains = new Set<string>();
  for (const domain of identity.domains) {
    const clean = domain.trim().toLowerCase().replace(/^www\./, '');
    if (clean) domains.add(clean);
  }
  for (const url of [identity.website, identity.careersUrl]) {
    const host = hostOf(url);
    if (host) domains.add(host);
  }
  return [...domains];
}

/**
 * Whether two hosts are the same company.
 *
 * A careers page frequently lives on a subdomain — jobs.ramp.com against
 * ramp.com — so a suffix match in either direction counts, while ramp.com
 * against notramp.com does not, which is why the dot is part of the test.
 */
function domainsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  return a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/**
 * Candidates, best first.
 *
 * A website match is worth more than everything else combined, because it is
 * the only signal here that is actually evidence rather than a coincidence of
 * naming. Without one, an exact name match is the best we can do and the
 * result is returned unverified rather than applied.
 */
export function rankCandidates(
  candidates: readonly WikidataCompany[],
  identity: CompanyIdentity,
): RankedCandidate[] {
  const domains = knownDomains(identity);
  const wanted = normaliseName(identity.name);

  return candidates
    .map((company) => {
      const verified = Boolean(
        company.websiteDomain && domains.some((domain) => domainsMatch(domain, company.websiteDomain!)),
      );

      let score = verified ? 100 : 0;
      const label = normaliseName(company.label);
      if (label === wanted) score += 20;
      else if (label.startsWith(wanted) || wanted.startsWith(label)) score += 8;

      // Detail is a weak proxy for "this is the entity somebody maintains",
      // and it only ever breaks ties.
      if (company.industry) score += 2;
      if (company.employees) score += 2;
      if (company.headquarters) score += 1;

      return { company, verified, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** Familiar headcount bands. Free text in the column, as the schema intends. */
export function headcountBand(employees: number, asOf: number | null): string | null {
  if (!Number.isFinite(employees) || employees <= 0) return null;

  const band =
    employees <= 10
      ? '1–10'
      : employees <= 50
        ? '11–50'
        : employees <= 200
          ? '51–200'
          : employees <= 500
            ? '201–500'
            : employees <= 1_000
              ? '501–1,000'
              : employees <= 5_000
                ? '1,001–5,000'
                : employees <= 10_000
                  ? '5,001–10,000'
                  : '10,000+';

  // The year matters: Wikidata carries a series, and a band with no date is
  // indistinguishable from a band that is six years stale.
  return asOf ? `${band} (${asOf})` : band;
}

export interface CompanyFields {
  industry: string | null;
  hq_location: string | null;
  headcount_band: string | null;
  stage: string | null;
  logo_url: string | null;
  linkedin_url: string | null;
  website: string | null;
}

export type CompanyPatch = Partial<CompanyFields>;

/**
 * What this entity would fill in, given what the record already holds.
 *
 * Only blanks. A field you typed is a field you decided, and a lookup that
 * quietly disagrees with you is worse than no lookup — you would never know it
 * had happened.
 */
export function proposedFields(
  company: WikidataCompany,
  existing: Partial<Record<keyof CompanyFields, string | null>>,
  extras: { logoUrl?: string | null } = {},
): CompanyPatch {
  const patch: CompanyPatch = {};
  const blank = (key: keyof CompanyFields) => {
    const value = existing[key];
    return value == null || value.trim() === '';
  };

  if (blank('industry') && company.industry) patch.industry = company.industry;
  if (blank('hq_location') && company.headquarters) patch.hq_location = company.headquarters;

  if (blank('headcount_band') && company.employees) {
    const band = headcountBand(company.employees, company.employeesAsOf);
    if (band) patch.headcount_band = band;
  }

  if (blank('stage')) {
    // The only stage Wikidata actually knows. Funding rounds are not in there,
    // and inventing "Series B" from an inception year would be a lie.
    if (company.isPublicCompany) patch.stage = 'Public company';
    else if (company.foundedYear) patch.stage = `Founded ${company.foundedYear}`;
  }

  const logo = company.logoUrl ?? extras.logoUrl ?? null;
  if (blank('logo_url') && logo) patch.logo_url = logo;

  if (blank('linkedin_url') && company.linkedinUrl) patch.linkedin_url = company.linkedinUrl;
  if (blank('website') && company.websiteUrl) patch.website = company.websiteUrl;

  return patch;
}

/** Human-readable list of what a patch would change, for the confirm step. */
export function describePatch(patch: CompanyPatch): string[] {
  const labels: Record<keyof CompanyFields, string> = {
    industry: 'Industry',
    hq_location: 'HQ',
    headcount_band: 'Headcount',
    stage: 'Stage',
    logo_url: 'Logo',
    linkedin_url: 'LinkedIn',
    website: 'Website',
  };

  return (Object.keys(patch) as Array<keyof CompanyFields>)
    .filter((key) => patch[key])
    .map((key) => `${labels[key]}: ${patch[key]}`);
}
