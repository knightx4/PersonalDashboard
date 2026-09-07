import { describe, expect, it } from 'vitest';
import { MAX_NOTE_BYTES, noteTooLarge, parseNote } from '@/lib/vault/markdown/note';

describe('parseNote', () => {
  it('separates frontmatter from the body', () => {
    const note = parseNote(
      ['---', 'tags: [work, admin]', 'status: active', '---', '', 'The actual note.'].join('\n'),
      'Work/Thing.md',
    );
    expect(note.frontmatter).toEqual({ tags: ['work', 'admin'], status: 'active' });
    expect(note.body).toBe('The actual note.');
  });

  it('keeps a note with no frontmatter intact', () => {
    const note = parseNote('# Heading\n\nBody text.', 'Plain.md');
    expect(note.frontmatter).toEqual({});
    expect(note.body).toBe('# Heading\n\nBody text.');
  });

  it('survives malformed frontmatter rather than refusing the note', () => {
    // A vault is a personal document store, not a build input. Half-typed YAML
    // at the top of a file is a Tuesday, and dropping the note over it would
    // make the app less useful than the folder it mirrors.
    const raw = ['---', 'tags: [unclosed', 'title "no colon"', '---', '', 'Still readable.'].join('\n');
    const note = parseNote(raw, 'Messy.md');
    expect(note.body).toContain('Still readable.');
    expect(note.title).toBe('Messy');
  });

  it('does not treat a horizontal rule as frontmatter', () => {
    const note = parseNote('Intro paragraph.\n\n---\n\nAfter the rule.', 'Rule.md');
    expect(note.frontmatter).toEqual({});
    expect(note.body).toContain('After the rule.');
  });
});

describe('parseNote titles', () => {
  it('prefers the filename, which is what Obsidian calls the note', () => {
    // A note called "Rent" whose first line is "# Notes from the call" is
    // still Rent -- and a list where half the rows are called "Notes" is not
    // a list.
    const note = parseNote('# Notes from the call\n\nBody.', 'Money/Rent.md');
    expect(note.title).toBe('Rent');
  });

  it('lets explicit frontmatter override the filename', () => {
    const note = parseNote('---\ntitle: The Real Title\n---\n\nBody.', 'Untitled-3.md');
    expect(note.title).toBe('The Real Title');
  });

  it('falls back to the first heading when there is no filename to use', () => {
    const note = parseNote('# Only a heading\n\nBody.', '.md');
    expect(note.title).toBe('Only a heading');
  });

  it('never returns an empty title', () => {
    expect(parseNote('', '.md').title).toBe('Untitled');
  });

  it('ignores a tag at the top of the body when looking for a heading', () => {
    // `#daily` is a tag, not an h1. The required space is what tells them apart.
    const note = parseNote('#daily\n\nBody.', '.md');
    expect(note.title).toBe('Untitled');
  });
});

describe('parseNote dates', () => {
  it('reads a modification date out of frontmatter', () => {
    const note = parseNote('---\nupdated: 2024-03-05\n---\n\nBody.', 'A.md');
    expect(note.updatedAt).toBe(new Date('2024-03-05').toISOString());
  });

  it('accepts the aliases people actually use', () => {
    for (const key of ['modified', 'last-modified', 'lastmod', 'date']) {
      const note = parseNote(`---\n${key}: 2022-01-02\n---\n`, 'A.md');
      expect(note.updatedAt, key).toBe(new Date('2022-01-02').toISOString());
    }
  });

  it('falls back to a creation date when there is no modification date', () => {
    const note = parseNote('---\ncreated: 2020-06-01\n---\n', 'A.md');
    expect(note.updatedAt).toBe(new Date('2020-06-01').toISOString());
  });

  it('is null when there is no usable date', () => {
    expect(parseNote('---\nupdated: sometime last spring\n---\n', 'A.md').updatedAt).toBeNull();
    expect(parseNote('Body only.', 'A.md').updatedAt).toBeNull();
  });
});

describe('noteTooLarge', () => {
  it('accepts a note at the cap and rejects one past it', () => {
    expect(noteTooLarge(MAX_NOTE_BYTES)).toBe(false);
    expect(noteTooLarge(MAX_NOTE_BYTES + 1)).toBe(true);
  });
});
