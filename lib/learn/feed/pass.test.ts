import { describe, expect, it } from 'vitest';
import type { WikipediaArticle, WikipediaResult, WikipediaSection } from '@/lib/learn/providers/wikipedia';
import { matchSection, runFeedPicksFor, type FeedCardInsert, type FeedPickPorts, type PersonInputs } from './pass';
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
    picked: { interest: 0, gap: 0 },
    articlesHeld: [],
    ...overrides,
  };
}

function ports(options: { missing?: Set<string>; loaded?: PersonInputs } = {}) {
  const cards: FeedCardInsert[] = [];
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
  return { ports: value, cards, stored, named };
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
    expect(summary.picked).toEqual({ interest: 24 - gap, gap });

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

  it('tells the model which articles the person already has, including this run\'s', async () => {
    const run = ports({ loaded: person({ articlesHeld: ['Money'] }) });
    await runFeedPicksFor(run.ports, { userId: 'u1', targets: 2, deadline: Number.MAX_SAFE_INTEGER, model: 'm' });
    expect(run.named[0].avoid).toEqual(['Money']);
    expect(run.named[1].avoid).toEqual(expect.arrayContaining(['Money', 'Article 1', 'Article 2', 'Article 3']));
  });

  it('starts with a gap when the person\'s earlier cards are short of them', async () => {
    const run = ports({ loaded: person({ picked: { interest: 9, gap: 0 } }) });
    await runFeedPicksFor(run.ports, { userId: 'u1', targets: 1, deadline: Number.MAX_SAFE_INTEGER, model: 'm' });
    expect(run.named[0].target.reason).toBe('gap');
  });

  it('stops drawing at the deadline', async () => {
    const run = ports();
    const summary = await runFeedPicksFor(run.ports, { userId: 'u1', targets: 8, deadline: 0, model: 'm' });
    expect(summary.targets).toEqual([]);
    expect(run.cards).toEqual([]);
  });
});
