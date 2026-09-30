import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePriceHtml } from '@/lib/watch/parse-price';

const load = (dir: string, name: string) =>
  readFileSync(join(process.cwd(), 'fixtures', dir, name), 'utf8');

// Saved from CrowdVolt on 30 Sep 2026: Jamie xx at Nowadays, 1 Oct. Six
// listings (asks) of General Admission and fourteen offers (bids).
const CROWDVOLT = 'https://www.crowdvolt.com/event/jamie-xx-nowadays-new-york-thursday-oct-1';

describe('parsePriceHtml on the CrowdVolt page', () => {
  const html = load('watch', 'crowdvolt-jamie-xx-2026-09-30.html');

  it('reads the cheapest all-in price, not the face price', () => {
    const reading = parsePriceHtml(html, CROWDVOLT);
    expect(reading).toMatchObject({
      ok: true,
      value: 186,
      detail: {
        source: 'crowdvolt',
        currency: 'USD',
        all_in: true,
        count: 8,
        listings: 6,
        high: 258,
        top_offer: 155,
      },
    });
  });

  it('counts the listings and tickets under a threshold', () => {
    const reading = parsePriceHtml(html, CROWDVOLT, { below: 200 });
    if (!reading.ok) throw new Error(reading.error);
    expect(reading.detail.below).toEqual({
      threshold: 200,
      listings: 2,
      count: 3,
      cheapest: [
        { price: 180, all_in: 186, qty: 2, ticket_type: 'General Admission' },
        { price: 190, all_in: 197, qty: 1, ticket_type: 'General Admission' },
      ],
    });
  });

  it('falls back to the JSON-LD face price when read from another host', () => {
    const reading = parsePriceHtml(html, 'https://mirror.example.com/jamie-xx');
    expect(reading).toMatchObject({
      ok: true,
      value: 180,
      detail: { source: 'json_ld', all_in: false, count: 8, high: 250 },
    });
  });

  it('says a page with an empty order book has nothing for sale', () => {
    const reading = parsePriceHtml(load('watch', 'crowdvolt-sold-out.html'), CROWDVOLT);
    expect(reading).toEqual({ ok: false, error: expect.stringMatching(/nothing for sale/) });
  });
});

describe('parsePriceHtml on JSON-LD offers', () => {
  it('reads an AggregateOffer', () => {
    const reading = parsePriceHtml(
      load('watch', 'jsonld-aggregate-offer.html'),
      'https://tickets.example.com/warehouse',
      { below: 100 },
    );
    expect(reading).toEqual({
      ok: true,
      value: 64.5,
      detail: {
        source: 'json_ld',
        currency: 'EUR',
        all_in: false,
        count: 9,
        listings: 5,
        high: 120,
        top_offer: null,
      },
    });
  });

  it('reads a plain Offer on a product page', () => {
    const reading = parsePriceHtml(
      load('saved', 'jsonld-product.html'),
      'https://shop.example.com/hand-wash',
    );
    expect(reading).toMatchObject({ ok: true, value: 39, detail: { source: 'json_ld' } });
  });
});

describe('a page with no price', () => {
  it('is an error reading, never zero', () => {
    const reading = parsePriceHtml(
      load('saved', 'no-metadata.html'),
      'https://example.com/plain',
    );
    expect(reading.ok).toBe(false);
    expect(reading).not.toHaveProperty('value');
  });
});
