import { describe, expect, it } from 'vitest';
import { keepPageLinks, mapPrompt, readMap, splitItem } from './research-map';
import type { ResearchSource } from './research';

const cite = (url: string, cited_text: string, title = 'A page') => ({
  type: 'web_search_result_location',
  url,
  title,
  cited_text,
  encrypted_index: 'x',
});
const text = (t: string, citations?: unknown[]) => ({
  type: 'text',
  text: t,
  ...(citations ? { citations } : {}),
});

const REPLY = [
  { type: 'server_tool_use', name: 'web_search', input: { query: 'AI internal controls finance' } },
  text('## Where the debate stands\n'),
  text('Most standard-setters extend existing control frameworks to AI.', [
    cite('https://coso.example.org/genai', 'COSO adapts its five components to generative AI'),
  ]),
  text(' Researchers doubt human review holds up.\n\n## Supports your answer\n- '),
  text('**COSO builds on ICFR**: COSO’s 2026 guidance maps AI uses to its existing components.', [
    cite('https://coso.example.org/genai', 'eight capability types'),
  ]),
  text('\n- **Unsourced claim**: this one has no citation.\n\n## Pushes back\n- '),
  text(
    '**Reviewers rubber-stamp**: a study found reviewers approved AI output they did not understand.',
    [
      cite(
        'https://journal.example.com/oversight',
        'humans sign off without substance',
        'Oversight study',
      ),
    ],
  ),
  text('\n\n## You could use\n'),
  text('- NIST AI RMF: four functions, govern, map, measure and manage.', [
    cite('https://nist.example.gov/rmf', 'Govern, Map, Measure, and Manage'),
  ]),
  text(
    '\n\n## Questions for you\n- Where does preventive control end and monitoring begin for an agent?\n- Not a question\n',
  ),
];

describe('the research written up for the writer', () => {
  const map = readMap(REPLY);

  it('keeps the debate and the cited items in their sections, and drops uncited ones', () => {
    expect(map.findings.map((f) => [f.kind, f.title])).toEqual([
      ['debate', ''],
      ['for', 'COSO builds on ICFR'],
      ['against', 'Reviewers rubber-stamp'],
      ['use', 'NIST AI RMF'],
    ]);
    expect(map.summary).toBe(
      'Most standard-setters extend existing control frameworks to AI. Researchers doubt human review holds up.',
    );
  });

  it('lists each cited page once and renumbers the citations to match', () => {
    expect(map.sources.map((s) => s.domain)).toEqual([
      'coso.example.org',
      'journal.example.com',
      'nist.example.gov',
    ]);
    expect(map.findings[2]!.citations).toEqual([
      { source: 1, quote: 'humans sign off without substance' },
    ]);
  });

  it('keeps only the questions', () => {
    expect(map.asks).toEqual([
      'Where does preventive control end and monitoring begin for an agent?',
    ]);
  });

  it('splits a headline from the rest', () => {
    expect(splitItem('**A thing.** More words')).toEqual({
      title: 'A thing',
      summary: 'More words',
    });
    expect(splitItem('No headline at all, just a sentence')).toEqual({
      title: '',
      summary: 'No headline at all, just a sentence',
    });
  });

  it('tells the call the question and the answer, and leaves the origin out', () => {
    const prompt = mapPrompt({
      question: 'Q?',
      claim: 'My answer.',
      reader: 'CFOs',
      change: 'A study.',
    });
    expect(prompt).toContain('My answer.');
    expect(mapPrompt({ question: ' ', claim: 'x', reader: '', change: '' })).toBeNull();
  });
});

/** Links in the essay's research write-up (note 179b2256). */

const PDF = 'https://example.org/ugd/coso-genai.pdf';
const pages: ResearchSource[] = [
  {
    url: 'https://dart.example.com/heads-up/coso-ai',
    title: 'COSO releases guidance',
    domain: 'dart.example.com',
    text: `The publication, [*Achieving Effective Internal Control Over Generative AI*](${PDF}), applies the five components.`,
  },
];

describe('keepPageLinks', () => {
  it('keeps a link to a page read, or to an address a page gives', () => {
    expect(keepPageLinks(`In 2026 COSO released [guidance](${PDF}).`, pages)).toBe(
      `In 2026 COSO released [guidance](${PDF}).`,
    );
    expect(
      keepPageLinks('See [the summary](https://dart.example.com/heads-up/coso-ai/).', pages),
    ).toBe('See [the summary](https://dart.example.com/heads-up/coso-ai/).');
  });

  it('turns a link to an address no page gives back into its words', () => {
    expect(keepPageLinks('COSO released [guidance](https://made-up.example.com/x).', pages)).toBe(
      'COSO released guidance.',
    );
  });
});
