import { describe, expect, it } from 'vitest';

import { NO_PREFERENCES, type JobPreferences } from '@/lib/jobs/suggest/preferences';
import { companyKey } from '@/lib/jobs/suggest/payload';
import {
  hnCompanyName,
  hnHtmlToText,
  parseHnThread,
  parseYcHiring,
  pickWhoIsHiringThread,
  websiteDomain,
} from './feeds';
import { filterHiringLists, homePlaceWords, type DiscoveryRules } from './filter';
import hnSearch from './fixtures/hn-search.json';
import hnThread from './fixtures/hn-thread.json';
import ycHiring from './fixtures/yc-hiring.json';

// Saved on 8 October 2026: ten entries of yc-oss's companies/hiring.json, the
// whoishiring search, and ten top-level comments of the October thread plus
// one deleted comment added by hand.
const yc = parseYcHiring(ycHiring);
const hn = parseHnThread(hnThread);

function rules(overrides: Partial<DiscoveryRules> & { prefs?: Partial<JobPreferences> } = {}): DiscoveryRules {
  const { prefs, ...rest } = overrides;
  return {
    preferences: { ...NO_PREFERENCES, ...prefs },
    excludedIndustries: [],
    knownCompanies: new Set(),
    knownDomains: new Set(),
    passedCompanies: new Set(),
    ...rest,
  };
}

const ycNames = (list: { name: string }[]) => list.map((c) => c.name).sort();
const hnNames = (list: { company: string | null }[]) => list.map((c) => c.company).sort();

describe('parseYcHiring', () => {
  it('reads every company with its stage, places and industry', () => {
    expect(yc).toHaveLength(10);
    const circuit = yc.find((c) => c.name === 'CircuitHub')!;
    expect(circuit).toMatchObject({
      source: 'yc',
      ycId: 5,
      website: 'https://circuithub.com',
      domain: 'circuithub.com',
      industry: 'Industrials',
      stage: 'early',
      locations: 'London, England, United Kingdom',
      ycUrl: 'https://www.ycombinator.com/companies/circuithub',
    });
    expect(circuit.regions).toContain('Partly Remote');
    expect(yc.find((c) => c.name === 'Amplitude')!.stage).toBe('public');
    expect(yc.find((c) => c.name === 'Apollo')!.stage).toBe('growth');
  });

  it('skips nameless and repeated entries and anything that is not a list', () => {
    expect(parseYcHiring({ companies: [] })).toEqual([]);
    expect(parseYcHiring([{ id: 1 }, { id: 2, name: 'A' }, { id: 2, name: 'A again' }, null])).toHaveLength(1);
  });
});

describe('websiteDomain', () => {
  it('drops the scheme, www and path', () => {
    expect(websiteDomain('http://www.taktile.com/about')).toBe('taktile.com');
    expect(websiteDomain('glass.health')).toBe('glass.health');
    expect(websiteDomain('')).toBeNull();
  });
});

describe('the Hacker News thread', () => {
  it('picks the newest hiring thread, not the wants-to-be-hired one', () => {
    expect(pickWhoIsHiringThread(hnSearch)).toEqual({
      id: 49922569,
      title: 'Ask HN: Who is hiring? (October 2026)',
      postedAt: '2026-10-01T15:02:07Z',
    });
    expect(pickWhoIsHiringThread({ hits: [] })).toBeNull();
  });

  it('keeps each job post as raw text and leaves out deleted comments and chatter', () => {
    expect(hn).toHaveLength(9);
    expect(hn.some((p) => p.hnId === 49999999)).toBe(false);
    expect(hn.some((p) => p.text.startsWith('there used to be'))).toBe(false);
    const prairie = hn.find((p) => p.hnId === 49922584)!;
    expect(prairie).toMatchObject({
      source: 'hn',
      threadId: 49922569,
      author: 'mwest1066',
      company: 'PrairieLearn',
      url: 'https://news.ycombinator.com/item?id=49922584',
    });
    expect(prairie.header).toBe('PrairieLearn (Remote US) — Full-Stack Software Engineer — TypeScript / Postgres / React / AI');
    expect(prairie.html).toContain('<p>');
    expect(prairie.text).toContain('Salary: $100k-$180k');
    expect(prairie.links[0]).toBe('https://www.prairielearn.com');
  });

  it('names the company from the header', () => {
    expect(hnCompanyName('Thunder Compute (YC S24) | C++ Systems | San Francisco (Onsite)')).toBe('Thunder Compute');
    expect(hnCompanyName('Snout https://snout.com/ | Multiple Engineering + Product Roles')).toBe('Snout');
    expect(hnCompanyName('DuckDuckGo - we are looking for candidates')).toBe('DuckDuckGo');
    expect(hnNames(hn)).toContain('Fastly');
  });

  it('turns HN markup into text with full links', () => {
    expect(hnHtmlToText('A &amp; B<p>See <a href="https:&#x2F;&#x2F;x.io&#x2F;jobs" rel="nofollow">https:&#x2F;&#x2F;x.io&#x2F;...</a>')).toBe(
      'A & B\n\nSee https://x.io/jobs',
    );
  });
});

describe('filterHiringLists', () => {
  it('keeps everything when nothing is set', () => {
    const out = filterHiringLists({ yc, hn }, rules());
    expect(out.yc).toHaveLength(10);
    expect(out.hn).toHaveLength(9);
    expect(out.dropped).toEqual([]);
  });

  it('leaves out companies already on the companies list, by name or by website', () => {
    const out = filterHiringLists(
      { yc, hn },
      rules({
        knownCompanies: new Set([companyKey('Etleap Inc'), companyKey('Fastly')]),
        knownDomains: new Set(['apollographql.com', 'prairielearn.com']),
      }),
    );
    expect(ycNames(out.yc)).not.toContain('Etleap');
    expect(ycNames(out.yc)).not.toContain('Apollo');
    expect(hnNames(out.hn)).not.toContain('Fastly');
    expect(hnNames(out.hn)).not.toContain('PrairieLearn');
    expect(out.dropped.every((d) => d.reason === 'on_file')).toBe(true);
    expect(out.dropped).toHaveLength(4);
  });

  it('leaves out companies they turned a role down for', () => {
    const out = filterHiringLists({ yc, hn }, rules({ passedCompanies: new Set([companyKey('Razorpay'), companyKey('OpenRent')]) }));
    expect(out.dropped.map((d) => d.reason)).toEqual(['passed', 'passed']);
    expect(ycNames(out.yc)).not.toContain('Razorpay');
    expect(hnNames(out.hn)).not.toContain('OpenRent');
  });

  it('leaves out excluded industries from the industry, tags and HN header', () => {
    const out = filterHiringLists({ yc, hn }, rules({ excludedIndustries: ['Crypto', 'Healthcare'] }));
    const dropped = out.dropped.map((d) => (d.candidate.source === 'yc' ? d.candidate.name : d.candidate.company)).sort();
    // Quartzy and Glass Health are Healthcare; CoinTracker is tagged Crypto / Web3;
    // Relevant Healthcare names it in its header.
    expect(dropped).toEqual(['CoinTracker', 'Glass Health', 'Quartzy', 'Relevant Healthcare']);
    expect(out.dropped.every((d) => d.reason === 'industry')).toBe(true);
  });

  it('leaves out YC stages they do not want, and keeps HN posts, which name none', () => {
    const out = filterHiringLists({ yc, hn }, rules({ prefs: { companyStages: ['early'] } }));
    expect(out.yc.every((c) => c.stage === 'early')).toBe(true);
    expect(ycNames(out.yc)).toEqual(['CircuitHub', 'Etleap', 'Glass Health', 'Taktile']);
    expect(out.hn).toHaveLength(9);
    expect(out.dropped.every((d) => d.reason === 'stage')).toBe(true);
  });

  it('with remote only, leaves out companies that do not hire remotely', () => {
    const out = filterHiringLists({ yc, hn }, rules({ prefs: { workplaces: ['remote'] } }));
    // Etleap and Mino Games list no remote region; Glass Health lists none at all and stays.
    expect(ycNames(out.dropped.filter((d) => d.candidate.source === 'yc').map((d) => d.candidate as { name: string }))).toEqual([
      'Etleap',
      'Mino Games',
    ]);
    expect(ycNames(out.yc)).toContain('Glass Health');
    // OpenRent is on-site and part remote, which counts as hiring remotely.
    expect(hnNames(out.hn)).toEqual(['OpenRent', 'PrairieLearn', 'Relevant Healthcare', 'Snout', 'Tether']);
    expect(out.dropped.every((d) => d.reason === 'workplace')).toBe(true);
  });

  it('with a home location, keeps companies there and fully remote ones', () => {
    const out = filterHiringLists({ yc, hn }, rules({ prefs: { homeLocation: 'London, UK' } }));
    // CircuitHub is in London; Apollo is fully remote; Glass Health gives no place.
    expect(ycNames(out.yc)).toEqual(['Apollo', 'CircuitHub', 'Glass Health']);
    // Fastly names the UK among its places; Thunder Compute and Shepherd are on-site in the US.
    expect(hnNames(out.hn)).toEqual(['Fastly', 'OpenRent', 'Planlab.ai', 'PrairieLearn', 'Relevant Healthcare', 'Snout', 'Tether']);
    expect(out.dropped.every((d) => d.reason === 'location')).toBe(true);
  });

  it('with a home location and on-site only, a fully remote company no longer counts', () => {
    const out = filterHiringLists({ yc, hn }, rules({ prefs: { homeLocation: 'London, UK', workplaces: ['on_site'] } }));
    expect(ycNames(out.yc)).toEqual(['CircuitHub', 'Glass Health']);
    expect(hnNames(out.hn)).toEqual(['Fastly', 'OpenRent', 'Planlab.ai']);
  });

  it('applies the rules together, and nothing excluded gets through', () => {
    const r = rules({
      prefs: { companyStages: ['early', 'growth'], workplaces: ['remote', 'hybrid'] },
      excludedIndustries: ['Healthcare'],
      knownCompanies: new Set([companyKey('Taktile')]),
    });
    const out = filterHiringLists({ yc, hn }, r);
    expect(ycNames(out.yc)).toEqual(['Apollo', 'CircuitHub', 'CoinTracker', 'Etleap', 'Mino Games', 'Razorpay']);
    expect(out.yc.length + out.hn.length + out.dropped.length).toBe(yc.length + hn.length);
  });
});

describe('homePlaceWords', () => {
  it('splits the location and writes out short forms', () => {
    expect(homePlaceWords('NYC or Remote')).toEqual(expect.arrayContaining(['nyc', 'new york', 'remote']));
    expect(homePlaceWords('London, UK')).toEqual(['london', 'uk', 'united kingdom']);
    expect(homePlaceWords(null)).toEqual([]);
  });
});
