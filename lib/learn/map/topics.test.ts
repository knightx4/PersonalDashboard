import { describe, expect, it } from 'vitest';
import type { StrengthInput } from '@/lib/learn/strength';
import {
  LEVEL4_FROM,
  MAX_TOPIC_NAMES,
  buildTopicFrame,
  nameTopics,
  topicTier,
  type TopicOnMap,
  type TopicRows,
} from './topics';
import { IDEA_NAMES_FROM } from './sky';

const ON = new Date('2026-10-14T00:00:00Z');
const known: StrengthInput = {
  state: 'known',
  established: 'tested',
  tested_at: '2026-10-13T00:00:00Z',
  declared_at: null,
  review_interval_days: null,
};
const at = (x: number, y: number) => ({ pca: { x, y }, neighbourMap: { x, y } });

function rows(extra: Partial<TopicRows> = {}): TopicRows {
  return {
    level3: [
      { id: 'L3-maths', title: 'Mathematics', field_id: 'f-maths' },
      { id: 'L3-bio', title: 'Biology', field_id: 'f-bio' },
      { id: 'L3-lost', title: 'Nowhere', field_id: null },
    ],
    level4: [
      { id: 'L4-sets', title: 'Set theory', parent_id: 'L3-maths' },
      { id: 'L4-cells', title: 'Cell (biology)', parent_id: 'L3-bio' },
    ],
    level4Total: 9022,
    parents: [
      { concept_id: 'i1', topic_id: 'L4-sets' },
      { concept_id: 'i2', topic_id: 'L4-sets' },
    ],
    links: [
      { target_id: 'L4-cells', weight: 1, similarity: 0.8, found_at: '2026-10-01T00:00:00Z', matched_by: 'name' },
    ],
    ...extra,
  };
}

const ideas = [
  { id: 'i1', ...at(0.5, 0.5), stateRow: known },
  { id: 'i2', ...at(0.7, 0.3), stateRow: null },
];
const fields = [
  { id: 'f-maths', ...at(-0.5, -0.5) },
  { id: 'f-bio', ...at(0.2, -0.8) },
];

describe('buildTopicFrame', () => {
  const frame = buildTopicFrame(rows(), ideas, fields, ON);
  const byId = new Map(frame.topics.map((t) => [t.id, t]));

  it('puts a topic with ideas in the middle of them, and its Level 3 parent with it', () => {
    expect(byId.get('L4-sets')!.neighbourMap).toEqual({ x: 0.6, y: 0.4 });
    expect(byId.get('L3-maths')!.neighbourMap).toEqual({ x: 0.6, y: 0.4 });
    expect(byId.get('L3-maths')!.ideaIds.sort()).toEqual(['i1', 'i2']);
    expect(byId.get('L3-maths')!.childCount).toBe(1);
  });

  it('puts an untouched Level 3 topic beside its field and leaves one with no field off', () => {
    const bio = byId.get('L3-bio')!;
    expect(Math.hypot(bio.neighbourMap.x - 0.2, bio.neighbourMap.y + 0.8)).toBeLessThan(0.05);
    expect(bio.touched).toBe(false);
    expect(byId.has('L3-lost')).toBe(false);
  });

  it('draws a Level 4 topic touched only by a link round its parent', () => {
    const cells = byId.get('L4-cells')!;
    expect(cells.state).toBe('lit');
    expect(cells.evidenceOnly).toBe(true);
    expect(Math.hypot(cells.neighbourMap.x - 0.2, cells.neighbourMap.y + 0.8)).toBeLessThan(0.1);
  });

  it('counts every state, the untouched Level 4 topics as hidden', () => {
    expect(frame.counts.hidden).toBe(9020);
    expect(frame.counts.lit).toBe(3); // Set theory and Mathematics from a known idea, Cell from its link
    expect(frame.counts.untouched).toBe(2); // Biology and Nowhere
    expect(frame.counts.unlocked).toBe(0);
  });

  it('leaves out a Level 4 topic nothing touches', () => {
    const frame2 = buildTopicFrame(
      rows({ level4: [...rows().level4, { id: 'L4-quiet', title: 'Quiet', parent_id: 'L3-bio' }] }),
      ideas,
      fields,
      ON,
    );
    expect(frame2.topics.some((t) => t.id === 'L4-quiet')).toBe(false);
  });
});

describe('topicTier', () => {
  it('shows Level 4 only from its zoom, and leaves Level 3 to the ideas when they are named', () => {
    expect(topicTier(1)).toBe(0);
    expect(topicTier(LEVEL4_FROM)).toBe(1);
    expect(topicTier(IDEA_NAMES_FROM)).toBe(2);
  });
});

describe('nameTopics', () => {
  const topic = (id: string, level: 3 | 4, parentId: string | null, x: number, y: number, strength = 0): TopicOnMap => ({
    id,
    title: id,
    level,
    parentId,
    state: strength > 0 ? 'lit' : 'unlocked',
    strength,
    evidenceOnly: false,
    touched: true,
    ideaCount: 1,
    linkCount: 0,
    ideaIds: [],
    childCount: 0,
    pca: { x, y },
    neighbourMap: { x, y },
  });

  // Two hundred unlocked topics under one parent, spread over a big screen.
  const parent = { ...topic('parent', 3, null, 1000, 1000), childCount: 200 };
  const children = Array.from({ length: 200 }, (_, i) =>
    topic(`c${i}`, 4, 'parent', 60 + (i % 20) * 95, 60 + Math.floor(i / 20) * 190, (i % 50) / 50),
  );
  const others = Array.from({ length: 40 }, (_, i) => topic(`p${i}`, 3, null, 40 + i * 48, 1900));
  const all = [parent, ...children, ...others];
  const input = {
    topics: all,
    at: (t: TopicOnMap) => t.neighbourMap,
    width: 2000,
    height: 2000,
    lineHeight: 16,
    measure: () => 40,
    gap: 4,
  };

  it('never names more than seven topics at one level', () => {
    for (const tier of [0, 1, 2] as const) {
      const names = nameTopics({ ...input, tier });
      expect(names.level3.length).toBeLessThanOrEqual(MAX_TOPIC_NAMES);
      expect(names.level4.length).toBeLessThanOrEqual(MAX_TOPIC_NAMES);
    }
  });

  it('names the strongest first and folds the rest into a count under the parent', () => {
    const names = nameTopics({ ...input, tier: 1 });
    expect(names.level4).toHaveLength(MAX_TOPIC_NAMES);
    const strengths = names.level4.map((p) => children.find((c) => c.id === p.id)!.strength);
    expect(Math.min(...strengths)).toBeGreaterThanOrEqual(0.9);
    const more = names.more.find((m) => m.id === 'parent');
    expect(more?.text).toBe(`+${200 - MAX_TOPIC_NAMES} more`);
  });

  it('shows no Level 4 name zoomed out and no Level 3 name among the ideas', () => {
    expect(nameTopics({ ...input, tier: 0 }).level4).toHaveLength(0);
    expect(nameTopics({ ...input, tier: 2 }).level3).toHaveLength(0);
  });
});
