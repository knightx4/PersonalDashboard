import { describe, expect, it } from 'vitest';
import {
  fingerprintLoose,
  fingerprintStrict,
  fingerprints,
  normalize,
} from './fingerprint';

describe('normalize', () => {
  it('lowercases, strips punctuation and collapses whitespace', () => {
    expect(normalize('  Sony  WH-1000XM5!! ')).toBe('sony wh 1000xm5');
  });

  it('drops stopwords', () => {
    expect(normalize('The Coat with a New Lining')).toBe('coat lining');
  });

  it('strips diacritics', () => {
    expect(normalize('Crème de la Mer')).toBe('creme de la mer');
  });

  it('treats null and empty input as empty', () => {
    expect(normalize(null)).toBe('');
    expect(normalize(undefined)).toBe('');
    expect(normalize('   ')).toBe('');
  });
});

describe('fingerprintStrict -- order deduplication, precision matters', () => {
  it('matches the same item from the same merchant', () => {
    const a = fingerprintStrict({ merchantSlug: 'nike', name: 'Pegasus 41', variant: 'Size 10 / Black' });
    const b = fingerprintStrict({ merchantSlug: 'nike', name: 'pegasus  41', variant: 'size 10 / black' });
    expect(a).toBe(b);
  });

  it('separates different variants, so two sizes are two purchases', () => {
    const ten = fingerprintStrict({ merchantSlug: 'nike', name: 'Pegasus 41', variant: 'Size 10' });
    const eleven = fingerprintStrict({ merchantSlug: 'nike', name: 'Pegasus 41', variant: 'Size 11' });
    expect(ten).not.toBe(eleven);
  });

  it('separates the same item at different merchants', () => {
    const amazon = fingerprintStrict({ merchantSlug: 'amazon', name: 'Sony WH-1000XM5' });
    const bestBuy = fingerprintStrict({ merchantSlug: 'best-buy', name: 'Sony WH-1000XM5' });
    expect(amazon).not.toBe(bestBuy);
  });
});

describe('fingerprintLoose -- already-own checks, recall matters', () => {
  it('matches the same product bought from two different merchants', () => {
    // The headline case. A single merchant-scoped fingerprint fails here, and
    // this is exactly when someone forgets they already bought the thing.
    expect(fingerprintLoose('Sony WH-1000XM5')).toBe(fingerprintLoose('sony wh 1000xm5'));
  });

  it('ignores variant, so a second colourway still flags as already owned', () => {
    const black = fingerprints({ merchantSlug: 'nike', name: 'Pegasus 41', variant: 'Black' });
    const white = fingerprints({ merchantSlug: 'nike', name: 'Pegasus 41', variant: 'White' });
    expect(black.strict).not.toBe(white.strict);
    expect(black.loose).toBe(white.loose);
  });

  it('does not match genuinely different products', () => {
    expect(fingerprintLoose('Aesop Resurrection Hand Wash')).not.toBe(
      fingerprintLoose('Aesop Geranium Body Cleanser'),
    );
  });

  it('still misses names that differ beyond normalization', () => {
    // Documenting the known limitation rather than pretending it is solved.
    // "Sony WH1000XM5/B Wireless Headphones" normalizes differently, which is
    // why the already-own query also runs a trigram comparison.
    expect(fingerprintLoose('Sony WH-1000XM5')).not.toBe(
      fingerprintLoose('Sony WH1000XM5/B Wireless Headphones'),
    );
  });
});
