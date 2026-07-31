import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isGenericImageUrl,
  isGenericTitle,
  parsePriceToCents,
  parseProductHtml,
  titleFromProductUrl,
} from '@/lib/saved/parse-product';
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

  it('rejects Amazon bot-shell OG and uses the URL slug', () => {
    const pageUrl =
      'https://www.amazon.com/Origin-Wealth-Remaking-Economics-Business/dp/1422121038';
    const result = parseProductHtml(load('amazon-bot-shell.html'), pageUrl);
    expect(result.title).toBe('Origin Wealth Remaking Economics Business');
    expect(result.imageUrl).toBeNull();
    expect(result.priceCents).toBeNull();
    expect(result.source).toBe('url');
  });

  it('prefers a useful <title> over junk Amazon OG', () => {
    const pageUrl =
      'https://www.amazon.com/Origin-Wealth-Remaking-Economics-Business/dp/1422121038';
    const result = parseProductHtml(load('amazon-title-tag.html'), pageUrl);
    expect(result.title).toBe('Origin of Wealth');
    expect(result.imageUrl).toBeNull();
    expect(result.source).toBe('document_title');
  });
});

describe('titleFromProductUrl', () => {
  it('reads Amazon /slug/dp/ASIN paths', () => {
    expect(
      titleFromProductUrl(
        'https://www.amazon.com/Origin-Wealth-Remaking-Economics-Business/dp/1422121038',
      ),
    ).toBe('Origin Wealth Remaking Economics Business');
    expect(titleFromProductUrl('https://www.amazon.com/dp/1422121038')).toBeNull();
  });

  it('reads /products/ handles', () => {
    expect(titleFromProductUrl('https://shop.example.com/products/sony-wh-1000xm5')).toBe(
      'sony wh 1000xm5',
    );
  });
});

describe('generic detection', () => {
  it('flags merchant-only titles and share-icon images', () => {
    expect(isGenericTitle('Amazon', 'https://www.amazon.com/dp/1')).toBe(true);
    expect(isGenericTitle('Amazon.com', 'https://www.amazon.com/dp/1')).toBe(true);
    expect(isGenericTitle('Sony WH-1000XM5', 'https://www.amazon.com/dp/1')).toBe(false);
    expect(
      isGenericImageUrl('https://m.media-amazon.com/images/G/01/share-icons/preview.png'),
    ).toBe(true);
    expect(isGenericImageUrl('https://m.media-amazon.com/images/I/71abcProduct.jpg')).toBe(
      false,
    );
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
