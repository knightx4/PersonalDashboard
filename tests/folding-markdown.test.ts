import { describe, expect, it } from 'vitest';

import { splitSections } from '@/components/ui/folding-markdown';

describe('splitSections', () => {
  it('leaves a note with no headings as its preamble', () => {
    expect(splitSections('one\n\n- two')).toEqual({ preamble: 'one\n\n- two', sections: [] });
  });

  it('nests a lower heading inside the one above it and closes it at a peer', () => {
    const { preamble, sections } = splitSections(
      'intro\n## A\na body\n### A1\nnested\n## B\nb body',
    );
    expect(preamble).toBe('intro');
    expect(sections.map((s) => s.title)).toEqual(['A', 'B']);
    expect(sections[0].body).toBe('a body');
    expect(sections[0].children).toEqual([
      { level: 3, title: 'A1', body: 'nested', children: [] },
    ]);
    expect(sections[1].body).toBe('b body');
  });

  it('does not read a hash inside a code fence as a heading', () => {
    const { sections } = splitSections('## Code\n```sh\n# a comment\n```');
    expect(sections).toHaveLength(1);
    expect(sections[0].body).toBe('```sh\n# a comment\n```');
  });

  it('drops a closing run of hashes from the title', () => {
    expect(splitSections('## Title ##').sections[0].title).toBe('Title');
  });
});
