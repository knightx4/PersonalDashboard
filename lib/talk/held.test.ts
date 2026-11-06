import { describe, expect, it } from 'vitest';
import { heldTogether, heldWaitMs, nextBatch, type HeldQuestion } from './held';
import { SETTLE_MAX_MS, SETTLE_QUIET_MS } from '@/lib/you/reply-turn';

const q = (id: string, body: string, at: number, files = 0): HeldQuestion => ({
  id,
  body,
  at,
  files: Array.from({ length: files }, (_, i) => ({ path: `${id}/${i}`, name: `${i}.png`, contentType: 'image/png', size: 1 })),
  citations: [],
});

describe('heldWaitMs', () => {
  it('waits for nothing when nothing is held', () => {
    expect(heldWaitMs([], 0, false)).toBeNull();
  });

  it('holds a question sent mid-answer until the answer lands, then sends it at once', () => {
    // Sent at 1s while the first answer is still being written.
    const held = [q('a', 'And in August?', 1_000)];
    expect(heldWaitMs(held, 2_000, true)).toBeNull();
    expect(heldWaitMs(held, 30_000, true)).toBeNull();
    // The answer lands at 30s: the person stopped long ago, so it goes now.
    expect(heldWaitMs(held, 30_000, false)).toBe(0);
  });

  it('waits out the pause after three quick questions, from the newest', () => {
    const held = [q('a', 'One', 0), q('b', 'Two', 600), q('c', 'Three', 1_200)];
    expect(heldWaitMs(held, 1_300, false)).toBe(SETTLE_QUIET_MS - 100);
    expect(heldWaitMs(held, 1_200 + SETTLE_QUIET_MS, false)).toBe(0);
  });

  it('never waits past the longest wait from the oldest', () => {
    const held = [q('a', 'One', 0), q('b', 'Two', SETTLE_MAX_MS - 500)];
    expect(heldWaitMs(held, SETTLE_MAX_MS - 400, false)).toBe(400);
  });
});

describe('nextBatch', () => {
  it('sends three quick questions as one question', () => {
    const { batch, rest, body } = nextBatch([q('a', 'One', 0), q('b', 'Two', 1), q('c', 'Three', 2)]);
    expect(batch.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(rest).toEqual([]);
    expect(body).toBe('One\n\nTwo\n\nThree');
  });

  it('leaves what will not fit in one turn for the next question', () => {
    const { batch, rest, body } = nextBatch([q('a', 'x'.repeat(6), 0), q('b', 'y'.repeat(6), 1)], 10);
    expect(batch.map((x) => x.id)).toEqual(['a']);
    expect(rest.map((x) => x.id)).toEqual(['b']);
    expect(body).toBe('xxxxxx');
  });

  it('keeps one question to one item of files', () => {
    const { batch, files } = nextBatch([q('a', 'A', 0, 3), q('b', 'B', 1, 3)], 8000, 5);
    expect(batch.map((x) => x.id)).toEqual(['a']);
    expect(files).toHaveLength(3);
  });

  it('always sends the oldest, even alone over the limit', () => {
    expect(nextBatch([q('a', 'x'.repeat(20), 0)], 10).batch).toHaveLength(1);
  });
});

describe('heldTogether', () => {
  it('sends each row once with the newest scope', () => {
    const row = { kind: 'order' as const, id: 'o1', title: 'Catan', href: '/shopping/orders/o1' };
    const other = { kind: 'order' as const, id: 'o2', title: 'Azul', href: '/shopping/orders/o2' };
    expect(
      heldTogether([
        { rows: [row], scope: null },
        { rows: [row, other], scope: 'shopping' },
      ]),
    ).toEqual({ rows: [row, other], scope: 'shopping' });
  });
});
