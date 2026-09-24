import { describe, expect, it } from 'vitest';
import { cardDepthForAim, toAim } from './aims';

describe('cardDepthForAim', () => {
  it('maps familiar, solid and deep to the card depths', () => {
    expect(cardDepthForAim('familiar')).toBe('working');
    expect(cardDepthForAim('solid')).toBe('advanced');
    expect(cardDepthForAim('deep')).toBe('specialist');
  });
});

describe('toAim', () => {
  const row = {
    id: 'a1',
    name: 'Every Level 3 vital article',
    about: null,
    depth: 'familiar',
    list_source: 'level3',
    field_id: null,
    domain_id: null,
    archived_at: null,
    created_at: '2026-09-24T00:00:00Z',
  };

  it('reads a list aim', () => {
    expect(toAim(row)).toMatchObject({ listSource: 'level3', depth: 'familiar' });
  });

  it('reads an unknown depth or list as the defaults', () => {
    expect(toAim({ ...row, depth: 'expert', list_source: 'other' })).toMatchObject({
      depth: 'familiar',
      listSource: null,
    });
  });
});
