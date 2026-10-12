import { describe, expect, it } from 'vitest';
import {
  citedPages,
  countLine,
  deeperProblem,
  definitionInsert,
  firstPassBasis,
  footnoteFor,
  forBrowser,
  readClaims,
  readFetchedPages,
  readFirstPass,
  researchFromRow,
  tally,
  textFragmentUrl,
} from './research';

const search = (query: string) => ({ type: 'server_tool_use', id: `s-${query}`, name: 'web_search', input: { query } });
const cite = (url: string, title: string, cited_text: string) => ({
  type: 'web_search_result_location',
  url,
  title,
  cited_text,
  encrypted_index: 'x',
});
const text = (value: string, citations?: unknown[]) => ({ type: 'text', text: value, ...(citations ? { citations } : {}) });

describe('firstPassBasis', () => {
  it('sends the question and what would change the writer’s mind, and nothing else', () => {
    expect(firstPassBasis({ question: ' Does sleep debt repay? ', change: 'A trial showing recovery' })).toBe(
      "The essay's question: Does sleep debt repay?\n\nWhat would change the writer's mind: A trial showing recovery",
    );
    expect(firstPassBasis({ question: 'Q?', change: '' })).toBe("The essay's question: Q?");
    expect(firstPassBasis({ question: '  ', change: 'x' })).toBeNull();
  });
});

describe('readFirstPass', () => {
  const content = [
    text('I will search for this.'),
    search('weekend recovery sleep'),
    { type: 'web_search_tool_result', tool_use_id: 's', content: [] },
    search('weekend recovery sleep'),
    search('sleep debt repayment study'),
    text('## Lie-ins do not repay lost sleep\n'),
    text('A 2019 trial found weekend recovery sleep did not undo the metabolic effects.', [
      cite('https://example.org/a#top', 'Catch-up sleep', 'weekend recovery sleep did not prevent metabolic dysregulation'),
    ]),
    text(' Others agree.', [cite('https://other.net/b', 'Other', 'no recovery after two nights')]),
    text('\n\n## Position 2: Some debt can be repaid\n- Short debts recover quickly.', [
      cite('https://example.org/a', 'Catch-up sleep (again)', 'short-term debt recovered after one night'),
    ]),
    text('\n\n## A position with nothing behind it\nJust the model talking.'),
  ];

  it('makes a position of each heading, with the cited words and one source per page', () => {
    const read = readFirstPass(content);
    expect(read.queries).toEqual(['weekend recovery sleep', 'sleep debt repayment study']);
    expect(read.positions.map((p) => p.title)).toEqual(['Lie-ins do not repay lost sleep', 'Some debt can be repaid']);
    expect(read.sources).toEqual([
      { url: 'https://example.org/a', title: 'Catch-up sleep', domain: 'example.org', text: null },
      { url: 'https://other.net/b', title: 'Other', domain: 'other.net', text: null },
    ]);
    expect(read.positions[0].citations).toEqual([
      { source: 0, quote: 'weekend recovery sleep did not prevent metabolic dysregulation' },
      { source: 1, quote: 'no recovery after two nights' },
    ]);
    expect(read.positions[0].summary).toBe(
      'A 2019 trial found weekend recovery sleep did not undo the metabolic effects. Others agree.',
    );
    expect(read.positions[1].summary).toBe('Short debts recover quickly.');
    expect(read.positions[1].citations).toEqual([{ source: 0, quote: 'short-term debt recovered after one night' }]);
  });

  it('drops a position nothing retrieved backs, and the preamble before the first heading', () => {
    const read = readFirstPass(content);
    expect(read.positions.some((p) => p.title.includes('nothing behind it'))).toBe(false);
    expect(read.positions.some((p) => p.summary.includes('I will search'))).toBe(false);
  });

  it('ignores citations that are not web search locations, or not web pages', () => {
    const read = readFirstPass([
      text('## One'),
      text('x', [{ type: 'char_location', cited_text: 'nope' }, cite('javascript:alert(1)', 't', 'bad')]),
    ]);
    expect(read.positions).toEqual([]);
  });
});

const page = (url: string, data: string, title = 'Page') => ({
  type: 'web_fetch_tool_result',
  tool_use_id: 'f',
  content: {
    type: 'web_fetch_result',
    url,
    content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data }, title },
    retrieved_at: '2026-10-12T10:00:00Z',
  },
});

describe('readFetchedPages', () => {
  it('keeps the text of each page read, once per page, and skips errors, PDFs and stubs', () => {
    const long = 'Sleep research. '.repeat(30);
    const pages = readFetchedPages([
      page('https://a.org/x', long, 'A study'),
      page('https://a.org/x#again', long, 'A study'),
      { type: 'web_fetch_tool_result', content: { type: 'web_fetch_tool_result_error', error_code: 'url_not_accessible' } },
      {
        type: 'web_fetch_tool_result',
        content: { type: 'web_fetch_result', url: 'https://b.org/p.pdf', content: { type: 'document', source: { type: 'base64', data: 'JVBER' } } },
      },
      page('https://c.org', 'Too short'),
    ]);
    expect(pages).toEqual([{ url: 'https://a.org/x', title: 'A study', domain: 'a.org', text: long.trim() }]);
  });
});

describe('readClaims', () => {
  const pages = [
    { url: 'https://a.org', title: 'A', domain: 'a.org', text: 'a' },
    { url: 'https://b.org', title: 'B', domain: 'b.org', text: 'b' },
    { url: 'https://c.org', title: 'C', domain: 'c.org', text: 'c' },
  ];
  const loc = (document_index: number, cited_text: string) => ({ type: 'char_location', document_index, cited_text, start_char_index: 0, end_char_index: 5 });

  it('reads each claim, the stance of each quote, and counts the pages for and against', () => {
    const claims = readClaims(
      [
        text('## Lie-ins do not repay sleep debt\nFor: '),
        text('A trial found no recovery.', [loc(0, 'no recovery of insulin sensitivity')]),
        text('\nFor: '),
        text('Another agreed.', [loc(0, 'agreed again'), loc(2, 'agrees')]),
        text('\nAgainst: '),
        text('One found partial recovery.', [loc(1, 'partial recovery')]),
        text('\n\n## Naps make it worse\n'),
        text('\n## Caffeine masks it\nAgainst: '),
        text('x', [loc(1, 'caffeine does not mask'), loc(9, 'out of range')]),
      ],
      pages,
    );
    expect(claims.map((c) => [c.claim, c.verdict, c.supporting, c.opposing])).toEqual([
      ['Lie-ins do not repay sleep debt', 'mixed', 2, 1],
      ['Naps make it worse', 'unsourced', 0, 0],
      ['Caffeine masks it', 'opposed', 0, 1],
    ]);
    expect(claims[0].citations).toContainEqual({ source: 1, quote: 'partial recovery', stance: 'against' });
  });

  it('keeps only the pages quoted, renumbered', () => {
    const claims = readClaims([text('## One\nFor: '), text('y', [loc(2, 'from c')])], pages);
    const out = citedPages(claims, pages);
    expect(out.sources.map((s) => s.url)).toEqual(['https://c.org']);
    expect(out.claims[0].citations).toEqual([{ source: 0, quote: 'from c', stance: 'for' }]);
  });
});

describe('tally and countLine', () => {
  it('counts sources, not quotes', () => {
    const t = tally([
      { source: 0, quote: 'a', stance: 'for' },
      { source: 0, quote: 'b', stance: 'for' },
    ]);
    expect(t).toEqual({ verdict: 'supported', supporting: 1, opposing: 0 });
    expect(countLine(t)).toBe('1 source supports it');
    expect(countLine({ supporting: 2, opposing: 3 })).toBe('2 sources support it, 3 sources oppose it');
    expect(countLine({ supporting: 0, opposing: 0 })).toBe('No page Dash read speaks to it');
  });
});

describe('deeperProblem', () => {
  it('needs a draft with something to check, and not a book', () => {
    expect(deeperProblem('Too short.')).toMatch(/paragraph or two/);
    expect(deeperProblem('word '.repeat(80))).toBeNull();
    expect(deeperProblem('word '.repeat(6_000))).toMatch(/4,000 words/);
  });
});

describe('textFragmentUrl', () => {
  it('links a short quote whole, escaping what a text fragment reserves', () => {
    expect(textFragmentUrl('https://e.org/x#old', 'well-rested, & alert')).toBe(
      'https://e.org/x#:~:text=well%2Drested%2C%20%26%20alert',
    );
  });

  it('matches a long quote by its first and last four words, dropping a word the API cut short', () => {
    expect(
      textFragmentUrl(
        'https://e.org/x',
        'Weekend recovery sleep did not prevent the metabolic dysregulation seen during insuffic...',
      ),
    ).toBe('https://e.org/x#:~:text=Weekend%20recovery%20sleep%20did,metabolic%20dysregulation%20seen%20during');
  });

  it('leaves the page bare when there are no words to match', () => {
    expect(textFragmentUrl('https://e.org/x', '...')).toBe('https://e.org/x');
  });
});

describe('footnoteFor', () => {
  const source = { url: 'https://example.org/x', title: 'The myth of [catch-up] sleep', domain: 'example.org' };

  it('numbers by first use and writes the definition with a text-fragment link', () => {
    const note = footnoteFor('Lie-ins do not help.[^1]\n\n[^1]: [Other](https://o.org) · o.org\n', source, 'weekend recovery sleep');
    expect(note).toEqual({
      ref: '[^2]',
      definition: '[^2]: [The myth of catch-up sleep](https://example.org/x#:~:text=weekend%20recovery%20sleep) · example.org',
    });
  });

  it('reuses the number of a page the essay already cites', () => {
    const doc = 'A.[^3]\n\n[^3]: [Myth](https://example.org/x#:~:text=old) · example.org\n';
    expect(footnoteFor(doc, source, 'new words')).toEqual({ ref: '[^3]', definition: null });
  });

  it('starts at 1 and escapes brackets in the link', () => {
    expect(footnoteFor('No notes yet.', { ...source, url: 'https://e.org/a_(b)' }, 'x').definition).toBe(
      '[^1]: [The myth of catch-up sleep](https://e.org/a_%28b%29#:~:text=x) · example.org',
    );
  });
});

describe('definitionInsert', () => {
  it('leaves a blank line after the essay, and none between footnotes', () => {
    expect(definitionInsert('Text.', '[^1]: d')).toBe('\n\n[^1]: d\n');
    expect(definitionInsert('Text.\n', '[^1]: d')).toBe('\n[^1]: d\n');
    expect(definitionInsert('Text.\n\n[^1]: a\n', '[^2]: b')).toBe('[^2]: b\n');
    expect(definitionInsert('Text.\n\n[^1]: a', '[^2]: b')).toBe('\n[^2]: b\n');
    expect(definitionInsert('', '[^1]: d')).toBe('[^1]: d\n');
  });
});

describe('researchFromRow', () => {
  it('reads a stored run back, dropping citations to sources it does not have', () => {
    const run = researchFromRow({
      id: 'r1',
      level: 'deeper',
      question: 'Q?',
      queries: ['q'],
      sources: [{ url: 'https://a.org', title: 'A', domain: 'a.org', text: 'kept text' }, { url: 'ftp://x' }],
      findings: [
        {
          claim: 'C',
          citations: [
            { source: 0, quote: 'yes', stance: 'for' },
            { source: 4, quote: 'gone', stance: 'against' },
          ],
        },
      ],
      cost_micros: '61234',
      created_at: '2026-10-12T10:00:00Z',
    });
    expect(run?.claims).toEqual([
      { claim: 'C', citations: [{ source: 0, quote: 'yes', stance: 'for' }], verdict: 'supported', supporting: 1, opposing: 0 },
    ]);
    expect(run?.costMicros).toBe(61_234);
    expect(run && forBrowser(run).sources[0].text).toBeNull();
    expect(
      researchFromRow({ id: 'r2', level: 'other', question: '', queries: null, sources: [], findings: [], cost_micros: null, created_at: '' }),
    ).toBeNull();
  });
});
