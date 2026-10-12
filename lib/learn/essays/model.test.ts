import { describe, expect, it } from 'vitest';
import { Text } from '@codemirror/state';
import { countWords, essayTitle, parseWordTarget, readBrief, toSummary, wordCountLabel } from './model';
import { paragraphAround } from './editor';

describe('essayTitle', () => {
  it('takes the first top-level heading', () => {
    expect(essayTitle('Intro line\n# Why money is odd\n\n## Part', 'Essays/Untitled essay.md')).toBe('Why money is odd');
  });

  it('ignores a second-level heading and frontmatter', () => {
    expect(essayTitle('---\ntitle: x\n---\n## Not this\ntext', 'Essays/Saved name.md')).toBe('Saved name');
  });

  it('falls back to Untitled essay', () => {
    expect(essayTitle('', '')).toBe('Untitled essay');
    expect(essayTitle('#   \n', 'Essays/Untitled essay.md')).toBe('Untitled essay');
  });
});

describe('countWords', () => {
  it('counts words and leaves out bare markdown symbols', () => {
    expect(countWords('# Title here\n\n- one **two**\n> three\n\n---\n')).toBe(5);
  });

  it('leaves out frontmatter and counts nothing in an empty draft', () => {
    expect(countWords('---\ntype: essay\nstage: draft\n---\nJust four words here')).toBe(4);
    expect(countWords('')).toBe(0);
    expect(countWords('   \n\n ')).toBe(0);
  });

  it('counts words in other scripts', () => {
    expect(countWords('café naïve 2026')).toBe(3);
  });
});

describe('wordCountLabel', () => {
  it('says the count, against the target when there is one', () => {
    expect(wordCountLabel(1, null)).toBe('1 word');
    expect(wordCountLabel(1412, null)).toBe('1,412 words');
    expect(wordCountLabel(412, 800)).toBe('412 of 800 words');
  });
});

describe('parseWordTarget', () => {
  it('accepts 200 to 2,000 and an empty field', () => {
    expect(parseWordTarget('')).toEqual({ target: null });
    expect(parseWordTarget('1,200')).toEqual({ target: 1200 });
    expect(parseWordTarget('200')).toEqual({ target: 200 });
  });

  it('refuses anything else', () => {
    expect(parseWordTarget('150')).toHaveProperty('error');
    expect(parseWordTarget('2001')).toHaveProperty('error');
    expect(parseWordTarget('lots')).toHaveProperty('error');
  });
});

describe('readBrief and toSummary', () => {
  it('reads a partial or malformed brief as empty strings', () => {
    expect(readBrief({ question: 'Why?', pinned: [] })).toEqual({ question: 'Why?', claim: '', reader: '' });
    expect(readBrief(null)).toEqual({ question: '', claim: '', reader: '' });
    expect(readBrief([1])).toEqual({ question: '', claim: '', reader: '' });
  });

  it('summarises a row', () => {
    const summary = toSummary({
      id: 'e1',
      path: 'Essays/Untitled essay.md',
      draft_body: '# A title\n\nTwo words',
      unsaved: true,
      brief: { question: 'Why?' },
      word_target: 400,
      published_at: null,
      updated_at: '2026-10-12T00:00:00Z',
    });
    expect(summary).toMatchObject({ title: 'A title', question: 'Why?', words: 4, wordTarget: 400 });
  });
});

describe('paragraphAround', () => {
  const doc = Text.of(['# Title', '', 'one', 'two', 'three', '', 'four']);

  it('finds the run of non-blank lines around a line', () => {
    expect(paragraphAround(doc, 4)).toEqual({ first: 3, last: 5 });
    expect(paragraphAround(doc, 1)).toEqual({ first: 1, last: 1 });
    expect(paragraphAround(doc, 7)).toEqual({ first: 7, last: 7 });
  });

  it('treats a blank line as its own paragraph', () => {
    expect(paragraphAround(doc, 2)).toEqual({ first: 2, last: 2 });
  });
});
