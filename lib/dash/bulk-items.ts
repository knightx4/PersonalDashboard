import type { AskDb, SchemaClient } from '@/lib/ask/db';
import { readSubject, sameValue } from '@/lib/core/dash-actions';
import { toRef } from '@/lib/core/refs';
import { displayName, groupUnits } from '@/lib/inventory/group-units';
import { isUuid } from '@/lib/ask/db';
import { namedItems } from '@/lib/ask/change-view';
import type { DashChangeInput } from '@/lib/talk/changes';
import type { DashWriteContext, DashWriteResult } from './registry';

/**
 * Dash changing many shopping items at once (plan #1656, feature #1653): the
 * change_items write. The person names a rule ("everything from the March
 * Amazon order") and Dash finds the rows; the change is the one the
 * inventory's bulk bar would make (components/inventory/inventory-selection.tsx)
 * and it is kept as one core.dash_actions record, so the card under the
 * answer and Home each offer one Undo that puts every item back
 * (docs/UI-QUALITY-SPEC.md, Part 9, R9).
 *
 * The record names the first item it changed as its subject, so it reads
 * like any other change, and keeps every item it changed in `undo.rows`:
 * each row's id and the column's value before and after. Undo
 * (undoItemChange) puts back the rows still holding what Dash left and
 * leaves alone any that have moved on since.
 *
 * Deleting is not one of the changes: a delete cannot be undone from a
 * reply, so it stays on the bulk bar (R10).
 */

/** The most items one change may touch. */
export const BULK_MAX = 100;

/** The changes the bulk bar offers, by the name Dash sends. */
export const ITEM_CHANGES = ['for_sale', 'not_for_sale', 'to_return', 'not_returning', 'group'] as const;
export type ItemChange = (typeof ITEM_CHANGES)[number];

/** The column each flag change writes, and the value it writes there. */
const FLAG: Record<Exclude<ItemChange, 'group'>, { column: 'for_sale' | 'return_planned'; value: boolean }> = {
  for_sale: { column: 'for_sale', value: true },
  not_for_sale: { column: 'for_sale', value: false },
  to_return: { column: 'return_planned', value: true },
  not_returning: { column: 'return_planned', value: false },
};

/** One item the change moved: its id and the column before and after. */
export type ChangedRow = { id: string; before: Record<string, unknown>; after: Record<string, unknown> };

/** What the record keeps in `undo` for change_items. */
export type ItemChangeUndo = {
  rows: ChangedRow[];
  /** The item group Dash made to group them, removed by Undo once nothing is in it. */
  group_made: string | null;
};

const ITEMS = 'public.inventory_items';
const ORDERS = 'public.orders';
/** How many items the card and the summary name before "and N more". */
const NAMED = 3;

type ItemRow = {
  id: string;
  name: string;
  short_name: string | null;
  status: string;
  for_sale: boolean | null;
  return_planned: boolean | null;
  group_id: string | null;
  order_item_id: string | null;
};

const ITEM_SELECT = 'id, name, short_name, status, for_sale, return_planned, group_id, order_item_id';

const refuse = (error: string): DashWriteResult => ({ ok: false, error });

function refList(args: Record<string, unknown>, key: string): string[] | null {
  const value = args[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) return null;
  return [...new Set((value as string[]).map((v) => v.trim()).filter(Boolean))];
}

const noun = (count: number) => (count === 1 ? 'item' : 'items');

/** What the change did, after "Dash", in the past tense. */
function didWords(change: ItemChange, count: number): string {
  switch (change) {
    case 'for_sale':
      return `marked ${count} ${noun(count)} for sale`;
    case 'not_for_sale':
      return `took ${count} ${noun(count)} off the sell page`;
    case 'to_return':
      return `marked ${count} ${noun(count)} to return`;
    case 'not_returning':
      return `took ${count} ${noun(count)} off the to-return list`;
    case 'group':
      return `grouped ${count} copies as one item`;
  }
}

async function readIn<T>(client: SchemaClient, table: string, select: string, column: string, values: string[]): Promise<T[]> {
  if (values.length === 0) return [];
  const { data, error } = await client.from(table).select(select).in(column, values);
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data ?? []) as T[];
}

/**
 * Change many owned items at once. Never throws for a request it refuses:
 * the refusal comes back as the sentence Dash says.
 */
export async function changeItems(ctx: DashWriteContext, args: Record<string, unknown>): Promise<DashWriteResult> {
  if (!ctx.enabledModules.includes('shopping')) {
    return refuse('The Shopping workspace is switched off, so nothing can be changed there.');
  }
  const change = typeof args.change === 'string' ? (args.change.trim() as ItemChange) : null;
  if (!change || !ITEM_CHANGES.includes(change)) {
    return refuse(`change must be one of ${ITEM_CHANGES.join(', ')}. Deleting items is done on the inventory list, not by Dash.`);
  }
  const itemRefs = refList(args, 'item_refs');
  const orderRefs = refList(args, 'order_refs');
  if (!itemRefs || !orderRefs) return refuse('item_refs and order_refs are lists of refs.');
  if (itemRefs.length === 0 && orderRefs.length === 0) {
    return refuse('Name the items by item_refs, or whole orders by order_refs.');
  }
  if (itemRefs.length > BULK_MAX) return refuse(`At most ${BULK_MAX} items can be changed at once. Ask them to narrow it down.`);
  const unseen = [
    ...itemRefs.filter((ref) => !isUuid(ref) || !ctx.seen(ITEMS, ref)).map((ref) => `${ITEMS} ${ref}`),
    ...orderRefs.filter((ref) => !isUuid(ref) || !ctx.seen(ORDERS, ref)).map((ref) => `${ORDERS} ${ref}`),
  ];
  if (unseen.length > 0) {
    return refuse(`No lookup in this conversation returned ${unseen.slice(0, 3).join(', ')}. Look them up first and use the refs they give.`);
  }

  const shop = await ctx.db('public');

  // Orders first: every item from them, the way the order page lists them.
  let fromOrders: string[] = [];
  if (orderRefs.length > 0) {
    const { data: orders, error } = await shop
      .from('orders')
      .select('id')
      .eq('user_id', ctx.userId)
      .is('deleted_at', null)
      .in('id', orderRefs);
    if (error) throw new Error(`orders: ${error.message}`);
    const mine = ((orders ?? []) as { id: string }[]).map((o) => o.id);
    if (mine.length < orderRefs.length) {
      return refuse(`${orderRefs.length - mine.length} of those orders are not theirs or are not there any more, so nothing was changed.`);
    }
    const lines = await readIn<{ id: string }>(shop, 'order_items', 'id, order_id', 'order_id', mine);
    const units = lines.length
      ? ((
          await shop
            .from('inventory_items')
            .select('id')
            .eq('user_id', ctx.userId)
            .in('order_item_id', lines.map((l) => l.id))
        ).data ?? []) as { id: string }[]
      : [];
    fromOrders = units.map((u) => u.id);
  }

  const ids = [...new Set([...itemRefs, ...fromOrders])];
  if (ids.length === 0) return refuse('Those orders have no items in the inventory, so nothing was changed.');
  if (ids.length > BULK_MAX) {
    return refuse(`That is ${ids.length} items, and at most ${BULK_MAX} can be changed at once. Ask them to narrow it down.`);
  }

  const { data, error } = await shop.from('inventory_items').select(ITEM_SELECT).eq('user_id', ctx.userId).in('id', ids);
  if (error) throw new Error(`inventory_items: ${error.message}`);
  const found = (data ?? []) as ItemRow[];
  // Refs are checked against what lookups returned, which are the person's
  // own; a ref that is still not theirs here stops the whole change.
  if (found.length < ids.length) {
    return refuse(`${ids.length - found.length} of those are not items of theirs, so nothing was changed.`);
  }
  // In the order named, so the card names the ones they named first.
  const order = new Map(ids.map((id, i) => [id, i]));
  found.sort((a, b) => order.get(a.id)! - order.get(b.id)!);

  // Only owned items, as on the bulk bar: a sold or returned one is not put on the sell page.
  const owned = found.filter((row) => row.status === 'owned');
  const notOwned = found.length - owned.length;

  let rows: ChangedRow[];
  let groupMade: string | null = null;
  if (change === 'group') {
    if (owned.length < 2) return refuse('Grouping needs at least two items they still own.');
    const grouped = await groupUnits(shop, ctx.userId, owned.map((row) => row.id));
    if (!grouped.ok) return refuse(grouped.error);
    groupMade = grouped.made ? grouped.groupId : null;
    rows = owned
      .filter((row) => grouped.ids.includes(row.id) && row.group_id !== grouped.groupId)
      .map((row) => ({ id: row.id, before: { group_id: row.group_id }, after: { group_id: grouped.groupId } }));
  } else {
    const { column, value } = FLAG[change];
    const moving = owned.filter((row) => !sameValue(row[column] ?? false, value));
    if (moving.length === 0) {
      return refuse(
        `All ${owned.length} ${noun(owned.length)} they still own there are already set that way, so nothing was changed.` +
          (notOwned ? ` ${notOwned} more are no longer owned.` : ''),
      );
    }
    const { data: updated, error: writeError } = await shop
      .from('inventory_items')
      .update({ [column]: value })
      .eq('user_id', ctx.userId)
      .eq('status', 'owned')
      .in('id', moving.map((row) => row.id))
      .select('id');
    if (writeError) throw new Error(`inventory_items: ${writeError.message}`);
    const written = new Set(((updated ?? []) as { id: string }[]).map((row) => row.id));
    rows = moving
      .filter((row) => written.has(row.id))
      .map((row) => ({ id: row.id, before: { [column]: row[column] }, after: { [column]: value } }));
  }
  if (rows.length === 0) return refuse('Those items are already set that way, so nothing was changed.');

  const byId = new Map(found.map((row) => [row.id, row]));
  const titles = rows.slice(0, NAMED).map((row) => displayName(byId.get(row.id)!));
  const left = found.length - rows.length;
  const firstRef = toRef(ITEMS, rows[0].id);
  const subjectAfter = await readSubject(ctx.db, firstRef);
  const subjectBefore = { ...(subjectAfter ?? {}), ...rows[0].before };
  const input: DashChangeInput['change_items'] = { change, count: rows.length, titles, left };
  const undo: ItemChangeUndo = { rows, group_made: groupMade };
  const where = change === 'for_sale' ? '/shopping/sell' : '/shopping/inventory';

  return {
    ok: true,
    kind: 'change_items',
    input: input as unknown as Record<string, unknown>,
    subjectRef: firstRef,
    op: 'update',
    before: subjectBefore,
    after: subjectAfter,
    undo: undo as unknown as Record<string, unknown>,
    summary:
      `Dash ${didWords(change, rows.length)}: ${namedItems(titles, rows.length)}.` +
      (left > 0 ? ` ${left} ${left === 1 ? 'was' : 'were'} left as ${left === 1 ? 'it was' : 'they were'}, already set that way or no longer owned.` : ''),
    row: { table: ITEMS, ref: rows[0].id, title: `${rows.length} ${change === 'group' ? 'copies' : noun(rows.length)}`, href: where },
  };
}

/** Whether a record's `undo` is change_items' shape. */
function itemUndo(value: Record<string, unknown> | null): ItemChangeUndo | null {
  const rows = value?.rows;
  if (!Array.isArray(rows)) return null;
  const ok = rows.every(
    (r) => r && typeof r === 'object' && typeof r.id === 'string' && r.before && r.after && typeof r.before === 'object',
  );
  if (!ok) return null;
  return { rows: rows as ChangedRow[], group_made: typeof value?.group_made === 'string' ? value.group_made : null };
}

/**
 * Put back every item a change_items record changed, where the item still
 * holds what Dash left in it; one moved on since is left alone, so a later
 * change by hand is never lost. Refused only when none could be put back.
 */
export async function undoItemChange(
  deps: { userId: string; db: AskDb },
  recorded: Record<string, unknown> | null,
): Promise<{ ok: true; restored: number; ids: string[] } | { ok: false; error: string }> {
  const undo = itemUndo(recorded);
  if (!undo || undo.rows.length === 0) {
    return { ok: false, error: 'Dash did not keep what this changed, so it cannot be undone.' };
  }
  const shop = await deps.db('public');

  // One write per column and pair of values, narrowed to the rows still as Dash left them.
  const batches = new Map<string, { column: string; before: unknown; after: unknown; ids: string[] }>();
  for (const row of undo.rows) {
    for (const column of Object.keys(row.after)) {
      const key = JSON.stringify([column, row.before[column] ?? null, row.after[column] ?? null]);
      const batch = batches.get(key) ?? { column, before: row.before[column] ?? null, after: row.after[column] ?? null, ids: [] };
      batch.ids.push(row.id);
      batches.set(key, batch);
    }
  }
  const restored = new Set<string>();
  for (const batch of batches.values()) {
    let query = shop
      .from('inventory_items')
      .update({ [batch.column]: batch.before })
      .eq('user_id', deps.userId)
      .in('id', batch.ids);
    query = batch.after === null ? query.is(batch.column, null) : query.eq(batch.column, batch.after);
    const { data, error } = await query.select('id');
    if (error) throw new Error(`inventory_items: ${error.message}`);
    for (const row of (data ?? []) as { id: string }[]) restored.add(row.id);
  }

  // The group Dash made goes once nothing is left in it.
  if (undo.group_made) {
    const { data: members, error } = await shop
      .from('inventory_items')
      .select('id')
      .eq('user_id', deps.userId)
      .eq('group_id', undo.group_made)
      .limit(1);
    if (error) throw new Error(`inventory_items: ${error.message}`);
    if ((members ?? []).length === 0) {
      const { error: groupError } = await shop.from('item_groups').delete().eq('id', undo.group_made).eq('user_id', deps.userId);
      if (groupError) console.error(`undo change_items: the empty group ${undo.group_made} was kept`, groupError.message);
    }
  }

  if (restored.size === 0) {
    return {
      ok: false,
      error: 'Every one of those items has changed since Dash changed it, so undoing would lose the later changes.',
    };
  }
  return { ok: true, restored: restored.size, ids: [...restored] };
}
