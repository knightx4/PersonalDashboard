import { describe, expect, it } from 'vitest';
import { displayVariant } from '@/lib/inventory/display';

describe('displayVariant', () => {
  it('passes through real variants', () => {
    expect(displayVariant('Paperback')).toBe('Paperback');
    expect(displayVariant('Size 10 / Black')).toBe('Size 10 / Black');
  });

  it('hides email total leftovers', () => {
    expect(displayVariant('Grand Total:')).toBeNull();
    expect(displayVariant('Grand Total')).toBeNull();
    expect(displayVariant('Order Total:')).toBeNull();
    expect(displayVariant('Subtotal')).toBeNull();
  });

  it('treats blank as null', () => {
    expect(displayVariant(null)).toBeNull();
    expect(displayVariant('  ')).toBeNull();
  });
});
