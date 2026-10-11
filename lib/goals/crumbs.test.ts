import { describe, expect, it } from 'vitest';
import { allGoalsCrumbs, areaCrumbs, goalCrumbs, stepCrumbs } from './crumbs';

const goal = { id: 'g1', title: "Sam's birthday", areaId: 'a1' };

type Node = { id: string; parentId: string; title: string; children: Node[] };
const node = (id: string, parentId: string, title: string, children: Node[] = []): Node => ({
  id,
  parentId,
  title,
  children,
});

const steps = [
  node('party', 'g1', 'Plan the party', [
    node('food', 'party', 'Sort the food', [node('cake', 'food', 'Buy a cake')]),
  ]),
  node('gift', 'g1', 'Get a present'),
];

describe('goal paths', () => {
  it('starts every path at Goals', () => {
    expect(allGoalsCrumbs()).toEqual([
      { label: 'Goals', href: '/goals' },
      { label: 'All goals', href: '/goals/all' },
    ]);
    expect(areaCrumbs({ id: 'a1', name: 'Family' })).toEqual([
      { label: 'Goals', href: '/goals' },
      { label: 'Family', href: '/goals/area/a1' },
    ]);
  });

  it('opens the area of a finished goal on a view that lists it', () => {
    expect(goalCrumbs(goal, 'Family').map((crumb) => crumb.href)).toEqual([
      '/goals',
      '/goals/area/a1',
      '/goals/g1',
    ]);
    expect(goalCrumbs(goal, 'Family', { open: false })[1].href).toBe('/goals/area/a1?view=all');
  });

  it('walks up through every step a sub-step sits under', () => {
    expect(stepCrumbs(goal, 'Family', steps, 'cake')).toEqual([
      { label: 'Goals', href: '/goals' },
      { label: 'Family', href: '/goals/area/a1' },
      { label: "Sam's birthday", href: '/goals/g1' },
      { label: 'Plan the party', href: '/goals/g1/s/party' },
      { label: 'Sort the food', href: '/goals/g1/s/food' },
      { label: 'Buy a cake', href: '/goals/g1/s/cake' },
    ]);
    expect(stepCrumbs(goal, 'Family', steps, 'gift')!.map((crumb) => crumb.label)).toEqual([
      'Goals',
      'Family',
      "Sam's birthday",
      'Get a present',
    ]);
  });

  it('has no path for a step the goal does not hold', () => {
    expect(stepCrumbs(goal, 'Family', steps, 'nope')).toBeNull();
  });
});
