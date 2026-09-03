/**
 * Which things are the same thing.
 *
 * The shared form shows one card per *product* with a quantity on it, not one
 * card per box, because "Monopoly Classic, Monopoly Classic, Monopoly Classic"
 * is not a question anyone wants to answer three times. This module decides
 * what stacks with what.
 *
 * Deliberately pure and deliberately not stored on `inventory_items`: the key
 * is derived from data that already exists, and a stored copy of a derived
 * value is a thing that can silently be wrong. It is cached onto
 * `share_link_items.group_key` when an item is added to a share -- which is
 * not a contradiction, because that copy exists so `share_respond()` can count
 * a quantity in SQL, and `regroupPlan()` below exists to refresh it.
 *
 * The other half of grouping -- "do these belong together", the Monopoly
 * heading over twelve themed editions -- is a table, not a computation. See
 * supabase/migrations/0040_item_families.sql.
 */
import { cleanGameTitle } from '@/lib/games/clean-title';
import { normalize } from '@/lib/fingerprint';

/** What the key needs to know about one unit. Sourced from one query. */
export type GroupableItem = {
  inventoryItemId: string;
  name: string;
  shortName: string | null;
  /** From game_details. Null when the item is not a game, or is unresolved. */
  bggId: number | null;
  /**
   * game_details.needs_confirmation. A bgg id behind this flag is a guess the
   * resolver was not sure about, and guesses must not stack: merging two boxes
   * on an unconfirmed match shows a quantity of 2 for a game you own one of.
   */
  needsConfirmation: boolean;
  /** True when the item has a game_details row at all. */
  isGame: boolean;
  fingerprintLoose: string | null;
};

/**
 * Title normalization for identity, which is NOT the same normalization the
 * BGG matcher uses.
 *
 * `normalizeForCompare()` in lib/games/clean-title.ts strips the word
 * "expansion", because a box reading "Catan Expansion Seafarers" and a BGG
 * entry reading "Catan: Seafarers" are the same product and should score as
 * one. Reusing it here would be a bug with a straight face: "Carcassonne" and
 * "Carcassonne Expansion" would normalize to the same string and stack into a
 * single group of 2, so the form would offer to sell "two Carcassonnes" when
 * what is on the shelf is a base game and an expansion.
 *
 * So: same cleanup of retail packaging noise, and then every remaining word
 * kept.
 */
export function normalizeTitleKey(raw: string): string {
  const cleaned = cleanGameTitle(raw);
  return cleaned
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 160);
}

/**
 * The key two units must share to be counted as one product.
 *
 * Three tiers, most trustworthy first:
 *
 *   game:bgg:<id>     a confirmed BoardGameGeek id, which pins an edition the
 *                     way an ISBN pins a printing. Two boxes here really are
 *                     the same product.
 *   game:title:<t>    a game with no confirmed id. Weaker, and knowingly so:
 *                     a title match can merge a 2015 reprint with a 3D
 *                     special. It is still better than showing the same words
 *                     four times.
 *   item:<fp>         anything else, on the loose fingerprint the already-own
 *                     check already uses.
 */
export function groupKeyFor(item: GroupableItem): string {
  if (item.bggId != null && !item.needsConfirmation) {
    return `game:bgg:${item.bggId}`;
  }

  const title = normalizeTitleKey(item.shortName?.trim() || item.name);

  if (item.isGame) {
    return `game:title:${title || item.inventoryItemId}`;
  }

  if (item.fingerprintLoose) {
    return `item:fp:${item.fingerprintLoose}`;
  }

  // Last resort: normalize() rather than normalizeTitleKey(), because a
  // non-game has not been through the board-game packaging cleanup and
  // "the"/"with" are noise there too.
  const generic = normalize(item.shortName?.trim() || item.name).replace(/\s+/g, '-');
  return `item:title:${generic || item.inventoryItemId}`;
}

/** The label shown on the card for a group. Identical units, so any name does. */
export function groupDisplayName(items: readonly GroupableItem[]): string {
  const names = items
    .map((i) => i.shortName?.trim() || i.name.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return names[0] ?? '';
}

export type GroupedItems = {
  groupKey: string;
  items: GroupableItem[];
  quantity: number;
  name: string;
};

/** Fold units into products. Order is stable: by display name. */
export function groupItems(items: readonly GroupableItem[]): GroupedItems[] {
  const buckets = new Map<string, GroupableItem[]>();
  for (const item of items) {
    const key = groupKeyFor(item);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }

  return [...buckets.entries()]
    .map(([groupKey, bucketItems]) => ({
      groupKey,
      items: bucketItems,
      quantity: bucketItems.length,
      name: groupDisplayName(bucketItems),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

// ---------------------------------------------------------------------------
// Regrouping
// ---------------------------------------------------------------------------

/**
 * A share caches each item's group key so the database can count a quantity
 * without trusting the caller. Confirming a bgg id or fixing a title changes
 * what that key should be, and then her answers are filed under a key nothing
 * points at any more.
 *
 * The rule is: move an answer only when the move is unambiguous, drop it
 * otherwise, and never guess. "Keep 1, sell 2" carried onto a group that just
 * absorbed four more boxes is not the answer she gave.
 *
 * Both directions of ambiguity are dropped, and the second is easy to miss:
 *
 *   split -- one old group's items now land in two or more new keys. Which new
 *            group inherits "sell 2" is unanswerable.
 *   merge -- two old groups now share one new key. Whichever answer was
 *            written second would silently overwrite the first.
 */
export type RegroupPlan = {
  /** Items whose cached key is stale. */
  updates: Array<{ shareLinkItemId: string; from: string; to: string }>;
  /** Answers that follow their group to a new key. */
  moves: Array<{ from: string; to: string }>;
  /** Answers that can no longer be placed, and why. */
  drops: Array<{ groupKey: string; reason: 'split' | 'merge' | 'empty' }>;
};

export type ShareItemState = {
  shareLinkItemId: string;
  /** The key currently cached on the share row. */
  cachedGroupKey: string;
  item: GroupableItem;
};

export function regroupPlan(
  state: readonly ShareItemState[],
  answeredGroupKeys: readonly string[],
): RegroupPlan {
  const updates: RegroupPlan['updates'] = [];
  const oldToNew = new Map<string, Set<string>>();
  const newToOld = new Map<string, Set<string>>();

  for (const row of state) {
    const next = groupKeyFor(row.item);
    if (next !== row.cachedGroupKey) {
      updates.push({ shareLinkItemId: row.shareLinkItemId, from: row.cachedGroupKey, to: next });
    }
    const forward = oldToNew.get(row.cachedGroupKey) ?? new Set<string>();
    forward.add(next);
    oldToNew.set(row.cachedGroupKey, forward);

    const back = newToOld.get(next) ?? new Set<string>();
    back.add(row.cachedGroupKey);
    newToOld.set(next, back);
  }

  const moves: RegroupPlan['moves'] = [];
  const drops: RegroupPlan['drops'] = [];

  for (const groupKey of answeredGroupKeys) {
    const targets = oldToNew.get(groupKey);

    // Nothing on the share carries this key any more: every unit it counted
    // was removed or deleted.
    if (!targets || targets.size === 0) {
      drops.push({ groupKey, reason: 'empty' });
      continue;
    }

    if (targets.size > 1) {
      drops.push({ groupKey, reason: 'split' });
      continue;
    }

    const [target] = [...targets];
    if (target === groupKey) continue; // unchanged; the answer stays put

    if ((newToOld.get(target)?.size ?? 0) > 1) {
      drops.push({ groupKey, reason: 'merge' });
      continue;
    }

    moves.push({ from: groupKey, to: target });
  }

  return { updates, moves, drops };
}
