/**
 * One row per item you own, not one per box of it.
 *
 * `inventory_items` is one row per physical unit and stays that way — returns,
 * disposal and per-unit landed cost are all trivial because of it. This module
 * is the layer above: it folds those units into the *item* they are copies of,
 * so the list can show "Acquire ×3" and the page behind it can talk about the
 * item rather than about one particular box.
 *
 * Two mechanisms, and which one applies is the whole design:
 *
 *   derived    A unit with no `group_id` stacks on the key from
 *              lib/share/grouping.ts — a confirmed BGG id, else a normalized
 *              title, else the loose fingerprint. Costs nothing, needs no
 *              write, and a copy bought next month joins its siblings on its
 *              own. This is the default and covers almost everything.
 *
 *   explicit   A unit with a `group_id` is where a person put it, and the
 *              derivation no longer gets a vote. That is the only way to say
 *              "these two are the same thing despite the titles" or "this one
 *              is not one of those", and neither is derivable by definition.
 *
 * An explicit group also carries the derived key it stands for (`groupKey`),
 * which is what stops a merge from freezing the stack: a fourth Acquire with
 * no `group_id` still lands in the group the first three were merged into,
 * because its derived key matches. A group holding a split-off unit has no
 * key, so nothing is ever drawn back into it.
 *
 * Both directions are reversible, which is the property that makes the buttons
 * safe to press: merging writes `group_id`, splitting rewrites it, and
 * clearing it hands the unit back to the derivation.
 */
import { groupKeyFor, type GroupableItem } from '@/lib/share/grouping';

/** An explicit group row, as stored. */
export type ItemGroupRow = {
  id: string;
  name: string;
  groupKey: string | null;
};

/** What stacking needs of a unit, on top of what the key needs. */
export type StackableUnit = GroupableItem & {
  /** Set when a person placed this unit by hand. */
  groupId: string | null;
  costCents: number;
  acquiredAt: string | null;
};

export type ItemStack<T extends StackableUnit> = {
  /** Stable identity for this stack: the group id, or the derived key. */
  key: string;
  /** Set only for an explicit group — what "ungroup" would undo. */
  groupId: string | null;
  name: string;
  units: T[];
  quantity: number;
  /** What the whole stack cost. */
  totalCents: number;
  /**
   * The unit the list links to and the one whose details stand for the item.
   * Oldest acquisition first, then lowest id, so it does not move about
   * between renders or between the list and the page.
   */
  primary: T;
};

/**
 * Where a unit belongs: its explicit group, or the group that has claimed its
 * derived key, or the derived key itself.
 *
 * Exported because the actions need exactly this answer when deciding which
 * group a newly merged unit should keep, and the two must not disagree.
 */
export function stackKeyFor(
  unit: StackableUnit,
  groupIdByKey: ReadonlyMap<string, string>,
): string {
  if (unit.groupId) return unit.groupId;
  const derived = groupKeyFor(unit);
  return groupIdByKey.get(derived) ?? derived;
}

/** Oldest first, then by id — a total order, so `primary` never wobbles. */
function byAge(a: StackableUnit, b: StackableUnit): number {
  const left = a.acquiredAt ?? '';
  const right = b.acquiredAt ?? '';
  if (left !== right) {
    // A unit with no date sorts last: an unknown acquisition is not evidence
    // of being the oldest.
    if (!left) return 1;
    if (!right) return -1;
    return left.localeCompare(right);
  }
  return a.inventoryItemId.localeCompare(b.inventoryItemId);
}

/**
 * Fold units into the items they are copies of.
 *
 * Input order is preserved between stacks — the caller has already sorted the
 * list the way the user asked for, and re-sorting here would quietly override
 * the sort control. A stack takes the position of its first unit.
 */
export function stackUnits<T extends StackableUnit>(
  units: readonly T[],
  groups: readonly ItemGroupRow[],
): ItemStack<T>[] {
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const groupIdByKey = new Map(
    groups.flatMap((group) => (group.groupKey ? [[group.groupKey, group.id] as const] : [])),
  );

  const buckets = new Map<string, T[]>();
  for (const unit of units) {
    const key = stackKeyFor(unit, groupIdByKey);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(unit);
    else buckets.set(key, [unit]);
  }

  return [...buckets.entries()].map(([key, bucketUnits]) => {
    const group = groupById.get(key) ?? null;
    const ordered = [...bucketUnits].sort(byAge);
    const primary = ordered[0]!;
    return {
      key,
      groupId: group?.id ?? null,
      // An explicit group's name is a decision too; only fall back to a unit's
      // when nobody has named it.
      name: group?.name ?? (primary.shortName?.trim() || primary.name),
      units: bucketUnits,
      quantity: bucketUnits.length,
      totalCents: bucketUnits.reduce((sum, unit) => sum + unit.costCents, 0),
      primary,
    };
  });
}

/** The stack one unit belongs to, or null when it is not in the list. */
export function stackContaining<T extends StackableUnit>(
  stacks: readonly ItemStack<T>[],
  inventoryItemId: string,
): ItemStack<T> | null {
  return (
    stacks.find((stack) =>
      stack.units.some((unit) => unit.inventoryItemId === inventoryItemId),
    ) ?? null
  );
}

/**
 * What one copy cost, said honestly.
 *
 * Copies of the same thing are usually bought together and cost the same, and
 * then there is a single per-copy price to show beside the quantity. When they
 * differ — one bought used, one on sale — naming any one of them "the price"
 * would be a lie, so the range is shown instead and the total below it carries
 * the real arithmetic.
 */
export function unitCostRange(units: readonly StackableUnit[]): {
  low: number;
  high: number;
  uniform: boolean;
} {
  const costs = units.map((unit) => unit.costCents);
  const low = Math.min(...costs);
  const high = Math.max(...costs);
  return { low, high, uniform: low === high };
}
