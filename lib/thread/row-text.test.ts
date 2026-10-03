import { describe, expect, it } from 'vitest';
import { COLUMN_MAX, rowText } from './row-text';

describe('rowText', () => {
  it('writes out a catalogued row with what its table holds and its title', () => {
    const text = rowText('core.files', {
      id: 'f1',
      user_id: 'me',
      title: 'Lisbon costs',
      body: 'Rent is high.',
      archived_at: null,
      embedding: Array.from({ length: 100 }, () => 0.1),
    });
    expect(text).toContain('A row of core.files: Longer pieces written for them');
    expect(text).toContain('Called: Lisbon costs');
    expect(text).toContain('### body\n\nRent is high.');
    expect(text).not.toContain('### user_id');
    expect(text).not.toContain('### archived_at');
    expect(text).not.toContain('### embedding');
  });

  it('cuts a long column and says how much was left out', () => {
    const text = rowText('core.files', { id: 'f1', body: 'x'.repeat(COLUMN_MAX + 10) });
    expect(text).toContain('(cut here: 10 more characters)');
  });

  it('writes out a table the catalogue does not know, column by column', () => {
    const text = rowText('public.somewhere', { id: 'r1', note: { a: 1 } });
    expect(text).toContain('A row of public.somewhere.');
    expect(text).toContain('### note\n\n{"a":1}');
  });

  it('keeps the path and folder of a vault note from Dash', () => {
    const text = rowText('obsidian.notes', {
      id: 'n1',
      path: 'Health/Running plan.md',
      title: 'Running plan',
      body: 'Three runs a week.',
      blob_sha: 'abc123',
      search_tsv: "'run':1",
    });
    expect(text).toContain('### body\n\nThree runs a week.');
    expect(text).not.toContain('Health/');
    expect(text).not.toContain('### path');
    expect(text).not.toContain('### blob_sha');
    expect(text).not.toContain('### search_tsv');
  });
});
