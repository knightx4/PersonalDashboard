import { describe, expect, it } from 'vitest';
import { defaultViewHref, type SavedView } from './store';

/**
 * Which view a bare list opens on.
 *
 * The rule that matters is the one about links: a URL with anything in it is
 * somebody asking for something specific, and sending that to a saved view
 * would make every shared link open the wrong rows.
 */

function view(over: Partial<SavedView>): SavedView {
  return {
    id: 'v1',
    list: '/shopping/orders',
    name: 'Big ones',
    query: 'sort=total_desc',
    isDefault: true,
    ...over,
  };
}

describe('opening a list on a saved view', () => {
  it('sends a bare URL to the default', () => {
    expect(defaultViewHref([view({})], {})).toBe('/shopping/orders?sort=total_desc');
  });

  it('leaves a link that asked for something alone', () => {
    expect(defaultViewHref([view({})], { merchant: 'abc' })).toBeNull();
    expect(defaultViewHref([view({})], { sort: 'oldest' })).toBeNull();
  });

  it('does nothing when no view is marked', () => {
    expect(defaultViewHref([view({ isDefault: false })], {})).toBeNull();
  });

  it('does not redirect to the bare list it is already on', () => {
    expect(defaultViewHref([view({ query: '' })], {})).toBeNull();
  });

  it('does nothing when there are no views at all', () => {
    expect(defaultViewHref([], {})).toBeNull();
  });
});
