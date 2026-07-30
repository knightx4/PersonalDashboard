import { describe, expect, it } from 'vitest';
import { mapPool } from '@/lib/async/map-pool';

describe('mapPool', () => {
  it('preserves order and respects concurrency', async () => {
    let active = 0;
    let maxActive = 0;
    const results = await mapPool([1, 2, 3, 4, 5], 2, async (n) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 20));
      active -= 1;
      return n * 10;
    });
    expect(results).toEqual([10, 20, 30, 40, 50]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });
});
