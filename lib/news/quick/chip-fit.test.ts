import { describe, expect, it } from 'vitest';
import { chipsThatFit } from './chip-fit';

describe('chipsThatFit', () => {
  const base = { all: 80, more: 50, gap: 6 };

  it('draws the whole row when every chip fits', () => {
    expect(chipsThatFit({ ...base, topics: [60, 60], available: 80 + 6 + 60 + 6 + 60 })).toBeNull();
  });

  it('keeps as many chips as fit beside More', () => {
    // 80 + 6 + 50 = 136 reserved; two chips of 60 take 132 more, a third would not fit.
    expect(chipsThatFit({ ...base, topics: [60, 60, 60, 60], available: 280 })).toBe(2);
  });

  it('stops at the first chip that does not fit, so the order is kept', () => {
    expect(chipsThatFit({ ...base, topics: [60, 200, 20], available: 240 })).toBe(1);
  });

  it('draws only All topics and More when nothing else fits', () => {
    expect(chipsThatFit({ ...base, topics: [200, 200], available: 200 })).toBe(0);
  });
});
