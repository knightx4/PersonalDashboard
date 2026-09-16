import { describe, expect, it, vi } from 'vitest';
import { listEverything, rankHits, searchEverything } from './search';
import { MIN_QUERY, type HitKind, type SearchHit, type SearchSource } from './sources';

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

function source(
  id: string,
  hits: SearchHit[],
  module: SearchHit['module'] = 'jobs',
  kinds: readonly HitKind[] = ['company'],
): SearchSource {
  return {
    id,
    module,
    label: id,
    kinds,
    find: vi.fn().mockResolvedValue(hits),
    list: vi.fn().mockResolvedValue(hits),
  };
}

function failingSource(id: string, module: SearchHit['module'] = 'shopping'): SearchSource {
  return {
    id,
    module,
    label: id,
    kinds: ['company'],
    find: vi.fn().mockRejectedValue(new Error('token expired')),
    list: vi.fn().mockRejectedValue(new Error('token expired')),
  };
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

describe('asking for only some kinds', () => {
  // What the todo link picker needs: a search that offers nothing a task
  // cannot be about. Narrowed here rather than in the browser, so the caps are
  // spent on rows that can actually be chosen.
  const orders = source(
    'shopping',
    [hit('Acme order', { module: 'shopping', kind: 'order' })],
    'shopping',
    ['order'],
  );
  const notes = source('vault', [hit('Acme note', { module: 'vault', kind: 'note' })], 'vault', [
    'note',
  ]);

  it('never asks a source that could not answer with a wanted kind', async () => {
    const result = await searchEverything({
      userId: 'user-1',
      query: 'ac',
      sources: [orders, notes],
      enabledModules: ALL,
      kinds: ['note'],
    });

    expect(orders.find).not.toHaveBeenCalled();
    expect(result.hits.map((h) => h.title)).toEqual(['Acme note']);
  });

  it('drops a hit of a kind nobody asked for, whoever returned it', async () => {
    // A source declares its kinds; it is not trusted to only return them.
    const sloppy = source(
      'jobs',
      [hit('Acme'), hit('Acme task', { module: 'todo', kind: 'task' })],
      'jobs',
      ['company', 'task'],
    );

    const result = await searchEverything({
      userId: 'user-1',
      query: 'ac',
      sources: [sloppy],
      enabledModules: ALL,
      kinds: ['company'],
    });

    expect(result.hits.map((h) => h.kind)).toEqual(['company']);
  });

  it('asks everybody when no kinds are named, which is the palette', async () => {
    const result = await searchEverything({
      userId: 'user-1',
      query: 'ac',
      sources: [orders, notes],
      enabledModules: ALL,
    });

    expect(orders.find).toHaveBeenCalled();
    expect(result.hits).toHaveLength(2);
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

describe('the whole list, with no query', () => {
  // What the palette fetches when it opens. The same three rules as a search
  // -- a broken workspace costs only itself, a switched-off one contributes
  // nothing, there is a cap -- and no ranking, because the browser does that.
  const list = (sources: SearchSource[], enabled: readonly SearchHit['module'][] = ALL, limit?: number) =>
    listEverything({ userId: 'user-1', sources, enabledModules: enabled, limit });

  it('returns what every source holds, unranked', async () => {
    const result = await list([
      source('a', [hit('Zebra'), hit('Acme')]),
      source('b', [hit('Acorn', { module: 'vault', kind: 'note' })], 'vault', ['note']),
    ]);

    expect(result.hits.map((h) => h.title)).toEqual(['Zebra', 'Acme', 'Acorn']);
    expect(result.failed).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('asks each source to list rather than to search', async () => {
    const only = source('jobs', [hit('Acme')]);
    await list([only], ALL, 40);

    expect(only.find).not.toHaveBeenCalled();
    expect(only.list).toHaveBeenCalledWith({ userId: 'user-1', limit: 40 });
  });

  it('lets the others answer when one of them throws', async () => {
    const result = await list([source('good', [hit('Acme')]), failingSource('broken')]);

    expect(result.hits.map((h) => h.title)).toEqual(['Acme']);
    expect(result.failed).toEqual(['broken']);
  });

  it('never runs a source whose workspace is switched off', async () => {
    const off = source('shopping', [hit('Acme', { module: 'shopping' })], 'shopping');
    const result = await list([source('jobs', [hit('Acorn')]), off], ['jobs']);

    expect(off.list).not.toHaveBeenCalled();
    expect(result.hits.map((h) => h.title)).toEqual(['Acorn']);
  });

  it('cuts the list at the cap and says that it did', async () => {
    const many = Array.from({ length: 9 }, (_, i) => hit(`Acme ${i}`));
    const result = await list([source('noisy', many)], ALL, 4);

    expect(result.hits).toHaveLength(4);
    expect(result.truncated).toBe(true);
  });
});
