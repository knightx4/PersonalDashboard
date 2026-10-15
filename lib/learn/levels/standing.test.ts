import { describe, expect, it } from 'vitest';
import type { TopicMap } from './model';
import { topicStanding } from './standing';
import type { TopicDetail } from './store';
import type { CellEvidenceView } from './store-page';

const topic: TopicDetail = {
  id: 't',
  name: 'T',
  scope: 's',
  status: 'approved',
  ceiling: 4,
  asked: null,
  createdAt: '2026-10-01T00:00:00Z',
  approvedAt: '2026-10-01T00:00:00Z',
  fieldNames: [],
  cells: [1, 2, 3, 4].map((level) => ({
    id: `t${level}`,
    level,
    checks: ['Can a', 'Can b'],
    original: null,
    rewrittenAt: level === 2 ? '2026-10-10T00:00:00Z' : null,
  })),
  links: [{ fromLevel: 3, topicId: 'u', topicName: 'U', level: 1, why: null }],
  wanted: [],
};

const map = (evidence: TopicMap['evidence']): TopicMap => ({
  topics: [{ id: 't', name: 'T', ceiling: 4, approved: true }],
  cells: topic.cells.map((c) => ({ id: c.id, topicId: 't', level: c.level })),
  links: [],
  evidence,
});

function view(cellId: string, verdict: CellEvidenceView['verdict'], observedAt: string, quote: string | null = null) {
  return { cellId, verdict, observedAt, quote };
}

describe('topicStanding', () => {
  it('reads every level open and untouched with no evidence, and points at one to ask', () => {
    const s = topicStanding(topic, map([]), [], []);
    expect(s.untouched).toBe(true);
    expect(s.level).toBe(0);
    expect(s.rows.every((r) => r.status === 'open')).toBe(true);
    expect(s.rows.filter((r) => r.next !== null)).toHaveLength(1);
  });

  it('implies the levels under a shown one and gives the topic its level', () => {
    const ev = [view('t3', 'met', '2026-10-12T00:00:00Z', 'quote')];
    const s = topicStanding(topic, map([{ cellId: 't3', verdict: 'met', observedAt: ev[0].observedAt }]), ev, []);
    expect(s.rows.map((r) => r.status)).toEqual(['implied', 'implied', 'shown', 'open']);
    expect(s.level).toBe(3);
    expect(s.untouched).toBe(false);
  });

  it('marks evidence given before a level was reworded', () => {
    const ev = [
      view('t2', 'met', '2026-10-12T00:00:00Z', 'after'),
      view('t2', 'met', '2026-10-05T00:00:00Z', 'before'),
    ];
    const s = topicStanding(topic, map([]), ev, []);
    expect(s.rows[1].evidence.map((e) => e.beforeRewording)).toEqual([false, true]);
    expect(s.rows[0].evidence).toEqual([]);
  });

  it('carries links out by the level that needs them and links in by the level needed', () => {
    const s = topicStanding(topic, map([]), [], [{ level: 2, topicId: 'v', topicName: 'V', fromLevel: 5, why: 'w' }]);
    expect(s.rows[2].needs.map((l) => l.topicName)).toEqual(['U']);
    expect(s.rows[1].neededBy.map((l) => l.topicName)).toEqual(['V']);
  });
});
