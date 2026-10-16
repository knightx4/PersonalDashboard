import { describe, expect, it } from 'vitest';
import type { StrengthInput } from '@/lib/learn/strength';
import type { SkyTerritory, TerritoryStanding } from './place-graph';
import { answerLine, dueText, quoteLabel, requirementsOf, standingText } from './why';

const standing = (over: Partial<TerritoryStanding> = {}): TerritoryStanding => ({
  topicId: 't',
  level: 3,
  how: 'tested',
  cellId: 'c',
  since: '2026-10-01T09:00:00.000Z',
  dueOn: '2026-10-31T09:00:00.000Z',
  quote: null,
  via: null,
  ...over,
});

describe('standingText', () => {
  it('says how the level is held, by kind', () => {
    expect(standingText(standing())).toBe('Level 3 is held by an answer you gave on 1 Oct 2026.');
    expect(standingText(standing({ how: 'declared' }))).toContain('No question has confirmed it.');
    expect(standingText(standing({ how: 'inferred', via: { topicName: 'CAPM', level: 5 } }))).toBe(
      'Level 3 is held by inference. Your answer on 1 Oct 2026 at level 5 of CAPM needs it.',
    );
  });

  it('labels the quote by whose words it holds', () => {
    expect(quoteLabel(standing())).toBe('Your words');
    expect(quoteLabel(standing({ how: 'inferred' }))).toBe('The words that showed it');
  });
});

describe('dueText', () => {
  it('names the day a re-check falls due, and says when it already has', () => {
    expect(dueText(standing(), new Date('2026-10-13T12:00:00Z'))).toBe('Falls due a re-check on 31 Oct 2026.');
    expect(dueText(standing(), new Date('2026-11-05T12:00:00Z'))).toBe('Due a re-check since 31 Oct 2026.');
  });
});

describe('answerLine', () => {
  const row = (over: Partial<StrengthInput>): StrengthInput => ({
    state: 'known',
    established: 'tested',
    tested_at: '2026-10-01T09:00:00Z',
    declared_at: null,
    review_interval_days: null,
    ...over,
  });
  const today = new Date('2026-10-13T12:00:00Z');

  it('gives a tested idea its strength today and the day it halves next', () => {
    const line = answerLine(row({}), today)!;
    expect(line.line).toMatch(/^You answered a question about it on 1 Oct 2026\. It reads \d+% today\.$/);
    expect(line.fades).toBe('Its strength halves next on 31 Oct 2026.');
  });

  it('says a declared idea is not tested, and gives it no fading', () => {
    const line = answerLine(row({ established: 'declared', tested_at: null, declared_at: '2026-10-02T09:00:00Z' }), today)!;
    expect(line.line).toContain('You said you know it on 2 Oct 2026.');
    expect(line.fades).toBeNull();
  });

  it('has nothing to say for an idea with no state', () => {
    expect(answerLine(null, today)).toBeNull();
    expect(answerLine(row({ state: 'unknown' }), today)).toBeNull();
  });
});

describe('requirementsOf', () => {
  const territory = {
    id: 'g',
    name: 'G',
    topics: [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C' },
    ],
    links: [
      { requiringTopicId: 'a', requiringLevel: 4, requiredTopicId: 'b', requiredLevel: 3 },
      { requiringTopicId: 'a', requiringLevel: 2, requiredTopicId: 'b', requiredLevel: 1 },
      { requiringTopicId: 'c', requiringLevel: 3, requiredTopicId: 'a', requiredLevel: 2 },
      { requiringTopicId: 'a', requiringLevel: 5, requiredTopicId: 'a', requiredLevel: 4 },
    ],
  } as unknown as SkyTerritory;

  it('reads both ways, one entry per topic at the lowest level that binds, never a topic with itself', () => {
    expect(requirementsOf(territory, 'a')).toEqual({
      needs: [{ name: 'B', level: 2, at: 1 }],
      neededBy: [{ name: 'C', level: 2, at: 3 }],
    });
  });
});
