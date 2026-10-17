import { describe, expect, it } from 'vitest';
import type { IdeaMapView } from './load';
import { PRIVATE_IDEA, PRIVATE_PLACE, redactView, viewFor } from './recording';
import { brightestStop, nextDoorStop, tourScript } from './tour';

type Idea = IdeaMapView['ideas'][number];

/** Places A, B and C of three ideas each, in a line; B is the best known. */
function fixture() {
  const strengths: Record<string, number[]> = {
    A: [0.2, 0.2, 0.2],
    B: [0.9, 0.8, 0.7],
    C: [0.1, 0, 0],
  };
  const ids = Object.entries(strengths).flatMap(([place, list]) =>
    list.map((s, i) => ({ place, s, id: `${place}${i}` })),
  );
  const ideas = ids.map(({ place, s, id }, i) => ({
    id,
    name: `Secret ${id}`,
    claim: `Claim ${id}`,
    placeId: place,
    strength: s,
    track: { id: 't', name: 'Track' },
    field: { id: 'f', name: 'Field' },
    domain: { id: 'd', name: 'Domain' },
    neighbours: ids
      .map((other, j) => ({ id: other.id, d: Math.abs(i - j) }))
      .filter((n) => n.id !== id)
      .sort((x, y) => x.d - y.d || x.id.localeCompare(y.id))
      .slice(0, 6)
      .map((n) => ({ id: n.id, similarity: 0.95 - n.d * 0.05 })),
  })) as unknown as Idea[];
  const places = ['A', 'B', 'C'].map((id) => ({
    id,
    name: `Place ${id}`,
    ideaCount: 3,
  })) as IdeaMapView['places'];
  return { ideas, places };
}

describe('the tour', () => {
  it('flies into the place with the highest mean strength and hops to the neighbour with most links', () => {
    const view = fixture();
    expect(brightestStop(view)).toEqual({ kind: 'place', id: 'B' });
    const next = nextDoorStop(view, { kind: 'place', id: 'B' });
    expect(next?.kind).toBe('place');
    expect(['A', 'C']).toContain(next?.id);
  });

  it('is the same on every run', () => {
    expect(tourScript(fixture())).toEqual(tourScript(fixture()));
  });

  it('breaks a tie by the larger place, then the smaller id', () => {
    const view = fixture();
    for (const idea of view.ideas) idea.strength = 0.5;
    expect(brightestStop(view)).toEqual({ kind: 'place', id: 'A' });
  });

  it('opens the strongest idea’s neighbourhood when no place is named', () => {
    const { ideas } = fixture();
    expect(brightestStop({ ideas, places: [] })).toEqual({ kind: 'around', id: 'B0' });
  });

  it('has no stops on an empty map', () => {
    expect(tourScript({ ideas: [], places: [] })).toEqual({ stops: [] });
  });
});

describe('recording mode', () => {
  it('renames the hidden places and the ideas in them, and nothing else', () => {
    const { ideas, places } = fixture();
    const view = redactView({ ideas, places } as IdeaMapView, new Set(['B']));
    expect(view.places.map((p) => p.name)).toEqual(['Place A', PRIVATE_PLACE, 'Place C']);
    const hidden = view.ideas.filter((i) => i.placeId === 'B');
    expect(hidden.every((i) => i.name === PRIVATE_IDEA && i.claim === '' && i.track === null)).toBe(
      true,
    );
    expect(
      view.ideas.filter((i) => i.placeId !== 'B').every((i) => i.name.startsWith('Secret')),
    ).toBe(true);
  });

  it('renames a hidden subject in its territory and the subjects card too (plan #2317.2)', () => {
    const { ideas, places } = fixture();
    const hiddenStar = ideas.find((i) => i.placeId === 'B')!.id;
    const territory = (id: string) => ({
      id,
      name: `Subject ${id}`,
      topics: [{ id: id === 'B' ? hiddenStar : 'X', name: 'Secret topic' }],
      links: [],
      standing: [{ topicId: id === 'B' ? hiddenStar : 'X', quote: 'My words', via: null }],
    });
    const goal = (id: string) => ({ id, name: `Subject ${id}`, goalNames: ['A goal'], next: 'Next', stars: [{ topicId: 'X', name: 'Secret topic' }] });
    const view = redactView(
      { ideas, places, territories: [territory('A'), territory('B')], goals: [goal('A'), goal('B')] } as unknown as IdeaMapView,
      new Set(['B']),
    );
    const [open, closed] = view.territories!;
    expect(open!.name).toBe('Subject A');
    expect(open!.standing![0]!.quote).toBe('My words');
    expect(closed!.name).toBe(PRIVATE_PLACE);
    expect(closed!.topics[0]!.name).toBe(PRIVATE_IDEA);
    expect(closed!.standing![0]!.quote).toBeNull();
    expect(view.goals!.map((g) => g.name)).toEqual(['Subject A', PRIVATE_PLACE]);
    expect(view.goals![1]!.goalNames).toEqual([]);
    expect(redactView({ ideas, places, goals: null } as unknown as IdeaMapView, new Set(['B'])).goals).toBeNull();
  });

  it('shows everything while it is off', () => {
    const base = { ideas: fixture().ideas, places: fixture().places } as IdeaMapView;
    expect(viewFor(base, { on: false, hidden: ['B'] })).toBe(base);
    expect(viewFor(base, { on: true, hidden: [] })).toBe(base);
    expect(viewFor(base, { on: true, hidden: ['B'] }).places[1]!.name).toBe(PRIVATE_PLACE);
  });
});
