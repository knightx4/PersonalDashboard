import { describe, expect, it, vi } from 'vitest';
import type { NearestStructureUnit } from '@/lib/learn/catalogue/structure-store';
import type { Territory } from '@/lib/learn/levels/territory';

vi.mock('server-only', () => ({}));

const { withTerritoryStore } = await import('./territory-run');
const { findStoredUnits, storedUnitQueries } = await import('./stored-sources-run');
type StoredUnitsFound = import('./stored-sources-run').StoredUnitsFound;

/**
 * The store part of a territory tick (plan #2247.10): the stored weeks join
 * the territory's sources, and a first tick with too little stored pulls what
 * the goal's kind calls for, once.
 */

const unit = (itemId: string, institution: string, ordinal: number): NearestStructureUnit => ({
  segmentId: `${itemId}-${ordinal}`,
  itemId,
  ordinal,
  label: `Week ${ordinal + 1}`,
  heading: `Heading ${ordinal}`,
  topics: [],
  readings: [],
  similarity: 0.7,
  documentTitle: `Course ${itemId}`,
  canonicalUrl: `https://example.org/${itemId}`,
  institution,
  courseCode: `C-${itemId}`,
  term: null,
  licenceMode: 'structure_only',
});

const territory: Territory = {
  key: 'french-influence',
  name: 'French influence on the American Revolution',
  subjectLens: 'French influence',
  performances: ['Explain what Montesquieu gave the framers'],
  roles: [],
  texts: [],
  topics: [],
  kind: 'narrow_question',
};

const given = { sources: [{ id: 'S1', label: 'Pasted', items: ['A line'] }], performances: territory.performances };

const found = (units: NearestStructureUnit[]): StoredUnitsFound => ({
  ok: true,
  matches: units,
  documents: [...new Set(units.map((u) => u.itemId))].map((itemId) => ({ itemId, textbooks: ['Palmer, The Age of the Democratic Revolution'] })),
});

describe('a territory tick reading the store', () => {
  it('adds the stored documents after the given sources and pulls nothing when two are stored', async () => {
    const pull = vi.fn();
    const read = await withTerritoryStore(territory, given, true, {
      find: async () => found([unit('ar', 'Yale', 2), unit('fr', 'MIT', 1)]),
      pull,
      embed: async () => {},
    });
    expect(pull).not.toHaveBeenCalled();
    expect(read.sources.sources.map((s) => s.id)).toEqual(['S1', 'S2', 'S3']);
    expect(read.refs.map((r) => r.sourceId)).toEqual(['S2', 'S3']);
    expect(read.canon).toEqual([{ title: 'Palmer, The Age of the Democratic Revolution', documents: 2 }]);
    expect(read.store.documents.map((d) => d.title)).toEqual(['Course ar', 'Course fr']);
  });

  it('pulls on the first tick when fewer than two documents are stored, then reads again', async () => {
    let calls = 0;
    const embed = vi.fn(async () => {});
    const read = await withTerritoryStore(territory, given, true, {
      find: async () => (calls++ === 0 ? found([unit('ar', 'Yale', 2)]) : found([unit('ar', 'Yale', 2), unit('fr', 'MIT', 1)])),
      pull: async () => ({
        ran: [{ provider: 'primary_sources', ok: true, lines: [{ candidate: 'x', status: 'stored', itemId: 'fr', units: 3, unchanged: false }] }],
        skipped: ['monographs', 'frame'],
      }),
      embed,
    });
    expect(embed).toHaveBeenCalledOnce();
    expect(read.refs).toHaveLength(2);
    expect(read.store.pulled?.skipped).toEqual(['monographs', 'frame']);
  });

  it('never pulls after the first tick', async () => {
    const pull = vi.fn();
    await withTerritoryStore(territory, given, false, { find: async () => found([]), pull, embed: async () => {} });
    expect(pull).not.toHaveBeenCalled();
  });

  it('drafts from the given sources when the store cannot be read', async () => {
    const read = await withTerritoryStore({ ...territory, kind: null }, given, true, {
      find: async () => ({ ok: false, detail: 'no-key: EMBEDDING_API_KEY is not set' }),
      pull: vi.fn(),
      embed: async () => {},
    });
    expect(read.sources).toBe(given);
    expect(read.store.unread).toContain('no-key');
  });
});

describe('searching the store for a goal', () => {
  it('embeds the goal and each performance as queries, and keeps each unit once', async () => {
    const embedded: string[][] = [];
    const result = await findStoredUnits(
      {
        embed: async (texts) => {
          embedded.push(texts);
          return { ok: true, vectors: texts.map((_, i) => [i]) };
        },
        nearest: async (vector) => [unit('ar', 'Yale', vector[0]), unit('ar', 'Yale', 0)],
        textbooks: async (ids) => ids.map((itemId) => ({ itemId, textbooks: [] })),
      },
      { name: 'French influence', about: 'on the framers' },
      ['Explain Montesquieu'],
    );
    expect(embedded).toEqual([['French influence. on the framers', 'Explain Montesquieu']]);
    expect(result.ok && result.matches.map((m) => m.ordinal).sort()).toEqual([0, 1]);
    expect(result.ok && result.documents).toEqual([{ itemId: 'ar', textbooks: [] }]);
    expect(storedUnitQueries({ name: ' X ' }, [' ', 'Y'])).toEqual(['X', 'Y']);
  });

  it('says why when the embedding fails', async () => {
    const result = await findStoredUnits(
      { embed: async () => ({ ok: false, detail: 'rate-limited' }), nearest: vi.fn(), textbooks: vi.fn() },
      { name: 'Goal' },
      [],
    );
    expect(result).toEqual({ ok: false, detail: 'rate-limited' });
  });
});
