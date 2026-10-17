import { describe, expect, it } from 'vitest';
import type { TopicMap } from '@/lib/learn/levels/model';
import { cellsUnder } from '@/lib/learn/levels/model';
import {
  chosenPerformance,
  dayBefore,
  fadingIdeas,
  parseDay,
  performances,
  readingsOn,
  thenAndNow,
  type GoalLevels,
} from './panels';
import { DEFAULT_PARAMS, mapHref, parseMapParams } from './view';

const AS_OF = new Date('2026-10-16T12:00:00Z');
const days = (n: number) => new Date(AS_OF.getTime() - n * 86_400_000).toISOString();

describe('fadingIdeas', () => {
  const row = (state: 'known' | 'unknown', testedDaysAgo: number | null, declared = false) => ({
    state,
    established: declared ? ('declared' as const) : ('tested' as const),
    tested_at: !declared && testedDaysAgo !== null ? days(testedDaysAgo) : null,
    declared_at: declared && testedDaysAgo !== null ? days(testedDaysAgo) : null,
    review_interval_days: null,
  });

  it('lists what fades, soonest to halve first, and leaves out what does not fade', () => {
    const list = fadingIdeas(
      [
        { id: 'a', name: 'Recent', stateRow: row('known', 2), track: { id: 't1' } },
        { id: 'b', name: 'Nearly halved', stateRow: row('known', 28), track: null },
        { id: 'c', name: 'Unknown', stateRow: row('unknown', 5), track: null },
        { id: 'd', name: 'Never seen', stateRow: null, track: null },
        { id: 'e', name: 'Said', stateRow: row('known', 40, true), track: null },
      ],
      AS_OF,
    );
    expect(list.map((i) => i.id)).toEqual(['b', 'e', 'a']);
    expect(list[0]!.inDays).toBe(2);
    expect(list[1]!.established).toBe('declared');
    expect(list[2]!.trackId).toBe('t1');
  });

  it('keeps to the ideas of a chosen goal', () => {
    const ideas = [
      { id: 'a', name: 'A', stateRow: row('known', 2), track: null },
      { id: 'b', name: 'B', stateRow: row('known', 3), track: null },
    ];
    expect(fadingIdeas(ideas, AS_OF, new Set(['b'])).map((i) => i.id)).toEqual(['b']);
  });
});

/** Two topics: B's level 2 needs A at level 2. */
function twoTopics(evidence: TopicMap['evidence'] = [], approved = true): GoalLevels {
  const cells = ['a', 'b'].flatMap((t) => [1, 2, 3, 4].map((level) => ({ id: `${t}${level}`, topicId: t, level })));
  return {
    map: {
      topics: [
        { id: 'a', name: 'Alpha', ceiling: 4, approved },
        { id: 'b', name: 'Beta', ceiling: 4, approved },
      ],
      cells,
      links: [{ requiringCellId: 'b2', requiredCellId: 'a2' }],
      evidence,
    },
    lenses: [
      {
        id: 'goal',
        name: 'Goal',
        targets: [
          { topicId: 'a', targetLevel: 2 },
          { topicId: 'b', targetLevel: 3 },
        ],
      },
    ],
  };
}

describe('cellsUnder', () => {
  it('holds the cell, the levels below it and what they require', () => {
    const { map } = twoTopics();
    expect([...cellsUnder(map, 'b3')].sort()).toEqual(['a1', 'a2', 'b1', 'b2', 'b3']);
    expect(cellsUnder(map, 'nope').size).toBe(0);
  });
});

describe('performances', () => {
  it('lists each target not held with its open rungs, the nearest first', () => {
    const levels = twoTopics([{ cellId: 'a1', verdict: 'met', observedAt: days(3) }]);
    const list = performances(levels, readingsOn(levels.map, AS_OF), 'goal');
    expect(list.map((p) => [p.topicId, p.rungs.map((r) => r.cellId)])).toEqual([
      ['a', ['a2']],
      ['b', ['b1', 'b2', 'b3', 'a2']],
    ]);
    // a2 needs only a1, which is held; b1 needs nothing.
    expect(list[0]!.rungs[0]!.ready).toBe(true);
    expect(list[1]!.rungs.find((r) => r.cellId === 'b1')!.ready).toBe(true);
    expect(list[1]!.rungs.find((r) => r.cellId === 'b2')!.ready).toBe(false);
    expect(list[0]!.can).toMatch(/^define it/);
  });

  it('leaves out a target held and marks a miss', () => {
    const levels = twoTopics([
      { cellId: 'a2', verdict: 'met', observedAt: days(3) },
      { cellId: 'b1', verdict: 'not_met', observedAt: days(2) },
    ]);
    const list = performances(levels, readingsOn(levels.map, AS_OF), 'goal');
    expect(list.map((p) => p.topicId)).toEqual(['b']);
    expect(list[0]!.rungs[0]).toMatchObject({ cellId: 'b1', status: 'missed', ready: true });
  });

  it('on drafts, every level is open and none is ready', () => {
    const levels = twoTopics([], false);
    const list = performances(levels, readingsOn(levels.map, AS_OF), 'goal');
    expect(list.every((p) => !p.approved && p.rungs.every((r) => !r.ready))).toBe(true);
  });

  it('shows the topic open in the address, else the nearest', () => {
    const levels = twoTopics();
    const list = performances(levels, readingsOn(levels.map, AS_OF), 'goal');
    expect(chosenPerformance(list, 'b')!.topicId).toBe('b');
    expect(chosenPerformance(list, 'missing')!.topicId).toBe('a');
    expect(chosenPerformance([], null)).toBeNull();
    expect(performances(levels, readingsOn(levels.map, AS_OF), 'other')).toEqual([]);
  });
});

describe('thenAndNow', () => {
  it('reads the goal as it stood on the earlier day from the evidence up to it', () => {
    const levels = twoTopics([
      { cellId: 'a1', verdict: 'met', observedAt: days(40) },
      { cellId: 'a2', verdict: 'met', observedAt: days(5) },
      { cellId: 'b3', verdict: 'declared', observedAt: days(2) },
    ]);
    const view = thenAndNow(levels, 'goal', parseDay(dayBefore(AS_OF, 28))!, AS_OF)!;
    expect(view.rows.map((r) => [r.topicId, r.then, r.now])).toEqual([
      ['b', 0, 3],
      ['a', 1, 2],
    ]);
    expect(view.heldThen).toBe(1);
    // a1, a2 and b1 to b3.
    expect(view.heldNow).toBe(5);
    expect(view.total).toBe(5);
  });

  it('is null for a goal not on the page', () => {
    expect(thenAndNow(twoTopics(), 'other', AS_OF, AS_OF)).toBeNull();
  });
});

describe('parseDay', () => {
  it('reads a day as its end, and refuses anything else', () => {
    expect(parseDay('2026-09-18')!.toISOString()).toBe('2026-09-18T23:59:59.999Z');
    expect(parseDay('18 Sep')).toBeNull();
    expect(parseDay(null)).toBeNull();
  });
});

describe('the panel in the address', () => {
  it('opens on fade and keeps the tab and day it was given', () => {
    expect(parseMapParams({}).panel).toBe('fade');
    expect(parseMapParams({ panel: 'nope' }).panel).toBe('fade');
    const params = parseMapParams({ panel: 'then', then: '2026-09-18', goal: 'g' });
    expect(params).toMatchObject({ panel: 'then', then: '2026-09-18' });
    expect(parseMapParams({ then: 'soon' }).then).toBeNull();
    expect(mapHref(params)).toBe('/learn/space?goal=g&panel=then&then=2026-09-18');
    expect(mapHref(DEFAULT_PARAMS, { panel: 'fade' })).toBe('/learn/space');
  });
});
