import { describe, expect, it } from 'vitest';
import { nextSection, shelve, type ReaderRow } from './shelves';
import { checkSource, partsOf, svgProblems } from './source';

const FULL = `A sale, according to this theory, is not the exchange of a commodity for some intermediate commodity called the "medium of exchange," but the exchange of a commodity for a credit.

There is absolutely no reason for assuming the existence of so clumsy a device as a medium of exchange when so simple a system would do all that was required.`;

const SVG = '<svg viewBox="0 0 360 100" role="img" aria-label="A owes B"><circle cx="40" cy="50" r="20" fill="none" stroke="currentColor"/><text x="40" y="54" font-size="12" class="accent">A</text></svg>';

function source(overrides: Record<string, unknown> = {}, section: Record<string, unknown> = {}) {
  return {
    title: 'What Is Money?',
    author: 'A. Mitchell Innes',
    published: 'Banking Law Journal, May 1913',
    rights: 'open',
    context: 'A diplomat writing against the textbook account of money.',
    brief: 'Money is credit and always was.',
    idea: 'Money is a record of who owes whom.',
    sections: [
      {
        title: 'A sale is goods for credit',
        minutes: 3,
        context: 'He turns from history to logic.',
        summary: 'The butcher takes an acknowledgment of debt.',
        idea: 'Trade needs people to honour what they owe.',
        text: FULL.split('\n\n'),
        glosses: [{ phrase: 'medium of exchange', note: 'A thing taken in trade only to be traded on.' }],
        questions: [],
        figure: { caption: 'A owes B.', svg: SVG },
        ...section,
      },
    ],
    ...overrides,
  };
}

describe('checkSource', () => {
  it('keeps a source whose paragraphs are in the full text, and adds up its minutes', () => {
    const checked = checkSource(source(), FULL);
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.source).toMatchObject({ minutes: 3, rights: 'open', kind: 'text' });
  });

  const failing: [string, Record<string, unknown>, Record<string, unknown>, RegExp][] = [
    ['a paragraph that is not in the full text', {}, { text: ['Money, as I recall him saying, is a kind of memory.'] }, /is not in the full text/],
    ['a note on words the section does not hold', {}, { glosses: [{ phrase: 'legal tender', note: 'x' }] }, /not in the section's text/],
    ['text shown for a work not marked open', { rights: 'copyright' }, { glosses: [] }, /not marked open/],
    ['an open work with a section left out', {}, { text: null, glosses: [] }, /shown in full/],
    ['an em dash in what Dash wrote', { context: 'A diplomat — not an economist.' }, {}, /em dash/],
    ['a typed link', { brief: 'See https://example.org for more.' }, {}, /typed link/],
    ['an idea that runs on', { idea: 'x'.repeat(240) }, {}, /keep it to 200/],
  ];
  it.each(failing)('refuses %s', (_name, overrides, section, problem) => {
    const checked = checkSource(source(overrides, section), FULL);
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.problems.join('\n')).toMatch(problem);
  });

  it('takes a work in copyright as summaries alone', () => {
    const checked = checkSource(source({ rights: 'copyright' }, { text: null, glosses: [], figure: null, pages: 'pp. 30 to 41' }));
    expect(checked.ok).toBe(true);
  });
});

describe('svgProblems', () => {
  it('passes shapes and words in the page’s own colours', () => {
    expect(svgProblems(SVG)).toEqual([]);
  });

  it.each([
    ['a script', '<svg viewBox="0 0 10 10"><script>alert(1)</script></svg>', /uses <script>/],
    ['a link', '<svg viewBox="0 0 10 10"><a href="x"><text>x</text></a></svg>', /uses <a>/],
    ['a handler', '<svg viewBox="0 0 10 10"><rect onclick="x()" width="1" height="1"/></svg>', /sets onclick/],
    ['a colour of its own', '<svg viewBox="0 0 10 10"><rect fill="#ff0000" width="1" height="1"/></svg>', /colour of its own/],
    ['an inline style', '<svg viewBox="0 0 10 10"><rect style="fill:red" width="1" height="1"/></svg>', /sets style/],
    ['an image', '<svg viewBox="0 0 10 10"><image width="1" height="1"/></svg>', /uses <image>/],
  ])('refuses %s', (_name, svg, problem) => {
    expect(svgProblems(svg).join('\n')).toMatch(problem);
  });
});

describe('partsOf', () => {
  it('cuts a paragraph at a noted phrase, once in the section', () => {
    const glosses = [{ phrase: 'medium of exchange', note: 'x' }];
    const used = new Set<number>();
    const [first, second] = FULL.split('\n\n');
    expect(partsOf(first, glosses, used).filter((part) => 'gloss' in part)).toEqual([{ text: 'medium of exchange', gloss: 0 }]);
    expect(partsOf(second, glosses, used).some((part) => 'gloss' in part)).toBe(false);
    expect(partsOf(first, glosses, new Set()).map((part) => part.text).join('')).toBe(first);
  });
});

describe('shelve', () => {
  const row = (over: Partial<ReaderRow>): ReaderRow => ({
    id: over.id ?? 'a',
    title: 'What Is Money?',
    author: null,
    origin: 'note',
    why: null,
    status: 'ready',
    basis: 'text',
    read: [],
    verdict: null,
    parentId: null,
    openedAt: null,
    requestedAt: '2026-11-16T00:00:00Z',
    outline: { published: null, minutes: 6, idea: 'x', sections: [{ title: 'One', minutes: 3, idea: 'First idea.' }, { title: 'Two', minutes: 3, idea: 'Second idea.' }] },
    ...over,
  });

  it('puts each source on the shelf its state calls for', () => {
    const shelves = shelve([
      row({ id: 'started', read: [1] }),
      row({ id: 'near' }),
      row({ id: 'new', origin: 'new' }),
      row({ id: 'asked', origin: 'deeper' }),
      row({ id: 'coming', status: 'preparing', outline: null }),
      row({ id: 'done', read: [1, 2] }),
      row({ id: 'dropped', verdict: 'dropped' }),
      row({ id: 'refill', origin: 'refill', status: 'queued', outline: null }),
    ]);
    const ids = (rows: ReaderRow[]) => rows.map((item) => item.id);
    expect(ids(shelves.continuing)).toEqual(['started']);
    expect(ids(shelves.near)).toEqual(['near']);
    expect(ids(shelves.fresh)).toEqual(['new']);
    expect(ids(shelves.asked)).toEqual(['asked']);
    expect(ids(shelves.coming)).toEqual(['coming']);
    expect(ids(shelves.finished)).toEqual(['done']);
    expect(shelves.finding).toBe(true);
    expect(shelves.ideas.map((idea) => idea.idea)).toEqual(['First idea.', 'First idea.', 'Second idea.']);
  });

  it('finds the first section not yet read', () => {
    expect(nextSection(row({ read: [1] }))).toBe(2);
    expect(nextSection(row({ read: [2] }))).toBe(1);
    expect(nextSection(row({ read: [1, 2] }))).toBeNull();
  });
});
