import { describe, expect, it } from 'vitest';
import type { EvidenceLink } from '@/lib/learn/evidence/model';
import type { IdeaMapView, IdeaOnMap } from './load';
import { ALL_LAYERS, layerOf, layeredView } from './layers';

const link = (id: string, kind: EvidenceLink['kind']): EvidenceLink => ({
  id,
  targetKind: 'idea',
  targetId: 'i',
  sourceKind: kind === 'course' ? 'course' : 'note',
  sourceId: id,
  similarity: 0.8,
  kind,
  ceiling: kind === 'course' ? 1 : 0.5,
  basis: id,
  foundAt: '2026-10-01T00:00:00Z',
});

const idea = (over: Partial<IdeaOnMap>): IdeaOnMap =>
  ({
    id: 'i',
    state: 'known',
    stateRow: { state: 'known', established: 'tested', tested_at: '2026-10-10T00:00:00Z', declared_at: null, review_interval_days: null },
    strength: 0.8,
    haze: 0,
    exposure: 0,
    evidence: [],
    ...over,
  }) as IdeaOnMap;

const view = (ideas: IdeaOnMap[]): IdeaMapView =>
  ({
    asOf: '2026-10-13T12:00:00Z',
    ideas,
    dust: [{ noteId: 'n', conceptId: 'i', similarity: 0.5 }],
    territories: [
      {
        id: 'g',
        name: 'G',
        links: [],
        topics: [{ id: 't', tested: 3, held: 4, missed: [2] }],
        standing: [{ topicId: 't' }],
      },
    ],
  }) as unknown as IdeaMapView;

const untested = { stateRow: null, state: 'unknown' as const, strength: 0, exposure: 0.9 };

describe('layerOf', () => {
  it('puts courses, work and video with courses and the rest with writing', () => {
    expect((['course', 'work', 'video'] as const).map(layerOf)).toEqual(['courses', 'courses', 'courses']);
    expect((['note', 'clipping', 'argued'] as const).map(layerOf)).toEqual(['writing', 'writing', 'writing']);
  });
});

describe('layeredView', () => {
  it('is the same view with every layer on', () => {
    const v = view([idea({})]);
    expect(layeredView(v, ALL_LAYERS)).toBe(v);
  });

  it('with answers off, leaves no brightness, haze, state or level held', () => {
    const out = layeredView(view([idea({ haze: 0.2 })]), { ...ALL_LAYERS, answers: false });
    expect(out.ideas[0]).toMatchObject({ strength: 0, haze: 0, state: 'unknown', stateRow: null });
    expect(out.territories![0]!.topics[0]).toMatchObject({ tested: 0, held: 0, missed: [] });
    expect(out.territories![0]!.standing).toEqual([]);
  });

  it('with courses off, drops their links and the ring only they gave', () => {
    const out = layeredView(view([idea({ ...untested, evidence: [link('c', 'course')] })]), { ...ALL_LAYERS, courses: false });
    expect(out.ideas[0]!.evidence).toEqual([]);
    expect(out.ideas[0]!.exposure).toBe(0);
  });

  it('with courses off, keeps the ring your writing gives and its links', () => {
    const out = layeredView(view([idea({ ...untested, evidence: [link('c', 'course'), link('n', 'note')] })]), {
      ...ALL_LAYERS,
      courses: false,
    });
    expect(out.ideas[0]!.evidence.map((l) => l.id)).toEqual(['n']);
    expect(out.ideas[0]!.exposure).toBeGreaterThan(0);
  });

  it('with writing off, takes the dust of your notes off the sky', () => {
    expect(layeredView(view([idea({})]), { ...ALL_LAYERS, writing: false }).dust).toEqual([]);
  });
});
