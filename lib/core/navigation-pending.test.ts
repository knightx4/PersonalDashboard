import { describe, expect, it } from 'vitest';
import { linkPathname } from './navigation-pending';

describe('linkPathname', () => {
  it('reads the path from a string href, without its query or hash', () => {
    expect(linkPathname('/learn/s/a/p/b')).toBe('/learn/s/a/p/b');
    expect(linkPathname('/learn/now?tab=feed#top')).toBe('/learn/now');
  });

  it('reads the path from a URL object', () => {
    expect(linkPathname({ pathname: '/goals', query: { a: '1' } })).toBe('/goals');
  });

  it('has no path for a link that only changes the query or the hash', () => {
    expect(linkPathname('?tab=feed')).toBeNull();
    expect(linkPathname('#top')).toBeNull();
    expect(linkPathname(undefined)).toBeNull();
  });
});

