import { describe, expect, it } from 'vitest';
import { companyFacts, describeDiscovery, rankCompanies, type DiscoveredCompany } from './watchlist-view';

function company(name: string, score: number | null, extra: Partial<DiscoveredCompany> = {}): DiscoveredCompany {
  return {
    id: name,
    name,
    website: null,
    source: 'yc',
    description: null,
    reason: null,
    score,
    stage: null,
    locations: [],
    postingRoles: [],
    board: null,
    noBoard: false,
    companySlug: null,
    ...extra,
  };
}

describe('rankCompanies', () => {
  it('puts the best fit first and unscored companies last, by name', () => {
    const ranked = rankCompanies([company('Beta', null), company('Alpha', 60), company('Zed', 91), company('Aardvark', null)]);
    expect(ranked.map((c) => c.name)).toEqual(['Zed', 'Alpha', 'Aardvark', 'Beta']);
  });
});

describe('companyFacts', () => {
  it('names the stage, the places, the source and the board', () => {
    expect(
      companyFacts(company('LiveFlow', 90, { stage: 'Early', locations: ['New York'], board: { vendor: 'ashby' } })),
    ).toEqual(['Early stage', 'New York', 'Found on YC', 'Jobs on Ashby']);
    expect(companyFacts(company('Arpari', 60, { source: 'hn', noBoard: true }))).toEqual([
      'Found on Hacker News',
      'No job board Dash can read',
    ]);
  });
});

describe('describeDiscovery', () => {
  const now = new Date('2026-10-08T16:00:00Z');
  const base = {
    startedAt: '2026-10-08T15:00:00Z',
    finishedAt: '2026-10-08T15:01:00Z',
    offered: 812,
    added: 30,
    refreshed: 10,
    boardsFound: 12,
    error: null,
  };

  it('says what a finished run read, kept and found', () => {
    expect(describeDiscovery({ ...base, stage: 'done' }, now)?.text).toBe(
      'The startup search 59 minutes ago read 812 hiring startups that fit your preferences, kept 40 and found 12 more job boards.',
    );
  });

  it('shows a working run as running, and one long past its start as stopped', () => {
    expect(describeDiscovery({ ...base, stage: 'boards', startedAt: '2026-10-08T15:58:00Z', finishedAt: null }, now)?.running).toBe(true);
    expect(describeDiscovery({ ...base, stage: 'boards', finishedAt: null }, now)).toMatchObject({ running: false, tone: 'warn' });
  });

  it('gives the reason a run failed', () => {
    expect(describeDiscovery({ ...base, stage: 'failed', error: 'Dash is rate-limited right now.' }, now)?.text).toContain(
      'failed: Dash is rate-limited right now.',
    );
    expect(describeDiscovery(null, now)).toBeNull();
  });
});
