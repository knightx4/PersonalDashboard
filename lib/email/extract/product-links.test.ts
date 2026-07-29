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

  it('prefers ordered-item title ASINs over promo carousel ASINs', () => {
    const html = `
      <a href="https://www.amazon.com/gp/r.html?U=https%3A%2F%2Fwww.amazon.com%2Fdp%2FB08LZRQQ49%2F%3Fref_%3Dpe_AGH3Col_04_00_IMG_07_dealz_pu_pie">deal</a>
      <a href="https://www.amazon.com/gp/r.html?U=https%3A%2F%2Fwww.amazon.com%2Fdp%2FB0DY913JWM%3Fref_%3Dpe_i_fed_asin_title">Legacy NCAA Baseball Hat</a>
      <a href="https://www.amazon.com/gp/r.html?U=https%3A%2F%2Fwww.amazon.com%2Fdp%2FB09Z6YCQQR%3Fref_%3Dpe_i_fed_asin_title">NYU T Shirt</a>
    `;
    const hints = extractProductLinksFromEmail(html);
    expect(hints.map((h) => h.asin)).toEqual(['B0DY913JWM', 'B09Z6YCQQR']);
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

  it('matches distinct ASINs to multi-item lines by nearby title text', () => {
    const html = `
      Legacy NCAA Officially Licensed Baseball Hat ... B0DY913JWM ...
      New York University Official Distressed Primary Logo Unisex Adult T Shirt ... B09Z6YCQQR ...
    `;
    const enriched = enrichLinesWithProductLinks(
      [
        { name: 'Legacy NCAA Officially Licensed Baseball Hat', productUrl: null },
        { name: 'New York University Official Distressed Primary Logo Unisex Adult T Shirt', productUrl: null },
      ],
      [
        { productUrl: 'https://www.amazon.com/dp/B0DY913JWM', asin: 'B0DY913JWM' },
        { productUrl: 'https://www.amazon.com/dp/B09Z6YCQQR', asin: 'B09Z6YCQQR' },
      ],
      html,
    );
    expect(enriched[0]?.productUrl).toBe('https://www.amazon.com/dp/B0DY913JWM');
    expect(enriched[1]?.productUrl).toBe('https://www.amazon.com/dp/B09Z6YCQQR');
  });
});
