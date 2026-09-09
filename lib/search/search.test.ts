import { describe, expect, it, vi } from 'vitest';
import { rankHits, searchEverything } from './search';
import { MIN_QUERY, type SearchHit, type SearchSource } from './sources';

/**
 * The rules that decide what ⌘K shows.
 *
 * Tested with stub sources and no database, because what matters here is not
 * whether a query works -- each source's own step covers that -- but what
 * happens around it: that one broken workspace cannot take the palette down,
 * that a workspace somebody switched off stays switched off, and that no
 * single source can fill a box meant to be read at a glance.
 */

const hit = (title: string, overrides: Partial<SearchHit> = {}): SearchHit => ({
  module: 'jobs',
  kind: 'company',
  id: title,
  title,
  subtitle: 'Company · Job search',
  href: `/jobs/companies/${title}`,
  ...overrides,
});

function source(id: string, hits: SearchHit[], module: SearchHit['module'] = 'jobs'): SearchSource {
  return { id, module, label: id, find: vi.fn().mockResolvedValue(hits) };
}

function failingSource(id: string, module: SearchHit['module'] = 'shopping'): SearchSource {
  return { id, module, label: id, find: vi.fn().mockRejectedValue(new Error('token expired')) };
}

const ALL = ['shopping', 'jobs', 'vault', 'todo', 'learn'] as const;

const run = (sources: SearchSource[], query = 'ac', enabled: readonly SearchHit['module'][] = ALL) =>
  searchEverything({ userId: 'user-1', query, sources, enabledModules: enabled });

describe('running the sources', () => {
  it('merges what they all return', async () => {
    const result = await run([
      source('a', [hit('Acme')]),
      source('b', [hit('Acorn', { module: 'shopping' })], 'shopping'),
    ]);

    expect(result.hits.map((h) => h.title).sort()).toEqual(['Acme', 'Acorn']);
    expect(result.failed).toEqual([]);
  });

  it('lets the others answer when one of them throws', async () => {
    // The palette must not go down because somebody else's token expired.
    const result = await run([source('good', [hit('Acme')]), failingSource('broken')]);

    expect(result.hits.map((h) => h.title)).toEqual(['Acme']);
    expect(result.failed).toEqual(['broken']);
  });

  it('still answers when every source is broken', async () => {
    const result = await run([failingSource('one'), failingSource('two', 'vault')]);
    expect(result.hits).toEqual([]);
    expect(result.failed).toHaveLength(2);
  });

  it('never runs a source whose workspace is switched off', async () => {
    // Turning a workspace off has to mean it stops appearing. A search still
    // reaching into it would make that setting a lie.
    const off = source('shopping', [hit('Acme', { module: 'shopping' })], 'shopping');
    const result = await run([source('jobs', [hit('Acorn')]), off], 'ac', ['jobs']);

    expect(off.find).not.toHaveBeenCalled();
    expect(result.hits.map((h) => h.title)).toEqual(['Acorn']);
  });
});

describe('the query floor', () => {
  it('asks nobody anything under two characters', async () => {
    const only = source('jobs', [hit('Acme')]);
    const result = await searchEverything({
      userId: 'user-1',
      query: 'a',
      sources: [only],
      enabledModules: ALL,
    });

    expect(only.find).not.toHaveBeenCalled();
    expect(result.hits).toEqual([]);
    expect(MIN_QUERY).toBe(2);
  });

  it('ignores surrounding space when deciding', async () => {
    const only = source('jobs', [hit('Acme')]);
    await searchEverything({
      userId: 'user-1',
      query: '  a  ',
      sources: [only],
      enabledModules: ALL,
    });
    expect(only.find).not.toHaveBeenCalled();
  });
});

describe('the caps', () => {
  it('trims a source that returned more than it was allowed', async () => {
    const many = Array.from({ length: 20 }, (_, i) => hit(`Acme ${i}`));
    const result = await searchEverything({
      userId: 'user-1',
      query: 'ac',
      sources: [source('noisy', many)],
      enabledModules: ALL,
      perSourceLimit: 3,
      totalLimit: 10,
    });

    expect(result.hits).toHaveLength(3);
  });

  it('caps the whole list however many sources answered', async () => {
    const result = await searchEverything({
      userId: 'user-1',
      query: 'ac',
      sources: [
        source('a', Array.from({ length: 5 }, (_, i) => hit(`Acme A${i}`))),
        source('b', Array.from({ length: 5 }, (_, i) => hit(`Acme B${i}`, { module: 'vault' })), 'vault'),
      ],
      enabledModules: ALL,
      perSourceLimit: 5,
      totalLimit: 4,
    });

    expect(result.hits).toHaveLength(4);
  });

  it('tells the source its own limit', async () => {
    const only = source('jobs', [hit('Acme')]);
    await searchEverything({
      userId: 'user-1',
      query: 'ac',
      sources: [only],
      enabledModules: ALL,
      perSourceLimit: 4,
    });

    expect(only.find).toHaveBeenCalledWith({ userId: 'user-1', query: 'ac', limit: 4 });
  });
});

describe('the ranking', () => {
  it('puts a match at the start of a word above one in the middle', () => {
    const ranked = rankHits([hit('Paracetamol'), hit('Acme')], 'ac');
    expect(ranked[0].title).toBe('Acme');
  });

  it('drops what does not match at all', () => {
    expect(rankHits([hit('Zebra')], 'qq')).toEqual([]);
  });

  it('finds a thing by the words its source said to look for it by', () => {
    // A role is called "Staff Engineer" and is looked for by the company.
    const ranked = rankHits(
      [hit('Staff Engineer', { kind: 'role', subtitle: 'Role at Acme · Job search', match: 'Acme' })],
      'acme',
    );
    expect(ranked).toHaveLength(1);
  });

  it('does not match against the subtitle, which is boilerplate', () => {
    // "Company · Job search" contains an a and then a c, so matching it would
    // make "ac" find every company there is.
    expect(rankHits([hit('Zebra')], 'ac')).toEqual([]);
  });

  it('is stable for two things that score the same', () => {
    const ranked = rankHits([hit('Acme Two'), hit('Acme One')], 'ac');
    expect(ranked.map((h) => h.title)).toEqual(['Acme One', 'Acme Two']);
  });
});
