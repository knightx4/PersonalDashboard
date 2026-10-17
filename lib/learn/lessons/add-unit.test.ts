import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/learn/graph/curriculum', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/learn/graph/curriculum')>()),
  writeNextUnit: vi.fn(),
}));
vi.mock('@/lib/learn/graph/load', () => ({ loadGraph: vi.fn(async () => ({ concepts: [], edges: [], mentions: [] })) }));
vi.mock('@/lib/learn/prepare/store', () => ({ loadSubjectTerritory: vi.fn(), loadDraftedNames: vi.fn() }));
vi.mock('@/lib/core/spend/record', () => ({ recordSpend: vi.fn() }));

import type { SpendClient } from '@/lib/core/spend/record';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { nextUnitPrompt, outlinePrompt, writeNextUnit } from '@/lib/learn/graph/curriculum';
import type { Concept, Graph, KnowledgeState } from '@/lib/learn/graph/model';
import type { Territory } from '@/lib/learn/levels/territory';
import { loadDraftedNames, loadSubjectTerritory } from '@/lib/learn/prepare/store';
import { addNextUnit, shownInTrack } from './add-unit';

/**
 * Writing a track's next unit (plan #969): what the person has shown is read
 * off the graph, and the call is given it beside the units so far.
 */

function graphOf(states: Record<string, KnowledgeState>): Graph {
  return {
    concepts: Object.entries(states).map(([name, state]) => ({ id: name, name, state }) as unknown as Concept),
    edges: [],
    mentions: [],
  };
}

describe('what the person has shown in a track', () => {
  it('counts known and sharp as known, and shaky as kept to work on', () => {
    expect(
      shownInTrack(graphOf({ Supply: 'known', Demand: 'sharp', Elasticity: 'shaky', Tax: 'unknown', Rent: 'misconception' })),
    ).toEqual({ known: ['Demand', 'Supply'], workingOn: ['Elasticity'] });
  });
});

describe('the next unit prompt', () => {
  it('names the units so far in order, and each list of ideas', () => {
    const prompt = nextUnitPrompt({
      subject: 'Economics',
      units: [
        { title: 'Supply and demand', covers: 'Curves.', outcome: 'Read a market.' },
        { title: 'Elasticity', covers: '', outcome: '' },
      ],
      known: ['Supply'],
      workingOn: [],
      tooHard: ['Tax incidence'],
    });
    expect(prompt).toContain('1. Supply and demand. Covers: Curves. Outcome: Read a market.');
    expect(prompt).toContain('2. Elasticity\n');
    expect(prompt).toContain('Ideas they know:\n- Supply');
    expect(prompt).toContain('Ideas they asked to keep working on: none yet.');
    expect(prompt).toContain('Lessons they rated too hard:\n- Tax incidence');
  });

  it('says when the track has no units yet, and cuts a long list', () => {
    const prompt = nextUnitPrompt({
      subject: 'Economics',
      units: [],
      known: Array.from({ length: 45 }, (_, i) => `Idea ${i}`),
      workingOn: [],
      tooHard: [],
    });
    expect(prompt).toContain('The track has no units yet, so this is its first.');
    expect(prompt).toContain('- and 5 more');
    expect(prompt).not.toContain('Idea 44');
  });
});

describe("the whole outline prompt (plan #1139)", () => {
  it('asks a new track for the whole course within the depth', () => {
    const prompt = outlinePrompt({ subject: 'SaaS metrics', asked: 'ARR and churn', bounds: { min: 8, max: 12 }, units: [] });
    expect(prompt).toContain('between 8 and 12 units');
    expect(prompt).toContain('The track has no units yet.');
  });

  it('asks a track with units only for those after them, counting them in', () => {
    const prompt = outlinePrompt({
      subject: 'SaaS metrics',
      asked: null,
      bounds: { min: 8, max: 12 },
      units: [
        { title: 'ARR', covers: 'Recurring revenue.', outcome: 'Compute ARR.' },
        { title: 'Churn', covers: 'Losses.', outcome: 'Compute churn.' },
      ],
    });
    expect(prompt).toContain('counting the 2 it already has, so write between 6 and 10 more');
    expect(prompt).toContain('1. ARR. Covers: Recurring revenue. Outcome: Compute ARR.');
    expect(prompt).toContain('Write only the units after these.');
  });
});

describe('a later unit on a prepared subject (plan #2307.5)', () => {
  const territory: Territory = {
    key: 'econ',
    name: 'Economics',
    subjectLens: 'Economics',
    performances: [],
    roles: [],
    texts: [{ key: 'mit', label: 'MIT 14.01', items: ['Week 1: markets', 'Week 4: elasticity', 'Week 5: taxes'] }],
    topics: [
      { ask: 'Supply and demand', scope: 'Curves.', frame: 'Economics', target: 4, from: ['mit: Week 1: markets'] },
      { ask: 'Elasticity', scope: 'Responsiveness.', frame: 'Economics', target: 4, from: ['mit: Week 4: elasticity'] },
      { ask: 'Who pays a tax', scope: 'Incidence.', frame: 'Economics', target: 4, from: ['mit: Week 5: taxes'] },
    ],
  };

  /** A learn client whose every query on a table resolves to that table's rows. */
  function learnWith(rows: Record<string, unknown>, inserted: unknown[]): LearnSupabaseClient {
    const query = (table: string): unknown => {
      const result = { data: rows[table] ?? [], error: null };
      const chain: Record<string, unknown> = {
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
        maybeSingle: async () => result,
        single: async () => ({ data: { id: 'new-unit' }, error: null }),
        insert: (row: unknown) => {
          inserted.push(row);
          return chain;
        },
      };
      for (const method of ['select', 'eq', 'order', 'limit', 'in', 'is']) chain[method] = () => chain;
      return chain;
    };
    return { from: query } as unknown as LearnSupabaseClient;
  }

  it('gives the call the territory topics no unit teaches, with their weeks, and cites the weeks it teaches', async () => {
    vi.mocked(loadSubjectTerritory).mockResolvedValue(territory);
    vi.mocked(loadDraftedNames).mockResolvedValue(new Map([['who pays a tax', 'Tax incidence']]));
    vi.mocked(writeNextUnit).mockResolvedValue({
      ok: true,
      unit: { title: 'Elasticity in markets', covers: 'Elasticity and how it shapes prices.', outcome: 'Read an elasticity.' },
    });
    const inserted: unknown[] = [];
    const learn = learnWith(
      {
        subjects: { id: 's1', name: 'Economics' },
        curriculum_units: [{ id: 'u1', ordinal: 1, title: 'Markets', covers: 'Supply and demand.', outcome: 'Read a market.' }],
      },
      inserted,
    );

    const added = await addNextUnit(learn, {} as SpendClient, 'me', 's1', 'u1', 'key');

    const call = vi.mocked(writeNextUnit).mock.calls[0][0];
    expect(call.territory?.topics).toEqual([
      { name: 'Elasticity', scope: 'Responsiveness.', weeks: ['MIT 14.01: Week 4: elasticity'] },
      { name: 'Tax incidence', scope: 'Incidence.', weeks: ['MIT 14.01: Week 5: taxes'] },
    ]);
    expect(nextUnitPrompt(call)).toContain('1. Elasticity: Responsiveness.\n   Taught in: MIT 14.01: Week 4: elasticity');
    expect(added).toEqual({
      outcome: 'added',
      unitId: 'new-unit',
      title: 'Elasticity in markets',
      topics: ['Elasticity'],
      weeks: ['MIT 14.01: Week 4: elasticity'],
    });
    expect(inserted[0]).toMatchObject({
      ordinal: 2,
      covers: 'Elasticity and how it shapes prices. Follows MIT 14.01: Week 4: elasticity.',
    });
  });

  it('writes from the name alone for a subject with no territory', async () => {
    vi.mocked(writeNextUnit).mockClear();
    vi.mocked(loadSubjectTerritory).mockResolvedValue(null);
    vi.mocked(writeNextUnit).mockResolvedValue({ ok: true, unit: { title: 'Next', covers: 'Covers.', outcome: 'Do it.' } });
    const learn = learnWith({ subjects: { id: 's1', name: 'Economics' }, curriculum_units: [] }, []);
    await addNextUnit(learn, {} as SpendClient, 'me', 's1', null, 'key');
    expect(vi.mocked(writeNextUnit).mock.calls[0][0].territory).toBeUndefined();
  });
});

describe('the next unit prompt with a territory', () => {
  it('lists the topics left in order with their weeks and asks for their names in covers', () => {
    const prompt = nextUnitPrompt({
      subject: 'Economics',
      units: [],
      known: [],
      workingOn: [],
      tooHard: [],
      territory: { topics: [{ name: 'Elasticity', scope: 'Responsiveness.', weeks: ['MIT 14.01: Week 4: elasticity'] }] },
    });
    expect(prompt).toContain('These are the topics the units so far do not teach yet');
    expect(prompt).toContain('1. Elasticity: Responsiveness.');
    expect(prompt).toContain('Taught in: MIT 14.01: Week 4: elasticity');
    expect(prompt).toContain('name the topics the unit teaches using their names exactly as listed above');
  });
});
