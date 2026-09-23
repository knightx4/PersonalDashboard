import { describe, expect, it } from 'vitest';
import { buildAreaGrid } from './grid';
import {
  destinationsFor,
  openedPlace,
  parseTarget,
  placementUpdate,
  runnerUpOf,
  sortPlacedThemes,
  targetValue,
  type PlacedTheme,
} from './move';

const SOC = '11111111-1111-4111-8111-111111111111';
const ECON = '22222222-2222-4222-8222-222222222222';
const PSYCH = '33333333-3333-4333-8333-333333333333';

const grid = buildAreaGrid({
  domains: [{ id: SOC, slug: 'social-sciences', name: 'Social sciences', position: 1 }],
  fields: [
    { id: ECON, domainId: SOC, name: 'Economics', slug: 'economics', position: 1 },
    { id: PSYCH, domainId: SOC, name: 'Psychology', slug: 'psychology', position: 2 },
  ],
  themes: [],
  tracks: [],
});

function placed(name: string, strength: number, extra: Partial<PlacedTheme> = {}): PlacedTheme {
  return {
    placementId: name,
    name,
    strength,
    basis: 'Because.',
    runnerUpId: null,
    movedByHand: false,
    target: { fieldId: ECON, domainId: null },
    ...extra,
  };
}

describe('a destination value', () => {
  it('round-trips a field, a domain and off the grid', () => {
    for (const target of [
      { fieldId: ECON, domainId: null },
      { fieldId: null, domainId: SOC },
      { fieldId: null, domainId: null },
    ]) {
      expect(parseTarget(targetValue(target))).toEqual(target);
    }
  });

  it('refuses anything the form would not have sent', () => {
    expect(parseTarget('field:economics')).toBeNull();
    expect(parseTarget(`topic:${ECON}`)).toBeNull();
    expect(parseTarget(`field:${ECON}:extra`)).toBeNull();
    expect(parseTarget('')).toBeNull();
  });
});

describe('a move', () => {
  it('writes one of field and domain, never both, and says who moved it', () => {
    expect(placementUpdate({ fieldId: null, domainId: SOC }, true)).toEqual({
      field_id: null,
      domain_id: SOC,
      moved_by_hand: true,
    });
    // The undo puts the pass's own flag back.
    expect(placementUpdate({ fieldId: ECON, domainId: null }, false).moved_by_hand).toBe(false);
  });
});

describe('the destinations', () => {
  it('offers each domain as a whole before its fields, in the grid order', () => {
    expect(destinationsFor(grid)).toEqual([
      {
        label: 'Social sciences',
        options: [
          { value: `domain:${SOC}`, label: 'All of Social sciences' },
          { value: `field:${ECON}`, label: 'Economics' },
          { value: `field:${PSYCH}`, label: 'Psychology' },
        ],
      },
    ]);
  });
});

describe('the opened place', () => {
  it('reads a field, a domain or the unplaced list from the URL', () => {
    expect(openedPlace({ field: 'psychology' }, grid)).toMatchObject({
      kind: 'field',
      name: 'Psychology',
      domainName: 'Social sciences',
      target: { fieldId: PSYCH, domainId: null },
    });
    expect(openedPlace({ domain: 'social-sciences' }, grid)).toMatchObject({
      kind: 'domain',
      target: { fieldId: null, domainId: SOC },
    });
    expect(openedPlace({ unplaced: '1' }, grid)).toEqual({
      kind: 'unplaced',
      target: { fieldId: null, domainId: null },
    });
  });

  it('opens nothing for a slug the grid does not have', () => {
    expect(openedPlace({ field: 'alchemy' }, grid)).toBeNull();
    expect(openedPlace({ domain: 'alchemy' }, grid)).toBeNull();
    expect(openedPlace({}, grid)).toBeNull();
  });
});

describe('the themes in a place', () => {
  it('lists the strongest first, then by name', () => {
    const sorted = sortPlacedThemes([placed('b', 1), placed('c', 5), placed('a', 1)]);
    expect(sorted.map((theme) => theme.name)).toEqual(['c', 'a', 'b']);
  });

  it('names the runner-up unless the theme now sits in it', () => {
    expect(runnerUpOf(placed('t', 1, { runnerUpId: PSYCH }), grid)).toBe('Psychology');
    expect(runnerUpOf(placed('t', 1), grid)).toBeNull();
    expect(
      runnerUpOf(
        placed('t', 1, { runnerUpId: PSYCH, target: { fieldId: PSYCH, domainId: null } }),
        grid,
      ),
    ).toBeNull();
  });
});
