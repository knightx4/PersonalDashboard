import { describe, expect, it } from 'vitest';
import {
  groupItems,
  groupKeyFor,
  normalizeTitleKey,
  regroupPlan,
  type GroupableItem,
  type ShareItemState,
} from './grouping';

function game(over: Partial<GroupableItem> & { name: string }): GroupableItem {
  return {
    inventoryItemId: over.name,
    shortName: null,
    bggId: null,
    needsConfirmation: false,
    isGame: true,
    fingerprintLoose: null,
    ...over,
  };
}

describe('groupKeyFor', () => {
  it('stacks two boxes sharing a confirmed bgg id', () => {
    const a = game({ name: 'Monopoly', bggId: 1406, inventoryItemId: 'a' });
    const b = game({ name: 'Monopoly Classic Edition', bggId: 1406, inventoryItemId: 'b' });
    expect(groupKeyFor(a)).toBe(groupKeyFor(b));
  });

  it('keeps different bgg ids apart even when the titles agree', () => {
    // The 2015 reprint and the 3D special are one word on the spine and very
    // different resale, which is the whole reason game_details exists.
    const a = game({ name: 'Catan', bggId: 13, inventoryItemId: 'a' });
    const b = game({ name: 'Catan', bggId: 178900, inventoryItemId: 'b' });
    expect(groupKeyFor(a)).not.toBe(groupKeyFor(b));
  });

  it('refuses to stack on an unconfirmed id, because a guess is not an identity', () => {
    const a = game({ name: 'Wingspan', bggId: 266192, needsConfirmation: true, inventoryItemId: 'a' });
    const b = game({ name: 'Wingspan', bggId: 266192, needsConfirmation: true, inventoryItemId: 'b' });
    // Falls through to the title tier, where they legitimately do stack --
    // what must not happen is stacking *because of* the shaky id.
    expect(groupKeyFor(a)).toBe('game:title:wingspan');
    expect(groupKeyFor(b)).toBe('game:title:wingspan');
  });

  it('does not fold an expansion into its base game', () => {
    // The bug this test exists for: lib/games/clean-title's
    // normalizeForCompare() strips the word "expansion" on purpose, and
    // reusing it here would stack these two into one group of 2.
    const base = game({ name: 'Carcassonne', inventoryItemId: 'a' });
    const expansion = game({ name: 'Carcassonne Expansion', inventoryItemId: 'b' });
    expect(groupKeyFor(base)).not.toBe(groupKeyFor(expansion));
  });

  it('sees through retail packaging noise to the same product', () => {
    const a = game({ name: 'Hasbro Gaming Monopoly Board Game, Ages 8+, 2-6 Players' });
    const b = game({ name: 'Monopoly' });
    expect(groupKeyFor(a)).toBe(groupKeyFor(b));
  });

  it('prefers the short name, which is the one a person chose', () => {
    const a = game({ name: 'Ticket To Ride Europe Strategy Board Game', shortName: 'Ticket to Ride: Europe' });
    const b = game({ name: 'Ticket to Ride Europe' });
    expect(groupKeyFor(a)).toBe(groupKeyFor(b));
  });

  it('uses the loose fingerprint for anything that is not a game', () => {
    const item = game({ name: 'Sony WH-1000XM5', isGame: false, fingerprintLoose: 'abc123' });
    expect(groupKeyFor(item)).toBe('item:fp:abc123');
  });

  it('falls back to a title for a non-game with no fingerprint', () => {
    const item = game({ name: 'A Wooden Spoon', isGame: false });
    expect(groupKeyFor(item)).toBe('item:title:wooden-spoon');
  });

  it('never returns an empty key, even for a name that normalizes to nothing', () => {
    const item = game({ name: '!!!', inventoryItemId: 'fallback-id' });
    expect(groupKeyFor(item)).toBe('game:title:fallback-id');
  });
});

describe('normalizeTitleKey', () => {
  it('keeps every meaningful word, expansions included', () => {
    expect(normalizeTitleKey('Catan: Seafarers Expansion')).toBe('catan-seafarers-expansion');
  });

  it('folds punctuation and case', () => {
    expect(normalizeTitleKey('Ticket to Ride — Europe')).toBe('ticket-to-ride-europe');
  });
});

describe('groupItems', () => {
  it('counts the copies and names the group once', () => {
    const groups = groupItems([
      game({ name: 'Monopoly', bggId: 1406, inventoryItemId: 'a' }),
      game({ name: 'Monopoly', bggId: 1406, inventoryItemId: 'b' }),
      game({ name: 'Monopoly', bggId: 1406, inventoryItemId: 'c' }),
      game({ name: 'Catan', bggId: 13, inventoryItemId: 'd' }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => [g.name, g.quantity])).toEqual([
      ['Catan', 1],
      ['Monopoly', 3],
    ]);
  });
});

describe('regroupPlan', () => {
  function state(rows: Array<[string, string, GroupableItem]>): ShareItemState[] {
    return rows.map(([shareLinkItemId, cachedGroupKey, item]) => ({
      shareLinkItemId,
      cachedGroupKey,
      item,
    }));
  }

  it('does nothing when nothing changed', () => {
    const plan = regroupPlan(
      state([['1', 'game:bgg:1406', game({ name: 'Monopoly', bggId: 1406 })]]),
      ['game:bgg:1406'],
    );
    expect(plan).toEqual({ updates: [], moves: [], drops: [] });
  });

  it('carries an answer across an unambiguous rename', () => {
    // A title-keyed group whose bgg id has since been confirmed.
    const plan = regroupPlan(
      state([
        ['1', 'game:title:monopoly', game({ name: 'Monopoly', bggId: 1406, inventoryItemId: 'a' })],
        ['2', 'game:title:monopoly', game({ name: 'Monopoly', bggId: 1406, inventoryItemId: 'b' })],
      ]),
      ['game:title:monopoly'],
    );
    expect(plan.updates.map((u) => u.to)).toEqual(['game:bgg:1406', 'game:bgg:1406']);
    expect(plan.moves).toEqual([{ from: 'game:title:monopoly', to: 'game:bgg:1406' }]);
    expect(plan.drops).toEqual([]);
  });

  it('drops an answer when its group splits, because the counts no longer say anything', () => {
    // "sell 2 of these 3" is meaningless once the 3 turn out to be 2 products.
    const plan = regroupPlan(
      state([
        ['1', 'game:title:catan', game({ name: 'Catan', bggId: 13, inventoryItemId: 'a' })],
        ['2', 'game:title:catan', game({ name: 'Catan', bggId: 178900, inventoryItemId: 'b' })],
      ]),
      ['game:title:catan'],
    );
    expect(plan.moves).toEqual([]);
    expect(plan.drops).toEqual([{ groupKey: 'game:title:catan', reason: 'split' }]);
  });

  it('drops both answers when two groups merge, rather than letting one win', () => {
    const plan = regroupPlan(
      state([
        ['1', 'game:title:monopoly', game({ name: 'Monopoly', bggId: 1406, inventoryItemId: 'a' })],
        ['2', 'game:title:monopoly-classic', game({ name: 'Monopoly', bggId: 1406, inventoryItemId: 'b' })],
      ]),
      ['game:title:monopoly', 'game:title:monopoly-classic'],
    );
    expect(plan.moves).toEqual([]);
    expect(plan.drops.map((d) => d.reason)).toEqual(['merge', 'merge']);
  });

  it('drops an answer whose units have all left the share', () => {
    const plan = regroupPlan(state([]), ['game:bgg:1406']);
    expect(plan.drops).toEqual([{ groupKey: 'game:bgg:1406', reason: 'empty' }]);
  });

  it('reports a stale cached key even when no answer depends on it', () => {
    const plan = regroupPlan(
      state([['1', 'game:title:wingspan', game({ name: 'Wingspan', bggId: 266192 })]]),
      [],
    );
    expect(plan.updates).toEqual([
      { shareLinkItemId: '1', from: 'game:title:wingspan', to: 'game:bgg:266192' },
    ]);
    expect(plan.moves).toEqual([]);
    expect(plan.drops).toEqual([]);
  });
});
