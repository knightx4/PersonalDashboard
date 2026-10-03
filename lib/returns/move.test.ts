import { describe, expect, it } from 'vitest';
import { moveWord } from '@/lib/core/move';
import { returnMove } from './move';

type Row = Parameters<typeof returnMove>[0];

const base: Row = {
  status: 'owned',
  delivered: true,
  orderStatus: 'delivered',
  carrier: null,
  merchantName: 'Sephora',
  daysLeft: 10,
  returnPlanned: false,
};

const word = (over: Partial<Row>) => {
  const found = returnMove({ ...base, ...over });
  return found ? moveWord(found.move) : null;
};

describe('returnMove', () => {
  it('puts an item inside its return window on you', () => {
    expect(word({})).toBe('On you');
    expect(word({ daysLeft: 0, returnPlanned: true })).toBe('On you');
  });

  it('says a delivery is waiting on the carrier, or the shop before it ships', () => {
    expect(word({ delivered: false, orderStatus: 'shipped', carrier: 'UPS', daysLeft: null })).toBe(
      'Waiting on UPS',
    );
    expect(word({ delivered: false, orderStatus: 'shipped', daysLeft: null })).toBe(
      'Waiting on the carrier',
    );
    expect(word({ delivered: false, orderStatus: 'ordered', daysLeft: null })).toBe(
      'Waiting on Sephora',
    );
  });

  it('keeps a marked return on you past its window, and lets the rest go', () => {
    expect(word({ daysLeft: -3, returnPlanned: true })).toBe('On you');
    expect(word({ daysLeft: -3 })).toBeNull();
    expect(word({ daysLeft: null })).toBeNull();
  });

  it('shows nothing once it is returned', () => {
    expect(word({ status: 'returned' })).toBeNull();
  });
});
