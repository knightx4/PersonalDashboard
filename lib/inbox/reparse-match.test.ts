import { describe, expect, it } from 'vitest';
import { matchExistingOrderItem } from './reparse-match';

describe('matchExistingOrderItem', () => {
  const existing = [
    {
      id: 'a',
      name: 'Shopify order',
      variant: null,
      fingerprint_strict: 'old-strict',
      fingerprint_loose: 'old-loose',
    },
  ];

  it('matches by fingerprint when available', () => {
    const hit = matchExistingOrderItem(
      existing,
      {
        name: 'Anything',
        variant: null,
        fingerprintStrict: 'old-strict',
        fingerprintLoose: 'x',
      },
      new Set(),
    );
    expect(hit?.id).toBe('a');
  });

  it('falls back to the single existing line when parsers replace a generic title', () => {
    const hit = matchExistingOrderItem(
      existing,
      {
        name: 'You Too Can Mahjong!',
        variant: '1304010-0002',
        fingerprintStrict: 'new-strict',
        fingerprintLoose: 'new-loose',
      },
      new Set(),
      { builtCount: 1 },
    );
    expect(hit?.id).toBe('a');
  });

  it('does not force-match when multiple lines exist', () => {
    const multi = [
      ...existing,
      {
        id: 'b',
        name: 'Other item',
        variant: null,
        fingerprint_strict: 'b-strict',
        fingerprint_loose: 'b-loose',
      },
    ];
    const hit = matchExistingOrderItem(
      multi,
      {
        name: 'Brand new product',
        variant: null,
        fingerprintStrict: 'fresh',
        fingerprintLoose: 'fresh-loose',
      },
      new Set(),
      { builtCount: 1 },
    );
    expect(hit).toBeNull();
  });
});
