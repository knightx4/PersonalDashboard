import { describe, expect, it } from 'vitest';
import { BLOCK_MAX_CHARS, notePlace, splitNoteBlocks } from '@/lib/vault/notes/blocks';

/** What substring(body from start + 1 for end - start) gives in Postgres. */
const pgSubstring = (body: string, start: number, end: number): string =>
  Array.from(body).slice(start, end).join('');

const note = (body: string, path = 'Ideas/Work/On pricing.md', title: string | null = 'On pricing') => ({
  path,
  title,
  body,
});

describe('splitNoteBlocks', () => {
  it('cuts at headings and keeps the headings above each passage', () => {
    const body = [
      'An opening paragraph before any heading, long enough to search.',
      '',
      '# Reasons',
      'The first reason is that people pay for what saves them time.',
      '## The second',
      'The second reason is that a price says what a thing is worth to you.',
      '# Doubts',
      'I am not sure any of this holds for things people buy once.',
    ].join('\n');
    const blocks = splitNoteBlocks(note(body));
    expect(blocks.map((b) => b.headingPath)).toEqual([
      [],
      ['Reasons'],
      ['Reasons', 'The second'],
      ['Doubts'],
    ]);
    expect(blocks[2].text).toBe(
      '## The second\nThe second reason is that a price says what a thing is worth to you.',
    );
    expect(blocks[2].embedText.split('\n\n')[0]).toBe('Ideas > Work > On pricing > Reasons > The second');
    expect(blocks.every((b) => b.searchable)).toBe(true);
    expect(blocks.map((b) => b.position)).toEqual([0, 1, 2, 3]);
  });

  it('gives offsets that read the passage back out of the body', () => {
    const body = '---\ntags: [a]\n---\nIntro line that is long enough to keep 🙂 here.\n\n# Émoji 🙂 heading\nText after an emoji 🙂 with more words in it.';
    for (const block of splitNoteBlocks(note(body))) {
      expect(pgSubstring(body, block.start, block.end)).toBe(block.text);
    }
  });

  it('leaves the frontmatter out and ignores # lines inside fenced code', () => {
    const body = '---\ntitle: x\n---\n# Code\n```sh\n# not a heading\necho hello there and more words\n```\nAfter the fence, still under Code.';
    const blocks = splitNoteBlocks(note(body));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].headingPath).toEqual(['Code']);
    expect(blocks[0].text.startsWith('# Code')).toBe(true);
  });

  it('keeps a heading on its own without a vector', () => {
    const blocks = splitNoteBlocks(note('# Empty\n\n# Full\nThis section has enough words to be searched.'));
    expect(blocks.map((b) => b.searchable)).toEqual([false, true]);
  });

  it('cuts a long section at blank lines', () => {
    const paragraph = 'word '.repeat(150).trim();
    const body = Array.from({ length: 8 }, () => paragraph).join('\n\n');
    const blocks = splitNoteBlocks(note(body));
    expect(blocks.length).toBeGreaterThan(1);
    for (const block of blocks) {
      expect(block.end - block.start).toBeLessThanOrEqual(BLOCK_MAX_CHARS);
      expect(pgSubstring(body, block.start, block.end)).toBe(block.text);
    }
  });

  it('changes only the edited block hash when one paragraph is edited', () => {
    const before = '# One\nThe first section says one thing at length.\n# Two\nThe second section says another thing.';
    const after = before.replace('another thing', 'a different thing');
    const a = splitNoteBlocks(note(before)).map((b) => b.textHash);
    const b = splitNoteBlocks(note(after)).map((b) => b.textHash);
    expect(a[0]).toBe(b[0]);
    expect(a[1]).not.toBe(b[1]);
  });

  it('marks a note with nothing but frontmatter with one unsearchable block', () => {
    const body = '---\ntags: [a]\n---\n';
    const blocks = splitNoteBlocks(note(body));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ start: 0, end: body.length, searchable: false });
  });

  it('gives nothing for an empty body', () => {
    expect(splitNoteBlocks(note('  \n'))).toEqual([]);
  });
});

describe('notePlace', () => {
  it('names the folders and the note, falling back to the file name', () => {
    expect(notePlace('A/B/Note.md', null)).toEqual(['A', 'B', 'Note']);
    expect(notePlace('Top.md', 'Title')).toEqual(['Title']);
  });
});
