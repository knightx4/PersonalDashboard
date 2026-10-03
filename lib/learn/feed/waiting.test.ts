import { describe, expect, it } from 'vitest';
import { countGoalsWithoutPlan, readWaiting, waitingEmpty, waitingLines, type WaitingCounts } from './waiting';

const all = (n: number | null): WaitingCounts => ({ reviews: n, readings: n, goals: n });

describe('waitingLines', () => {
  it('shows one line per count, each linking to its page', () => {
    expect(waitingLines({ reviews: 3, readings: 1, goals: 2 })).toEqual([
      { key: 'reviews', text: '3 ideas due for review', href: '/learn/now#due-for-review' },
      { key: 'readings', text: '1 reading you said you would read', href: '/learn/now#read-these' },
      { key: 'goals', text: '2 goals without a plan yet', href: '/goals' },
    ]);
  });

  it('opens the Learn area for goals without a plan when the page knows it', () => {
    const area = '/goals/area/00000000-0000-4000-8000-000000000001';
    expect(waitingLines({ reviews: 0, readings: 0, goals: 1 }, { goalsHref: area })).toEqual([
      { key: 'goals', text: '1 goal without a plan yet', href: area },
    ]);
  });

  it('leaves out a line whose count is zero', () => {
    expect(waitingLines({ reviews: 0, readings: 2, goals: 1 }).map((line) => line.key)).toEqual([
      'readings',
      'goals',
    ]);
  });

  it('leaves out a line whose count could not be read', () => {
    expect(waitingLines({ reviews: 4, readings: null, goals: 0 }).map((line) => line.key)).toEqual([
      'reviews',
    ]);
  });
});

describe('waitingEmpty', () => {
  it('says nothing is waiting when every count was read as zero', () => {
    expect(waitingEmpty(all(0))).toBe('nothing');
  });

  it('does not claim nothing is waiting when a count could not be read', () => {
    expect(waitingEmpty({ reviews: 0, readings: null, goals: 0 })).toBe('unread');
    expect(waitingEmpty(all(null))).toBe('unread');
  });

  it('is null while any line shows', () => {
    expect(waitingEmpty({ reviews: 1, readings: null, goals: 0 })).toBeNull();
  });
});

describe('readWaiting', () => {
  it('reads every count', async () => {
    const counts = await readWaiting({
      reviews: async () => 1,
      readings: async () => 2,
      goals: async () => 4,
    });
    expect(counts).toEqual({ reviews: 1, readings: 2, goals: 4 });
  });

  it('drops only the count whose read fails', async () => {
    for (const failing of ['reviews', 'readings', 'goals'] as const) {
      const reads = {
        reviews: async () => 1,
        readings: async () => 2,
        goals: async () => 4,
        [failing]: async () => {
          throw new Error('read failed');
        },
      };
      const counts = await readWaiting(reads);
      expect(counts[failing]).toBeNull();
      expect(waitingLines(counts)).toHaveLength(2);
    }
  });

  it('survives every read failing', async () => {
    const fail = async (): Promise<number> => {
      throw new Error('read failed');
    };
    const counts = await readWaiting({ reviews: fail, readings: fail, goals: fail });
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
