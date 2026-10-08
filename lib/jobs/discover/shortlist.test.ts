import { describe, expect, it } from 'vitest';

import { NO_PREFERENCES } from '@/lib/jobs/suggest/preferences';
import { companyKey } from '@/lib/jobs/suggest/payload';
import type { HnCandidate, YcCandidate } from './feeds';
import type { DiscoveryRules } from './filter';
import {
  SHORTLIST_MAX,
  buildCandidates,
  candidateLine,
  interestTerms,
  parseShortlist,
  precut,
  watchlistRows,
  type ShortlistCandidate,
  type WatchlistExisting,
} from './shortlist';
import { SHORTLIST_TOOL, shortlistStartups } from './shortlist-run';

function yc(name: string, over: Partial<YcCandidate> = {}): YcCandidate {
  return {
    source: 'yc',
    ycId: name.length,
    name,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    website: `https://${name.toLowerCase().replace(/\s+/g, '')}.com`,
    domain: `${name.toLowerCase().replace(/\s+/g, '')}.com`,
    oneLiner: `${name} makes software`,
    description: null,
    industry: 'B2B',
    industries: ['B2B'],
    tags: [],
    stage: 'early',
    batch: 'Winter 2024',
    teamSize: 20,
    locations: 'New York, NY, USA; Remote',
    regions: [],
    ycUrl: null,
    ...over,
  };
}

let hnIds = 1000;
function hn(company: string | null, over: Partial<HnCandidate> = {}): HnCandidate {
  const id = (hnIds += 1);
  const header = `${company ?? 'Hello'} | Head of Finance | New York | Onsite`;
  return {
    source: 'hn',
    hnId: id,
    threadId: 1,
    author: 'someone',
    postedAt: null,
    header,
    company,
    text: `${header}\n\nWe are hiring. Apply at https://jobs.ashbyhq.com/${(company ?? 'x').toLowerCase()}`,
    html: '',
    links: [`https://jobs.ashbyhq.com/${(company ?? 'x').toLowerCase()}`, 'https://example.com/blog'],
    url: `https://news.ycombinator.com/item?id=${id}`,
    ...over,
  };
}

describe('buildCandidates', () => {
  it('makes one candidate of a company on both lists, and skips a second post by it', () => {
    const list = buildCandidates({
      yc: [yc('Ramp'), yc('Brex')],
      hn: [hn('Ramp, Inc.'), hn('Ramp'), hn('Mercury'), hn(null)],
    });
    expect(list.map((c) => c.id)).toEqual(['Y1', 'Y2', 'H1', 'H2']);
    expect(list[0].hn?.company).toBe('Ramp, Inc.');
    expect(list[2].hn?.company).toBe('Mercury');
    expect(list[3].key).toBe('');
    expect(candidateLine(list[0])).toMatch(/^Y1 \| Ramp \| .* \| HN post: Ramp, Inc\. \| Head of Finance/);
    expect(candidateLine(list[2])).toMatch(/^H1 \| Mercury .* links: https:\/\/jobs\.ashbyhq\.com\/mercury/);
  });
});

describe('precut', () => {
  const terms = interestTerms({ targetTitles: ['Chief of Staff', 'FP&A'], latestGoal: 'I want to work in climate software.' });

  it('reads titles as phrases and leaves out level words on their own', () => {
    expect(terms).toEqual(expect.arrayContaining(['chief of staff', 'fp&a', 'climate', 'software']));
    expect(terms).not.toContain('staff');
    expect(terms).not.toContain('want');
  });

  it('keeps everything that fits, posts first, and cuts the least relevant YC companies when over budget', () => {
    const list = buildCandidates({
      yc: [
        yc('Plain', { teamSize: 5 }),
        yc('Bigger', { teamSize: 300 }),
        yc('Climate Co', { oneLiner: 'Climate software for FP&A teams' }),
      ],
      hn: [hn('Poster')],
    });
    const all = precut(list, terms, 1e9, 1e9);
    expect(all.kept.map((c) => c.yc?.name ?? c.hn?.company)).toEqual(['Poster', 'Climate Co', 'Bigger', 'Plain']);
    expect(all.cut).toBe(0);

    const budget = all.lines.slice(0, 3).join('\n').length + 1;
    const cut = precut(list, terms, budget, 1e9);
    expect(cut.kept.map((c) => c.yc?.name ?? c.hn?.company)).toEqual(['Poster', 'Climate Co', 'Bigger']);
    expect(cut.cut).toBe(1);
    expect(cut.lines.join('\n').length).toBeLessThanOrEqual(budget);
  });
});

describe('parseShortlist', () => {
  const shown = buildCandidates({ yc: [yc('Ramp'), yc('Known Co')], hn: [hn('Mercury'), hn(null), hn('Retool')] });

  it('keeps picks of shown lines with a reason, once each, and reads a post through Dash', () => {
    const picks = parseShortlist(
      {
        picks: [
          { id: 'Y1', reason: 'You want strategic finance — Ramp is hiring for it.', company: 'Ignored', roles: ['x'] },
          { id: 'y1', reason: 'Again' },
          { id: 'Y9', reason: 'Not shown' },
          { id: 'Y2', reason: 'On file already' },
          { id: 'H1', reason: '   ' },
          { id: 'H2', reason: 'No company, so not a post', company: null },
          {
            id: 'H3',
            reason: 'Hiring a finance lead in New York.',
            company: 'Retool (YC W17)',
            roles: ['Finance Lead', ''],
            location: 'New York',
            link: 'https://jobs.ashbyhq.com/retool/',
          },
        ],
      },
      shown,
      new Set([companyKey('Known Co')]),
    );
    expect(picks.map((p) => p.name)).toEqual(['Ramp', 'Retool']);
    expect(picks[0]).toMatchObject({ reason: 'You want strategic finance, Ramp is hiring for it.', roles: [], link: null });
    expect(picks[1]).toMatchObject({
      nameKey: 'retool',
      roles: ['Finance Lead'],
      location: 'New York',
      link: 'https://jobs.ashbyhq.com/retool',
    });
  });

  it('never keeps a link the post did not give, nor more than the most', () => {
    const [pick] = parseShortlist(
      { picks: [{ id: 'H1', reason: 'Fits.', company: 'Mercury', link: 'https://made-up.example/jobs' }] },
      shown,
    );
    expect(pick.link).toBeNull();

    const many = buildCandidates({ yc: Array.from({ length: 60 }, (_, i) => yc(`Co${i}`)), hn: [] });
    const all = parseShortlist({ picks: many.map((c) => ({ id: c.id, reason: 'Fits.' })) }, many);
    expect(all).toHaveLength(SHORTLIST_MAX);
    expect(parseShortlist({ nope: [] }, many)).toEqual([]);
  });
});

describe('watchlistRows', () => {
  it('refreshes a post already on the watchlist by its comment id, keeping what the new pick lacks', () => {
    const post = hn('Mercury');
    const shown = buildCandidates({ yc: [], hn: [post] });
    const [pick] = parseShortlist({ picks: [{ id: 'H1', reason: 'Fits.', company: 'Mercury Bank' }] }, shown);
    const existing: WatchlistExisting = {
      name: 'Mercury',
      name_key: 'mercury',
      website: 'https://mercury.com',
      source: 'hn',
      source_ref: String(post.hnId),
      description: 'Old',
      stage: null,
      locations: ['NYC'],
      posting_roles: ['Controller'],
      posting_location: 'NYC',
      posting_url: 'https://jobs.ashbyhq.com/mercury',
    };
    const [row] = watchlistRows('u1', [pick], [existing], new Date('2026-10-08T00:00:00Z'));
    expect(row).toMatchObject({
      name: 'Mercury',
      name_key: 'mercury',
      website: 'https://mercury.com',
      reason: 'Fits.',
      posting_roles: ['Controller'],
      posting_url: 'https://jobs.ashbyhq.com/mercury',
      last_seen_at: '2026-10-08T00:00:00.000Z',
    });
    expect(Object.keys(row)).not.toContain('board_vendor');
    expect(Object.keys(row)).not.toContain('first_seen_at');
  });
});

// ---------------------------------------------------------------------------
// One run, then a second in the same week
// ---------------------------------------------------------------------------

type Stored = Record<string, unknown>;

/** Enough of the client for the shortlist: the seeker's reads and the watchlist's upsert. */
function fakeSupabase(store: Stored[]) {
  const seeker: Record<string, unknown> = {
    profiles: { display_name: 'Alex', target_titles: ['Strategic Finance'], excluded_industries: [] },
    thoughts: [{ body: 'I want strategic finance at a startup.', created_at: '2026-10-01T00:00:00Z' }],
    resume_versions: null,
  };
  return {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        not: () => chain,
        order: () => chain,
        limit: () => (table === 'watchlist_startups' ? Promise.resolve({ data: store.map((r) => ({ ...r })), error: null }) : chain),
        maybeSingle: () => Promise.resolve({ data: seeker[table] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) => resolve({ data: seeker[table] ?? [], error: null }),
        upsert: (rows: Stored[], opts: { onConflict: string }) => {
          expect(opts.onConflict).toBe('user_id,name_key');
          for (const row of rows) {
            const at = store.findIndex((r) => r.user_id === row.user_id && r.name_key === row.name_key);
            if (at >= 0) store[at] = { ...store[at], ...row };
            else store.push({ ...row, first_seen_at: row.last_seen_at, board_vendor: null });
          }
          return Promise.resolve({ error: null });
        },
      };
      return chain;
    },
  } as never;
}

function reporting(picks: unknown[]) {
  const requests: { messages: { content: unknown }[] }[] = [];
  const client = {
    messages: {
      stream: (request: never) => ({
        finalMessage: () => {
          requests.push(request);
          return Promise.resolve({
            content: [{ type: 'tool_use', id: 't1', name: SHORTLIST_TOOL, input: { picks } }],
            stop_reason: 'tool_use',
            usage: { input_tokens: 40_000, output_tokens: 3_000 },
          });
        },
      }),
    },
  } as never;
  return { client, requests };
}

describe('shortlistStartups', () => {
  const rules: DiscoveryRules = {
    preferences: NO_PREFERENCES,
    excludedIndustries: [],
    knownCompanies: new Set(),
    knownDomains: new Set(),
    passedCompanies: new Set(),
  };
  const lists = {
    yc: Array.from({ length: 36 }, (_, i) => yc(`Startup ${i}`)),
    hn: [hn('Posting Co'), hn('Other Co')],
    dropped: [],
    rules,
  };
  const shown: ShortlistCandidate[] = buildCandidates(lists);
  const picks = shown.map((c) => ({ id: c.id, reason: `Fits because of ${c.id}.`, company: c.hn?.company ?? null }));

  it('writes 30 to 50 startups with a reason, and a second run in the week adds none', async () => {
    const store: Stored[] = [];
    const supabase = fakeSupabase(store);
    const first = reporting(picks);
    const one = await shortlistStartups(supabase, 'u1', { apiKey: 'k', client: first.client, lists, now: new Date('2026-10-05') });
    expect(one).toMatchObject({ ok: true, offered: 38, cut: 0, added: 38, refreshed: 0, error: null });
    expect(one.spend).toHaveLength(1);
    expect(store.length).toBeGreaterThanOrEqual(30);
    expect(store.length).toBeLessThanOrEqual(50);
    expect(store.every((row) => typeof row.reason === 'string' && (row.reason as string).length > 0)).toBe(true);

    const prompt = first.requests[0].messages[0].content as string;
    expect(prompt).toContain('Titles they are targeting: Strategic Finance');
    expect(prompt).toContain('H2 | Other Co | Head of Finance');

    // The second run spells a post's company differently; it still lands on the same row.
    const again = picks.map((p) => (p.company === 'Posting Co' ? { ...p, company: 'PostingCo Ltd' } : p));
    const two = await shortlistStartups(supabase, 'u1', { apiKey: 'k', client: reporting(again).client, lists, now: new Date('2026-10-07') });
    expect(two).toMatchObject({ ok: true, added: 0, refreshed: 38 });
    expect(store).toHaveLength(38);
    expect(new Set(store.map((r) => r.name_key)).size).toBe(38);
    expect(store.every((r) => r.last_seen_at === new Date('2026-10-07').toISOString())).toBe(true);
    expect(store.every((r) => r.first_seen_at === new Date('2026-10-05').toISOString())).toBe(true);
  });

  it('writes nothing when Dash reports nothing', async () => {
    const store: Stored[] = [];
    const out = await shortlistStartups(fakeSupabase(store), 'u1', { apiKey: 'k', client: reporting([]).client, lists });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/no startups/);
    expect(store).toHaveLength(0);
  });
});
