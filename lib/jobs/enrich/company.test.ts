import { describe, expect, it } from 'vitest';
import {
  describePatch,
  headcountBand,
  knownDomains,
  proposedFields,
  rankCandidates,
} from './company';
import { toCompany, domainOf } from './wikidata';
import type { WikidataCompany } from './wikidata';

function company(overrides: Partial<WikidataCompany> = {}): WikidataCompany {
  return {
    wikidataId: 'Q1',
    label: 'Ramp',
    description: 'American financial technology company',
    websiteDomain: 'ramp.com',
    websiteUrl: 'https://ramp.com',
    industry: 'financial technology',
    headquarters: 'New York City, United States',
    employees: 1200,
    employeesAsOf: 2024,
    foundedYear: 2019,
    isPublicCompany: false,
    logoUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/Ramp.svg?width=256',
    linkedinUrl: 'https://www.linkedin.com/company/ramp',
    ...overrides,
  };
}

describe('knownDomains', () => {
  it('collects domains from the list and from any URL on the record', () => {
    expect(
      knownDomains({
        name: 'Ramp',
        domains: ['ramp.com', 'RAMP.co'],
        website: 'https://www.ramp.com/about',
        careersUrl: 'https://jobs.ramp.com/openings',
      }),
    ).toEqual(['ramp.com', 'ramp.co', 'jobs.ramp.com']);
  });

  it('survives a URL that is not a URL', () => {
    expect(knownDomains({ name: 'Ramp', domains: [], website: 'ramp dot com' })).toEqual([]);
  });
});

describe('rankCandidates', () => {
  const identity = { name: 'Ramp', domains: ['ramp.com'] };

  it('verifies the candidate whose official site is a domain we hold', () => {
    const [best] = rankCandidates([company()], identity);
    expect(best.verified).toBe(true);
  });

  it('puts the website match above a better name match', () => {
    // This is the whole point: "Ramp" the payments company vs "Ramp" the
    // slope. The name is identical and only the domain tells them apart.
    const wrong = company({ wikidataId: 'Q2', label: 'Ramp', websiteDomain: null, websiteUrl: null });
    const right = company({ wikidataId: 'Q3', label: 'Ramp Business Corporation' });

    const ranked = rankCandidates([wrong, right], identity);
    expect(ranked[0].company.wikidataId).toBe('Q3');
    expect(ranked[0].verified).toBe(true);
  });

  it('matches a careers subdomain against the root site', () => {
    const ranked = rankCandidates([company()], {
      name: 'Ramp',
      domains: [],
      careersUrl: 'https://jobs.ramp.com/openings',
    });
    expect(ranked[0].verified).toBe(true);
  });

  it('does not treat a lookalike domain as a match', () => {
    const ranked = rankCandidates([company({ websiteDomain: 'notramp.com' })], identity);
    expect(ranked[0].verified).toBe(false);
  });

  it('still returns a name-only hit, labelled unverified', () => {
    const ranked = rankCandidates([company({ websiteDomain: null, websiteUrl: null })], identity);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].verified).toBe(false);
  });

  it('drops candidates that match on nothing', () => {
    expect(
      rankCandidates([company({ label: 'Belgian Village', websiteDomain: null, websiteUrl: null, industry: null, employees: null, headquarters: null })], identity),
    ).toEqual([]);
  });

  it('ignores a legal suffix when comparing names', () => {
    const ranked = rankCandidates([company({ label: 'Ramp, Inc.', websiteDomain: null, websiteUrl: null })], identity);
    expect(ranked[0].score).toBeGreaterThan(0);
  });
});

describe('headcountBand', () => {
  it('uses familiar bands', () => {
    expect(headcountBand(4, null)).toBe('1–10');
    expect(headcountBand(180, null)).toBe('51–200');
    expect(headcountBand(1200, null)).toBe('1,001–5,000');
    expect(headcountBand(240000, null)).toBe('10,000+');
  });

  it('carries the year, because the figure is a snapshot', () => {
    expect(headcountBand(1200, 2024)).toBe('1,001–5,000 (2024)');
  });

  it('refuses a nonsense count', () => {
    expect(headcountBand(0, null)).toBeNull();
    expect(headcountBand(Number.NaN, null)).toBeNull();
  });
});

describe('proposedFields', () => {
  it('fills every blank it can', () => {
    const patch = proposedFields(company(), {});

    expect(patch).toEqual({
      industry: 'financial technology',
      hq_location: 'New York City, United States',
      headcount_band: '1,001–5,000 (2024)',
      stage: 'Founded 2019',
      logo_url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Ramp.svg?width=256',
      linkedin_url: 'https://www.linkedin.com/company/ramp',
      website: 'https://ramp.com',
    });
  });

  it('never argues with something already recorded', () => {
    const patch = proposedFields(company(), {
      industry: 'Payments',
      hq_location: 'NYC',
      website: 'https://ramp.com/careers',
    });

    expect(patch.industry).toBeUndefined();
    expect(patch.hq_location).toBeUndefined();
    expect(patch.website).toBeUndefined();
    // The blanks are still filled.
    expect(patch.headcount_band).toBe('1,001–5,000 (2024)');
  });

  it('treats whitespace as blank', () => {
    expect(proposedFields(company(), { industry: '   ' }).industry).toBe('financial technology');
  });

  it('says public company rather than inventing a funding stage', () => {
    expect(proposedFields(company({ isPublicCompany: true }), {}).stage).toBe('Public company');
  });

  it('leaves stage alone when it knows neither', () => {
    expect(
      proposedFields(company({ isPublicCompany: false, foundedYear: null }), {}).stage,
    ).toBeUndefined();
  });

  it('falls back to the site icon when Wikidata has no logo', () => {
    const patch = proposedFields(company({ logoUrl: null }), {}, {
      logoUrl: 'https://ramp.com/apple-touch-icon.png',
    });
    expect(patch.logo_url).toBe('https://ramp.com/apple-touch-icon.png');
  });
});

describe('describePatch', () => {
  it('lists what would change, for the confirm step', () => {
    expect(describePatch({ industry: 'financial technology', hq_location: 'New York City' })).toEqual([
      'Industry: financial technology',
      'HQ: New York City',
    ]);
  });

  it('is empty when there is nothing to do', () => {
    expect(describePatch({})).toEqual([]);
  });
});

describe('toCompany', () => {
  const claims = {
    P31: [{ mainsnak: { datavalue: { value: { id: 'Q4830453' } } } }],
    P856: [{ mainsnak: { datavalue: { value: 'https://www.ramp.com' } } }],
    P452: [{ mainsnak: { datavalue: { value: { id: 'Q837171' } } } }],
    P159: [{ mainsnak: { datavalue: { value: { id: 'Q60' } } } }],
    P17: [{ mainsnak: { datavalue: { value: { id: 'Q30' } } } }],
    P154: [{ mainsnak: { datavalue: { value: 'Ramp logo.svg' } } }],
    P4264: [{ mainsnak: { datavalue: { value: 'ramp' } } }],
    P571: [{ mainsnak: { datavalue: { value: { time: '+2019-01-01T00:00:00Z' } } } }],
    P1128: [
      {
        mainsnak: { datavalue: { value: { amount: '+400' } } },
        qualifiers: { P585: [{ datavalue: { value: { time: '+2021-01-01T00:00:00Z' } } }] },
      },
      {
        mainsnak: { datavalue: { value: { amount: '+1200' } } },
        qualifiers: { P585: [{ datavalue: { value: { time: '+2024-01-01T00:00:00Z' } } }] },
      },
    ],
  };

  const labels = new Map([
    ['Q837171', 'financial technology'],
    ['Q60', 'New York City'],
    ['Q30', 'United States'],
  ]);

  const entity = {
    id: 'Q1',
    labels: { en: { value: 'Ramp' } },
    descriptions: { en: { value: 'American financial technology company' } },
    claims,
  };

  it('reads an organisation into a company', () => {
    const result = toCompany('Q1', entity, labels);

    expect(result).not.toBeNull();
    expect(result!.label).toBe('Ramp');
    expect(result!.websiteDomain).toBe('ramp.com');
    expect(result!.industry).toBe('financial technology');
    expect(result!.headquarters).toBe('New York City, United States');
    expect(result!.foundedYear).toBe(2019);
    expect(result!.linkedinUrl).toBe('https://www.linkedin.com/company/ramp');
    expect(result!.logoUrl).toContain('Special:FilePath/Ramp%20logo.svg');
  });

  it('takes the most recent headcount, not the first', () => {
    // Wikidata carries a series. Taking the first is how you tell somebody a
    // 1,200-person company has 400 people.
    const result = toCompany('Q1', entity, labels);
    expect(result!.employees).toBe(1200);
    expect(result!.employeesAsOf).toBe(2024);
  });

  it('refuses an entity that is not an organisation', () => {
    const village = {
      labels: { en: { value: 'Ramp' } },
      claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q532' } } } }] },
    };
    expect(toCompany('Q9', village, new Map())).toBeNull();
  });

  it('accepts an organisation whose class is not on the list but has a site and an industry', () => {
    const unusual = {
      labels: { en: { value: 'Acme Cooperative' } },
      claims: {
        P31: [{ mainsnak: { datavalue: { value: { id: 'Q4539' } } } }],
        P856: [{ mainsnak: { datavalue: { value: 'https://acme.coop' } } }],
        P452: [{ mainsnak: { datavalue: { value: { id: 'Q837171' } } } }],
      },
    };
    expect(toCompany('Q8', unusual, labels)?.label).toBe('Acme Cooperative');
  });

  it('does not collapse HQ and country into a repetition', () => {
    const countryOnly = {
      labels: { en: { value: 'Acme' } },
      claims: {
        P31: [{ mainsnak: { datavalue: { value: { id: 'Q4830453' } } } }],
        P159: [{ mainsnak: { datavalue: { value: { id: 'Q30' } } } }],
        P17: [{ mainsnak: { datavalue: { value: { id: 'Q30' } } } }],
      },
    };
    expect(toCompany('Q7', countryOnly, labels)?.headquarters).toBe('United States');
  });
});

describe('domainOf', () => {
  it('strips the scheme, www and path', () => {
    expect(domainOf('https://www.Ramp.com/careers')).toBe('ramp.com');
  });

  it('is null for nonsense', () => {
    expect(domainOf('ramp')).toBeNull();
    expect(domainOf(null)).toBeNull();
  });
});
