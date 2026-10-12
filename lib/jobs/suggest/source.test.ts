import { describe, expect, it } from 'vitest';
import { NO_OPENING_FILTER, passesFilter } from './scores';
import { openingSource, siteOf, sourceText } from './source';

describe('openingSource', () => {
  it('names the list or search that found a role, and its site', () => {
    expect(sourceText(openingSource({ origin: 'discovered', foundIn: 'Found on YC', url: 'https://jobs.ashbyhq.com/f2/1' }))).toBe(
      'From YC startup list · Ashby',
    );
    expect(openingSource({ origin: 'discovered', foundIn: 'Found on Hacker News', url: null }).key).toBe('hn');
    expect(sourceText(openingSource({ origin: 'board', foundIn: "On Rogo's own job board", url: 'https://boards.greenhouse.io/rogo/jobs/2' }))).toBe(
      'From a company you follow · Greenhouse',
    );
    expect(sourceText(openingSource({ origin: 'search', foundIn: null, url: 'https://careers.example.com/role' }))).toBe(
      "From Dash's web search · careers.example.com",
    );
    expect(openingSource({ origin: null, foundIn: 'Goal: move into strategic finance', url: null }).key).toBe('goal');
  });

  it('reads a site from its host, and nothing from a bad link', () => {
    expect(siteOf('https://www.linkedin.com/jobs/view/1')).toBe('LinkedIn');
    expect(siteOf('https://acme.wd5.myworkdayjobs.com/x')).toBe('Workday');
    expect(siteOf('not a link')).toBeNull();
  });
});

describe('the source filter', () => {
  it('keeps only roles from the chosen source, scored or not', () => {
    const yc = { scores: null, createdAt: '2026-10-09', source: { key: 'yc' as const } };
    const board = { scores: null, createdAt: '2026-10-09', source: { key: 'board' as const } };
    const filter = { ...NO_OPENING_FILTER, source: 'yc' as const };
    expect(passesFilter(yc, filter)).toBe(true);
    expect(passesFilter(board, filter)).toBe(false);
    expect(passesFilter(board, NO_OPENING_FILTER)).toBe(true);
  });
});
