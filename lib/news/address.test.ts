import { describe, expect, it } from 'vitest';
import { localPartOf, newsAddress } from '@/lib/news/address';

const DOMAIN = 'in.example.com';
const MINE = 'k7m2pq4xv9zd3b1n';

describe('localPartOf', () => {
  it('reads the local part off an address on our domain', () => {
    expect(localPartOf(`${MINE}@${DOMAIN}`, DOMAIN)).toBe(MINE);
  });

  it('reads it out of a name-and-angle-brackets recipient, whatever the case', () => {
    expect(localPartOf(`Me <${MINE.toUpperCase()}@IN.EXAMPLE.COM>`, DOMAIN)).toBe(MINE);
  });

  it('is null for another domain, so mail routed here by mistake is dropped', () => {
    expect(localPartOf(`${MINE}@elsewhere.com`, DOMAIN)).toBeNull();
  });

  it('is null for a local part that could never have been issued', () => {
    expect(localPartOf(`hello@${DOMAIN}`, DOMAIN)).toBeNull();
    expect(localPartOf(`${MINE}+news@${DOMAIN}`, DOMAIN)).toBeNull();
  });

  it('finds ours among several recipients', () => {
    expect(localPartOf(`someone@other.com, ${MINE}@${DOMAIN}`, DOMAIN)).toBe(MINE);
  });

  it('is null for nonsense', () => {
    expect(localPartOf('', DOMAIN)).toBeNull();
    expect(localPartOf('not an address', DOMAIN)).toBeNull();
  });
});

describe('newsAddress', () => {
  it('joins the two halves', () => {
    expect(newsAddress(MINE, DOMAIN)).toBe(`${MINE}@${DOMAIN}`);
  });
});
