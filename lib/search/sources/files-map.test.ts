import { describe, expect, it } from 'vitest';
import { fileText, fileTextFilter, snippetAround } from '@/lib/search/sources/files-map';
import { hitPoints } from '@/lib/search/rank';
import type { SearchHit } from '@/lib/search/sources';

const hit = (matchText: string): SearchHit => ({
  module: 'goals', kind: 'file', id: '1', ref: 'core.files:1', title: 'Pension notes',
  subtitle: null, matchText, href: '/goals/files/1',
});

describe('files search text', () => {
  it('filters title, summary and body, quoting the pattern', () => {
    expect(fileTextFilter('a,b_')).toBe(
      'title.ilike."%a,b\\\\_%",summary.ilike."%a,b\\\\_%",body.ilike."%a,b\\\\_%"',
    );
  });
  it('cuts a snippet around the first match', () => {
    expect(snippetAround('x'.repeat(200) + ' Annuity ' + 'y'.repeat(200), 'annuity')).toContain('Annuity');
    expect(snippetAround('nothing', 'annuity')).toBe('');
  });
  it('caps the text a list carries', () => {
    expect(fileText(null, 'z'.repeat(9000)).length).toBe(3000);
  });
  it('finds a word in the text as a substring only', () => {
    expect(hitPoints(hit('the annuity rate'), 'annuity')).toBe(0);
    expect(hitPoints(hit('the annuity rate'), 'xqz')).toBeNull();
  });
});
