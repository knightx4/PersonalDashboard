import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isUuid, type AskDb, type AskRow, type SchemaClient } from '@/lib/ask/db';
import { namedItems } from '@/lib/ask/change-view';
import type { ShoppingChangeInput, ShoppingChangeKind } from '@/lib/ask/shopping-changes';
import { slugifyCategoryName } from '@/lib/categories/slugify';
import { toRef } from '@/lib/core/refs';
import { enrichItemDisplay } from '@/lib/inventory/enrich-display';
import { displayName } from '@/lib/inventory/group-units';
import { stackSiblingIds } from '@/lib/inventory/stack-siblings';
import { pickListGradient } from '@/lib/lists/gradients';
import { formatMoney } from '@/lib/money';
import { sellIdentityOf } from '@/lib/sell/item-quote';
import { BULK_MAX } from './bulk-items';
import type { DashWriteContext, DashWriteResult, DashWriteTool } from './registry';

/**
 * The Shopping changes an agent makes when asked, one item or one list at a
 * time (plan #1894.5.1, feature #1894.5). change_items (lib/dash/bulk-items.ts)
 * keeps the ones the inventory's bulk bar makes over many items: for sale, to
 * return, grouped, ungrouped, separated, disposed of.
 *
 *   change_item   one item's name, variant or notes (reaching every copy in
 *                 its stack, as the item page's Details form does), a note
 *                 added to it (the sell page's "planning to list"), the name
 *                 of the group it is in, or its sell price.
 *   item_lists    items put on one of their lists or taken off it, the list
 *                 made when it is new, or a list renamed.
 *
 * Both Ask and the connector run them, as News's (lib/dash/news-writes.ts):
 * Ask on the person's own clients, the connector on service-role ones for the
 * verified person. The service role passes no row level security, and the
 * detail and list-membership tables have no user_id of their own, so every
 * ref is checked against the person's user id here before it is used.
 *
 * One change can touch several rows: every copy in a stack, the group, the
 * book's details. So each keeps what it changed in `undo` (ShoppingUndo), and
 * undoShoppingChange puts every row back from it, from Ask, a thread or the
 * connector alike (MANY_ROW_KINDS in lib/core/dash-actions.ts sends a
 * connector's record to Ask's undo, which calls it). As #1894.4 settled, the
 * writes go straight in and Home lists each with an Undo.
 *
 * To add a tool (the sibling steps under #1894.5 do): write its run function
 * returning a ShoppingMade, with every row it touched in `undo`; add an entry
 * to SHOPPING_WRITES; add its name to SHOPPING_CHANGE_KINDS in
 * lib/ask/shopping-changes.ts and to the kind check on core.dash_actions in a
 * migration that keeps every kind in the live list; add any new table to
 * TABLES below; point its entries in lib/inventory/agent-actions.ts at it;
 * and name it in the tool lists in lib/dash/ask.ts, lib/dash/thread.ts and
 * lib/connector/mcp.ts. Ask, threads and the connector pick it up from here.
 */

export type ShoppingWriteEnv = {
  userId: string;
  /** The public schema, where every Shopping table is. */
  shop: SchemaClient;
};

/** The tables a Shopping change may name in its undo, and whether each keeps a user_id. */
const TABLES = {
  inventory_items: { owned: true },
  item_groups: { owned: true },
  item_lists: { owned: true },
  book_details: { owned: false },
  game_details: { owned: false },
  inventory_item_lists: { owned: false },
} as const;

export type ShoppingTable = keyof typeof TABLES;

type Row = Record<string, unknown>;

/**
 * What a Shopping change keeps in `undo`: the rows it updated, with the
 * columns before and after; the rows it added; and the rows it took away,
 * whole. Undo puts each back where it still holds what Dash left.
 */
export type ShoppingUndo = {
  rows?: { table: ShoppingTable; id: string; before: Row; after: Row }[];
  added?: { table: ShoppingTable; id: string }[];
  removed?: { table: ShoppingTable; values: Row }[];
};

/** A Shopping change as made, before a surface keeps it. */
export type ShoppingMade = {
  kind: ShoppingChangeKind;
  input: ShoppingChangeInput;
  subjectRef: string;
  op: 'insert' | 'update';
  before: Row | null;
  after: Row | null;
  undo: ShoppingUndo;
  summary: string;
  row: AskRow;
};

export type ShoppingWrite = {
  name: ShoppingChangeKind;
  /** Without the line each surface adds on where the change shows. */
  description: string;
  input_schema: Anthropic.Tool['input_schema'];
  run: (env: ShoppingWriteEnv, args: Args) => Promise<ShoppingMade>;
};

/** A refusal the model reads and says in words. */
export class ShoppingRefused extends Error {}

type Args = Record<string, unknown>;

const ITEMS = 'public.inventory_items';
const LISTS = 'public.item_lists';

function given(args: Args, key: string): boolean {
  return args[key] !== undefined && args[key] !== null;
}

/** A text field when it was given: trimmed, '' kept so the caller can read it as a clear. */
function textArg(args: Args, key: string, max: number): string | undefined {
  if (!given(args, key)) return undefined;
  const value = args[key];
  if (typeof value !== 'string') throw new ShoppingRefused(`${key} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new ShoppingRefused(`${key} is longer than ${max} characters.`);
  return trimmed;
}

function idOf(value: unknown, key: string, what: string): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id) throw new ShoppingRefused(`${key} is missing: give the ${what}'s ref from a lookup.`);
  if (!isUuid(id)) throw new ShoppingRefused(`${key} must be a ${what}'s ref, as a lookup returned it.`);
  return id;
}

/** A name cut to a line for a sentence. */
function named(title: unknown, fallback: string): string {
  const line = typeof title === 'string' ? title.split('\n')[0].trim() : '';
  if (!line) return fallback;
  return line.length > 120 ? `${line.slice(0, 119).trimEnd()}…` : line;
}

async function ownRow(client: SchemaClient, table: string, id: string, userId: string, what: string): Promise<Row> {
  const { data, error } = await client.from(table).select('*').eq('id', id).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`Reading the ${what} failed: ${error.message}`);
  if (!data) throw new ShoppingRefused(`There is no ${what} of theirs with that ref. Look it up first.`);
  return data as Row;
}

const itemHref = (id: string) => `/shopping/inventory/${id}`;
const pick = (row: Row, keys: readonly string[]) => Object.fromEntries(keys.map((key) => [key, row[key] ?? null]));
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// ---------------------------------------------------------------------------
// change_item
// ---------------------------------------------------------------------------

async function changeItem(env: ShoppingWriteEnv, args: Args): Promise<ShoppingMade> {
  const id = idOf(args.item_ref, 'item_ref', 'item');
  const item = await ownRow(env.shop, 'inventory_items', id, env.userId, 'item');
  const title = named(displayName(item as { name: string; short_name: string | null }), 'the item');

  const name = textArg(args, 'name', 300);
  const variant = textArg(args, 'variant', 300);
  const notes = textArg(args, 'notes', 5000);
  const addNote = textArg(args, 'add_note', 1000);
  const groupName = textArg(args, 'group_name', 200);
  const clearPrice = args.clear_sell_price === true;
  let priceCents: number | null | undefined;
  if (given(args, 'sell_price')) {
    const price = args.sell_price;
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
      throw new ShoppingRefused('sell_price is a dollar amount such as 12.5.');
    }
    priceCents = Math.round(price * 100);
  }
  if (clearPrice && priceCents !== undefined) throw new ShoppingRefused('Give sell_price or clear_sell_price, not both.');
  if (clearPrice) priceCents = null;
  if (name === '') throw new ShoppingRefused('name cannot be empty.');
  if (addNote === '') throw new ShoppingRefused('add_note cannot be empty.');
  if (groupName === '') throw new ShoppingRefused('group_name cannot be empty.');
  if (notes !== undefined && addNote !== undefined) {
    throw new ShoppingRefused('Give notes to replace them or add_note to add a line, not both.');
  }
  if ([name, variant, notes, addNote, groupName, priceCents].every((value) => value === undefined)) {
    throw new ShoppingRefused('Say what to change: name, variant, notes, add_note, group_name, sell_price or clear_sell_price.');
  }

  const rows: NonNullable<ShoppingUndo['rows']> = [];
  const said: string[] = [];
  const paths = new Set(['/shopping/inventory', itemHref(id), '/shopping/sell']);

  // Name, variant and notes describe the item, so they reach every copy in its stack, as the page's save does.
  const values: Row = {};
  if (name !== undefined && name !== item.name) values.name = name;
  if (variant !== undefined && !same(variant || null, item.variant)) values.variant = variant || null;
  if (notes !== undefined && !same(notes || null, item.notes)) values.notes = notes || null;
  if ('name' in values || 'variant' in values) {
    let categorySlug: string | null = null;
    let categoryName: string | null = null;
    if (typeof item.category_id === 'string') {
      const { data: category } = await env.shop.from('categories').select('slug, name').eq('id', item.category_id).maybeSingle();
      categorySlug = (category as Row | null)?.slug as string | null ?? null;
      categoryName = (category as Row | null)?.name as string | null ?? null;
    }
    const enriched = enrichItemDisplay({
      name: (values.name as string | undefined) ?? (item.name as string),
      variant: 'variant' in values ? (values.variant as string | null) : (item.variant as string | null),
      categorySlug,
      categoryName,
    });
    values.short_name = enriched.shortName;
    values.search_tags = enriched.searchTags;
  }
  let copies = 1;
  if (Object.keys(values).length > 0) {
    const ids = await stackSiblingIds(env.shop as SupabaseClient, env.userId, id);
    const { data: before, error: readError } = await env.shop
      .from('inventory_items')
      .select('*')
      .eq('user_id', env.userId)
      .in('id', ids);
    if (readError) throw new Error(`Reading the copies failed: ${readError.message}`);
    const { data: updated, error } = await env.shop
      .from('inventory_items')
      .update(values)
      .eq('user_id', env.userId)
      .in('id', ids)
      .select('id');
    if (error) throw new Error(`Changing the item failed: ${error.message}`);
    const written = new Set(((updated ?? []) as Row[]).map((row) => row.id as string));
    for (const copy of (before ?? []) as Row[]) {
      if (!written.has(copy.id as string)) continue;
      rows.push({ table: 'inventory_items', id: copy.id as string, before: pick(copy, Object.keys(values)), after: { ...values } });
      paths.add(itemHref(copy.id as string));
    }
    copies = written.size;
    if ('name' in values) said.push(`renamed it "${named(values.name, 'the item')}"`);
    if ('variant' in values) said.push(values.variant ? `set its variant to "${named(values.variant, '')}"` : 'cleared its variant');
    if ('notes' in values) said.push(values.notes ? 'rewrote its notes' : 'cleared its notes');
  }

  if (addNote !== undefined) {
    const now = await ownRow(env.shop, 'inventory_items', id, env.userId, 'item');
    const next = now.notes ? `${now.notes}\n${addNote}` : addNote;
    const { error } = await env.shop.from('inventory_items').update({ notes: next }).eq('id', id).eq('user_id', env.userId);
    if (error) throw new Error(`Adding the note failed: ${error.message}`);
    rows.push({ table: 'inventory_items', id, before: { notes: now.notes ?? null }, after: { notes: next } });
    said.push(`added the note "${named(addNote, '')}"`);
  }

  if (groupName !== undefined) {
    if (typeof item.group_id !== 'string') {
      throw new ShoppingRefused(`"${title}" is not in a group of copies, so it has no group name: change its name instead.`);
    }
    const group = await ownRow(env.shop, 'item_groups', item.group_id, env.userId, 'item group');
    if (group.name !== groupName) {
      const { error } = await env.shop.from('item_groups').update({ name: groupName }).eq('id', group.id).eq('user_id', env.userId);
      if (error) throw new Error(`Renaming the group failed: ${error.message}`);
      rows.push({ table: 'item_groups', id: group.id as string, before: { name: group.name }, after: { name: groupName } });
      said.push(`renamed its group "${named(groupName, '')}"`);
    }
  }

  if (priceCents !== undefined) {
    // The price lands where the sell page reads it: a book's or a game's details, or the item itself.
    const identity = await sellIdentityOf(env.shop as SupabaseClient, id);
    const table: ShoppingTable = identity?.kind === 'book' ? 'book_details' : identity?.kind === 'game' ? 'game_details' : 'inventory_items';
    let target: Row;
    if (table === 'inventory_items') {
      target = { id, manual_expected_price_cents: item.manual_expected_price_cents ?? null };
    } else {
      const { data, error } = await env.shop
        .from(table)
        .select('id, manual_expected_price_cents')
        .eq('inventory_item_id', id)
        .maybeSingle();
      if (error || !data) throw new Error(`Reading the item's details failed: ${error?.message ?? 'no row'}`);
      target = data as Row;
    }
    if (!same(target.manual_expected_price_cents, priceCents)) {
      let query = env.shop.from(table).update({ manual_expected_price_cents: priceCents }).eq('id', target.id);
      if (table === 'inventory_items') query = query.eq('user_id', env.userId);
      const { error } = await query;
      if (error) throw new Error(`Setting the sell price failed: ${error.message}`);
      rows.push({
        table,
        id: target.id as string,
        before: { manual_expected_price_cents: target.manual_expected_price_cents ?? null },
        after: { manual_expected_price_cents: priceCents },
      });
      said.push(priceCents === null ? 'cleared its sell price' : `set its sell price to ${formatMoney(priceCents)}`);
    }
  }

  if (rows.length === 0) throw new ShoppingRefused(`"${title}" already reads that way, so nothing was changed.`);
  const after = await ownRow(env.shop, 'inventory_items', id, env.userId, 'item');
  const across = copies > 1 ? ` on all ${copies} copies` : '';
  const words = sentence(said);
  return {
    kind: 'change_item',
    input: { verb: 'Changed', what: title, rest: `: ${words}${across}`, href: itemHref(id), where: 'Open the item', paths: [...paths] },
    subjectRef: toRef(ITEMS, id),
    op: 'update',
    before: item,
    after,
    undo: { rows },
    summary: `Dash changed "${title}" in Shopping: ${words}${across}.`,
    row: { table: ITEMS, ref: id, title, href: itemHref(id) },
  };
}

/** "a, b and c". */
function sentence(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// ---------------------------------------------------------------------------
// item_lists
// ---------------------------------------------------------------------------

const LIST_CHANGES = ['add', 'remove', 'rename'] as const;
type ListChange = (typeof LIST_CHANGES)[number];

const listHref = (id: string) => `/shopping/inventory?list=${id}`;

/** A list name as the settings page takes one: two to forty characters, with a letter or number. */
function listName(value: string | undefined, key: string): string {
  if (!value || value.length < 2 || value.length > 40) throw new ShoppingRefused(`${key} must be 2 to 40 characters.`);
  if (!slugifyCategoryName(value)) throw new ShoppingRefused(`${key} needs letters or numbers in it.`);
  return value;
}

/** The list named, by its ref or by its name as they have it, or null when they have none by that name. */
async function findList(env: ShoppingWriteEnv, args: Args): Promise<{ list: Row | null; asked: string }> {
  if (given(args, 'list_ref')) {
    const list = await ownRow(env.shop, 'item_lists', idOf(args.list_ref, 'list_ref', 'list'), env.userId, 'list');
    return { list, asked: list.name as string };
  }
  const asked = textArg(args, 'list', 40);
  if (!asked) throw new ShoppingRefused('Name the list by list, its name, or by list_ref.');
  const slug = slugifyCategoryName(asked);
  if (!slug) throw new ShoppingRefused('list needs letters or numbers in it.');
  const { data, error } = await env.shop.from('item_lists').select('*').eq('user_id', env.userId).eq('slug', slug).maybeSingle();
  if (error) throw new Error(`Reading their lists failed: ${error.message}`);
  return { list: (data as Row | null) ?? null, asked };
}

/** The items named, every one theirs, in the order named. */
async function namedItemRows(env: ShoppingWriteEnv, args: Args): Promise<Row[]> {
  const raw = args.item_refs;
  if (!Array.isArray(raw) || raw.length === 0) throw new ShoppingRefused('item_refs must list the public.inventory_items refs of the items.');
  const ids = [...new Set(raw.map((ref, i) => idOf(ref, `item_refs[${i}]`, 'item')))];
  if (ids.length > BULK_MAX) throw new ShoppingRefused(`At most ${BULK_MAX} items at once. Ask them to narrow it down.`);
  const { data, error } = await env.shop.from('inventory_items').select('id, name, short_name').eq('user_id', env.userId).in('id', ids);
  if (error) throw new Error(`Reading the items failed: ${error.message}`);
  const found = (data ?? []) as Row[];
  if (found.length < ids.length) {
    throw new ShoppingRefused(`${ids.length - found.length} of those are not items of theirs, so nothing was changed.`);
  }
  const order = new Map(ids.map((id, i) => [id, i]));
  return found.sort((a, b) => order.get(a.id as string)! - order.get(b.id as string)!);
}

const itemTitle = (row: Row) => named(displayName(row as { name: string; short_name: string | null }), 'an item');
const noun = (count: number) => (count === 1 ? 'item' : 'items');

async function itemLists(env: ShoppingWriteEnv, args: Args): Promise<ShoppingMade> {
  const change = (typeof args.change === 'string' ? args.change.trim() : '') as ListChange;
  if (!LIST_CHANGES.includes(change)) throw new ShoppingRefused(`change must be one of ${LIST_CHANGES.join(', ')}.`);
  const { list: found, asked } = await findList(env, args);
  const paths = ['/shopping/inventory', '/shopping/settings'];

  if (change === 'rename') {
    if (!found) throw new ShoppingRefused(`They have no list called "${asked}".`);
    const to = listName(textArg(args, 'rename_to', 40), 'rename_to');
    if (to === found.name) throw new ShoppingRefused(`The list is called "${to}" already.`);
    const { data: after, error } = await env.shop
      .from('item_lists')
      .update({ name: to })
      .eq('id', found.id)
      .eq('user_id', env.userId)
      .select('*')
      .single();
    if (error || !after) throw new Error(`Renaming the list failed: ${error?.message ?? 'no row'}`);
    const id = found.id as string;
    return {
      kind: 'item_lists',
      input: { verb: 'Renamed the list', what: to, rest: ` from "${named(found.name, '')}"`, href: listHref(id), where: 'Open the list', paths },
      subjectRef: toRef(LISTS, id),
      op: 'update',
      before: found,
      after: after as Row,
      undo: { rows: [{ table: 'item_lists', id, before: { name: found.name }, after: { name: to } }] },
      summary: `Dash renamed the list "${named(found.name, '')}" to "${to}".`,
      row: { table: LISTS, ref: id, title: to, href: listHref(id) },
    };
  }

  const items = await namedItemRows(env, args);
  const ids = items.map((row) => row.id as string);

  if (change === 'remove') {
    if (!found) throw new ShoppingRefused(`They have no list called "${asked}".`);
    const { data: memberships, error } = await env.shop
      .from('inventory_item_lists')
      .select('*')
      .eq('list_id', found.id)
      .in('inventory_item_id', ids);
    if (error) throw new Error(`Reading the list failed: ${error.message}`);
    const on = (memberships ?? []) as Row[];
    if (on.length === 0) throw new ShoppingRefused(`None of those is on the list "${found.name}".`);
    const { error: removeError } = await env.shop
      .from('inventory_item_lists')
      .delete()
      .eq('list_id', found.id)
      .in('id', on.map((row) => row.id as string));
    if (removeError) throw new Error(`Taking the items off the list failed: ${removeError.message}`);
    const off = new Set(on.map((row) => row.inventory_item_id as string));
    const titles = items.filter((row) => off.has(row.id as string)).map(itemTitle);
    const id = found.id as string;
    const listed = named(found.name, 'the list');
    return {
      kind: 'item_lists',
      input: { verb: 'Took', what: namedItems(titles, titles.length), rest: ` off the list "${listed}"`, href: listHref(id), where: 'Open the list', paths },
      subjectRef: toRef(LISTS, id),
      op: 'update',
      before: found,
      after: found,
      undo: { removed: on.map((values) => ({ table: 'inventory_item_lists' as const, values })) },
      summary: `Dash took ${titles.length} ${noun(titles.length)} off the list "${listed}": ${namedItems(titles, titles.length)}.`,
      row: { table: LISTS, ref: id, title: listed, href: listHref(id) },
    };
  }

  // add: the list is made first when they have none by that name, as the item page's "new list" does.
  const added: NonNullable<ShoppingUndo['added']> = [];
  let list = found;
  if (!list) {
    const name = listName(asked, 'list');
    const { data: existing } = await env.shop.from('item_lists').select('color').eq('user_id', env.userId);
    const color = pickListGradient(((existing ?? []) as Row[]).map((row) => row.color as string | null));
    const { data: made, error } = await env.shop
      .from('item_lists')
      .insert({ user_id: env.userId, name, slug: slugifyCategoryName(name), color })
      .select('*')
      .single();
    if (error || !made) throw new Error(`Making the list failed: ${error?.message ?? 'no row'}`);
    list = made as Row;
    added.push({ table: 'item_lists', id: list.id as string });
  }
  const { data: already, error: readError } = await env.shop
    .from('inventory_item_lists')
    .select('inventory_item_id')
    .eq('list_id', list.id)
    .in('inventory_item_id', ids);
  if (readError) throw new Error(`Reading the list failed: ${readError.message}`);
  const on = new Set(((already ?? []) as Row[]).map((row) => row.inventory_item_id as string));
  const joining = items.filter((row) => !on.has(row.id as string));
  if (joining.length === 0) throw new ShoppingRefused(`Every one of those is on the list "${list.name}" already.`);
  const { data: joined, error } = await env.shop
    .from('inventory_item_lists')
    .insert(joining.map((row) => ({ inventory_item_id: row.id, list_id: list!.id })))
    .select('id');
  if (error) throw new Error(`Putting the items on the list failed: ${error.message}`);
  for (const row of (joined ?? []) as Row[]) added.push({ table: 'inventory_item_lists', id: row.id as string });

  const titles = joining.map(itemTitle);
  const id = list.id as string;
  const listed = named(list.name, 'the list');
  const madeIt = !found;
  return {
    kind: 'item_lists',
    input: {
      verb: 'Put',
      what: namedItems(titles, titles.length),
      rest: ` on ${madeIt ? 'a new list' : 'the list'} "${listed}"`,
      href: listHref(id),
      where: 'Open the list',
      paths,
    },
    subjectRef: toRef(LISTS, id),
    op: madeIt ? 'insert' : 'update',
    before: madeIt ? null : found,
    after: list,
    undo: { added },
    summary: `Dash ${madeIt ? `made the list "${listed}" and put` : 'put'} ${titles.length} ${noun(titles.length)} on ${madeIt ? 'it' : `the list "${listed}"`}: ${namedItems(titles, titles.length)}.`,
    row: { table: LISTS, ref: id, title: listed, href: listHref(id) },
  };
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

function isTable(value: unknown): value is ShoppingTable {
  return typeof value === 'string' && value in TABLES;
}

/** Whether a record's `undo` is a Shopping change's shape. */
function shoppingUndo(value: Record<string, unknown> | null): ShoppingUndo | null {
  if (!value) return null;
  const rows = Array.isArray(value.rows) ? value.rows : [];
  const added = Array.isArray(value.added) ? value.added : [];
  const removed = Array.isArray(value.removed) ? value.removed : [];
  const ok =
    rows.every((r) => r && isTable(r.table) && typeof r.id === 'string' && r.before && r.after) &&
    added.every((r) => r && isTable(r.table) && typeof r.id === 'string') &&
    removed.every((r) => r && isTable(r.table) && r.values && typeof r.values === 'object');
  if (!ok || rows.length + added.length + removed.length === 0) return null;
  return { rows, added, removed } as ShoppingUndo;
}

const scalar = (value: unknown) => value === null || ['string', 'number', 'boolean'].includes(typeof value);

/**
 * Put back every row a Shopping change touched: an updated row where it still
 * holds what Dash left (one changed since keeps the later change), an added
 * row taken away (a list only once nothing is on it), a removed row put back.
 * Refused only when nothing could be put back. Runs on the person's own
 * clients, from Home or Ask.
 */
export async function undoShoppingChange(
  deps: { userId: string; db: AskDb },
  recorded: Record<string, unknown> | null,
): Promise<{ ok: true; restored: number } | { ok: false; error: string }> {
  const undo = shoppingUndo(recorded);
  if (!undo) return { ok: false, error: 'Dash did not keep what this changed, so it cannot be undone.' };
  const shop = await deps.db('public');
  let restored = 0;

  for (const row of undo.rows ?? []) {
    let query = shop.from(row.table).update(row.before).eq('id', row.id);
    if (TABLES[row.table].owned) query = query.eq('user_id', deps.userId);
    for (const [column, value] of Object.entries(row.after)) {
      if (!scalar(value)) continue;
      query = value === null ? query.is(column, null) : query.eq(column, value);
    }
    const { data, error } = await query.select('id');
    if (error) throw new Error(`${row.table}: ${error.message}`);
    restored += (data ?? []).length;
  }

  // Memberships before the list they are on, so a list Dash made is empty when it is reached.
  const added = [...(undo.added ?? [])].sort((a, b) => Number(a.table === 'item_lists') - Number(b.table === 'item_lists'));
  for (const row of added) {
    if (row.table === 'item_lists') {
      const { data: still, error } = await shop.from('inventory_item_lists').select('id').eq('list_id', row.id).limit(1);
      if (error) throw new Error(`inventory_item_lists: ${error.message}`);
      if ((still ?? []).length > 0) continue;
    }
    let query = shop.from(row.table).delete().eq('id', row.id);
    if (TABLES[row.table].owned) query = query.eq('user_id', deps.userId);
    const { data, error } = await query.select('id');
    if (error) throw new Error(`${row.table}: ${error.message}`);
    restored += (data ?? []).length;
  }

  for (const row of undo.removed ?? []) {
    const { data, error } = await shop.from(row.table).upsert(row.values, { onConflict: 'id', ignoreDuplicates: true }).select('id');
    if (error) throw new Error(`${row.table}: ${error.message}`);
    restored += (data ?? []).length;
  }

  if (restored === 0) {
    return { ok: false, error: 'Everything this changed has changed again since, so undoing would lose the later changes.' };
  }
  return { ok: true, restored };
}

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

const ITEM_REF = { type: 'string', description: 'The public.inventory_items ref a lookup returned for the item.' } as const;

export const SHOPPING_WRITES: readonly ShoppingWrite[] = [
  {
    name: 'change_item',
    description:
      "Change one item they own in Shopping, when they ask: its name, variant or notes (these reach every copy in its stack, as the item page's save does), a line added to its notes (\"planning to list it myself\"), the name of the group of copies it is in, or the price they mean to sell it for. Give only what changes; an empty variant or notes clears it. Marking items for sale or to return, grouping, ungrouping, separating or saying they got rid of an item is change_items.",
    input_schema: {
      type: 'object',
      properties: {
        item_ref: ITEM_REF,
        name: { type: 'string', description: 'The new name.' },
        variant: { type: 'string', description: 'The new variant, such as a colour or size; empty clears it.' },
        notes: { type: 'string', description: 'The notes in full, replacing what is there; empty clears them.' },
        add_note: { type: 'string', description: 'A line added to the end of its notes, keeping what is there.' },
        group_name: { type: 'string', description: 'The name of the group of copies the item is in.' },
        sell_price: { type: 'number', description: 'The price they mean to sell it for, in dollars. It beats every price lookup.' },
        clear_sell_price: { type: 'boolean', description: 'True to clear a sell price set by hand.' },
      },
      required: ['item_ref'],
      additionalProperties: false,
    },
    run: changeItem,
  },
  {
    name: 'item_lists',
    description:
      `Put items they own on one of their Shopping lists, take them off one, or rename a list, when they ask ("put these on my Gifts list"). change add puts the items on the list named, making the list when they have none by that name; remove takes them off; rename gives the list rename_to as its name. Name the list by list (its name) or list_ref, and the items by item_refs, at most ${BULK_MAX}. Deleting a list is done in Shopping's settings, not by you.`,
    input_schema: {
      type: 'object',
      properties: {
        change: { type: 'string', enum: [...LIST_CHANGES], description: 'add, remove or rename.' },
        list: { type: 'string', description: 'The list by its name, as they call it.' },
        list_ref: { type: 'string', description: 'Instead of list: the public.item_lists ref of the list.' },
        item_refs: {
          type: 'array',
          items: { type: 'string' },
          maxItems: BULK_MAX,
          description: 'For add and remove: the public.inventory_items refs lookups returned for the items.',
        },
        rename_to: { type: 'string', description: 'For rename: the new name, 2 to 40 characters.' },
      },
      required: ['change'],
      additionalProperties: false,
    },
    run: itemLists,
  },
];

/** Runs one Shopping write. Never throws: a refusal or a failure is the sentence the model reads. */
export async function runShoppingWrite(
  write: ShoppingWrite,
  env: ShoppingWriteEnv,
  input: unknown,
): Promise<ShoppingMade | { ok: false; error: string }> {
  const args = input && typeof input === 'object' ? (input as Args) : {};
  try {
    return await write.run(env, args);
  } catch (error) {
    if (error instanceof ShoppingRefused) return { ok: false, error: error.message };
    console.error(`shopping write ${write.name} failed`, error);
    return { ok: false, error: 'That change could not be made. Tell them nothing was changed.' };
  }
}

/** What a surface says when the person has Shopping switched off. */
export const SHOPPING_OFF = 'The Shopping workspace is switched off, so nothing can be changed there.';

/** Whether the person has Shopping switched on. */
export function shoppingOn(enabled: readonly string[]): boolean {
  return enabled.includes('shopping');
}

const ASK_NOTE =
  'It is done: it shows under your answer with an Undo. Say in your answer what you did, and cite the row this returned.';

/** The Shopping writes as Ask's write tools, run on the person's own clients. */
export const SHOPPING_WRITE_TOOLS: readonly DashWriteTool<DashWriteResult>[] = SHOPPING_WRITES.map((write) => ({
  name: write.name,
  kind: 'write' as const,
  definition: { name: write.name, description: `${write.description} ${ASK_NOTE}`, input_schema: write.input_schema },
  apply: async (ctx: DashWriteContext, input: unknown): Promise<DashWriteResult> => {
    if (!shoppingOn(ctx.enabledModules)) return { ok: false, error: SHOPPING_OFF };
    const made = await runShoppingWrite(write, { userId: ctx.userId, shop: await ctx.db('public') }, input);
    if ('ok' in made) return made;
    return {
      ok: true,
      ...made,
      input: made.input as unknown as Record<string, unknown>,
      undo: made.undo as unknown as Record<string, unknown>,
    };
  },
}));
