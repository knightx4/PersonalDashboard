import { describe, expect, it } from 'vitest';
import {
  enrichLinesWithProductLinks,
  extractProductLinksFromEmail,
} from './product-links';

describe('extractProductLinksFromEmail', () => {
  it('unwraps Amazon tracking links to a clean dp URL', () => {
    const html = `
      <a href="https://www.amazon.com/gp/r.html?C=ABC&U=https%3A%2F%2Fwww.amazon.com%2Fdp%2F0062234730%3Fref_%3Dx&H=ZZ">
        The Well-Tempered City
      </a>
      <img src="https://m.media-amazon.com/images/I/81bookcover._AC_SL1500_.jpg" />
    `;
    const hints = extractProductLinksFromEmail(html);
    expect(hints).toHaveLength(1);
    expect(hints[0]?.productUrl).toBe('https://www.amazon.com/dp/0062234730');
    expect(hints[0]?.asin).toBe('0062234730');
    expect(hints[0]?.imageUrl).toMatch(/bookcover/);
  });
});

describe('enrichLinesWithProductLinks', () => {
  it('fills a single ASIN onto a single line', () => {
    const enriched = enrichLinesWithProductLinks(
      [{ name: 'Book', productUrl: null, imageUrl: null }],
      [{ productUrl: 'https://www.amazon.com/dp/0062234730', asin: '0062234730' }],
    );
    expect(enriched[0]?.productUrl).toBe('https://www.amazon.com/dp/0062234730');
  });
});
