import { describe, expect, it } from 'vitest';
import { exclusionWords } from '@/lib/jobs/suggest/payload';
import { NO_PREFERENCES } from '@/lib/jobs/suggest/preferences';
import { postingPlaceFits } from './filter';
import {
  DISCOVERED_PER_WEEK,
  SOURCE_LABELS,
  boardPosting,
  discoveredText,
  pickDiscovered,
  postRoles,
  readingUpdates,
  weekRoom,
  type DiscoveredRules,
  type WatchedStartup,
} from './roles';

const startup = (name: string, over: Partial<WatchedStartup> = {}): WatchedStartup => ({
  id: `id-${name}`,
  name,
  source: 'yc',
  description: 'Payroll software for small firms',
  reason: `You want strategic finance, and ${name} is hiring for it.`,
  boardVendor: 'ashby',
  boardToken: name.toLowerCase(),
  postingRoles: [],
  postingLocation: null,
  postingUrl: null,
  emptyWeeks: 0,
  lastReadAt: null,
  ...over,
});

const role = (s: WatchedStartup, title: string, location: string | null = null) =>
  boardPosting(s, { title, url: `https://jobs.ashbyhq.com/${s.boardToken}/${encodeURIComponent(title)}`, location });

const rules = (over: Partial<DiscoveredRules> = {}): DiscoveredRules => ({
  targetTitles: ['Strategic Finance Manager'],
  likedTitles: [],
  taken: { urls: new Set(), roles: new Set(), companies: new Set() },
  excludedWords: [],
  preferences: NO_PREFERENCES,
  knownCompanies: new Set(),
  room: DISCOVERED_PER_WEEK,
  ...over,
});

describe('pickDiscovered', () => {
  it('takes at most ten a week, and two from one startup, each startup first before any second', () => {
    const startups = Array.from({ length: 8 }, (_, i) => startup(`Co${i}`));
    const postings = startups.flatMap((s) => [
      role(s, 'Strategic Finance Manager'),
      role(s, 'Senior Strategic Finance Manager'),
      role(s, 'Strategic Finance Lead'),
    ]);
    const { picks, fitted } = pickDiscovered(postings, rules());
    expect(picks).toHaveLength(10);
    expect(fitted.size).toBe(8);
    const firsts = picks.slice(0, 8).map((p) => p.startup.name);
    expect(new Set(firsts).size).toBe(8);
    const counts = new Map<string, number>();
    for (const p of picks) counts.set(p.company, (counts.get(p.company) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
  });

  it('leaves out engineering roles unless a target title is engineering', () => {
    const s = startup('LiveFlow');
    const postings = [
      role(s, 'Software Engineer - AI Agents'),
      role(s, 'Senior Full Stack Engineer'),
      role(s, 'Strategic Finance Manager'),
    ];
    const liked = rules({ likedTitles: ['Forward Deployed Engineer'] });
    expect(pickDiscovered(postings, liked).picks.map((p) => p.title)).toEqual(['Strategic Finance Manager']);
    const engineer = rules({ targetTitles: ['Software Engineer'] });
    expect(pickDiscovered(postings, engineer).picks.map((p) => p.title)).toContain('Software Engineer - AI Agents');
  });

  it('takes only what is left of the week', () => {
    const s = startup('Ramp');
    const postings = [role(s, 'Strategic Finance Manager'), role(s, 'Strategic Finance Lead')];
    expect(pickDiscovered(postings, rules({ room: weekRoom(9) })).picks).toHaveLength(1);
    const full = pickDiscovered(postings, rules({ room: weekRoom(12) }));
    expect(full.picks).toEqual([]);
    expect(full.fitted.has(s.id)).toBe(true);
  });

  it('applies the exclusions again to each role', () => {
    const crypto = startup('Coinly', { description: 'A crypto exchange for teams' });
    const known = startup('Known Co');
    const passed = startup('Passed Co');
    const faraway = startup('Faraway');
    const fine = startup('Fine');
    const { picks, fitted } = pickDiscovered(
      [
        role(crypto, 'Strategic Finance Manager'),
        role(known, 'Strategic Finance Manager'),
        role(passed, 'Strategic Finance Manager'),
        role(faraway, 'Strategic Finance Manager', 'Singapore'),
        role(fine, 'Strategic Finance Manager', 'London, UK'),
        role(fine, 'Software Engineer', 'London, UK'),
      ],
      rules({
        excludedWords: exclusionWords(['Crypto']),
        knownCompanies: new Set(['known']),
        taken: { urls: new Set(), roles: new Set(), companies: new Set(['passed']) },
        preferences: { ...NO_PREFERENCES, homeLocation: 'London', workplaces: ['hybrid'] },
      }),
    );
    expect(picks.map((p) => `${p.title} at ${p.company}`)).toEqual(['Strategic Finance Manager at Fine']);
    expect([...fitted]).toEqual([fine.id]);
  });

  it('counts a role suggested before as fitting, without suggesting it again', () => {
    const s = startup('Ramp');
    const posting = role(s, 'Strategic Finance Manager');
    const { picks, fitted } = pickDiscovered(
      [posting],
      rules({ taken: { urls: new Set([posting.url]), roles: new Set(), companies: new Set() } }),
    );
    expect(picks).toEqual([]);
    expect(fitted.has(s.id)).toBe(true);
  });
});

describe('postRoles', () => {
  it('suggests an HN post without a board at its own link, one link once', () => {
    const s = startup('Posty', {
      source: 'hn',
      boardVendor: null,
      boardToken: null,
      postingRoles: ['Strategic Finance Manager', 'Strategic Finance Lead'],
      postingUrl: 'https://posty.example/careers',
      postingLocation: 'Remote',
    });
    const postings = postRoles(s);
    expect(postings.map((p) => p.url)).toEqual(['https://posty.example/careers', 'https://posty.example/careers']);
    const { picks } = pickDiscovered(postings, rules());
    expect(picks).toHaveLength(1);
    expect(picks[0].startup.source).toBe('hn');
  });

  it('leaves a startup with a board to its board', () => {
    expect(postRoles(startup('Boarded', { postingRoles: ['CFO'], postingUrl: 'https://x.example' }))).toEqual([]);
  });
});

describe('readingUpdates', () => {
  const now = new Date('2026-10-12T09:00:00Z');
  it('starts the count again on a fit, adds a week on a miss a week on, and leaves a same-week miss', () => {
    const fit = startup('Fit', { emptyWeeks: 2, lastReadAt: '2026-10-05T09:00:00Z' });
    const miss = startup('Miss', { emptyWeeks: 3, lastReadAt: '2026-10-05T09:00:00Z' });
    const first = startup('First');
    const again = startup('Again', { emptyWeeks: 1, lastReadAt: '2026-10-10T09:00:00Z' });
    expect(readingUpdates([fit, miss, first, again], new Set([fit.id]), now)).toEqual([
      { id: fit.id, emptyWeeks: 0 },
      { id: miss.id, emptyWeeks: 4 },
      { id: first.id, emptyWeeks: 1 },
    ]);
  });
});

describe('labels and text', () => {
  it('says where each was found, and gives the shortlist reason as the why', () => {
    expect(SOURCE_LABELS).toEqual({ yc: 'Found on YC', hn: 'Found on Hacker News' });
    const s = startup('Ramp');
    expect(discoveredText(role(s, 'Strategic Finance Manager')).why).toBe(s.reason);
    expect(discoveredText(role(startup('Quiet', { reason: null, source: 'hn' }), 'X')).why).toContain('Hacker News');
  });
});

describe('postingPlaceFits', () => {
  it('keeps a posting with no location, and a remote one when remote is fine', () => {
    const prefs = { ...NO_PREFERENCES, homeLocation: 'London' };
    expect(postingPlaceFits(null, prefs)).toBe(true);
    expect(postingPlaceFits('Remote (Europe)', prefs)).toBe(true);
    expect(postingPlaceFits('New York', prefs)).toBe(false);
    expect(postingPlaceFits('London', { ...prefs, workplaces: ['remote'] })).toBe(false);
  });
});
