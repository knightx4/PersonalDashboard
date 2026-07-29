import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePriceToCents, parseProductHtml } from '@/lib/saved/parse-product';
import {
  findMerchantByUrl,
  hostnameFromUrl,
} from '@/lib/saved/resolve-merchant';
import { isBlockedHostname } from '@/lib/saved/ssrf';

const fixtures = join(process.cwd(), 'fixtures/saved');

function load(name: string): string {
  return readFileSync(join(fixtures, name), 'utf8');
}

describe('parseProductHtml', () => {
  it('prefers JSON-LD Product fields', () => {
    const result = parseProductHtml(
      load('jsonld-product.html'),
      'https://shop.example.com/hand-wash',
    );
    expect(result.source).toBe('json_ld');
    expect(result.title).toBe('Aesop Resurrection Aromatique Hand Wash');
    expect(result.imageUrl).toBe('https://cdn.example.com/aesop-hand-wash.jpg');
    expect(result.priceCents).toBe(3900);
    expect(result.currency).toBe('USD');
  });

  it('falls back to Open Graph + product: meta', () => {
    const result = parseProductHtml(
      load('og-meta.html'),
      'https://shop.example.com/products/xm5',
    );
    expect(result.source).toBe('open_graph');
    expect(result.title).toBe('Sony WH-1000XM5 Wireless Headphones');
    expect(result.imageUrl).toBe('https://shop.example.com/images/xm5.jpg');
    expect(result.priceCents).toBe(34800);
  });

  it('lets JSON-LD win over OG when both are present', () => {
    const result = parseProductHtml(
      load('jsonld-and-og.html'),
      'https://shop.example.com/item',
    );
    expect(result.source).toBe('json_ld');
    expect(result.title).toBe('JSON-LD wins for title');
    expect(result.priceCents).toBe(5550);
    // Image only on OG — still filled as a gap.
    expect(result.imageUrl).toBe('https://cdn.example.com/og-only.jpg');
  });

  it('returns empty enrichment when nothing useful is present', () => {
    const result = parseProductHtml(
      load('no-metadata.html'),
      'https://shop.example.com/plain',
    );
    expect(result.source).toBe('none');
    expect(result.title).toBeNull();
    expect(result.imageUrl).toBeNull();
    expect(result.priceCents).toBeNull();
  });

  it('reads AggregateOffer lowPrice and image arrays', () => {
    const result = parseProductHtml(
      load('offer-catalog.html'),
      'https://shop.example.com/sweater',
    );
    expect(result.title).toBe('Patagonia Better Sweater');
    expect(result.priceCents).toBe(13900);
    expect(result.imageUrl).toBe('https://cdn.example.com/sweater-1.jpg');
  });
});

describe('parsePriceToCents', () => {
  it('accepts numbers, dollar strings, and currency-prefixed strings', () => {
    expect(parsePriceToCents(39)).toBe(3900);
    expect(parsePriceToCents('12.99')).toBe(1299);
    expect(parsePriceToCents('$1,299.00')).toBe(129_900);
    expect(parsePriceToCents('USD 39.00')).toBe(3900);
    expect(parsePriceToCents(null)).toBeNull();
    expect(parsePriceToCents('nope')).toBeNull();
  });
});

describe('isBlockedHostname', () => {
  it('blocks localhost and private literals', () => {
    expect(isBlockedHostname('localhost')).toBe(true);
    expect(isBlockedHostname('127.0.0.1')).toBe(true);
    expect(isBlockedHostname('10.0.0.4')).toBe(true);
    expect(isBlockedHostname('192.168.1.1')).toBe(true);
    expect(isBlockedHostname('169.254.169.254')).toBe(true);
    expect(isBlockedHostname('::1')).toBe(true);
  });

  it('allows ordinary public hostnames', () => {
    expect(isBlockedHostname('shop.example.com')).toBe(false);
    expect(isBlockedHostname('www.amazon.com')).toBe(false);
  });
});

describe('resolve-merchant', () => {
  const merchants = [
    {
      id: '11111111-1111-1111-1111-111111111111',
      slug: 'amazon',
      name: 'Amazon',
      domains: ['amazon.com', 'amazon.co.uk'],
    },
    {
      id: '22222222-2222-2222-2222-222222222222',
      slug: 'best-buy',
      name: 'Best Buy',
      domains: ['bestbuy.com'],
    },
  ];

  it('extracts hostnames and matches domain suffixes', () => {
    expect(hostnameFromUrl('https://www.amazon.com/dp/B0TEST')).toBe('www.amazon.com');
    expect(findMerchantByUrl('https://www.amazon.com/dp/B0TEST', merchants)?.slug).toBe(
      'amazon',
    );
    expect(findMerchantByUrl('https://www.bestbuy.com/site/x', merchants)?.slug).toBe(
      'best-buy',
    );
    expect(findMerchantByUrl('https://unknown.example/p/1', merchants)).toBeNull();
  });
});
