import { describe, expect, it } from 'vitest';
import { countGoalsWithoutPlan, readWaiting, waitingEmpty, waitingLines, type WaitingCounts } from './waiting';

const all = (n: number | null): WaitingCounts => ({ reviews: n, readings: n, cards: n, goals: n });

describe('waitingLines', () => {
  it('shows one line per count, each linking to its page', () => {
    expect(waitingLines({ reviews: 3, readings: 1, cards: 12, goals: 2 })).toEqual([
      { key: 'reviews', text: '3 ideas due for review', href: '/learn/now' },
      { key: 'readings', text: '1 reading you said you would read', href: '/learn/now' },
      { key: 'cards', text: '12 cards ready in Learn now', href: '/learn/now' },
      { key: 'goals', text: '2 goals without a plan yet', href: '/learn/goals' },
    ]);
  });

  it('leaves out a line whose count is zero', () => {
    expect(waitingLines({ reviews: 0, readings: 2, cards: 0, goals: 1 }).map((line) => line.key)).toEqual([
      'readings',
      'goals',
    ]);
  });

  it('leaves out a line whose count could not be read', () => {
    expect(waitingLines({ reviews: 4, readings: null, cards: 5, goals: 0 }).map((line) => line.key)).toEqual([
      'reviews',
      'cards',
    ]);
  });
});

describe('waitingEmpty', () => {
  it('says nothing is waiting when every count was read as zero', () => {
    expect(waitingEmpty(all(0))).toBe('nothing');
  });

  it('does not claim nothing is waiting when a count could not be read', () => {
    expect(waitingEmpty({ reviews: 0, readings: null, cards: 0, goals: 0 })).toBe('unread');
    expect(waitingEmpty(all(null))).toBe('unread');
  });

  it('is null while any line shows', () => {
    expect(waitingEmpty({ reviews: 1, readings: null, cards: 0, goals: 0 })).toBeNull();
  });
});

describe('readWaiting', () => {
  it('reads every count', async () => {
    const counts = await readWaiting({
      reviews: async () => 1,
      readings: async () => 2,
      cards: async () => 3,
      goals: async () => 4,
    });
    expect(counts).toEqual({ reviews: 1, readings: 2, cards: 3, goals: 4 });
  });

  it('drops only the count whose read fails', async () => {
    for (const failing of ['reviews', 'readings', 'cards', 'goals'] as const) {
      const reads = {
        reviews: async () => 1,
        readings: async () => 2,
        cards: async () => 3,
        goals: async () => 4,
        [failing]: async () => {
          throw new Error('read failed');
        },
      };
      const counts = await readWaiting(reads);
      expect(counts[failing]).toBeNull();
      expect(waitingLines(counts)).toHaveLength(3);
    }
  });

  it('survives every read failing', async () => {
    const fail = async (): Promise<number> => {
      throw new Error('read failed');
    };
    const counts = await readWaiting({ reviews: fail, readings: fail, cards: fail, goals: fail });
    expect(counts).toEqual(all(null));
    expect(waitingLines(counts)).toEqual([]);
  });
});

describe('countGoalsWithoutPlan', () => {
  it('counts the goals no plan names', () => {
    expect(countGoalsWithoutPlan([{ id: 'a' }, { id: 'b' }, { id: 'c' }], [{ aimId: 'b' }])).toBe(2);
  });

  it('is zero when every goal has a plan or there are no goals', () => {
    expect(countGoalsWithoutPlan([{ id: 'a' }], [{ aimId: 'a' }])).toBe(0);
    expect(countGoalsWithoutPlan([], [])).toBe(0);
  });
});
