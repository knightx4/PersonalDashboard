import { describe, expect, it } from 'vitest';
import { readCells, type TopicMap } from '@/lib/learn/levels/model';
import { EVIDENCE_CEILING, strength, type StrengthInput } from '@/lib/learn/strength';
import { LIT_MIN, topicStates, type TopicIdea, type TopicLevels, type TopicLink, type TopicNode } from './topic-state';

const T0 = '2026-01-01T00:00:00Z';
const on = new Date(T0);

const topics: TopicNode[] = [
  { id: 'L3', level: 3, parentId: null },
  { id: 'L3b', level: 3, parentId: null },
  { id: 'a', level: 4, parentId: 'L3' },
  { id: 'b', level: 4, parentId: 'L3' },
  { id: 'c', level: 4, parentId: 'L3' },
];

const tested = (state: StrengthInput['state']): StrengthInput => ({
  state,
  established: 'tested',
  tested_at: T0,
  declared_at: null,
  review_interval_days: null,
});
const idea = (id: string, topicId: string, state: StrengthInput | null): TopicIdea => ({ id, topicId, state });
const link = (extra: Partial<TopicLink> = {}): TopicLink => ({
  kind: 'work',
  ceiling: 1,
  similarity: 0.8,
  foundAt: T0,
  matchedBy: 'similarity',
  ...extra,
});
const run = (ideas: TopicIdea[] = [], links: Record<string, TopicLink[]> = {}) =>
  topicStates(topics, ideas, new Map(Object.entries(links)), on);

describe('topicStates', () => {
  it('hides an untouched Level 4 topic and never hides a Level 3 one', () => {
    const s = run();
    expect(s.get('a')?.state).toBe('hidden');
    expect(s.get('L3')?.state).toBe('unlocked');
    expect(s.get('L3')?.strength).toBe(0);
  });

  it('unlocks a topic with a name-only link too faint to light it', () => {
    const s = run([], { a: [link({ matchedBy: 'name', similarity: 0, kind: 'note', ceiling: 0.5 })] });
    expect(s.get('a')?.state).toBe('unlocked');
    expect(s.get('a')?.strength).toBe(0);
  });

  it('counts a name match at half the similarity', () => {
    const byName = run([], { a: [link({ matchedBy: 'name', similarity: 0.9 })] }).get('a')!;
    const byVector = run([], { a: [link({ matchedBy: 'similarity', similarity: 0.9 })] }).get('a')!;
    expect(byName.strength).toBeCloseTo(0.45 * EVIDENCE_CEILING);
    expect(byVector.strength).toBeCloseTo(0.9 * EVIDENCE_CEILING);
  });

  it('lights a topic from evidence and caps it at recognised however much there is', () => {
    const s = run([], { a: Array.from({ length: 5 }, () => link()) }).get('a')!;
    expect(s.state).toBe('lit');
    expect(s.strength).toBeCloseTo(EVIDENCE_CEILING);
    expect(s.evidenceOnly).toBe(true);
  });

  it('does not let several evidence-backed ideas lift a topic past the cap', () => {
    const ideas = [idea('1', 'a', null), idea('2', 'a', null), idea('3', 'a', null)];
    const s = run(ideas, { a: [link()] }).get('a')!;
    expect(s.state).toBe('lit');
    expect(s.strength).toBeLessThanOrEqual(EVIDENCE_CEILING + 1e-9);
    expect(s.ideaCount).toBe(3);
  });

  it('unlocks a topic that only has an unscored idea under it', () => {
    expect(run([idea('1', 'b', null)]).get('b')?.state).toBe('unlocked');
  });

  it('lights a topic from a known idea beyond the evidence cap', () => {
    const s = run([idea('1', 'a', tested('known'))]).get('a')!;
    expect(s.state).toBe('lit');
    expect(s.strength).toBeCloseTo(strength(tested('known'), on));
    expect(s.strength).toBeGreaterThan(EVIDENCE_CEILING);
    expect(s.evidenceOnly).toBe(false);
  });

  it('adds ideas together without passing 1', () => {
    const s = run([idea('1', 'a', tested('known')), idea('2', 'a', tested('known'))]).get('a')!;
    expect(s.strength).toBeCloseTo(1 - 0.2 * 0.2);
  });

  it('ignores a misconception and an unknown idea', () => {
    const s = run([idea('1', 'a', tested('misconception')), idea('2', 'a', tested('unknown'))]).get('a')!;
    expect(s.state).toBe('unlocked');
  });

  it('fades an idea with the days since it was set', () => {
    const later = topicStates(topics, [idea('1', 'a', tested('sharp'))], new Map(), new Date('2026-03-01T00:00:00Z'));
    expect(later.get('a')!.strength).toBeLessThan(0.5);
  });

  it('rolls Level 4 ideas up into their Level 3 topic', () => {
    const s = run([idea('1', 'a', tested('known')), idea('2', 'b', tested('shaky'))]);
    expect(s.get('L3')!.ideaCount).toBe(2);
    expect(s.get('L3')!.strength).toBeCloseTo(1 - (1 - 0.8) * (1 - 0.35));
    expect(s.get('L3b')!.state).toBe('unlocked');
  });

  it('does not count a link found after the day asked about', () => {
    const s = run([], { a: [link({ foundAt: '2026-02-01T00:00:00Z' })] }).get('a')!;
    expect(s.state).toBe('hidden');
  });

  it('keeps a lit topic at or above the lit minimum', () => {
    const s = run([], { a: [link({ similarity: 0.4 })] }).get('a')!;
    expect(s.state).toBe('lit');
    expect(s.strength).toBeGreaterThanOrEqual(LIT_MIN);
  });

  it('leaves a mention out: it neither lights nor unlocks', () => {
    const s = run([], { a: [link({ kind: 'mention', ceiling: 0, similarity: 0.9 })] }).get('a')!;
    expect(s.state).toBe('hidden');
    expect(s.linkCount).toBe(0);
    expect(s.kinds).toEqual([]);
  });

  it('never reads a kind past its ceiling, however many links it has', () => {
    const notes = Array.from({ length: 6 }, () => link({ kind: 'note', ceiling: 0.5, similarity: 0.9 }));
    const s = run([], { a: notes }).get('a')!;
    expect(s.strength).toBeCloseTo(0.5 * EVIDENCE_CEILING);
    const clippings = Array.from({ length: 6 }, () => link({ kind: 'clipping', ceiling: 0.25, similarity: 0.9 }));
    expect(run([], { a: clippings }).get('a')!.state).toBe('unlocked');
  });

  it('names the kinds that back a topic', () => {
    const s = run([], { a: [link({ kind: 'note', ceiling: 0.5 }), link({ kind: 'work' }), link({ kind: 'note', ceiling: 0.5 })] });
    expect(s.get('a')!.kinds).toEqual(['work', 'note']);
  });

  it('reports breadth and depth from the topics refining it, apart from the strength', () => {
    const map: TopicMap = {
      topics: [
        { id: 'dcf', name: 'DCF', ceiling: 3, approved: true },
        { id: 'wacc', name: 'WACC', ceiling: 3, approved: true },
      ],
      cells: [
        { id: 'dcf1', topicId: 'dcf', level: 1 },
        { id: 'dcf2', topicId: 'dcf', level: 2 },
        { id: 'dcf3', topicId: 'dcf', level: 3 },
        { id: 'wacc1', topicId: 'wacc', level: 1 },
      ],
      links: [],
      evidence: [
        { cellId: 'dcf2', verdict: 'met', observedAt: T0 },
        { cellId: 'wacc1', verdict: 'declared', observedAt: T0 },
      ],
    };
    const levels: TopicLevels = { map, readings: readCells(map), refining: new Map([['a', ['dcf']], ['b', ['wacc']]]) };
    const s = topicStates(topics, [], new Map(), on, levels);
    expect(s.get('a')!.reach).toEqual({
      children: 1,
      // Level 2 shown implies level 1, which counts as inferred, not tested.
      breadth: { tested: 1, inferred: 1, declared: 0 },
      depth: { tested: 2, inferred: 1, declared: 0 },
    });
    // The Level 3 topic counts the topics refining its Level 4 topics.
    expect(s.get('L3')!.reach.children).toBe(2);
    expect(s.get('L3')!.reach.breadth).toEqual({ tested: 1, inferred: 1, declared: 1 });
    expect(s.get('c')!.reach.children).toBe(0);
    expect(s.get('a')!.strength).toBe(0);
  });
});
