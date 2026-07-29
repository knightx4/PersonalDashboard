import { describe, expect, it } from 'vitest';
import { parseShopifyQuantityLines } from './shopify-lines';

describe('parseShopifyQuantityLines', () => {
  it('reads product × qty, variant, and dollar price from an order summary', () => {
    const text = `
Order summary
-------------

Miraculous Foamer × 1

4 oz

$32.00

Subtotal

$32.00

Shipping

$7.99

Taxes

$0.00

Total

$39.99 USD

Customer information
--------------------
`;
    const lines = parseShopifyQuantityLines(text);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      name: 'Miraculous Foamer',
      quantity: 1,
      unitPriceCents: 3200,
      variant: '4 oz',
    });
  });
});
