import { describe, expect, it } from 'vitest';
import type { CellEvidence, CellLink, LevelCell, LevelTopic, TopicMap, Verdict } from './model';
import { pickCell, RECHECK_EVERY, whyLine } from './pick';
import { runSummary } from './run';

const NOW = new Date('2026-10-15T12:00:00Z');
const OLD = '2026-10-01T10:00:00Z';
const JUST_NOW = '2026-10-15T11:55:00Z';

function cellsFor(topics: readonly LevelTopic[]): LevelCell[] {
  return topics.flatMap((t) =>
    Array.from({ length: t.ceiling }, (_, i) => ({ id: `${t.id}${i + 1}`, topicId: t.id, level: i + 1 })),
  );
}

function ev(cellId: string, verdict: Verdict, observedAt = OLD): CellEvidence {
  return { cellId, verdict, observedAt };
}

const DCF: LevelTopic = { id: 'dcf', name: 'Discounted cash flow', ceiling: 10, approved: true };
const WACC: LevelTopic = { id: 'wacc', name: 'WACC', ceiling: 6, approved: true };

function map(topics: LevelTopic[], evidence: CellEvidence[] = [], links: CellLink[] = []): TopicMap {
  return { topics, cells: cellsFor(topics), links, evidence };
}

describe('pickCell placement', () => {
  it('places you on a new ten-level topic in a handful of questions', () => {
    for (const truth of [0, 1, 3, 6, 9, 10]) {
      const evidence: CellEvidence[] = [];
      let asked = 0;
      for (;;) {
        const p = pickCell(map([DCF], evidence), { now: NOW, answered: 0 });
        if (!p || p.reason !== 'placement') break;
        asked += 1;
        evidence.push(ev(p.cellId, p.level <= truth ? 'met' : 'not_met', new Date(Date.parse(OLD) + asked * 1000).toISOString()));
      }
      expect(asked, `placing at level ${truth}`).toBeLessThanOrEqual(4);
      expect(asked).toBeGreaterThan(0);
    }
  });

  it('starts halfway up and says why', () => {
    const p = pickCell(map([DCF]), { now: NOW, answered: 0 })!;
    expect(p).toMatchObject({ level: 5, reason: 'placement', heldTo: 0 });
    expect(whyLine(p, NOW)).toContain('Nothing is known about it yet');
  });

  it('finishes the topic under way before starting another', () => {
    const m = map([DCF, WACC], [ev('wacc3', 'met')]);
    expect(pickCell(m, { now: NOW, answered: 0 })).toMatchObject({ topicId: 'wacc', reason: 'placement' });
  });
});

describe('pickCell after placement', () => {
  it('asks from the fringe once every topic is placed, a miss before anything new', () => {
    // DCF placed at 4 with 5 missed; WACC placed at 2 with 3 missed.
    const m = map([DCF, WACC], [ev('dcf4', 'met'), ev('dcf5', 'not_met'), ev('wacc2', 'met'), ev('wacc3', 'not_met')]);
    const p = pickCell(m, { now: NOW, answered: 0 })!;
    expect(p.reason).toBe('fringe');
    expect(p.missed).toBe(true);
    expect(whyLine(p, NOW)).toContain('comes back before anything new');
  });

  it('rests a level just missed, and asks the next thing instead', () => {
    const m = map([DCF, WACC], [ev('dcf4', 'met'), ev('dcf5', 'not_met', JUST_NOW), ev('wacc2', 'met'), ev('wacc3', 'not_met')]);
    expect(pickCell(m, { now: NOW, answered: 0 })).toMatchObject({ cellId: 'wacc3', reason: 'fringe', missed: true });
  });

  it('keeps to the topics it is focused on', () => {
    const m = map([DCF, WACC], [ev('dcf4', 'met'), ev('dcf5', 'not_met'), ev('wacc2', 'met'), ev('wacc3', 'not_met')]);
    expect(pickCell(m, { now: NOW, answered: 0, topics: new Set(['dcf']) })?.topicId).toBe('dcf');
  });

  it('asks a re-check one answer in five when one is due', () => {
    const m = map([WACC], [ev('wacc6', 'met', '2026-08-01T00:00:00Z')]);
    const p = pickCell(m, { now: NOW, answered: RECHECK_EVERY - 1 })!;
    expect(p).toMatchObject({ cellId: 'wacc6', reason: 'recheck' });
    expect(whyLine(p, NOW)).toMatch(/held this level for \d+ days/);
  });

  it('has nothing to ask when every topic is held to its ceiling or a draft', () => {
    const m = map([WACC, { ...DCF, approved: false }], [ev('wacc6', 'met', JUST_NOW)]);
    expect(pickCell(m, { now: NOW, answered: 0 })).toBeNull();
  });
});

describe('pickCell and level 10', () => {
  it('never asks level 10, which has no question yet', () => {
    const m = map([DCF], [ev('dcf9', 'met')]);
    expect(pickCell(m, { now: NOW, answered: 0 })).toBeNull();
  });
});

describe('runSummary', () => {
  it('lists what the run showed, implied and missed, and nothing from before it', () => {
    const since = '2026-10-15T11:00:00Z';
    const m = map([DCF], [ev('dcf2', 'met'), ev('dcf5', 'met', JUST_NOW), ev('dcf7', 'not_met', JUST_NOW)]);
    const s = runSummary({ map: m, since, answered: 2 });
    expect(s.answered).toBe(2);
    expect(s.shown.map((c) => c.level)).toEqual([5]);
    // Levels 1 and 2 were held before the run; 3 and 4 are newly implied.
    expect(s.implied.map((c) => c.level)).toEqual([3, 4]);
    expect(s.missed.map((c) => c.level)).toEqual([7]);
    expect(s.shown[0].topicName).toBe('Discounted cash flow');
  });
});
