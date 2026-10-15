import { describe, expect, it } from 'vitest';
import { keepPageLinks, readMap } from './research-map';
import type { ResearchSource } from './research';

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
    expect(keepPageLinks(`In 2026 COSO released [guidance](${PDF}).`, pages)).toBe(`In 2026 COSO released [guidance](${PDF}).`);
    expect(keepPageLinks('See [the summary](https://dart.example.com/heads-up/coso-ai/).', pages)).toBe(
      'See [the summary](https://dart.example.com/heads-up/coso-ai/).',
    );
  });

  it('turns a link to an address no page gives back into its words', () => {
    expect(keepPageLinks('COSO released [guidance](https://made-up.example.com/x).', pages)).toBe('COSO released guidance.');
  });
});

describe('readMap', () => {
  it('carries the kept links into the short answer and the parts', () => {
    const content = [
      { type: 'text', text: '## Short answer\n' },
      {
        type: 'text',
        text: `COSO released [guidance](${PDF}) in 2026 and [rules](https://nowhere.example.com).`,
        citations: [{ type: 'char_location', document_index: 0, cited_text: 'applies the five components' }],
      },
      { type: 'text', text: '\n## Q1\n' },
      {
        type: 'text',
        text: `It applies the five components of the [framework](${PDF}).`,
        citations: [{ type: 'char_location', document_index: 0, cited_text: 'applies the five components' }],
      },
    ];
    const map = readMap(content, pages, [{ id: 'q1', text: 'What does the guidance apply?' }]);
    expect(map.summary).toBe(`COSO released [guidance](${PDF}) in 2026 and rules.`);
    expect(map.parts[0]?.summary).toBe(`It applies the five components of the [framework](${PDF}).`);
  });
});
