import { describe, expect, it } from 'vitest';
import { readWaiting, waitingEmpty, waitingLines, type WaitingCounts } from './waiting';

const all = (n: number | null): WaitingCounts => ({ inbox: n, reviews: n, readings: n, cards: n });

describe('waitingLines', () => {
  it('shows one line per count, each linking to its page', () => {
    expect(waitingLines({ inbox: 4, reviews: 3, readings: 1, cards: 12 })).toEqual([
      { key: 'inbox', text: '4 things in your inbox', href: '/learn/inbox' },
      { key: 'reviews', text: '3 ideas due for review', href: '/learn/now#due-for-review' },
      { key: 'readings', text: '1 reading you said you would read', href: '/learn/now#read-these' },
      { key: 'cards', text: '12 cards from before', href: '/learn/now?cards=1' },
    ]);
  });

  it('says one thing and one card in the singular', () => {
    expect(waitingLines({ inbox: 1, reviews: 0, readings: 0, cards: 1 }).map((line) => line.text)).toEqual([
      '1 thing in your inbox',
      '1 card from before',
    ]);
  });

  it('drops the cards line once the last card is answered', () => {
    expect(waitingLines({ inbox: 0, reviews: 2, readings: 0, cards: 0 }).map((line) => line.key)).toEqual([
      'reviews',
    ]);
  });

  it('leaves out a line whose count could not be read', () => {
    expect(waitingLines({ inbox: null, reviews: 4, readings: null, cards: 0 }).map((line) => line.key)).toEqual([
      'reviews',
    ]);
  });
});

describe('waitingEmpty', () => {
  it('says nothing is waiting when every count was read as zero', () => {
    expect(waitingEmpty(all(0))).toBe('nothing');
  });

  it('does not claim nothing is waiting when a count could not be read', () => {
    expect(waitingEmpty({ inbox: 0, reviews: 0, readings: null, cards: 0 })).toBe('unread');
    expect(waitingEmpty(all(null))).toBe('unread');
  });

  it('is null while any line shows', () => {
    expect(waitingEmpty({ inbox: 1, reviews: null, readings: null, cards: 0 })).toBeNull();
  });
});

describe('readWaiting', () => {
  const ok = { inbox: async () => 3, reviews: async () => 1, readings: async () => 2, cards: async () => 4 };

  it('reads every count', async () => {
    expect(await readWaiting(ok)).toEqual({ inbox: 3, reviews: 1, readings: 2, cards: 4 });
  });

  it('drops only the count whose read fails', async () => {
    for (const failing of ['inbox', 'reviews', 'readings', 'cards'] as const) {
      const counts = await readWaiting({
        ...ok,
        [failing]: async () => {
          throw new Error('read failed');
        },
      });
      expect(counts[failing]).toBeNull();
      expect(waitingLines(counts)).toHaveLength(3);
    }
  });

  it('survives every read failing', async () => {
    const fail = async (): Promise<number> => {
      throw new Error('read failed');
    };
    const counts = await readWaiting({ inbox: fail, reviews: fail, readings: fail, cards: fail });
    expect(counts).toEqual(all(null));
    expect(waitingLines(counts)).toEqual([]);
  });
});
