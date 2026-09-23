import { describe, expect, it } from 'vitest';
import type { Concept, Graph } from '@/lib/learn/graph/model';
import {
  buildAreaGrid,
  interestLine,
  kindLabel,
  kindOf,
  shadeFor,
  testedLine,
  trackTested,
  type GridTheme,
  type GridTrack,
} from './grid';

const DOMAINS = [
  { id: 'd-phys', slug: 'physical-sciences', name: 'Physical sciences', position: 2 },
  { id: 'd-soc', slug: 'social-sciences', name: 'Social sciences', position: 1 },
];
const FIELDS = [
  { id: 'f-econ', domainId: 'd-soc', name: 'Economics', slug: 'economics', position: 1 },
  { id: 'f-psych', domainId: 'd-soc', name: 'Psychology', slug: 'psychology', position: 2 },
  { id: 'f-law', domainId: 'd-soc', name: 'Law', slug: 'law', position: 3 },
  { id: 'f-physics', domainId: 'd-phys', name: 'Physics', slug: 'physics', position: 1 },
  { id: 'f-earth', domainId: 'd-phys', name: 'Earth sciences', slug: 'earth', position: 2 },
];

const theme = (name: string, strength: number, at: Partial<GridTheme> = {}): GridTheme => ({
  name,
  strength,
  lastSeen: null,
  fieldId: null,
  domainId: null,
  ...at,
});

const track = (name: string, at: Partial<GridTrack> = {}): GridTrack => ({
  name,
  known: 0,
  total: 0,
  answered: 0,
  lastAnswered: null,
  fieldId: null,
  domainId: null,
  ...at,
});

function grid(themes: GridTheme[], tracks: GridTrack[] = []) {
  return buildAreaGrid({ domains: DOMAINS, fields: FIELDS, themes, tracks });
}

const cell = (g: ReturnType<typeof grid>, id: string) =>
  g.domains.flatMap((domain) => domain.fields).find((field) => field.id === id)!;

describe('building the areas grid', () => {
  it('lays out every domain in order with its fields in order', () => {
    const g = grid([]);
    expect(g.domains.map((domain) => domain.name)).toEqual([
      'Social sciences',
      'Physical sciences',
    ]);
    expect(g.domains[0].fields.map((field) => field.name)).toEqual([
      'Economics',
      'Psychology',
      'Law',
    ]);
    expect(
      g.domains.every((domain) => domain.fields.every((field) => field.kind === 'neither')),
    ).toBe(true);
  });

  it('sums interest per field and names the two strongest themes', () => {
    const g = grid([
      theme('Money', 3, { fieldId: 'f-econ', lastSeen: '2026-09-01T00:00:00Z' }),
      theme('Markets', 5, { fieldId: 'f-econ', lastSeen: '2026-09-20T00:00:00Z' }),
      theme('Trade', 1, { fieldId: 'f-econ' }),
    ]);
    const econ = cell(g, 'f-econ');
    expect(econ.interest).toEqual({
      themes: 3,
      strength: 9,
      lastWritten: '2026-09-20T00:00:00Z',
      strongest: ['Markets', 'Money'],
    });
    expect(econ.shade).toBe(3);
    expect(econ.kind).toBe('untested');
  });

  it('shows a domain-level placement on the domain row and in no cell', () => {
    const g = grid(
      [theme('Society', 4, { domainId: 'd-soc' }), theme('Markets', 2, { fieldId: 'f-econ' })],
      [track('Social theory', { domainId: 'd-soc', known: 1, total: 2, answered: 1 })],
    );
    const soc = g.domains[0];
    expect(soc.own.interest.themes).toBe(1);
    expect(soc.own.tested.tracks).toEqual(['Social theory']);
    expect(soc.fields.reduce((sum, field) => sum + field.interest.themes, 0)).toBe(1);
    expect(soc.total.interest.themes).toBe(2);
    expect(soc.total.tested).toMatchObject({ known: 1, total: 2 });
  });

  it('counts unplaced themes and tracks and draws them nowhere', () => {
    const g = buildAreaGrid({
      domains: DOMAINS,
      fields: FIELDS,
      themes: [theme('A trip', 9)],
      tracks: [track('Science at large')],
      unplacedTracks: 1,
    });
    expect(g.unplacedThemes).toBe(1);
    expect(g.unplacedTracks).toBe(2);
    expect(g.domains.every((domain) => domain.total.interest.themes === 0)).toBe(true);
  });

  it('keeps interest and tested apart in the cell', () => {
    const g = grid(
      [theme('Heat', 10, { fieldId: 'f-physics' })],
      [
        track('Thermodynamics', {
          fieldId: 'f-physics',
          known: 14,
          total: 20,
          answered: 16,
          lastAnswered: '2026-03-03T10:00:00Z',
        }),
      ],
    );
    const physics = cell(g, 'f-physics');
    expect(physics.interest.themes).toBe(1);
    expect(physics.tested).toEqual({
      tracks: ['Thermodynamics'],
      known: 14,
      total: 20,
      answered: 16,
      lastAnswered: '2026-03-03T10:00:00Z',
    });
    expect(physics.kind).toBe('strong');
  });
});

describe('the four kinds', () => {
  const tested = (known: number, total: number, answered: number, tracks = ['T']) => ({
    tracks,
    known,
    total,
    answered,
    lastAnswered: null,
  });

  it('needs an answered question before it calls a field strong or getting there', () => {
    expect(kindOf(0, tested(10, 20, 3))).toBe('strong');
    expect(kindOf(3, tested(2, 20, 5))).toBe('getting-there');
    expect(kindOf(0, tested(0, 19, 0))).toBe('untested');
  });

  it('calls a field written about only once it is a tenth of the strongest', () => {
    expect(shadeFor(0, 100)).toBe(0);
    expect(shadeFor(9, 100)).toBe(1);
    expect(shadeFor(10, 100)).toBe(2);
    expect(shadeFor(40, 100)).toBe(3);
    expect(kindOf(1, tested(0, 0, 0, []))).toBe('neither');
    expect(kindOf(2, tested(0, 0, 0, []))).toBe('untested');
  });

  it('names an untested field by why it is untested', () => {
    expect(kindLabel({ kind: 'untested', shade: 3 })).toBe('Written about, not tested');
    expect(kindLabel({ kind: 'untested', shade: 1 })).toBe('Not tested yet');
    expect(kindLabel({ kind: 'neither', shade: 0 })).toBeNull();
  });
});

describe('the lines a cell says', () => {
  const day = (at: string | null) => (at ? '3 March' : null);

  it('gives every count its size and its date, never a share', () => {
    expect(
      testedLine({ tracks: ['T'], known: 14, total: 20, answered: 18, lastAnswered: 'x' }, day),
    ).toBe('14 of 20 ideas known, last answered 3 March');
    expect(
      testedLine({ tracks: ['T'], known: 0, total: 19, answered: 0, lastAnswered: null }, day),
    ).toBe('0 of 19 ideas known, nothing answered yet');
    expect(
      testedLine({ tracks: [], known: 0, total: 0, answered: 0, lastAnswered: null }, day),
    ).toBe('No track here');
    expect(interestLine({ themes: 1, strength: 2, lastWritten: 'x', strongest: [] }, day)).toBe(
      '1 theme, last written 3 March',
    );
    expect(interestLine({ themes: 4, strength: 2, lastWritten: null, strongest: [] }, day)).toBe(
      '4 themes',
    );
  });
});

describe('what a track has shown', () => {
  const concept = (state: Concept['state'], testedAt: string | null) =>
    ({ id: Math.random().toString(), state, testedAt }) as unknown as Concept;

  it('counts known the way the tracks list does and dates the last answer', () => {
    const graph = {
      concepts: [
        concept('known', '2026-03-01T00:00:00Z'),
        concept('sharp', '2026-03-03T00:00:00Z'),
        concept('shaky', null),
        concept('unknown', null),
      ],
      edges: [],
      mentions: [],
    } as unknown as Graph;
    expect(trackTested(graph)).toEqual({
      known: 2,
      total: 4,
      answered: 2,
      lastAnswered: '2026-03-03T00:00:00Z',
    });
  });
});
