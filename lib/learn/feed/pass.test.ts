import { describe, expect, it } from 'vitest';
import type { WikipediaArticle, WikipediaResult, WikipediaSection } from '@/lib/learn/providers/wikipedia';
import { matchSection, runFeedPicksFor, type FeedCardInsert, type FeedPickPorts, type PersonInputs } from './pass';
import { LEVEL3_LIST_PICKER, untouchedPicks, type Level3Article } from './level3';
import type { NameResult } from './name-material';
import type { FeedTarget } from './targets';

/**
 * The picking pass, run once against ports.
 *
 * This is the run the done-when describes, with the database, the model and
 * Wikipedia replaced: picks land pointing at the fetched section, a title
 * Wikipedia does not have is dropped before anything is stored, and across a
 * run about three picks in four come from interest.
 */

function sections(...headings: (string | null)[]): WikipediaSection[] {
  return headings.map((heading, ordinal) => ({
    ordinal,
    anchor: heading ? heading.replace(/ /g, '_') : null,
    heading,
    text: `Text of ${heading ?? 'the lead'}.`,
  }));
}

function article(title: string): WikipediaArticle {
  return {
    externalId: title.replace(/ /g, '_'),
    title,
    canonicalUrl: `https://en.wikipedia.org/wiki/${title.replace(/ /g, '_')}`,
    lengthChars: 100,
    sections: sections(null, 'History', 'Causes'),
  };
}

describe('matching a named section', () => {
  const list = sections(null, 'History', 'Causes and effects', "Keynes's view");

  it('finds a heading whatever its case and punctuation', () => {
    expect(matchSection(list, 'causes and effects')?.section.ordinal).toBe(2);
    expect(matchSection(list, 'Keynes view')).toMatchObject({ matched: false });
    expect(matchSection(list, 'Keyness view')?.section.ordinal).toBe(3);
  });

  it('accepts a heading that contains the name', () => {
    expect(matchSection(list, 'Causes')).toMatchObject({ section: { ordinal: 2 }, matched: true });
  });

  it('falls back to the lead, and says so, when the heading is not there', () => {
    expect(matchSection(list, 'Criticism')).toMatchObject({ section: { ordinal: 0 }, matched: false });
    expect(matchSection(list, null)).toMatchObject({ section: { ordinal: 0 }, matched: true });
  });

  it('has nothing to offer an article with no sections', () => {
    expect(matchSection([], 'History')).toBeNull();
  });
});

function person(overrides: Partial<PersonInputs> = {}): PersonInputs {
  const fields = ['econ', 'phys', 'art', 'law'].map((id) => ({
    id,
    slug: id,
    name: id.toUpperCase(),
    scope: `${id} scope`,
    domain: 'D',
  }));
  const themes = Array.from({ length: 12 }, (_, i) => ({
    id: `t${i}`,
    name: `Theme ${i}`,
    about: `About ${i}`,
    strength: 12 - i,
    fieldId: 'econ',
  }));
  return {
    themes,
    fields,
    tests: new Map(),
    recentThemeIds: new Set(),
    recentFieldIds: new Set(),
    picked: { interest: 0, gap: 0, goal: 0 },
    articlesHeld: [],
    ...overrides,
  };
}

/**
 * The Level 3 list and the evidence against it, standing in for
 * learn.level3_untouched_articles: an article with evidence, or already
 * picked, is never offered.
 */
type ListStub = { articles: Level3Article[]; evidence: Set<string> };

function ports(options: { missing?: Set<string>; loaded?: PersonInputs; list?: ListStub } = {}) {
  const cards: FeedCardInsert[] = [];
  const listed: string[][] = [];
  const stored: string[] = [];
  const named: { target: FeedTarget; avoid: string[] }[] = [];
  let articleNo = 0;
  let clock = 0;

  const value: FeedPickPorts = {
    loadPerson: async () => options.loaded ?? person(),
    name: async (target, avoid): Promise<NameResult> => {
      named.push({ target, avoid: [...avoid] });
      return {
        ok: true,
        named: [0, 1, 2].map(() => {
          articleNo += 1;
          return { article: `Article ${articleNo}`, section: 'Causes', basis: 'Fits.' };
        }),
      };
    },
    drawFromList: async (_goal, avoid) => {
      listed.push([...avoid]);
      const list = options.list ?? { articles: [], evidence: new Set<string>() };
      const untouched = list.articles.filter(
        (a) => !list.evidence.has(a.title) && !avoid.some((title) => title.toLowerCase() === a.title.toLowerCase()),
      );
      return { ok: true, named: untouchedPicks(untouched, avoid) };
    },
    fetchArticle: async (title): Promise<WikipediaResult> =>
      options.missing?.has(title)
        ? { ok: false, reason: 'not-found', detail: `no article called ${title}` }
        : { ok: true, ...article(title) },
    storeArticle: async (a) => {
      stored.push(a.title);
      return {
        itemId: `item:${a.title}`,
        segments: a.sections.map((s) => ({ id: `seg:${a.title}:${s.ordinal}`, ordinal: s.ordinal })),
      };
    },
    insertCard: async (row) => {
      if (cards.some((card) => card.segment_id === row.segment_id)) return 'duplicate';
      cards.push(row);
      return 'inserted';
    },
    now: () => (clock += 1),
    random: () => 0.5,
  };
  return { ports: value, cards, stored, named, listed };
}

describe('running the pass once', () => {
  it('leaves picks pointing at the fetched section, about three in four from interest', async () => {
    const run = ports();
    const summary = await runFeedPicksFor(run.ports, {
      userId: 'u1',
      targets: 8,
      deadline: Number.MAX_SAFE_INTEGER,
      model: 'claude-sonnet-5',
    });

    expect(run.cards).toHaveLength(24);
    for (const card of run.cards) {
      expect(card.user_id).toBe('u1');
      // "Causes" is ordinal 2 in every stub article.
      expect(card.segment_id).toBe(`seg:${card.named_article}:2`);
      expect(card.item_id).toBe(`item:${card.named_article}`);
    }
    const gap = run.cards.filter((card) => card.reason === 'gap').length;
    expect(gap / run.cards.length).toBeGreaterThanOrEqual(0.2);
    expect(gap / run.cards.length).toBeLessThanOrEqual(0.3);
    expect(summary.picked).toEqual({ interest: 24 - gap, gap, goal: 0 });

    const interestCard = run.cards.find((card) => card.reason === 'interest')!;
    expect(interestCard.theme_name).toMatch(/^Theme /);
    expect(interestCard.field_id).toBe('econ');
    const gapCard = run.cards.find((card) => card.reason === 'gap')!;
    expect(gapCard.theme_id).toBeNull();
    expect(gapCard.theme_name).toBeNull();
  });

  it('drops a title Wikipedia does not have before storing anything', async () => {
    const run = ports({ missing: new Set(['Article 2']) });
    const summary = await runFeedPicksFor(run.ports, {
      userId: 'u1',
      targets: 1,
      deadline: Number.MAX_SAFE_INTEGER,
      model: 'm',
    });
    expect(summary.notFound).toEqual(['Article 2']);
    expect(run.stored).toEqual(['Article 1', 'Article 3']);
    expect(run.cards.map((card) => card.named_article)).toEqual(['Article 1', 'Article 3']);
  });

  it('drops a pick whose section is not in the article rather than using the lead', async () => {
    const run = ports();
    run.ports.name = async () => ({ ok: true, named: [{ article: 'Supply and demand', section: 'Nope', basis: 'B.' }] });
    const summary = await runFeedPicksFor(run.ports, { userId: 'u1', targets: 1, deadline: Number.MAX_SAFE_INTEGER, model: 'm' });
    expect(summary.sectionMissing).toBe(1);
    expect(run.cards).toEqual([]);
  });

  it('names each target at the depth its swipes earned, and stores the depth on the pick', async () => {
    const progress = {
      themes: new Map([['t0', { known: ['A', 'B'], review: ['C'], tooHard: [], tooEasy: [] }]]),
      fields: new Map(),
      aims: new Map(),
    };
    const run = ports({ loaded: person({ themes: person().themes.slice(0, 1), progress }) });
    const depths: unknown[] = [];
    const name = run.ports.name;
    run.ports.name = async (target, avoid, depth) => {
      depths.push(depth);
      return name(target, avoid, depth);
    };
    await runFeedPicksFor(run.ports, { userId: 'u1', targets: 1, deadline: Number.MAX_SAFE_INTEGER, model: 'm' });
    expect(depths[0]).toEqual({ depth: 'advanced', known: ['A', 'B'], review: ['C'], tooHard: [] });
    expect(run.cards.every((card) => card.depth === 'advanced')).toBe(true);
  });

  it('tells the model which articles the person already has, including this run\'s', async () => {
    const run = ports({ loaded: person({ articlesHeld: ['Money'] }) });
    await runFeedPicksFor(run.ports, { userId: 'u1', targets: 2, deadline: Number.MAX_SAFE_INTEGER, model: 'm' });
    expect(run.named[0].avoid).toEqual(['Money']);
    expect(run.named[1].avoid).toEqual(expect.arrayContaining(['Money', 'Article 1', 'Article 2', 'Article 3']));
  });

  it('starts with a gap when the person\'s earlier cards are short of them', async () => {
    const run = ports({ loaded: person({ picked: { interest: 9, gap: 0, goal: 0 } }) });
    await runFeedPicksFor(run.ports, { userId: 'u1', targets: 1, deadline: Number.MAX_SAFE_INTEGER, model: 'm' });
    expect(run.named[0].target.reason).toBe('gap');
  });

  it('stops drawing at the deadline', async () => {
    const run = ports();
    const summary = await runFeedPicksFor(run.ports, { userId: 'u1', targets: 8, deadline: 0, model: 'm' });
    expect(summary.targets).toEqual([]);
    expect(run.cards).toEqual([]);
  });

  it('draws about one card in three for an active goal, each naming it at the depth set on it', async () => {
    const econ = person().fields[0];
    const goals = [
      { id: 'g1', name: 'City design and urbanism', about: null, depth: 'advanced' as const, field: econ, domain: null },
      { id: 'g2', name: 'Startup finance', about: 'FP&A', depth: 'specialist' as const, field: null, domain: null },
    ];
    const run = ports({ loaded: person({ goals, goalWindow: { goal: 0, total: 0 } }) });
    const depths: { reason: string; depth: string }[] = [];
    const name = run.ports.name;
    run.ports.name = async (target, avoid, depth) => {
      depths.push({ reason: target.reason, depth: depth.depth });
      return name(target, avoid, depth);
    };
    const summary = await runFeedPicksFor(run.ports, {
      userId: 'u1',
      targets: 9,
      deadline: Number.MAX_SAFE_INTEGER,
      model: 'm',
    });

    const goalCards = run.cards.filter((card) => card.reason === 'goal');
    expect(goalCards.length / run.cards.length).toBeGreaterThanOrEqual(0.3);
    expect(goalCards.length / run.cards.length).toBeLessThanOrEqual(0.4);
    expect(summary.picked.goal).toBe(goalCards.length);
    // The first target is a goal: none has been drawn since goals began.
    expect(run.named[0].target.reason).toBe('goal');

    const urbanism = goalCards.find((card) => card.aim_id === 'g1')!;
    expect(urbanism).toMatchObject({ aim_name: 'City design and urbanism', field_id: 'econ', theme_id: null, depth: 'advanced' });
    const finance = goalCards.find((card) => card.aim_id === 'g2')!;
    expect(finance).toMatchObject({ aim_name: 'Startup finance', field_id: null, depth: 'specialist' });
    for (const entry of depths.filter((d) => d.reason === 'goal')) {
      expect(['advanced', 'specialist']).toContain(entry.depth);
    }
    for (const card of run.cards.filter((c) => c.reason !== 'goal')) {
      expect(card.aim_id).toBeNull();
      expect(card.aim_name).toBeNull();
    }
  });

  it('names a goal past the cards swiped known on it, with its needs-work cards to come at differently', async () => {
    const goals = [{ id: 'g1', name: 'Startup finance', about: null, depth: 'working' as const, field: null, domain: null }];
    const progress = {
      themes: new Map(),
      fields: new Map(),
      aims: new Map([['g1', { known: ['Runway: Burn', 'SaaS: Retention'], review: ['Cap table: Pro rata'], tooHard: [], tooEasy: [] }]]),
    };
    const run = ports({ loaded: person({ goals, goalWindow: { goal: 0, total: 0 }, progress }) });
    const seen: { reason: string; depth: unknown }[] = [];
    const name = run.ports.name;
    run.ports.name = async (target, avoid, depth) => {
      seen.push({ reason: target.reason, depth });
      return name(target, avoid, depth);
    };
    await runFeedPicksFor(run.ports, { userId: 'u1', targets: 1, deadline: Number.MAX_SAFE_INTEGER, model: 'm' });
    expect(seen[0]).toEqual({
      reason: 'goal',
      depth: { depth: 'advanced', known: ['Runway: Burn', 'SaaS: Retention'], review: ['Cap table: Pro rata'], tooHard: [] },
    });
    expect(run.cards.filter((card) => card.reason === 'goal').every((card) => card.depth === 'advanced')).toBe(true);
  });

  it('draws no goal cards for a person with no goals', async () => {
    const run = ports();
    await runFeedPicksFor(run.ports, { userId: 'u1', targets: 6, deadline: Number.MAX_SAFE_INTEGER, model: 'm' });
    expect(run.cards.some((card) => card.reason === 'goal')).toBe(false);
  });

  it('draws the Level 3 goal from untouched articles on its list, never naming it', async () => {
    const level3 = {
      id: 'l3',
      name: 'Every Level 3 vital article',
      about: null,
      depth: 'working' as const,
      field: null,
      domain: null,
      list: 'level3' as const,
    };
    const articles = ['Metallurgy', 'Photosynthesis', 'Inflation', 'Tide', 'Opera', 'Glacier', 'Vaccine', 'Sonnet'].map(
      (title) => ({ title, section: 'Science > Things' }),
    );
    // A Got it on Photosynthesis and a save on Opera are evidence.
    const evidence = new Set(['Photosynthesis', 'Opera']);
    const run = ports({
      loaded: person({ goals: [level3], goalWindow: { goal: 0, total: 0 }, articlesHeld: ['Tide'] }),
      list: { articles, evidence },
    });
    const summary = await runFeedPicksFor(run.ports, {
      userId: 'u1',
      targets: 9,
      deadline: Number.MAX_SAFE_INTEGER,
      model: 'm',
    });

    // The naming call never sees the Level 3 goal.
    expect(run.named.some((entry) => entry.target.reason === 'goal')).toBe(false);
    expect(run.listed.length).toBeGreaterThan(0);

    const goalCards = run.cards.filter((card) => card.reason === 'goal');
    expect(goalCards.length).toBeGreaterThan(0);
    expect(summary.picked.goal).toBe(goalCards.length);
    const titles = goalCards.map((card) => card.named_article);
    // Each card is on a different article, none with evidence and none already held.
    expect(new Set(titles).size).toBe(titles.length);
    for (const title of titles) {
      expect(evidence.has(title)).toBe(false);
      expect(title).not.toBe('Tide');
    }
    for (const card of goalCards) {
      expect(card).toMatchObject({
        aim_id: 'l3',
        aim_name: 'Every Level 3 vital article',
        field_id: null,
        theme_id: null,
        named_section: null,
        pick_model: LEVEL3_LIST_PICKER,
        depth: 'working',
      });
      // Each card is from the article's lead.
      expect(card.segment_id).toBe(`seg:${card.named_article}:0`);
    }
  });

  it('stops offering an untouched article once it has a Got it', async () => {
    const level3 = {
      id: 'l3',
      name: 'Every Level 3 vital article',
      about: null,
      depth: 'working' as const,
      field: null,
      domain: null,
      list: 'level3' as const,
    };
    const articles = [{ title: 'Metallurgy', section: 'Technology' }, { title: 'Glacier', section: 'Earth' }];
    const run = ports({
      loaded: person({ goals: [level3], goalWindow: { goal: 0, total: 0 } }),
      list: { articles, evidence: new Set(['Metallurgy']) },
    });
    await runFeedPicksFor(run.ports, { userId: 'u1', targets: 3, deadline: Number.MAX_SAFE_INTEGER, model: 'm' });
    expect(run.cards.filter((card) => card.reason === 'goal').map((card) => card.named_article)).toEqual(['Glacier']);
  });
});
