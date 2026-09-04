/**
 * What counts as one item.
 *
 * The interesting cases are all about precedence: a derivation is a guess that
 * is usually right, an explicit group is an instruction that is always right,
 * and the whole design rests on the second beating the first in both
 * directions -- pulling apart what the key stacked, and holding together what
 * it did not.
 */
import { describe, expect, it } from 'vitest';
import {
  stackUnits,
  stackContaining,
  unitCostRange,
  type ItemGroupRow,
  type StackableUnit,
} from '@/lib/inventory/item-groups';

function unit(overrides: Partial<StackableUnit> & { inventoryItemId: string }): StackableUnit {
  return {
    name: 'Acquire',
    shortName: null,
    bggId: null,
    needsConfirmation: false,
    isGame: false,
    fingerprintLoose: null,
    groupId: null,
    costCents: 1000,
    acquiredAt: '2026-01-01',
    ...overrides,
  };
}

const noGroups: ItemGroupRow[] = [];

describe('stackUnits', () => {
  it('stacks copies that derive to the same key, with no group row at all', () => {
    const stacks = stackUnits(
      [
        unit({ inventoryItemId: 'a', isGame: true, bggId: 5 }),
        unit({ inventoryItemId: 'b', isGame: true, bggId: 5 }),
        unit({ inventoryItemId: 'c', isGame: true, bggId: 5 }),
      ],
      noGroups,
    );

    expect(stacks).toHaveLength(1);
    expect(stacks[0]!.quantity).toBe(3);
    expect(stacks[0]!.totalCents).toBe(3000);
    expect(stacks[0]!.groupId).toBeNull();
  });

  it('keeps different things apart', () => {
    const stacks = stackUnits(
      [
        unit({ inventoryItemId: 'a', isGame: true, bggId: 5 }),
        unit({ inventoryItemId: 'b', name: 'Catan', isGame: true, bggId: 13 }),
      ],
      noGroups,
    );
    expect(stacks).toHaveLength(2);
  });

  it('honours an explicit group over the derived key, in both directions', () => {
    // `a` and `b` derive apart (different titles) and are grouped by hand.
    // `c` derives to the same key as `b` but was split out, so it stays out.
    const groups: ItemGroupRow[] = [
      { id: 'g1', name: 'Acquire', groupKey: null },
      { id: 'g2', name: 'Acquire (spare)', groupKey: null },
    ];
    const stacks = stackUnits(
      [
        unit({ inventoryItemId: 'a', name: 'Acquire 1963', groupId: 'g1' }),
        unit({ inventoryItemId: 'b', name: 'Acquire', groupId: 'g1' }),
        unit({ inventoryItemId: 'c', name: 'Acquire', groupId: 'g2' }),
      ],
      groups,
    );

    expect(stacks).toHaveLength(2);
    const merged = stacks.find((stack) => stack.groupId === 'g1')!;
    expect(merged.units.map((u) => u.inventoryItemId)).toEqual(['a', 'b']);
    expect(stacks.find((stack) => stack.groupId === 'g2')!.quantity).toBe(1);
  });

  it('draws a later copy into the group that claimed its derived key', () => {
    // The point of item_groups.group_key: a fourth Acquire bought next month
    // joins the three that were merged, instead of forming a stack beside it.
    const groups: ItemGroupRow[] = [
      { id: 'g1', name: 'Acquire', groupKey: 'game:bgg:5' },
    ];
    const stacks = stackUnits(
      [
        unit({ inventoryItemId: 'a', isGame: true, bggId: 5, groupId: 'g1' }),
        unit({ inventoryItemId: 'new', isGame: true, bggId: 5, groupId: null }),
      ],
      groups,
    );

    expect(stacks).toHaveLength(1);
    expect(stacks[0]!.groupId).toBe('g1');
    expect(stacks[0]!.quantity).toBe(2);
  });

  it('leaves a keyless group closed, which is what makes a split stick', () => {
    const groups: ItemGroupRow[] = [{ id: 'g2', name: 'Acquire', groupKey: null }];
    const stacks = stackUnits(
      [
        unit({ inventoryItemId: 'split', isGame: true, bggId: 5, groupId: 'g2' }),
        unit({ inventoryItemId: 'loose', isGame: true, bggId: 5, groupId: null }),
      ],
      groups,
    );
    expect(stacks).toHaveLength(2);
  });

  it('names a stack after its group, and an underived one after its primary', () => {
    const groups: ItemGroupRow[] = [{ id: 'g1', name: 'The Acquire pile', groupKey: null }];
    const [named] = stackUnits([unit({ inventoryItemId: 'a', groupId: 'g1' })], groups);
    expect(named!.name).toBe('The Acquire pile');

    const [derived] = stackUnits(
      [unit({ inventoryItemId: 'a', shortName: 'Acquire' })],
      noGroups,
    );
    expect(derived!.name).toBe('Acquire');
  });

  it('picks the oldest copy as primary, and undated copies last', () => {
    const stacks = stackUnits(
      [
        unit({ inventoryItemId: 'c', isGame: true, bggId: 5, acquiredAt: null }),
        unit({ inventoryItemId: 'b', isGame: true, bggId: 5, acquiredAt: '2026-05-01' }),
        unit({ inventoryItemId: 'a', isGame: true, bggId: 5, acquiredAt: '2024-01-01' }),
      ],
      noGroups,
    );
    expect(stacks[0]!.primary.inventoryItemId).toBe('a');
  });

  it('takes the position of its first unit, so the sort control still holds', () => {
    const stacks = stackUnits(
      [
        unit({ inventoryItemId: 'z', name: 'Zebra' }),
        unit({ inventoryItemId: 'a1', name: 'Acquire', isGame: true, bggId: 5 }),
        unit({ inventoryItemId: 'a2', name: 'Acquire', isGame: true, bggId: 5 }),
      ],
      noGroups,
    );
    expect(stacks.map((stack) => stack.name)).toEqual(['Zebra', 'Acquire']);
  });
});

describe('stackContaining', () => {
  it('finds the stack a copy is in, whichever copy is asked for', () => {
    const stacks = stackUnits(
      [
        unit({ inventoryItemId: 'a', isGame: true, bggId: 5 }),
        unit({ inventoryItemId: 'b', isGame: true, bggId: 5 }),
      ],
      noGroups,
    );
    expect(stackContaining(stacks, 'b')?.quantity).toBe(2);
    expect(stackContaining(stacks, 'missing')).toBeNull();
  });
});

describe('unitCostRange', () => {
  it('reports a single price when the copies agree', () => {
    expect(unitCostRange([unit({ inventoryItemId: 'a' }), unit({ inventoryItemId: 'b' })])).toEqual(
      { low: 1000, high: 1000, uniform: true },
    );
  });

  it('reports a range when they do not, rather than picking one', () => {
    expect(
      unitCostRange([
        unit({ inventoryItemId: 'a', costCents: 1000 }),
        unit({ inventoryItemId: 'b', costCents: 1400 }),
      ]),
    ).toEqual({ low: 1000, high: 1400, uniform: false });
  });
});
