import { sameAs, noButton, type DashWriteRuns } from './runs';
import { randomUUID } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isUuid, type AskDb, type AskRow, type AskSchema, type SchemaClient } from '@/lib/ask/db';
import { namedItems } from '@/lib/ask/change-view';
import type { ShoppingChangeInput, ShoppingChangeKind } from '@/lib/ask/shopping-changes';
import { classifyScannedCode } from '@/lib/barcodes/scan-code';
import { buildOwnedBookRows, type OwnedBookBundle } from '@/lib/books/create-owned-book';
import { normalizeIsbn } from '@/lib/books/isbn';
import { resolveBook } from '@/lib/books/resolve';
import type { CanonicalBook } from '@/lib/books/types';
import { slugifyCategoryName } from '@/lib/categories/slugify';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { toRef } from '@/lib/core/refs';
import { fingerprintLoose } from '@/lib/fingerprint';
import { fetchMessageBody } from '@/lib/inbox/fetch-message-body';
import { DISMISSED_REVIEW_ERROR } from '@/lib/inbox/merchant-exclusion-match';
import { applyLifecycleToOrder } from '@/lib/orders/apply-lifecycle';
import { buildManualOrder } from '@/lib/orders/create-manual-order';
import { extractionForAttach, isAttachableClassification, lifecycleKindForAttach } from '@/lib/review/attach-email';
import { canReadAsOrder } from '@/lib/review/read-order';
import { findMerchantByUrl } from '@/lib/saved/resolve-merchant';
import { buildOwnedGameRows, type OwnedGameBundle } from '@/lib/games/create-owned-game';
import type { CanonicalGame } from '@/lib/games/types';
import { enrichItemDisplay } from '@/lib/inventory/enrich-display';
import { displayName } from '@/lib/inventory/group-units';
import { stackSiblingIds } from '@/lib/inventory/stack-siblings';
import { pickListGradient } from '@/lib/lists/gradients';
import { PERSON_COLOURS } from '@/lib/people/load';
import { mergePayments, moveCharges, renamePayment, setPaymentCounted } from '@/lib/recurring/corrections';
import { payeeKey } from '@/lib/recurring/extraction';
import { PAYEE_MAX } from '@/lib/recurring/limits';
import { MOVED_NO_UNDO } from '@/lib/recurring/record';
import { formatMoney, todayInTimezone } from '@/lib/money';
import { sellIdentityOf } from '@/lib/sell/item-quote';
import { ensureItemTags, linkOrderItemTags } from '@/lib/tags/ensure';
import { normalizeTagLabel, slugifyTagName } from '@/lib/tags/guess';
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
 *                 Also a book's or a game's condition, and its edition
 *                 confirmed (plan #1894.5.2).
 *   item_lists    items put on one of their lists or taken off it, the list
 *                 made when it is new, or a list renamed.
 *   change_saved_item
 *                 the saved-for-later list: a product saved, its title, link,
 *                 price or notes changed, marked bought, put aside or
 *                 brought back (plan #1894.5.3). Deleting one stays on the page.
 *   add_items     books, board games and anything else they own added to the
 *                 inventory, as the add pages save them (plan #1894.5.2).
 *                 Undo takes each one away while nothing hangs off it.
 *   add_order     an order they describe or show on a receipt, entered as
 *                 the order form saves it, or read from a waiting email
 *                 (plan #1894.5.4). Undo takes the whole order away while
 *                 nothing hangs off it or its units.
 *   order_item_tags
 *                 a tag put on an order line or taken off it.
 *   review_orders the review queue: confirm, unconfirm, discard and restore
 *                 orders, dismiss and undismiss waiting emails, and attach one
 *                 to the order it is about. Deleting an order stays on the page.
 *   change_recurring
 *                 a recurring payment renamed, left out of the monthly total
 *                 or counted again, merged into another, or some of its
 *                 charges moved to another payment (plan #1894.5.5). A merge
 *                 and a move have no Undo, as the mail reader's own moves
 *                 have none: each changes the charges and both payments.
 *   return_window a shop's return window set, or a shop of their own added
 *                 with one, as Shopping's settings do (plan #1894.5.5).
 *   change_person someone they shop for added, renamed or given another
 *                 colour (plan #1894.5.5). Removing one stays on the page.
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
  /** The public schema, where every Shopping table but people is. */
  shop: SchemaClient;
  /** Every schema, for core.people and for reading an email again from Gmail (core). Without it, the subject is read alone. */
  db?: AskDb;
};

/** The tables a Shopping change may name in its undo, and whether each keeps a user_id. */
const TABLES = {
  inventory_items: { owned: true },
  item_groups: { owned: true },
  item_lists: { owned: true },
  book_details: { owned: false },
  game_details: { owned: false },
  inventory_item_lists: { owned: false },
  saved_items: { owned: true },
  orders: { owned: true },
  item_tags: { owned: true },
  order_item_tags: { owned: false },
  ingested_messages: { owned: false },
  shipments: { owned: false },
  returns: { owned: true },
  recurring_payments: { owned: true },
  merchant_return_policies: { owned: true },
  // A shop of their own keeps its owner in created_by_user_id (OWNER_COLUMN).
  merchants: { owned: false },
  // In core, not public (TABLE_SCHEMA).
  people: { owned: true },
} as const;

/** The tables outside public. */
const TABLE_SCHEMA: Partial<Record<keyof typeof TABLES, AskSchema>> = { people: 'core' };

/** The tables whose owner is kept under another name than user_id. */
const OWNER_COLUMN: Partial<Record<keyof typeof TABLES, string>> = { merchants: 'created_by_user_id' };

/** The column that says whose a row is, or null for a table that keeps none. */
function ownerColumn(table: keyof typeof TABLES): string | null {
  return OWNER_COLUMN[table] ?? (TABLES[table].owned ? 'user_id' : null);
}

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
  /** Why there is no Undo, for a change that cannot be put back row by row (noUndoReason). */
  none?: string;
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
  /** The buttons it does the same as, or why none does (./runs.ts). */
  runs: DashWriteRuns;
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

/** The conditions a book's or a game's details take (the book_condition and game_condition enums). */
const CONDITIONS = {
  book_details: ['new', 'like_new', 'very_good', 'good', 'acceptable'],
  game_details: ['new_sealed', 'like_new', 'complete_used', 'incomplete', 'damaged'],
} as const;

/** The book or game details of an item already checked to be theirs, or null for anything else. */
async function detailsOf(env: ShoppingWriteEnv, itemId: string): Promise<{ table: 'book_details' | 'game_details'; row: Row } | null> {
  for (const table of ['book_details', 'game_details'] as const) {
    const { data, error } = await env.shop.from(table).select('*').eq('inventory_item_id', itemId).maybeSingle();
    if (error) throw new Error(`Reading the item's details failed: ${error.message}`);
    if (data) return { table, row: data as Row };
  }
  return null;
}

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
  const condition = textArg(args, 'condition', 40);
  const confirmEdition = args.confirm_edition === true;
  if (name === '') throw new ShoppingRefused('name cannot be empty.');
  if (addNote === '') throw new ShoppingRefused('add_note cannot be empty.');
  if (groupName === '') throw new ShoppingRefused('group_name cannot be empty.');
  if (notes !== undefined && addNote !== undefined) {
    throw new ShoppingRefused('Give notes to replace them or add_note to add a line, not both.');
  }
  if ([name, variant, notes, addNote, groupName, priceCents, condition].every((value) => value === undefined) && !confirmEdition) {
    throw new ShoppingRefused(
      'Say what to change: name, variant, notes, add_note, group_name, sell_price, clear_sell_price, condition or confirm_edition.',
    );
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

  if (condition !== undefined || confirmEdition) {
    // A book's or a game's details, as the item page's condition picker and "this is the right edition" press write them.
    const details = await detailsOf(env, id);
    if (!details) {
      throw new ShoppingRefused(`"${title}" is not a book or a board game, so it has no condition or edition to set.`);
    }
    const values: Row = {};
    if (condition !== undefined) {
      const allowed = CONDITIONS[details.table];
      const next = condition === '' ? null : condition;
      if (next !== null && !(allowed as readonly string[]).includes(next)) {
        throw new ShoppingRefused(`condition for a ${details.table === 'book_details' ? 'book' : 'game'} is one of ${allowed.join(', ')}, or empty to clear it.`);
      }
      if (!same(details.row.condition, next)) values.condition = next;
    }
    if (confirmEdition && details.row.needs_confirmation === true) {
      Object.assign(values, { needs_confirmation: false, candidates: [], confirmation_reason: null });
    }
    if (Object.keys(values).length > 0) {
      const { error } = await env.shop.from(details.table).update(values).eq('id', details.row.id);
      if (error) throw new Error(`Changing the item's details failed: ${error.message}`);
      rows.push({ table: details.table, id: details.row.id as string, before: pick(details.row, Object.keys(values)), after: { ...values } });
      if ('condition' in values) said.push(values.condition ? `set its condition to ${String(values.condition).replace(/_/g, ' ')}` : 'cleared its condition');
      if ('needs_confirmation' in values) said.push('confirmed its edition');
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
// add_items
// ---------------------------------------------------------------------------

const ADD_KINDS = ['book', 'game', 'other'] as const;
type AddKind = (typeof ADD_KINDS)[number];

/** The most items one call adds, a shelf's worth. */
export const ADD_MAX = 50;

/** One item as asked for, checked, before any catalog lookup. */
type AddAsked = {
  kind: AddKind;
  title: string | null;
  isbn: { isbn13: string; isbn10: string | null } | null;
  authors: string[];
  publisher: string | null;
  year: number | null;
  edition: string | null;
  barcode: string | null;
  variant: string | null;
  notes: string | null;
  category: string | null;
  costCents: number;
  acquiredOn: string | null;
};

function addAsked(raw: unknown, i: number): AddAsked {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ShoppingRefused(`items[${i}] must be an object.`);
  const args = raw as Args;
  const at = (key: string) => `items[${i}].${key}`;
  const text = (key: string, max: number) => {
    try {
      return textArg(args, key, max);
    } catch (error) {
      if (error instanceof ShoppingRefused) throw new ShoppingRefused(`items[${i}].${error.message}`);
      throw error;
    }
  };
  const kind = (typeof args.kind === 'string' ? args.kind.trim() : '') as AddKind;
  if (!ADD_KINDS.includes(kind)) throw new ShoppingRefused(`${at('kind')} must be one of ${ADD_KINDS.join(', ')}.`);
  const title = text('title', 300) || null;
  const isbnRaw = text('isbn', 40);
  const isbn = isbnRaw ? normalizeIsbn(isbnRaw) : null;
  if (isbnRaw && !isbn) throw new ShoppingRefused(`${at('isbn')} failed its check digit; ask them to read it again.`);
  if (isbn && kind !== 'book') throw new ShoppingRefused(`${at('isbn')} is for a book: give kind book.`);
  if (!title && !isbn) throw new ShoppingRefused(`${at('title')} is missing: give the title${kind === 'book' ? ', or the ISBN' : ''}.`);

  const authorsRaw = args.authors;
  if (authorsRaw !== undefined && authorsRaw !== null && (!Array.isArray(authorsRaw) || authorsRaw.some((a) => typeof a !== 'string'))) {
    throw new ShoppingRefused(`${at('authors')} must list names.`);
  }
  const authors = ((authorsRaw as string[] | undefined) ?? []).map((a) => a.trim()).filter(Boolean).slice(0, 20);

  let year: number | null = null;
  if (given(args, 'year')) {
    const value = args.year;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1000 || value > 2100) {
      throw new ShoppingRefused(`${at('year')} must be a four-digit year.`);
    }
    year = value;
  }

  let costCents = 0;
  if (given(args, 'cost')) {
    const value = args.cost;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new ShoppingRefused(`${at('cost')} is a dollar amount such as 24.99.`);
    costCents = Math.round(value * 100);
  }

  const acquiredOn = text('acquired_on', 10) || null;
  if (acquiredOn && !/^\d{4}-\d{2}-\d{2}$/.test(acquiredOn)) throw new ShoppingRefused(`${at('acquired_on')} must be a date, YYYY-MM-DD.`);

  const barcodeRaw = text('barcode', 40);
  const code = barcodeRaw ? classifyScannedCode(barcodeRaw) : null;
  if (barcodeRaw && code?.kind === 'isbn' && kind !== 'book') {
    throw new ShoppingRefused(`${at('barcode')} is an ISBN, so it is a book: give kind book and the ISBN.`);
  }

  const onlyFor = (key: string, kinds: readonly AddKind[]) => {
    if (given(args, key) && !kinds.includes(kind)) throw new ShoppingRefused(`${at(key)} is not taken for kind ${kind}.`);
  };
  onlyFor('authors', ['book']);
  onlyFor('edition', ['book']);
  onlyFor('publisher', ['book', 'game']);
  onlyFor('year', ['book', 'game']);
  onlyFor('variant', ['other']);
  onlyFor('category', ['other']);

  return {
    kind,
    title,
    isbn,
    authors,
    publisher: text('publisher', 200) || null,
    year,
    edition: text('edition', 200) || null,
    barcode: code?.kind === 'product' ? code.ean13 : null,
    variant: text('variant', 300) || null,
    notes: text('notes', 5000) || null,
    category: text('category', 60) || null,
    costCents,
    acquiredOn,
  };
}

/** The book an item names: the catalog's record for its ISBN, else what they gave, as the by-hand form saves it. */
async function bookFor(asked: AddAsked): Promise<{ book: CanonicalBook; lookedUp: boolean } | null> {
  if (asked.isbn) {
    let found: CanonicalBook | null = null;
    try {
      found = await resolveBook({ isbn: asked.isbn.isbn13 }, { googleBooksApiKey: process.env.GOOGLE_BOOKS_API_KEY ?? null });
    } catch (error) {
      console.error('add_items: the book lookup failed', error);
    }
    if (found) return { book: found, lookedUp: true };
  }
  if (!asked.title) return null;
  return {
    lookedUp: false,
    book: {
      isbn13: asked.isbn?.isbn13 ?? null,
      isbn10: asked.isbn?.isbn10 ?? null,
      title: asked.title,
      authors: asked.authors,
      publisher: asked.publisher,
      publishedYear: asked.year,
      edition: asked.edition,
      coverUrl: null,
      weightGrams: null,
      matchConfidence: 1,
      needsConfirmation: false,
      resolutionSource: 'manual',
      alternates: [],
      confirmationReason: null,
    },
  };
}

async function sharedCategoryId(env: ShoppingWriteEnv, slug: string, what: string): Promise<string> {
  const { data, error } = await env.shop.from('categories').select('id').eq('slug', slug).is('user_id', null).maybeSingle();
  if (error) throw new Error(`Reading the ${what} category failed: ${error.message}`);
  if (!data) throw new Error(`The ${what} category is missing from the database.`);
  return (data as Row).id as string;
}

/** A category named for a plain item: theirs or a shared one, by its name. */
async function namedCategory(env: ShoppingWriteEnv, name: string): Promise<{ id: string; slug: string; name: string }> {
  const slug = slugifyCategoryName(name);
  if (!slug) throw new ShoppingRefused('category needs letters or numbers in it.');
  const { data, error } = await env.shop
    .from('categories')
    .select('id, slug, name, user_id')
    .eq('slug', slug)
    .or(`user_id.is.null,user_id.eq.${env.userId}`);
  if (error) throw new Error(`Reading their categories failed: ${error.message}`);
  const found = ((data ?? []) as Row[]).sort((a, b) => Number(a.user_id === null) - Number(b.user_id === null))[0];
  if (!found) throw new ShoppingRefused(`They have no category called "${name}". Leave category out, or use one they have.`);
  return { id: found.id as string, slug: found.slug as string, name: found.name as string };
}

const inventoryRow = (bundle: OwnedBookBundle | OwnedGameBundle, notes: string | null, costCents: number, acquiredOn: string | null): Row => ({
  id: bundle.inventory.id,
  user_id: bundle.inventory.userId,
  order_item_id: null,
  category_id: bundle.inventory.categoryId,
  name: bundle.inventory.name,
  short_name: bundle.inventory.shortName,
  variant: bundle.inventory.variant,
  image_url: bundle.inventory.imageUrl,
  fingerprint_loose: bundle.inventory.fingerprintLoose,
  acquired_at: acquiredOn ?? bundle.inventory.acquiredAt,
  cost_cents: costCents,
  search_tags: bundle.inventory.searchTags,
  notes,
  source: bundle.inventory.source,
  status: bundle.inventory.status,
});

/**
 * Add what they own, as the add pages save it: a book (looked up by its ISBN
 * when they give one, as the scan page does, or saved by hand), a board game
 * by hand, or anything else typed in. Every lookup is made before anything is
 * written, so one that fails leaves nothing half added.
 */
async function addItems(env: ShoppingWriteEnv, args: Args): Promise<ShoppingMade> {
  const raw = args.items;
  if (!Array.isArray(raw) || raw.length === 0) throw new ShoppingRefused('items must list at least one item.');
  if (raw.length > ADD_MAX) throw new ShoppingRefused(`At most ${ADD_MAX} items at once.`);
  const asked = raw.map(addAsked);

  const { data: profile } = await env.shop.from('profiles').select('timezone').eq('id', env.userId).maybeSingle();
  const today = todayInTimezone(((profile as Row | null)?.timezone as string | undefined) ?? 'UTC');
  const booksId = asked.some((a) => a.kind === 'book') ? await sharedCategoryId(env, 'books', 'Books') : null;
  const gamesId = asked.some((a) => a.kind === 'game') ? await sharedCategoryId(env, 'board-games', 'Board games') : null;

  const items: Row[] = [];
  const books: Row[] = [];
  const games: Row[] = [];
  const titles: string[] = [];
  let unconfirmed = 0;

  for (const [i, item] of asked.entries()) {
    if (item.kind === 'book') {
      const found = await bookFor(item);
      if (!found) throw new ShoppingRefused(`No catalog has the ISBN in items[${i}]: ask them for the title and add it by hand.`);
      const bundle = buildOwnedBookRows({ userId: env.userId, booksCategoryId: booksId!, book: found.book, acquiredAt: today, source: 'manual' });
      items.push(inventoryRow(bundle, item.notes, item.costCents, item.acquiredOn));
      const d = bundle.bookDetails;
      if (d.needsConfirmation) unconfirmed += 1;
      books.push({
        id: d.id,
        inventory_item_id: d.inventoryItemId,
        isbn_13: d.isbn13,
        isbn_10: d.isbn10,
        authors: d.authors,
        edition: d.edition,
        publisher: d.publisher,
        published_year: d.publishedYear,
        weight_grams: d.weightGrams,
        condition: null,
        resolution_source: d.resolutionSource,
        match_confidence: d.matchConfidence,
        needs_confirmation: d.needsConfirmation,
        candidates: d.candidates,
        confirmation_reason: d.confirmationReason,
        auto_imported: false,
      });
      titles.push(found.book.title);
    } else if (item.kind === 'game') {
      const game: CanonicalGame = {
        bggId: null,
        barcode: item.barcode,
        title: item.title!,
        yearPublished: item.year,
        publisher: item.publisher,
        minPlayers: null,
        maxPlayers: null,
        playingTimeMinutes: null,
        imageUrl: null,
        matchConfidence: 1,
        needsConfirmation: false,
        resolutionSource: 'manual',
        alternates: [],
        confirmationReason: null,
      };
      const bundle = buildOwnedGameRows({ userId: env.userId, gamesCategoryId: gamesId!, game, acquiredAt: today, source: 'manual', forceConfirmed: true });
      items.push(inventoryRow(bundle, item.notes, item.costCents, item.acquiredOn));
      const d = bundle.gameDetails;
      games.push({
        id: d.id,
        inventory_item_id: d.inventoryItemId,
        bgg_id: d.bggId,
        wikidata_id: d.wikidataId,
        barcode: d.barcode,
        year_published: d.yearPublished,
        publisher: d.publisher,
        min_players: d.minPlayers,
        max_players: d.maxPlayers,
        playing_time_minutes: d.playingTimeMinutes,
        condition: null,
        resolution_source: d.resolutionSource,
        match_confidence: d.matchConfidence,
        needs_confirmation: d.needsConfirmation,
        candidates: d.candidates,
        confirmation_reason: d.confirmationReason,
        auto_imported: d.autoImported,
      });
      titles.push(game.title);
    } else {
      const name = item.title!;
      const category = item.category ? await namedCategory(env, item.category) : null;
      const enriched = enrichItemDisplay({ name, variant: item.variant, categorySlug: category?.slug ?? null, categoryName: category?.name ?? null });
      items.push({
        id: randomUUID(),
        user_id: env.userId,
        order_item_id: null,
        category_id: category?.id ?? null,
        name,
        short_name: enriched.shortName,
        variant: item.variant,
        image_url: null,
        fingerprint_loose: fingerprintLoose(name),
        acquired_at: item.acquiredOn ?? today,
        cost_cents: item.costCents,
        search_tags: item.barcode ? [...enriched.searchTags, item.barcode] : enriched.searchTags,
        notes: item.notes,
        source: 'manual',
        status: 'owned',
      });
      titles.push(name);
    }
  }

  const { error } = await env.shop.from('inventory_items').insert(items);
  if (error) throw new Error(`Adding the items failed: ${error.message}`);
  const ids = items.map((row) => row.id as string);
  for (const [table, rows] of [['book_details', books], ['game_details', games]] as const) {
    if (rows.length === 0) continue;
    const { error: detailError } = await env.shop.from(table).insert(rows);
    if (detailError) {
      await env.shop.from('inventory_items').delete().eq('user_id', env.userId).in('id', ids);
      throw new Error(`Adding the ${table} failed: ${detailError.message}`);
    }
  }

  const first = items[0];
  const count = items.length;
  const shown = titles.map((t) => named(t, 'an item'));
  const short = titles.map((t) => {
    const line = named(t, 'an item');
    return line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line;
  });
  const href = count === 1 ? itemHref(ids[0]) : '/shopping/inventory';
  const confirm = unconfirmed > 0 ? ` ${unconfirmed === 1 ? 'One needs' : `${unconfirmed} need`} its edition confirmed before selling.` : '';
  return {
    kind: 'add_items',
    input: {
      verb: 'Added',
      what: namedItems(shown, count),
      rest: ' to your inventory',
      href,
      where: count === 1 ? 'Open the item' : 'Open the inventory',
      paths: ['/shopping/inventory', '/shopping/sell', ...ids.map(itemHref)],
    },
    subjectRef: toRef(ITEMS, ids[0]),
    op: 'insert',
    before: null,
    after: first,
    // The details go with each item when Undo takes it away (they cascade), so only the items are kept here.
    undo: { added: ids.map((id) => ({ table: 'inventory_items' as const, id })) },
    summary: `Dash added ${count} ${noun(count)} to Shopping: ${namedItems(short, count)}.${confirm}`,
    row: { table: ITEMS, ref: ids[0], title: shown[0], href },
  };
}

// ---------------------------------------------------------------------------
// Orders (plan #1894.5.4): add_order, order_item_tags, review_orders
// ---------------------------------------------------------------------------

const ORDERS = 'public.orders';
const orderHref = (id: string) => `/shopping/orders/${id}`;
const REVIEW_HREF = '/shopping/review';
/** The pages an order change shows on, as the order and review actions revalidate them. */
const ORDER_PATHS = ['/shopping/orders', '/shopping/inventory', '/shopping/dashboard', '/shopping/review', '/shopping/settings'];
/** One selection's worth of review rows, as the queue's bulk bar takes. */
export const REVIEW_MAX = 100;
const DISCARDED_ERROR = 'Discarded from review queue';
const MESSAGE_KEYS = ['parse_status', 'resulting_order_id', 'error'] as const;

/** Dollars as cents, refusing anything that is not a plain amount. */
function centsArg(args: Args, key: string, fallback: number | null): number | null {
  if (!given(args, key)) return fallback;
  const value = args[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new ShoppingRefused(`${key} is a dollar amount such as 12.99.`);
  return Math.round(value * 100);
}

function slugPart(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * The merchant an order is from, by name: a shared one or one of theirs
 * called that, or a new one of theirs, as the order form's "Other merchant"
 * makes. A merchant made here stays when the order is undone; it is a name in
 * their merchant list, with nothing under it.
 */
async function merchantNamed(env: ShoppingWriteEnv, name: string): Promise<{ id: string; slug: string; name: string }> {
  const { data, error } = await env.shop.from('merchants').select('id, slug, name, is_global, created_by_user_id').ilike('name', name);
  if (error) throw new Error(`Reading the merchants failed: ${error.message}`);
  const seen = ((data ?? []) as Row[]).filter((m) => m.is_global === true || m.created_by_user_id === env.userId);
  const found = seen.sort((a, b) => Number(a.created_by_user_id !== env.userId) - Number(b.created_by_user_id !== env.userId))[0];
  if (found) return { id: found.id as string, slug: found.slug as string, name: found.name as string };
  const slug = `${slugPart(name) || 'merchant'}-${env.userId.slice(0, 8)}`;
  const { data: mine } = await env.shop.from('merchants').select('id, slug, name').eq('slug', slug).maybeSingle();
  if (mine) return mine as { id: string; slug: string; name: string };
  const { data: made, error: madeError } = await env.shop
    .from('merchants')
    .insert({ name, slug, created_by_user_id: env.userId, is_global: false })
    .select('id, slug, name')
    .single();
  if (madeError || !made) throw new Error(`Adding the merchant failed: ${madeError?.message ?? 'no row'}`);
  return made as { id: string; slug: string; name: string };
}

type OrderLine = { name: string; variant: string | null; quantity: number; unitPriceCents: number; category: string | null };

function orderLine(raw: unknown, i: number): OrderLine {
  if (!raw || typeof raw !== 'object') throw new ShoppingRefused(`lines[${i}] must be an object.`);
  const line = raw as Args;
  const name = textArg(line, 'name', 300);
  if (!name) throw new ShoppingRefused(`lines[${i}] needs a name.`);
  const quantity = given(line, 'quantity') ? line.quantity : 1;
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    throw new ShoppingRefused(`lines[${i}].quantity must be a whole number from 1 to 100.`);
  }
  const price = centsArg(line, 'unit_price', null);
  if (price === null) throw new ShoppingRefused(`lines[${i}] needs its unit_price in dollars.`);
  return { name, variant: textArg(line, 'variant', 300) || null, quantity, unitPriceCents: price, category: textArg(line, 'category', 80) || null };
}

/** The order's merchant names, by order id, for the sentences. */
async function merchantNames(env: ShoppingWriteEnv, orders: readonly Row[]): Promise<Map<string, string>> {
  const ids = [...new Set(orders.map((o) => o.merchant_id).filter((id): id is string => typeof id === 'string'))];
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const { data, error } = await env.shop.from('merchants').select('id, name').in('id', ids);
  if (error) throw new Error(`Reading the merchants failed: ${error.message}`);
  for (const m of (data ?? []) as Row[]) names.set(m.id as string, m.name as string);
  return names;
}

const orderTitle = (order: Row, merchants: Map<string, string>) =>
  `the ${named(merchants.get(order.merchant_id as string), 'unknown merchant')} order of ${order.order_date as string}`;

/**
 * Enter an order they describe, as the order form saves one: the order, a
 * line per thing bought and an inventory item per unit, with the line's
 * guessed tags. From a receipt they photographed it is saved as a receipt
 * order, which is what the receipt page's save does once it has read the
 * photo. From a waiting email it takes the email out of the review queue, as
 * the form opened from that email does. Undo takes the order away, and every
 * unit with it, while nothing hangs off any of them.
 */
async function addOrder(env: ShoppingWriteEnv, args: Args): Promise<ShoppingMade> {
  const rawLines = args.lines;
  if (!Array.isArray(rawLines) || rawLines.length === 0) throw new ShoppingRefused('lines must list at least one thing bought.');
  if (rawLines.length > ADD_MAX) throw new ShoppingRefused(`At most ${ADD_MAX} lines in one order.`);
  const lines = rawLines.map(orderLine);
  const merchantName = textArg(args, 'merchant', 120);
  const orderNumber = textArg(args, 'order_number', 120) || null;
  const currency = textArg(args, 'currency', 3)?.toUpperCase();
  if (currency !== undefined && !/^[A-Z]{3}$/.test(currency)) throw new ShoppingRefused('currency is a 3-letter code such as USD.');
  const tax = centsArg(args, 'tax', 0)!;
  const shipping = centsArg(args, 'shipping', 0)!;
  const discount = centsArg(args, 'discount', 0)!;
  const fromReceipt = args.from_receipt === true;
  const messageId = given(args, 'message_ref') ? idOf(args.message_ref, 'message_ref', 'email') : null;
  if (fromReceipt && messageId) throw new ShoppingRefused('An order comes from a receipt or from an email, not both.');

  const { data: profile } = await env.shop.from('profiles').select('timezone').eq('id', env.userId).maybeSingle();
  const today = todayInTimezone(((profile as Row | null)?.timezone as string | undefined) ?? 'UTC');
  const orderDate = textArg(args, 'order_date', 10) || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(orderDate)) throw new ShoppingRefused('order_date is a day, YYYY-MM-DD.');

  let message: Row | null = null;
  if (messageId) {
    message = await ownRow(env.shop, 'inbox_messages', messageId, env.userId, 'email');
    if (!canReadAsOrder(message.classification as string | null)) {
      throw new ShoppingRefused('That email is not an order confirmation, shipping or delivery email.');
    }
    if (message.parse_status !== 'needs_review') throw new ShoppingRefused('That email has already left the review queue.');
  }

  // Every lookup before anything is written, so one that fails leaves nothing behind.
  const categories = new Map<string, { id: string; slug: string; name: string }>();
  for (const line of lines) {
    if (line.category && !categories.has(line.category)) categories.set(line.category, await namedCategory(env, line.category));
  }
  const merchant = merchantName ? await merchantNamed(env, merchantName) : null;

  const source = messageId ? 'email' : fromReceipt ? 'receipt_photo' : 'manual';
  let built: ReturnType<typeof buildManualOrder>;
  try {
    built = buildManualOrder({
      userId: env.userId,
      merchantId: merchant?.id ?? null,
      merchantSlug: merchant?.slug ?? null,
      externalOrderNumber: orderNumber,
      orderDate,
      source,
      currency,
      taxCents: tax,
      shippingCents: shipping,
      discountCents: discount,
      lines: lines.map((line) => {
        const cat = line.category ? categories.get(line.category) : undefined;
        return {
          name: line.name,
          variant: line.variant,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          categoryId: cat?.id,
          categorySlug: cat?.slug ?? null,
          categoryName: cat?.name ?? null,
        };
      }),
    });
  } catch (error) {
    // A discount larger than the order, which the form refuses the same way.
    throw new ShoppingRefused(error instanceof Error ? error.message : 'Those amounts do not make an order.');
  }

  const orderRow: Row = {
    id: built.order.id,
    user_id: env.userId,
    merchant_id: built.order.merchantId,
    source: built.order.source,
    external_order_number: built.order.externalOrderNumber,
    order_date: built.order.orderDate,
    subtotal_cents: built.order.subtotalCents,
    tax_cents: built.order.taxCents,
    shipping_cents: built.order.shippingCents,
    discount_cents: built.order.discountCents,
    total_cents: built.order.totalCents,
    currency: built.order.currency,
  };
  const { data: order, error: orderError } = await env.shop.from('orders').insert(orderRow).select('*').single();
  if (orderError || !order) throw new Error(`Adding the order failed: ${orderError?.message ?? 'no row'}`);
  const orderId = built.order.id;
  const takeBack = async (why: string): Promise<never> => {
    await env.shop.from('orders').delete().eq('id', orderId).eq('user_id', env.userId);
    throw new Error(why);
  };

  const { error: itemsError } = await env.shop.from('order_items').insert(
    built.orderItems.map((item) => ({
      id: item.id,
      order_id: item.orderId,
      category_id: item.categoryId,
      name: item.name,
      short_name: item.shortName,
      variant: item.variant,
      quantity: item.quantity,
      unit_price_cents: item.unitPriceCents,
      fingerprint_strict: item.fingerprintStrict,
      fingerprint_loose: item.fingerprintLoose,
    })),
  );
  if (itemsError) await takeBack(`Adding the order's lines failed: ${itemsError.message}`);

  for (const item of built.orderItems) {
    if (item.tags.length === 0) continue;
    try {
      const resolved = await ensureItemTags(env.shop as SupabaseClient, env.userId, item.tags);
      await linkOrderItemTags(env.shop as SupabaseClient, item.id, resolved.map((tag) => tag.id));
    } catch {
      // Tags are best-effort, as on the order form; the order itself saved.
    }
  }

  const { error: inventoryError } = await env.shop.from('inventory_items').insert(
    built.inventoryItems.map((item) => ({
      id: item.id,
      user_id: env.userId,
      order_item_id: item.orderItemId,
      category_id: item.categoryId,
      name: item.name,
      short_name: item.shortName,
      variant: item.variant,
      fingerprint_loose: item.fingerprintLoose,
      acquired_at: item.acquiredAt,
      cost_cents: item.costCents,
      search_tags: item.searchTags,
      source: item.source,
      status: 'owned',
    })),
  );
  if (inventoryError) await takeBack(`Adding the order's items failed: ${inventoryError.message}`);

  const undo: ShoppingUndo = { added: [{ table: 'orders', id: orderId }] };
  if (message && messageId) {
    // Conditional on the email still waiting, so a second call that got this far finds it taken.
    const { data: linked, error: linkError } = await env.shop
      .from('ingested_messages')
      .update({ parse_status: 'parsed', resulting_order_id: orderId, error: null })
      .eq('id', messageId)
      .eq('parse_status', 'needs_review')
      .select('*');
    if (linkError || !linked || linked.length === 0) await takeBack(linkError?.message ?? 'That email has already left the review queue.');
    undo.rows = [{ table: 'ingested_messages', id: messageId, before: pick(message, MESSAGE_KEYS), after: pick((linked as Row[])[0], MESSAGE_KEYS) }];
  }

  const units = built.inventoryItems.length;
  const from = merchant ? ` from ${named(merchant.name, 'the shop')}` : '';
  const shown = `${merchant ? named(merchant.name, 'An') : 'An'} order of ${orderDate}`;
  const total = formatMoney(built.order.totalCents, built.order.currency);
  const how = fromReceipt ? ' from their receipt' : messageId ? ' from the waiting email' : '';
  return {
    kind: 'add_order',
    input: {
      verb: 'Added',
      what: shown,
      rest: `, ${total}, with ${units} ${noun(units)}${how}`,
      href: orderHref(orderId),
      where: 'Open the order',
      paths: [...ORDER_PATHS, orderHref(orderId)],
    },
    subjectRef: toRef(ORDERS, orderId),
    op: 'insert',
    before: null,
    after: order as Row,
    undo,
    summary: `Dash added an order${from} of ${orderDate} for ${total}${how}, with ${units} ${noun(units)} in the inventory.`,
    row: { table: ORDERS, ref: orderId, title: shown, href: orderHref(orderId) },
  };
}

const TAG_CHANGES = ['add', 'remove'] as const;
type TagChange = (typeof TAG_CHANGES)[number];

/** An order line of theirs: the line and the order it is on, checked against the person. */
async function ownOrderItem(env: ShoppingWriteEnv, id: string): Promise<{ item: Row; order: Row }> {
  const { data, error } = await env.shop.from('order_items').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Reading the order line failed: ${error.message}`);
  const item = data as Row | null;
  if (!item) throw new ShoppingRefused('There is no order line of theirs with that ref. Look the order up first.');
  const { data: order, error: orderError } = await env.shop
    .from('orders')
    .select('id, merchant_id, order_date')
    .eq('id', item.order_id as string)
    .eq('user_id', env.userId)
    .maybeSingle();
  if (orderError) throw new Error(`Reading the order failed: ${orderError.message}`);
  if (!order) throw new ShoppingRefused('There is no order line of theirs with that ref. Look the order up first.');
  return { item, order: order as Row };
}

/**
 * Put a tag on a line of one of their orders, or take one off, as the order
 * page's tag chips do. A tag they have none of by that name is made, and Undo
 * takes it away again while nothing else carries it.
 */
async function orderItemTags(env: ShoppingWriteEnv, args: Args): Promise<ShoppingMade> {
  const change = (typeof args.change === 'string' ? args.change.trim() : '') as TagChange;
  if (!TAG_CHANGES.includes(change)) throw new ShoppingRefused(`change must be one of ${TAG_CHANGES.join(', ')}.`);
  const lineId = idOf(args.order_item_ref, 'order_item_ref', 'order line');
  const raw = textArg(args, 'tag', 40);
  if (!raw) throw new ShoppingRefused('Give the tag by its name.');
  const label = normalizeTagLabel(raw);
  const slug = label ? slugifyTagName(label) : '';
  if (!label || !slug || label.length < 2) throw new ShoppingRefused('A tag is 2 to 40 characters with a letter or number in it.');
  const { item, order } = await ownOrderItem(env, lineId);
  const line = named(item.name, 'the line');
  const orderId = order.id as string;
  const paths = ['/shopping/orders', '/shopping/settings', orderHref(orderId)];

  const { data: existing, error: tagError } = await env.shop.from('item_tags').select('*').eq('user_id', env.userId).eq('slug', slug).maybeSingle();
  if (tagError) throw new Error(`Reading their tags failed: ${tagError.message}`);
  let tag = existing as Row | null;

  if (change === 'remove') {
    if (!tag) throw new ShoppingRefused(`They have no tag called "${label}".`);
    const { data: link, error } = await env.shop.from('order_item_tags').select('*').eq('order_item_id', lineId).eq('tag_id', tag.id as string).maybeSingle();
    if (error) throw new Error(`Reading the line's tags failed: ${error.message}`);
    if (!link) throw new ShoppingRefused(`"${line}" is not tagged "${tag.name as string}".`);
    const { error: removeError } = await env.shop.from('order_item_tags').delete().eq('id', (link as Row).id as string);
    if (removeError) throw new Error(`Taking the tag off failed: ${removeError.message}`);
    const name = tag.name as string;
    return {
      kind: 'order_item_tags',
      input: { verb: 'Took', what: `the tag "${name}"`, rest: ` off ${line}`, href: orderHref(orderId), where: 'Open the order', paths },
      subjectRef: toRef(ORDERS, orderId),
      op: 'update',
      before: link as Row,
      after: null,
      undo: { removed: [{ table: 'order_item_tags', values: link as Row }] },
      summary: `Dash took the tag "${name}" off "${line}" on an order.`,
      row: { table: ORDERS, ref: orderId, title: line, href: orderHref(orderId) },
    };
  }

  const added: { table: ShoppingTable; id: string }[] = [];
  if (!tag) {
    const { data: made, error } = await env.shop.from('item_tags').insert({ user_id: env.userId, name: label, slug }).select('*').single();
    if (error || !made) throw new Error(`Making the tag failed: ${error?.message ?? 'no row'}`);
    tag = made as Row;
    added.push({ table: 'item_tags', id: tag.id as string });
  }
  const { data: had } = await env.shop.from('order_item_tags').select('id').eq('order_item_id', lineId).eq('tag_id', tag.id as string).maybeSingle();
  if (had) throw new ShoppingRefused(`"${line}" is tagged "${tag.name as string}" already.`);
  const { data: link, error: linkError } = await env.shop.from('order_item_tags').insert({ order_item_id: lineId, tag_id: tag.id }).select('*').single();
  if (linkError || !link) throw new Error(`Tagging the line failed: ${linkError?.message ?? 'no row'}`);
  // The link before the tag, so a tag Dash made is free of it when Undo reaches it.
  added.unshift({ table: 'order_item_tags', id: (link as Row).id as string });
  const name = tag.name as string;
  return {
    kind: 'order_item_tags',
    input: { verb: 'Tagged', what: line, rest: ` "${name}"`, href: orderHref(orderId), where: 'Open the order', paths },
    subjectRef: toRef(ORDERS, orderId),
    op: 'update',
    before: null,
    after: link as Row,
    undo: { added },
    summary: `Dash tagged "${line}" on an order with "${name}".`,
    row: { table: ORDERS, ref: orderId, title: line, href: orderHref(orderId) },
  };
}

const REVIEW_MOVES = ['confirm', 'unconfirm', 'discard', 'restore', 'dismiss', 'undismiss', 'attach'] as const;
type ReviewMove = (typeof REVIEW_MOVES)[number];

function refList(args: Args, key: string, what: string): string[] {
  const raw = args[key];
  if (!Array.isArray(raw) || raw.length === 0) throw new ShoppingRefused(`${key} must list at least one ${what}.`);
  if (raw.length > REVIEW_MAX) throw new ShoppingRefused(`At most ${REVIEW_MAX} at once.`);
  return [...new Set(raw.map((value, i) => idOf(value, `${key}[${i}]`, what)))];
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** The orders of theirs among the refs, with their merchants' names. */
async function ownOrders(env: ShoppingWriteEnv, ids: readonly string[]): Promise<{ orders: Row[]; merchants: Map<string, string> }> {
  const { data, error } = await env.shop.from('orders').select('*').in('id', [...ids]).eq('user_id', env.userId);
  if (error) throw new Error(`Reading the orders failed: ${error.message}`);
  const orders = (data ?? []) as Row[];
  if (orders.length < ids.length) throw new ShoppingRefused('Some of those are not orders of theirs. Look them up first.');
  return { orders, merchants: await merchantNames(env, orders) };
}

/** The waiting emails of theirs among the refs: the inbox_messages view carries the owner the verdict rows do not. */
async function ownMessages(env: ShoppingWriteEnv, ids: readonly string[]): Promise<Row[]> {
  const { data, error } = await env.shop.from('inbox_messages').select('*').in('id', [...ids]).eq('user_id', env.userId);
  if (error) throw new Error(`Reading the emails failed: ${error.message}`);
  const messages = (data ?? []) as Row[];
  if (messages.length < ids.length) throw new ShoppingRefused('Some of those are not emails of theirs. Look them up first.');
  return messages;
}

/** One update per row, keeping each row's columns before and after. */
async function updateKept(
  env: ShoppingWriteEnv,
  table: 'orders' | 'ingested_messages',
  rows: readonly Row[],
  values: Row,
  keys: readonly string[],
): Promise<NonNullable<ShoppingUndo['rows']>> {
  const kept: NonNullable<ShoppingUndo['rows']> = [];
  for (const row of rows) {
    let query = env.shop.from(table).update(values).eq('id', row.id as string);
    if (table === 'orders') query = query.eq('user_id', env.userId);
    const { data, error } = await query.select('*');
    if (error) throw new Error(`${table}: ${error.message}`);
    const after = ((data ?? []) as Row[])[0];
    if (after) kept.push({ table, id: row.id as string, before: pick(row, keys), after: pick(after, keys) });
  }
  return kept;
}

/**
 * Work the review queue, as its buttons and bulk bar do: confirm an imported
 * order that looks right, put a confirmed one back, discard a bad import (the
 * order goes to Deleted orders and its email stops coming back), bring back a
 * deleted or discarded order, dismiss a waiting email or bring one back, and
 * attach a waiting shipping, delivery or return email to the order it is
 * about. Every row moved is kept for Undo.
 */
async function reviewOrders(env: ShoppingWriteEnv, args: Args): Promise<ShoppingMade> {
  const move = (typeof args.move === 'string' ? args.move.trim() : '') as ReviewMove;
  if (!REVIEW_MOVES.includes(move)) throw new ShoppingRefused(`move must be one of ${REVIEW_MOVES.join(', ')}.`);
  if (move === 'attach') return attachEmail(env, args);
  const paths = ORDER_PATHS;

  if (move === 'dismiss' || move === 'undismiss') {
    const ids = refList(args, 'message_refs', 'email');
    const messages = await ownMessages(env, ids);
    const waiting =
      move === 'dismiss'
        ? messages.filter((m) => m.parse_status === 'needs_review')
        : messages.filter((m) => m.parse_status === 'skipped' && m.error === DISMISSED_REVIEW_ERROR);
    if (waiting.length === 0) throw new ShoppingRefused(move === 'dismiss' ? 'Those have left the queue already.' : 'None of those was dismissed from the queue.');
    const values = move === 'dismiss' ? { parse_status: 'skipped', error: DISMISSED_REVIEW_ERROR } : { parse_status: 'needs_review', error: null };
    const rows = await updateKept(env, 'ingested_messages', waiting, values, ['parse_status', 'error']);
    const subjects = waiting.map((m) => named(m.subject, 'an email'));
    const what = namedItems(subjects, subjects.length);
    const verb = move === 'dismiss' ? 'Dismissed' : 'Put back';
    const rest = move === 'dismiss' ? ' from the review queue' : ' in the review queue';
    return {
      kind: 'review_orders',
      input: { verb, what, rest, href: REVIEW_HREF, where: 'Open the review queue', paths },
      subjectRef: toRef('public.inbox_messages', waiting[0].id as string),
      op: 'update',
      before: waiting[0],
      after: null,
      undo: { rows },
      summary: `Dash ${move === 'dismiss' ? 'dismissed' : 'put back'} ${plural(waiting.length, 'email')}${rest}: ${what}.`,
      row: { table: 'public.inbox_messages', ref: waiting[0].id as string, title: subjects[0], href: REVIEW_HREF },
    };
  }

  const ids = refList(args, 'order_refs', 'order');
  const { orders, merchants } = await ownOrders(env, ids);
  const live = orders.filter((o) => o.deleted_at == null);
  let moving: Row[];
  let values: Row;
  let keys: string[];
  let verb: string;
  let rest: string;
  let said: string;
  let messageRows: NonNullable<ShoppingUndo['rows']> = [];

  if (move === 'confirm') {
    moving = live.filter((o) => o.needs_review === true);
    if (moving.length === 0) throw new ShoppingRefused('Those are confirmed already.');
    values = { needs_review: false };
    keys = ['needs_review'];
    [verb, rest, said] = ['Confirmed', ' from the review queue', 'confirmed'];
  } else if (move === 'unconfirm') {
    moving = live.filter((o) => o.needs_review !== true);
    if (moving.length === 0) throw new ShoppingRefused('Those are waiting in the review queue already.');
    values = { needs_review: true };
    keys = ['needs_review'];
    [verb, rest, said] = ['Put back', ' in the review queue', 'put back in the review queue'];
  } else if (move === 'discard') {
    moving = live;
    if (moving.length === 0) throw new ShoppingRefused('Those are gone already.');
    // The emails first, as the queue does, so a re-scan does not bring the order back.
    const { data: sources, error } = await env.shop
      .from('inbox_messages')
      .select('*')
      .in('resulting_order_id', moving.map((o) => o.id as string))
      .eq('user_id', env.userId);
    if (error) throw new Error(`Reading the orders' emails failed: ${error.message}`);
    messageRows = await updateKept(
      env,
      'ingested_messages',
      (sources ?? []) as Row[],
      { parse_status: 'skipped', resulting_order_id: null, error: DISCARDED_ERROR },
      [...MESSAGE_KEYS],
    );
    values = { deleted_at: new Date().toISOString(), needs_review: false };
    keys = ['deleted_at', 'needs_review'];
    [verb, rest, said] = ['Discarded', ' to Deleted orders', 'discarded'];
  } else {
    moving = orders.filter((o) => o.deleted_at != null);
    if (moving.length === 0) throw new ShoppingRefused('None of those is deleted.');
    values = args.review_again === true ? { deleted_at: null, needs_review: true } : { deleted_at: null };
    keys = Object.keys(values);
    [verb, rest, said] = ['Brought back', args.review_again === true ? ' to the review queue' : ' from Deleted orders', 'brought back'];
  }

  const rows = [...(await updateKept(env, 'orders', moving, values, keys)), ...messageRows];
  const titles = moving.map((o) => orderTitle(o, merchants));
  const what = namedItems(titles, titles.length);
  const first = moving[0].id as string;
  const href = moving.length === 1 && move !== 'discard' ? orderHref(first) : REVIEW_HREF;
  return {
    kind: 'review_orders',
    input: { verb, what, rest, href, where: href === REVIEW_HREF ? 'Open the review queue' : 'Open the order', paths: [...paths, ...moving.map((o) => orderHref(o.id as string))] },
    subjectRef: toRef(ORDERS, first),
    op: 'update',
    before: moving[0],
    after: null,
    undo: { rows },
    summary: `Dash ${said} ${plural(moving.length, 'order')}: ${what}.`,
    row: { table: ORDERS, ref: first, title: titles[0], href },
  };
}

/**
 * Attach a waiting shipping, delivery, return or confirmation email to the
 * order it is about, as the review queue's attach does: the email is read
 * again from Gmail where it can be (the subject alone still moves the
 * order's status where it cannot), the shipment or return it describes is
 * written onto the order, and the email leaves the queue. Undo puts the email
 * back in the queue and takes away the shipment or return it wrote.
 */
async function attachEmail(env: ShoppingWriteEnv, args: Args): Promise<ShoppingMade> {
  const messageId = idOf(args.message_ref, 'message_ref', 'email');
  const orderId = idOf(args.order_ref, 'order_ref', 'order');
  const message = await ownRow(env.shop, 'inbox_messages', messageId, env.userId, 'email');
  const order = await ownRow(env.shop, 'orders', orderId, env.userId, 'order');
  if (order.deleted_at != null) throw new ShoppingRefused('That order is deleted. Bring it back first.');
  const classification = message.classification as string | null;
  if (!isAttachableClassification(classification)) {
    throw new ShoppingRefused('Only confirmation, shipping, delivery and return emails attach to an order.');
  }
  if (message.parse_status !== 'needs_review') throw new ShoppingRefused('That email has already left the queue.');
  const kind = lifecycleKindForAttach(classification, message.subject as string | null);
  const merchants = await merchantNames(env, [order]);
  const title = orderTitle(order, merchants);
  const subject = named(message.subject, 'the email');

  // Claimed first, so a sync running at the same time does not write the shipment twice.
  const { data: claimed, error: claimError } = await env.shop
    .from('ingested_messages')
    .update({ parse_status: 'pending', resulting_order_id: orderId, error: null })
    .eq('id', messageId)
    .eq('parse_status', 'needs_review')
    .select('id');
  if (claimError) throw new Error(`Claiming the email failed: ${claimError.message}`);
  if (!claimed || claimed.length === 0) throw new ShoppingRefused('That email has already left the queue.');

  const undo: ShoppingUndo = {};
  const messageKeys = [...MESSAGE_KEYS, 'classification', 'parse_confidence'];
  let done: Row = { parse_status: 'parsed', error: null };

  if (kind !== null) {
    const receivedAt = message.received_at ? new Date(message.received_at as string) : null;
    const fetched = env.db
      ? await fetchMessageBody((await env.db('core')) as unknown as CoreSupabaseClient, {
          userId: env.userId,
          accountId: message.email_account_id as string,
          providerMessageId: message.provider_message_id as string,
        })
      : null;
    const body = fetched?.ok ? fetched.message : null;
    const extraction = extractionForAttach({
      classification: kind,
      subject: body ? body.subject : (message.subject as string | null),
      body: body ? { text: body.text, html: body.html } : null,
      receivedAt: body ? (body.internalDate ?? receivedAt) : receivedAt,
    });
    const { data: profile } = await env.shop.from('profiles').select('timezone').eq('id', env.userId).maybeSingle();
    const applied = await applyLifecycleToOrder(env.shop as SupabaseClient, {
      userId: env.userId,
      order: {
        id: orderId,
        merchantId: (order.merchant_id as string | null) ?? null,
        externalOrderNumber: (order.external_order_number as string | null) ?? null,
        cancelledAt: (order.cancelled_at as string | null) ?? null,
      },
      classification: kind,
      extraction,
      sourceMessageId: messageId,
      receivedAt,
      timezone: ((profile as Row | null)?.timezone as string | undefined) ?? 'UTC',
    });
    if (!applied.ok) {
      // Back in the queue, unlinked, with the reason, as the queue leaves it.
      await env.shop.from('ingested_messages').update({ parse_status: 'needs_review', resulting_order_id: null, error: applied.error }).eq('id', messageId);
      throw new ShoppingRefused(`It could not be attached: ${applied.error}.`);
    }
    const change = applied.change;
    if (change?.what === 'shipment' && change.op === 'insert') undo.added = [{ table: 'shipments', id: change.shipmentId }];
    if (change?.what === 'return') undo.added = change.returnIds.map((id) => ({ table: 'returns' as const, id }));
    if (change?.what === 'shipment' && change.op === 'update') {
      const { data: now } = await env.shop.from('shipments').select('*').eq('id', change.shipmentId).maybeSingle();
      if (now) {
        const keys = Object.keys(change.before).filter((key) => !['created_at', 'updated_at'].includes(key) && !same(change.before[key], (now as Row)[key]));
        if (keys.length > 0) undo.rows = [{ table: 'shipments', id: change.shipmentId, before: pick(change.before, keys), after: pick(now as Row, keys) }];
      }
    }
    // A confirmation that was really a shipping notice is recorded as one.
    done = { ...done, parse_confidence: extraction.confidence, classification: kind };
  }

  const { data: after, error: doneError } = await env.shop.from('ingested_messages').update(done).eq('id', messageId).select('*');
  if (doneError) throw new Error(`Finishing the email failed: ${doneError.message}`);
  const afterRow = ((after ?? []) as Row[])[0] ?? { ...message, ...done, resulting_order_id: orderId };
  undo.rows = [{ table: 'ingested_messages', id: messageId, before: pick(message, messageKeys), after: pick(afterRow, messageKeys) }, ...(undo.rows ?? [])];

  const what = kind === null ? 'the email' : `the ${kind} email`;
  return {
    kind: 'review_orders',
    input: {
      verb: 'Attached',
      what: subject,
      rest: ` to ${title}`,
      href: orderHref(orderId),
      where: 'Open the order',
      paths: [...ORDER_PATHS, '/shopping/returns', orderHref(orderId)],
    },
    subjectRef: toRef(ORDERS, orderId),
    op: 'update',
    before: order,
    after: null,
    undo,
    summary: `Dash attached ${what} "${subject}" to ${title}.`,
    row: { table: ORDERS, ref: orderId, title, href: orderHref(orderId) },
  };
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

/**
 * What the person can hang off an item after Dash added it: a list, a tag, a
 * use, a family, a return or a todo. An added item with any of these, or one
 * since grouped, marked for sale or no longer owned, is theirs now, and Undo
 * keeps it. A price quote is the app's own reading and goes with the item.
 */
const ITEM_DEPENDENTS = [
  { schema: 'public', table: 'inventory_item_lists' },
  { schema: 'public', table: 'inventory_item_tags' },
  { schema: 'public', table: 'item_uses' },
  { schema: 'public', table: 'inventory_item_families' },
  { schema: 'public', table: 'returns' },
  { schema: 'todo', table: 'task_links' },
] as const;

// ---------------------------------------------------------------------------
// change_saved_item
// ---------------------------------------------------------------------------

const SAVED_CHANGES = ['add', 'edit', 'bought', 'dismiss', 'restore'] as const;
type SavedChange = (typeof SAVED_CHANGES)[number];
const SAVED = 'public.saved_items';
const savedHref = (id: string) => `/shopping/saved/${id}`;
const SAVED_STATUS: Record<'bought' | 'dismiss' | 'restore', { status: string; verb: string; rest: string; said: string }> = {
  bought: { status: 'purchased', verb: 'Marked', rest: ' as bought', said: 'marked' },
  dismiss: { status: 'dismissed', verb: 'Put aside', rest: '', said: 'put aside' },
  restore: { status: 'saved', verb: 'Moved back to saved', rest: '', said: 'moved back to saved' },
};

function savedUrl(value: string | undefined): string {
  try {
    const url = new URL(value ?? '');
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
  } catch {
    // falls through to the refusal
  }
  throw new ShoppingRefused('url must be a full product link starting with http:// or https://.');
}

async function merchantFor(env: ShoppingWriteEnv, link: string): Promise<{ id: string; name: string } | null> {
  const { data, error } = await env.shop.from('merchants').select('id, slug, name, domains');
  if (error) throw new Error(`Reading the merchants failed: ${error.message}`);
  return findMerchantByUrl(
    link,
    ((data ?? []) as Row[]).map((m) => ({ id: m.id as string, slug: m.slug as string, name: m.name as string, domains: (m.domains ?? []) as string[] })),
  );
}

async function changeSavedItem(env: ShoppingWriteEnv, args: Args): Promise<ShoppingMade> {
  const change = (typeof args.change === 'string' ? args.change.trim() : '') as SavedChange;
  if (!SAVED_CHANGES.includes(change)) throw new ShoppingRefused(`change must be one of ${SAVED_CHANGES.join(', ')}.`);
  const paths = ['/shopping/saved'];

  const url = textArg(args, 'url', 2000);
  const title = textArg(args, 'title', 300);
  const notes = textArg(args, 'notes', 5000);
  const imageUrl = textArg(args, 'image_url', 2000);
  let priceCents: number | null | undefined;
  if (given(args, 'price')) {
    const price = args.price;
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) throw new ShoppingRefused('price is a dollar amount such as 12.99.');
    priceCents = Math.round(price * 100);
  }
  if (args.clear_price === true) {
    if (priceCents !== undefined) throw new ShoppingRefused('Give price or clear_price, not both.');
    priceCents = null;
  }
  const currency = textArg(args, 'currency', 3)?.toUpperCase();
  if (currency !== undefined && currency.length !== 3) throw new ShoppingRefused('currency is a 3-letter code such as USD.');
  if (title === '') throw new ShoppingRefused('title cannot be empty.');
  if (imageUrl) savedUrl(imageUrl);

  if (change === 'add') {
    if (!url) throw new ShoppingRefused('Give the product link as url.');
    if (!title) throw new ShoppingRefused('Give a title, so the item can be matched later.');
    const link = savedUrl(url);
    const merchant = await merchantFor(env, link);
    const { data: made, error } = await env.shop
      .from('saved_items')
      .insert({
        user_id: env.userId,
        url: link,
        title,
        image_url: imageUrl || null,
        price_cents: priceCents ?? null,
        currency: currency ?? 'USD',
        notes: notes || null,
        merchant_id: merchant?.id ?? null,
        fingerprint_loose: fingerprintLoose(title),
        status: 'saved',
      })
      .select('*')
      .single();
    if (error || !made) throw new Error(`Saving the item failed: ${error?.message ?? 'no row'}`);
    const id = (made as Row).id as string;
    const shown = named(title, 'the item');
    return {
      kind: 'change_saved_item',
      input: { verb: 'Saved', what: shown, rest: ' for later', href: savedHref(id), where: 'Open the saved item', paths: [...paths, savedHref(id)] },
      subjectRef: toRef(SAVED, id),
      op: 'insert',
      before: null,
      after: made as Row,
      undo: { added: [{ table: 'saved_items', id }] },
      summary: `Dash saved "${shown}" for later${merchant ? ` from ${merchant.name}` : ''}.`,
      row: { table: SAVED, ref: id, title: shown, href: savedHref(id) },
    };
  }

  const id = idOf(args.saved_ref, 'saved_ref', 'saved item');
  const item = await ownRow(env.shop, 'saved_items', id, env.userId, 'saved item');
  const shown = named(item.title ?? item.url, 'the saved item');
  const itemPaths = [...paths, savedHref(id)];
  const values: Row = {};
  let input: ShoppingChangeInput;
  let summary: string;

  if (change === 'edit') {
    if (url !== undefined && url !== item.url) values.url = savedUrl(url);
    if (title !== undefined && title !== item.title) {
      values.title = title;
      values.fingerprint_loose = fingerprintLoose(title);
    }
    if (notes !== undefined && !same(notes || null, item.notes)) values.notes = notes || null;
    if (imageUrl !== undefined && !same(imageUrl || null, item.image_url)) values.image_url = imageUrl || null;
    if (priceCents !== undefined && !same(priceCents, item.price_cents)) values.price_cents = priceCents;
    if (currency !== undefined && currency !== item.currency) values.currency = currency;
    if ('url' in values) {
      const hit = await merchantFor(env, values.url as string);
      if ((hit?.id ?? null) !== item.merchant_id) values.merchant_id = hit?.id ?? null;
    }
    if (Object.keys(values).length === 0) {
      throw new ShoppingRefused('Nothing there differs from what is saved. Give a url, title, notes, image_url, price, clear_price or currency that changes.');
    }
    const label: Record<string, string> = { url: 'link', title: 'title', price_cents: 'price', currency: 'currency', notes: 'notes', image_url: 'picture' };
    const said = sentence(Object.keys(label).filter((key) => key in values).map((key) => label[key]));
    input = { verb: 'Changed', what: shown, rest: `: ${said}`, href: savedHref(id), where: 'Open the saved item', paths: itemPaths };
    summary = `Dash changed the saved item "${shown}": ${said}.`;
  } else {
    const move = SAVED_STATUS[change];
    if (item.status === move.status) throw new ShoppingRefused(`"${shown}" is ${move.status === 'saved' ? 'saved' : move.status} already.`);
    values.status = move.status;
    input = { verb: move.verb, what: shown, rest: move.rest, href: savedHref(id), where: 'Open the saved item', paths: itemPaths };
    summary = `Dash ${move.said} the saved item "${shown}".`;
  }

  const { data: after, error } = await env.shop.from('saved_items').update(values).eq('id', id).eq('user_id', env.userId).select('*').single();
  if (error || !after) throw new Error(`Changing the saved item failed: ${error?.message ?? 'no row'}`);
  const keys = Object.keys(values);
  return {
    kind: 'change_saved_item',
    input,
    subjectRef: toRef(SAVED, id),
    op: 'update',
    before: item,
    after: after as Row,
    undo: { rows: [{ table: 'saved_items', id, before: pick(item, keys), after: pick(after as Row, keys) }] },
    summary,
    row: { table: SAVED, ref: id, title: shown, href: savedHref(id) },
  };
}

// ---------------------------------------------------------------------------
// change_recurring
// ---------------------------------------------------------------------------

const RECURRING_CHANGES = ['rename', 'leave_out', 'count', 'merge', 'move'] as const;
type RecurringChange = (typeof RECURRING_CHANGES)[number];
const RECURRING = 'public.recurring_payments';
const RECURRING_HREF = '/shopping/recurring';
/** The Recurring page and the agenda, which lists bills and renewals by payee. */
const RECURRING_PATHS = ['/shopping/recurring', '/todo'];
/** What working a payment out again from its charges can change. */
const SUMMARY_COLUMNS = ['status', 'amount_cents', 'currency', 'period', 'next_date', 'last_charged_on'] as const;
export const MERGED_NO_UNDO =
  'There is no Undo, because the merge moved every charge onto the kept payment and worked its amount out again. To split them, move the charges on the Recurring page.';

const flatName = (value: unknown) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : '');

/** Their payment by the name it shows under, the key the mail files it by, or a name a merge left on it. */
async function findPayment(env: ShoppingWriteEnv, name: string | undefined, key: string): Promise<Row> {
  if (!name) throw new ShoppingRefused(`Name the payment by ${key}, as it shows on the Recurring page.`);
  const { data, error } = await env.shop.from('recurring_payments').select('*').eq('user_id', env.userId);
  if (error) throw new Error(`Reading their recurring payments failed: ${error.message}`);
  const rows = (data ?? []) as Row[];
  const byName = rows.filter((row) => flatName(row.payee) === flatName(name));
  if (byName.length === 1) return byName[0];
  const payee = payeeKey(name);
  const byKey = rows.find((row) => row.payee_key === payee);
  if (byKey) return byKey;
  const { data: alias, error: aliasError } = await env.shop
    .from('recurring_payee_aliases')
    .select('payment_id')
    .eq('user_id', env.userId)
    .eq('payee_key', payee)
    .maybeSingle();
  if (aliasError) throw new Error(`Reading their payment names failed: ${aliasError.message}`);
  const aliased = alias ? rows.find((row) => row.id === (alias as Row).payment_id) : undefined;
  if (aliased) return aliased;
  if (rows.length === 0) throw new ShoppingRefused('They have no recurring payments in Shopping yet.');
  const names = rows.slice(0, 25).map((row) => `"${named(row.payee, '')}"`);
  throw new ShoppingRefused(
    `They have no recurring payment called "${name}". Theirs are ${names.join(', ')}${rows.length > 25 ? ' and more' : ''}.`,
  );
}

/** "$9.99 on 2026-09-01", for naming a charge back to the model. */
function chargeLine(charge: Row): string {
  const amount = typeof charge.amount_cents === 'number' ? `${formatMoney(charge.amount_cents)} ` : '';
  return `${amount}on ${String(charge.occurred_on)}`;
}

async function changeRecurring(env: ShoppingWriteEnv, args: Args): Promise<ShoppingMade> {
  const change = (typeof args.change === 'string' ? args.change.trim() : '') as RecurringChange;
  if (!RECURRING_CHANGES.includes(change)) throw new ShoppingRefused(`change must be one of ${RECURRING_CHANGES.join(', ')}.`);
  const payment = await findPayment(env, textArg(args, 'payment', PAYEE_MAX), 'payment');
  const id = payment.id as string;
  const shown = named(payment.payee, 'the payment');
  const client = env.shop as SupabaseClient;
  const input = (verb: string, what: string, rest: string): ShoppingChangeInput => ({
    verb,
    what,
    rest,
    href: RECURRING_HREF,
    where: 'Open Recurring',
    paths: RECURRING_PATHS,
  });
  const rowFor = (ref: string, title: string): AskRow => ({ table: RECURRING, ref, title, href: RECURRING_HREF });

  if (change === 'rename') {
    const to = textArg(args, 'rename_to', PAYEE_MAX)?.replace(/\s+/g, ' ');
    if (!to) throw new ShoppingRefused('Give the new name as rename_to.');
    if (to === payment.payee) throw new ShoppingRefused(`"${shown}" is called that already.`);
    const result = await renamePayment(client, { userId: env.userId, paymentId: id, payee: to });
    if (result.error) throw new ShoppingRefused(result.error);
    const after = await ownRow(env.shop, 'recurring_payments', id, env.userId, 'recurring payment');
    const now = named(after.payee, to);
    return {
      kind: 'change_recurring',
      input: input('Renamed', shown, ` to "${now}"`),
      subjectRef: toRef(RECURRING, id),
      op: 'update',
      before: payment,
      after,
      undo: { rows: [{ table: 'recurring_payments', id, before: { payee: payment.payee }, after: { payee: after.payee } }] },
      summary: `Dash renamed the recurring payment "${shown}" to "${now}".`,
      row: rowFor(id, now),
    };
  }

  if (change === 'leave_out' || change === 'count') {
    const counted = change === 'count';
    if (counted && payment.status !== 'ignored') throw new ShoppingRefused(`"${shown}" is counted in the monthly total already.`);
    if (!counted && payment.status === 'ignored') throw new ShoppingRefused(`"${shown}" is left out of the monthly total already.`);
    const result = await setPaymentCounted(client, { userId: env.userId, paymentId: id, counted });
    if (result.error) throw new ShoppingRefused(result.error);
    const after = await ownRow(env.shop, 'recurring_payments', id, env.userId, 'recurring payment');
    const keys = SUMMARY_COLUMNS.filter((key) => !same(payment[key], after[key]));
    return {
      kind: 'change_recurring',
      input: counted ? input('Counted', shown, ' in the monthly total again') : input('Left', shown, ' out of the monthly total'),
      subjectRef: toRef(RECURRING, id),
      op: 'update',
      before: payment,
      after,
      undo: { rows: [{ table: 'recurring_payments', id, before: pick(payment, keys), after: pick(after, keys) }] },
      summary: counted
        ? `Dash counted the recurring payment "${shown}" in the monthly total again.`
        : `Dash left the recurring payment "${shown}" out of the monthly total.`,
      row: rowFor(id, shown),
    };
  }

  if (change === 'merge') {
    const into = await findPayment(env, textArg(args, 'into', PAYEE_MAX), 'into');
    if (into.id === id) throw new ShoppingRefused(`"${shown}" and the payment to merge it into are the same one.`);
    const kept = named(into.payee, 'the payment');
    const result = await mergePayments(client, { userId: env.userId, paymentId: id, intoId: into.id as string });
    if (result.error) throw new ShoppingRefused(result.error);
    const after = await ownRow(env.shop, 'recurring_payments', into.id as string, env.userId, 'recurring payment');
    return {
      kind: 'change_recurring',
      input: input('Merged', shown, ` into "${kept}"`),
      subjectRef: toRef(RECURRING, into.id as string),
      op: 'update',
      before: into,
      after,
      undo: { none: MERGED_NO_UNDO },
      summary: `Dash merged the recurring payment "${shown}" into "${kept}", moving its charges there.`,
      row: rowFor(into.id as string, kept),
    };
  }

  // move: some of its charges, named by the day each was charged, to another payment or a new one.
  const { data: chargeData, error: chargeError } = await env.shop
    .from('recurring_charges')
    .select('id, occurred_on, amount_cents, currency')
    .eq('user_id', env.userId)
    .eq('payment_id', id)
    .order('occurred_on', { ascending: true });
  if (chargeError) throw new Error(`Reading the charges failed: ${chargeError.message}`);
  const charges = (chargeData ?? []) as Row[];
  const listed = charges.map(chargeLine).join(', ');
  const raw = args.charged_on;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ShoppingRefused(
      `Name the charges to move by charged_on, the days they were charged. "${shown}" has ${charges.length ? `charges of ${listed}` : 'no charges'}.`,
    );
  }
  const days = new Set(raw.map((day) => (typeof day === 'string' ? day.trim() : '')));
  const picked = charges.filter((charge) => days.has(String(charge.occurred_on)));
  const missed = [...days].filter((day) => !charges.some((charge) => String(charge.occurred_on) === day));
  if (missed.length > 0) {
    throw new ShoppingRefused(`"${shown}" has no charge on ${missed.join(', ')}. Its charges are ${listed || 'none'}.`);
  }
  const intoName = textArg(args, 'into', PAYEE_MAX);
  const newPayee = textArg(args, 'new_payee', PAYEE_MAX);
  if (!intoName === !newPayee) {
    throw new ShoppingRefused('Give into, a payment they have, or new_payee, the name of a new one, and not both.');
  }
  const target = intoName ? await findPayment(env, intoName, 'into') : null;
  const { data: idsBefore, error: idsError } = await env.shop.from('recurring_payments').select('id').eq('user_id', env.userId);
  if (idsError) throw new Error(`Reading their recurring payments failed: ${idsError.message}`);
  const existed = new Set(((idsBefore ?? []) as Row[]).map((row) => row.id as string));
  const result = await moveCharges(client, {
    userId: env.userId,
    paymentId: id,
    chargeIds: picked.map((charge) => charge.id as string),
    to: target ? { paymentId: target.id as string } : { payee: newPayee ?? '' },
  });
  if (result.error || !result.paymentId) throw new ShoppingRefused(result.error ?? 'Those charges could not be moved.');
  const after = await ownRow(env.shop, 'recurring_payments', result.paymentId, env.userId, 'recurring payment');
  const made = !existed.has(result.paymentId);
  const there = named(after.payee, 'the payment');
  const count = picked.length === 1 ? 'one charge' : `${picked.length} charges`;
  return {
    kind: 'change_recurring',
    input: input('Moved', count, ` from "${shown}" to ${made ? 'a new payment, ' : ''}"${there}"`),
    subjectRef: toRef(RECURRING, result.paymentId),
    op: made ? 'insert' : 'update',
    before: made ? null : (target ?? null),
    after,
    undo: { none: MOVED_NO_UNDO },
    summary: `Dash moved ${count} from the recurring payment "${shown}" to ${made ? 'a new payment, ' : ''}"${there}".`,
    row: rowFor(result.paymentId, there),
  };
}

// ---------------------------------------------------------------------------
// return_window
// ---------------------------------------------------------------------------

const POLICIES_HREF = '/shopping/settings';
/** Every page that reads a return window, as Shopping's settings refresh them. */
const POLICY_PATHS = ['/shopping/settings', '/shopping/returns', '/shopping/inventory', '/shopping/orders', '/shopping/dashboard'];
const windowWords = (days: unknown) => (typeof days === 'number' ? `a ${days}-day return window` : 'no return window');

/** A shop's slug as Shopping's settings make one, before the owner's suffix. */
function shopSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'merchant'
  );
}

async function returnWindow(env: ShoppingWriteEnv, args: Args): Promise<ShoppingMade> {
  const name = textArg(args, 'shop', 80);
  if (!name || name.length < 2) throw new ShoppingRefused('Name the shop by shop, at least 2 characters.');
  const useDefault = args.use_default === true;
  let days: number | null | undefined;
  if (given(args, 'days')) {
    const value = args.days;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 730) {
      throw new ShoppingRefused('days is a whole number of days from 1 to 730.');
    }
    days = value;
  }
  if (args.no_window === true) {
    if (days !== undefined) throw new ShoppingRefused('Give days or no_window, not both.');
    days = null;
  }
  if (useDefault && days !== undefined) throw new ShoppingRefused('Give one of days, no_window or use_default.');
  if (!useDefault && days === undefined) throw new ShoppingRefused('Say what the window is: days, no_window for none, or use_default.');

  const { data, error } = await env.shop
    .from('merchants')
    .select('id, name, slug, is_global, created_by_user_id, default_return_window_days');
  if (error) throw new Error(`Reading the shops failed: ${error.message}`);
  // The service role reads every account's shops: only the shared ones and theirs are theirs to name.
  const theirs = ((data ?? []) as Row[]).filter((m) => m.is_global === true || m.created_by_user_id === env.userId);
  const slug = shopSlug(name);
  const ownSlug = `${slug}-${env.userId.slice(0, 8)}`;
  const merchant =
    theirs.find((m) => flatName(m.name) === flatName(name)) ?? theirs.find((m) => m.slug === slug || m.slug === ownSlug);

  if (!merchant) {
    if (args.new_shop !== true) {
      throw new ShoppingRefused(`There is no shop called "${name}" in Shopping. If it is a shop to add, call again with new_shop true.`);
    }
    if (useDefault) throw new ShoppingRefused('A new shop has no default window to use: give days or no_window.');
    const { data: made, error: madeError } = await env.shop
      .from('merchants')
      .insert({
        name,
        slug: ownSlug,
        domains: [],
        created_by_user_id: env.userId,
        is_global: false,
        default_return_window_days: days ?? null,
      })
      .select('*')
      .single();
    if (madeError || !made) throw new Error(`Adding the shop failed: ${madeError?.message ?? 'no row'}`);
    const id = (made as Row).id as string;
    const shown = named(name, 'the shop');
    return {
      kind: 'return_window',
      input: {
        verb: 'Added',
        what: shown,
        rest: ` with ${windowWords(days)}`,
        href: POLICIES_HREF,
        where: 'Open the return windows',
        paths: POLICY_PATHS,
      },
      subjectRef: toRef('public.merchants', id),
      op: 'insert',
      before: null,
      after: made as Row,
      undo: { added: [{ table: 'merchants', id }] },
      summary: `Dash added the shop "${shown}" to Shopping with ${windowWords(days)}.`,
      row: { table: 'public.merchants', ref: id, title: shown, href: POLICIES_HREF },
    };
  }

  const shown = named(merchant.name, 'the shop');
  const fallback = (merchant.default_return_window_days as number | null) ?? null;
  const target = useDefault ? fallback : (days as number | null);
  const { data: policyData, error: policyError } = await env.shop
    .from('merchant_return_policies')
    .select('*')
    .eq('user_id', env.userId)
    .eq('merchant_id', merchant.id)
    .maybeSingle();
  if (policyError) throw new Error(`Reading their return windows failed: ${policyError.message}`);
  const policy = (policyData as Row | null) ?? null;
  const now = policy ? ((policy.return_window_days as number | null) ?? null) : fallback;
  if (same(now, target)) throw new ShoppingRefused(`${shown} has ${windowWords(target)} already.`);
  // The settings page takes a window back to the default by deleting the person's own.
  // Dash never deletes, so it writes the default in.
  const said = useDefault ? `the default, ${windowWords(target)}` : windowWords(target);
  const input: ShoppingChangeInput = {
    verb: 'Set',
    what: shown,
    rest: ` to ${said}`,
    href: POLICIES_HREF,
    where: 'Open the return windows',
    paths: POLICY_PATHS,
  };
  const summary = `Dash set ${shown}'s return window to ${said}.`;
  if (policy) {
    const { data: after, error: updateError } = await env.shop
      .from('merchant_return_policies')
      .update({ return_window_days: target })
      .eq('id', policy.id)
      .eq('user_id', env.userId)
      .select('*')
      .single();
    if (updateError || !after) throw new Error(`Setting the return window failed: ${updateError?.message ?? 'no row'}`);
    return {
      kind: 'return_window',
      input,
      subjectRef: toRef('public.merchant_return_policies', policy.id as string),
      op: 'update',
      before: policy,
      after: after as Row,
      undo: {
        rows: [
          {
            table: 'merchant_return_policies',
            id: policy.id as string,
            before: { return_window_days: policy.return_window_days ?? null },
            after: { return_window_days: target },
          },
        ],
      },
      summary,
      row: { table: 'public.merchant_return_policies', ref: policy.id as string, title: shown, href: POLICIES_HREF },
    };
  }
  const { data: made, error: insertError } = await env.shop
    .from('merchant_return_policies')
    .insert({ user_id: env.userId, merchant_id: merchant.id, return_window_days: target })
    .select('*')
    .single();
  if (insertError || !made) throw new Error(`Setting the return window failed: ${insertError?.message ?? 'no row'}`);
  const id = (made as Row).id as string;
  return {
    kind: 'return_window',
    input,
    subjectRef: toRef('public.merchant_return_policies', id),
    op: 'insert',
    before: null,
    after: made as Row,
    undo: { added: [{ table: 'merchant_return_policies', id }] },
    summary,
    row: { table: 'public.merchant_return_policies', ref: id, title: shown, href: POLICIES_HREF },
  };
}

// ---------------------------------------------------------------------------
// change_person
// ---------------------------------------------------------------------------

const PERSON_CHANGES = ['add', 'edit'] as const;
type PersonChange = (typeof PERSON_CHANGES)[number];
const PEOPLE = 'core.people';
const PEOPLE_HREF = '/shopping/settings';
/** Every page that shows a person's name or badge, as the settings refresh them. */
const PEOPLE_PATHS = ['/shopping/settings', '/shopping/orders', '/shopping/inventory', '/shopping/dashboard'];

function personName(value: string | undefined, key: string): string {
  const name = value?.replace(/\s+/g, ' ');
  if (!name) throw new ShoppingRefused(`Give ${key}, their name.`);
  if (name.length > 60) throw new ShoppingRefused(`${key} is longer than 60 characters.`);
  return name;
}

function personColour(args: Args): string | undefined {
  const colour = textArg(args, 'colour', 20)?.toLowerCase();
  if (colour === undefined || colour === '') return undefined;
  if (!(PERSON_COLOURS as readonly string[]).includes(colour)) throw new ShoppingRefused(`colour is one of ${PERSON_COLOURS.join(', ')}.`);
  return colour;
}

async function changePerson(env: ShoppingWriteEnv, args: Args): Promise<ShoppingMade> {
  const change = (typeof args.change === 'string' ? args.change.trim() : '') as PersonChange;
  if (!PERSON_CHANGES.includes(change)) throw new ShoppingRefused(`change must be one of ${PERSON_CHANGES.join(', ')}.`);
  if (!env.db) throw new Error('change_person needs the core schema');
  const core = await env.db('core');
  const { data, error } = await core.from('people').select('*').eq('user_id', env.userId);
  if (error) throw new Error(`Reading the people they shop for failed: ${error.message}`);
  const people = (data ?? []) as Row[];
  const colour = personColour(args);
  const input = (verb: string, what: string, rest: string): ShoppingChangeInput => ({
    verb,
    what,
    rest,
    href: PEOPLE_HREF,
    where: 'Open the people',
    paths: PEOPLE_PATHS,
  });

  if (change === 'add') {
    const name = personName(textArg(args, 'name', 200), 'name');
    if (people.some((p) => flatName(p.name) === flatName(name))) throw new ShoppingRefused(`${name} is on their list of people already.`);
    // The first person added becomes the default, as the settings page makes them.
    const { data: made, error: madeError } = await core
      .from('people')
      .insert({ user_id: env.userId, name, colour: colour ?? 'brand', is_default: people.length === 0 })
      .select('*')
      .single();
    if (madeError?.code === '23505') throw new ShoppingRefused(`${name} is on their list of people already.`);
    if (madeError || !made) throw new Error(`Adding the person failed: ${madeError?.message ?? 'no row'}`);
    const id = (made as Row).id as string;
    return {
      kind: 'change_person',
      input: input('Added', name, ' to the people you shop for'),
      subjectRef: toRef(PEOPLE, id),
      op: 'insert',
      before: null,
      after: made as Row,
      undo: { added: [{ table: 'people', id }] },
      summary: `Dash added ${name} to the people they shop for in Shopping.`,
      row: { table: PEOPLE, ref: id, title: name, href: PEOPLE_HREF },
    };
  }

  const asked = textArg(args, 'person', 200);
  if (!asked) throw new ShoppingRefused('Name the person to change by person.');
  const person = people.find((p) => flatName(p.name) === flatName(asked));
  if (!person) {
    const names = people.map((p) => named(p.name, '')).join(', ');
    throw new ShoppingRefused(
      people.length
        ? `There is nobody called ${asked} on their list. The people they shop for are ${names}.`
        : 'They have nobody on their list of people yet: add them first.',
    );
  }
  const shown = named(person.name, 'them');
  const values: Row = {};
  const renameTo = textArg(args, 'rename_to', 200);
  if (renameTo !== undefined) {
    const name = personName(renameTo, 'rename_to');
    if (name !== person.name) {
      if (people.some((p) => p.id !== person.id && flatName(p.name) === flatName(name))) {
        throw new ShoppingRefused(`Somebody called ${name} is on their list already.`);
      }
      values.name = name;
    }
  }
  if (colour !== undefined && colour !== person.colour) values.colour = colour;
  if (Object.keys(values).length === 0) {
    throw new ShoppingRefused(`Say what changes for ${shown}: a rename_to or colour that differs from now.`);
  }
  const { data: after, error: updateError } = await core
    .from('people')
    .update(values)
    .eq('id', person.id)
    .eq('user_id', env.userId)
    .select('*')
    .single();
  if (updateError?.code === '23505') throw new ShoppingRefused('Somebody with that name is on their list already.');
  if (updateError || !after) throw new Error(`Changing the person failed: ${updateError?.message ?? 'no row'}`);
  const said = sentence([
    ...('name' in values ? [`renamed them ${named(values.name, '')}`] : []),
    ...('colour' in values ? [`gave them the colour ${String(values.colour)}`] : []),
  ]);
  const keys = Object.keys(values);
  return {
    kind: 'change_person',
    input: input('Changed', shown, `: ${said}`),
    subjectRef: toRef(PEOPLE, person.id as string),
    op: 'update',
    before: person,
    after: after as Row,
    undo: { rows: [{ table: 'people', id: person.id as string, before: pick(person, keys), after: pick(after as Row, keys) }] },
    summary: `Dash changed ${shown} in the people they shop for: ${said}.`,
    row: { table: PEOPLE, ref: person.id as string, title: named((after as Row).name, shown), href: PEOPLE_HREF },
  };
}

async function itemHasDependents(deps: { userId: string; db: AskDb }, shop: SchemaClient, id: string): Promise<boolean> {
  const { data: item, error } = await shop
    .from('inventory_items')
    .select('status, for_sale, group_id, return_planned')
    .eq('id', id)
    .eq('user_id', deps.userId)
    .maybeSingle();
  if (error) throw new Error(`inventory_items: ${error.message}`);
  if (!item) return false;
  const row = item as Row;
  if (row.status !== 'owned' || row.for_sale === true || row.return_planned === true || typeof row.group_id === 'string') return true;
  for (const dependent of ITEM_DEPENDENTS) {
    const client = dependent.schema === 'public' ? shop : await deps.db(dependent.schema);
    const { data, error: readError } = await client.from(dependent.table).select('id').eq('inventory_item_id', id).limit(1);
    if (readError) throw new Error(`${dependent.table}: ${readError.message}`);
    if ((data ?? []).length > 0) return true;
  }
  return false;
}

/**
 * Whether an order Dash added is theirs now: deleted or changed by them, a
 * shipment, return or todo on it, or a unit with anything hanging off it.
 * Taking the order away would take all of that with it.
 */
async function orderHasDependents(deps: { userId: string; db: AskDb }, shop: SchemaClient, id: string): Promise<boolean> {
  const { data: order, error } = await shop.from('orders').select('id, deleted_at').eq('id', id).eq('user_id', deps.userId).maybeSingle();
  if (error) throw new Error(`orders: ${error.message}`);
  if (!order) return false;
  if ((order as Row).deleted_at != null) return true;
  for (const [schema, table] of [['public', 'shipments'], ['public', 'returns'], ['todo', 'task_links']] as const) {
    const client = schema === 'public' ? shop : await deps.db(schema);
    const { data, error: readError } = await client.from(table).select('id').eq('order_id', id).limit(1);
    if (readError) throw new Error(`${table}: ${readError.message}`);
    if ((data ?? []).length > 0) return true;
  }
  const { data: lines, error: linesError } = await shop.from('order_items').select('id').eq('order_id', id);
  if (linesError) throw new Error(`order_items: ${linesError.message}`);
  const lineIds = ((lines ?? []) as Row[]).map((line) => line.id as string);
  if (lineIds.length === 0) return false;
  const { data: units, error: unitsError } = await shop.from('inventory_items').select('id').eq('user_id', deps.userId).in('order_item_id', lineIds);
  if (unitsError) throw new Error(`inventory_items: ${unitsError.message}`);
  for (const unit of (units ?? []) as Row[]) {
    if (await itemHasDependents(deps, shop, unit.id as string)) return true;
  }
  return false;
}

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
  if (typeof recorded?.none === 'string' && recorded.none.trim() !== '') return { ok: false, error: recorded.none.trim() };
  const undo = shoppingUndo(recorded);
  if (!undo) return { ok: false, error: 'Dash did not keep what this changed, so it cannot be undone.' };
  const shop = await deps.db('public');
  const clientFor = async (table: ShoppingTable) => (TABLE_SCHEMA[table] ? deps.db(TABLE_SCHEMA[table]) : shop);
  const owned = <Q extends { eq: (column: string, value: unknown) => Q }>(query: Q, table: ShoppingTable): Q => {
    const owner = ownerColumn(table);
    return owner ? query.eq(owner, deps.userId) : query;
  };
  let restored = 0;

  // An order Dash added goes back whole or not at all: taking it away takes its units, its shipments and its returns.
  for (const row of undo.added ?? []) {
    if (row.table === 'orders' && (await orderHasDependents(deps, shop, row.id))) {
      return {
        ok: false,
        error:
          'The order Dash added has had something done to it since, such as an item listed, returned or linked, or a shipment added, so Dash kept it. Delete it from the order page instead.',
      };
    }
  }

  for (const row of undo.rows ?? []) {
    let query = owned((await clientFor(row.table)).from(row.table).update(row.before).eq('id', row.id), row.table);
    for (const [column, value] of Object.entries(row.after)) {
      if (!scalar(value)) continue;
      query = value === null ? query.is(column, null) : query.eq(column, value);
    }
    const { data, error } = await query.select('id');
    if (error) throw new Error(`${row.table}: ${error.message}`);
    restored += (data ?? []).length;
  }

  // Memberships before the list or tag they are on, so a list or tag Dash made is free of them when it is reached.
  const last = (table: ShoppingTable) => Number(table === 'item_lists' || table === 'item_tags');
  const added = [...(undo.added ?? [])].sort((a, b) => last(a.table) - last(b.table));
  let kept = 0;
  for (const row of added) {
    if (row.table === 'inventory_items' && (await itemHasDependents(deps, shop, row.id))) {
      kept += 1;
      continue;
    }
    if (row.table === 'item_lists') {
      const { data: still, error } = await shop.from('inventory_item_lists').select('id').eq('list_id', row.id).limit(1);
      if (error) throw new Error(`inventory_item_lists: ${error.message}`);
      if ((still ?? []).length > 0) continue;
    }
    if (row.table === 'item_tags') {
      let carried = false;
      for (const links of ['order_item_tags', 'inventory_item_tags']) {
        const { data: still, error } = await shop.from(links).select('id').eq('tag_id', row.id).limit(1);
        if (error) throw new Error(`${links}: ${error.message}`);
        carried ||= (still ?? []).length > 0;
      }
      if (carried) continue;
    }
    if (await addedHasDependents(deps, row)) {
      kept += 1;
      continue;
    }
    const { data, error } = await owned((await clientFor(row.table)).from(row.table).delete().eq('id', row.id), row.table).select('id');
    if (error) throw new Error(`${row.table}: ${error.message}`);
    restored += (data ?? []).length;
  }

  for (const row of undo.removed ?? []) {
    const { data, error } = await (await clientFor(row.table)).from(row.table).upsert(row.values, { onConflict: 'id', ignoreDuplicates: true }).select('id');
    if (error) throw new Error(`${row.table}: ${error.message}`);
    restored += (data ?? []).length;
  }

  if (restored === 0 && kept > 0) {
    if (added.some((row) => row.table === 'people' || row.table === 'merchants')) {
      return { ok: false, error: 'What Dash added has orders, items or a return window on it since, so Dash kept it.' };
    }
    return {
      ok: false,
      error: `${kept === 1 ? 'The item Dash added has' : `All ${kept} items Dash added have`} been put on a list, sold, grouped or linked since, so Dash kept ${kept === 1 ? 'it' : 'them'}. Remove ${kept === 1 ? 'it' : 'them'} from the inventory instead.`,
    };
  }
  if (restored === 0) {
    return { ok: false, error: 'Everything this changed has changed again since, so undoing would lose the later changes.' };
  }
  return { ok: true, restored };
}

/**
 * What can hang off a person or a shop Dash added (plan #1894.5.5): the
 * orders and items put on the person, the mailbox given to them; the orders,
 * saved items and return window on the shop. Deleting the row would blank or
 * take those with it, so an added row that has any is kept.
 */
const ADDED_DEPENDENTS: Partial<Record<ShoppingTable, readonly { schema: AskSchema; table: string; column: string }[]>> = {
  people: [
    { schema: 'public', table: 'orders', column: 'person_id' },
    { schema: 'public', table: 'inventory_items', column: 'person_id' },
    { schema: 'core', table: 'email_accounts', column: 'person_id' },
  ],
  merchants: [
    { schema: 'public', table: 'orders', column: 'merchant_id' },
    { schema: 'public', table: 'saved_items', column: 'merchant_id' },
    { schema: 'public', table: 'merchant_return_policies', column: 'merchant_id' },
    { schema: 'public', table: 'merchant_exclusions', column: 'merchant_id' },
  ],
};

async function addedHasDependents(deps: { userId: string; db: AskDb }, row: { table: ShoppingTable; id: string }): Promise<boolean> {
  for (const dependent of ADDED_DEPENDENTS[row.table] ?? []) {
    const { data, error } = await (await deps.db(dependent.schema)).from(dependent.table).select('id').eq(dependent.column, row.id).limit(1);
    if (error) throw new Error(`${dependent.table}: ${error.message}`);
    if ((data ?? []).length > 0) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

const ITEM_REF = { type: 'string', description: 'The public.inventory_items ref a lookup returned for the item.' } as const;

export const SHOPPING_WRITES: readonly ShoppingWrite[] = [
  {
    name: 'change_item',
    runs: sameAs(
      ['app/shopping/inventory/actions.ts#updateInventoryItem', 'app/shopping/inventory/actions.ts#updateInventoryItem'],
      ['app/shopping/inventory/group-actions.ts#renameItemGroup', 'app/shopping/inventory/group-actions.ts#renameItemGroup'],
      ['app/shopping/inventory/book-actions.ts#confirmBookEdition', 'app/shopping/inventory/book-actions.ts#confirmBookEdition'],
      ['app/shopping/inventory/book-actions.ts#updateBookCondition', 'app/shopping/inventory/book-actions.ts#updateBookCondition'],
      ['app/shopping/inventory/game-actions.ts#confirmGameEdition', 'app/shopping/inventory/game-actions.ts#confirmGameEdition'],
      ['app/shopping/sell/actions.ts#noteListingIntent', 'app/shopping/sell/actions.ts#noteListingIntent'],
      ['app/shopping/sell/actions.ts#setSellPrice', 'app/shopping/sell/actions.ts#setSellPrice'],
    ),
    description:
      "Change one item they own in Shopping, when they ask: its name, variant or notes (these reach every copy in its stack, as the item page's save does), a line added to its notes (\"planning to list it myself\"), the name of the group of copies it is in, the price they mean to sell it for, a book's or game's condition, or confirming the edition it was matched to. Give only what changes; an empty variant or notes clears it. Marking items for sale or to return, grouping, ungrouping, separating or saying they got rid of an item is change_items.",
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
        condition: {
          type: 'string',
          description:
            'For a book: new, like_new, very_good, good or acceptable. For a board game: new_sealed, like_new, complete_used, incomplete or damaged. Empty clears it.',
        },
        confirm_edition: {
          type: 'boolean',
          description: 'True when they say the edition Shopping matched for a book or game is the right one, clearing the confirm prompt.',
        },
      },
      required: ['item_ref'],
      additionalProperties: false,
    },
    run: changeItem,
  },
  {
    name: 'item_lists',
    runs: sameAs(
      ['app/shopping/settings/actions.ts#createItemList', 'app/shopping/settings/actions.ts#createItemList'],
      ['app/shopping/settings/actions.ts#renameItemList', 'app/shopping/settings/actions.ts#renameItemList'],
      ['app/shopping/inventory/actions.ts#updateInventoryItemLists', 'app/shopping/inventory/actions.ts#updateInventoryItemLists'],
      ['app/shopping/inventory/actions.ts#createItemListAndAssign', 'app/shopping/inventory/actions.ts#createItemListAndAssign'],
      ['app/shopping/inventory/actions.ts#toggleInventoryItemList', 'app/shopping/inventory/actions.ts#toggleInventoryItemList'],
    ),
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
  {
    name: 'add_items',
    runs: sameAs(
      ['app/shopping/inventory/book-actions.ts#saveOwnedBook', 'app/shopping/inventory/book-actions.ts#saveOwnedBook'],
      ['app/shopping/inventory/game-actions.ts#saveGame', 'app/shopping/inventory/game-actions.ts#saveGame'],
      ['app/shopping/inventory/item-actions.ts#saveManualItem', 'app/shopping/inventory/item-actions.ts#saveManualItem'],
    ),
    description: `Add things they own to their Shopping inventory, when they tell you they bought or have them ("I bought a copy of Dune", a list of the board games on their shelf), as the add pages do. Each item takes a kind: book (an isbn is looked up in the book catalogs; without one, give the title and what they said of authors, publisher, year and edition), game (a board game, by its title, with year, publisher or barcode when known), or other (anything else, with an optional variant and the name of one of their categories). At most ${ADD_MAX} items. Do not add what an order email already brought in: look it up first when unsure.`,
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          maxItems: ADD_MAX,
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: [...ADD_KINDS], description: 'book, game (a board game) or other.' },
              title: { type: 'string', description: 'The title or name. A book with an isbn may leave it out.' },
              isbn: { type: 'string', description: 'For a book: its ISBN-10 or ISBN-13.' },
              authors: { type: 'array', items: { type: 'string' }, description: 'For a book typed in by hand: its authors.' },
              publisher: { type: 'string', description: 'For a book or game: the publisher.' },
              year: { type: 'integer', description: 'For a book or game: the year it was published.' },
              edition: { type: 'string', description: 'For a book: the edition, such as "2nd" or "paperback".' },
              barcode: { type: 'string', description: 'The UPC or EAN printed on the box, for a game or other item.' },
              variant: { type: 'string', description: 'For other: a colour, size or model.' },
              category: { type: 'string', description: 'For other: the name of one of their Shopping categories.' },
              notes: { type: 'string', description: 'Notes kept on the item.' },
              cost: { type: 'number', description: 'What they paid, in dollars. Leave out when unknown.' },
              acquired_on: { type: 'string', description: 'The day they got it, YYYY-MM-DD. Today when left out.' },
            },
            required: ['kind'],
            additionalProperties: false,
          },
          description: 'The items to add, each with its kind.',
        },
      },
      required: ['items'],
      additionalProperties: false,
    },
    run: addItems,
  },
  {
    name: 'change_saved_item',
    runs: sameAs(
      ['app/shopping/saved/actions.ts#createSavedItem', 'app/shopping/saved/actions.ts#createSavedItem'],
      ['app/shopping/saved/actions.ts#updateSavedItem', 'app/shopping/saved/actions.ts#updateSavedItem'],
      ['app/shopping/saved/actions.ts#markSavedPurchased', 'app/shopping/saved/actions.ts#markSavedPurchased'],
      ['app/shopping/saved/actions.ts#dismissSavedItem', 'app/shopping/saved/actions.ts#dismissSavedItem'],
      ['app/shopping/saved/actions.ts#restoreSavedItem', 'app/shopping/saved/actions.ts#restoreSavedItem'],
    ),
    description:
      "Work their saved-for-later list in Shopping, when they ask: add saves a product they might buy (give its url and a title; price, notes and picture are optional), edit changes a saved item's link, title, price, notes or picture, bought marks it bought, dismiss puts it aside, restore brings a dismissed or bought one back to saved. Name a saved item by saved_ref, from a lookup. Deleting a saved item is done on its page, not by you.",
    input_schema: {
      type: 'object',
      properties: {
        change: { type: 'string', enum: [...SAVED_CHANGES], description: 'add, edit, bought, dismiss or restore.' },
        saved_ref: { type: 'string', description: 'For everything but add: the public.saved_items ref a lookup returned.' },
        url: { type: 'string', description: 'The product link, starting with https://.' },
        title: { type: 'string', description: 'What the product is called.' },
        price: { type: 'number', description: 'The price in dollars, such as 12.99.' },
        clear_price: { type: 'boolean', description: 'For edit: true to clear the price.' },
        currency: { type: 'string', description: 'A 3-letter currency code; USD when left out on add.' },
        notes: { type: 'string', description: 'Notes in full, replacing what is there; empty clears them.' },
        image_url: { type: 'string', description: 'A link to a picture of the product; empty clears it.' },
      },
      required: ['change'],
      additionalProperties: false,
    },
    run: changeSavedItem,
  },
  {
    name: 'add_order',
    runs: noButton('No page has an order form: orders come in from email, and capture files a receipt through saveReceiptOrder.'),
    description: `Enter an order they describe in Shopping, as the order form does ("I bought two mugs at Target for $8 each yesterday"), or one read from a receipt they show you: the merchant by name, the day, and a line per thing bought with its quantity and unit price in dollars; tax, shipping and discount are optional. Each unit lands in the inventory. Set from_receipt when it comes from a receipt photo; give message_ref when it is read from an email waiting in the review queue, which takes the email out of the queue. At most ${ADD_MAX} lines. Look the orders up first when it may have come in from email already.`,
    input_schema: {
      type: 'object',
      properties: {
        merchant: { type: 'string', description: 'The shop by name. A name they have no merchant for adds one.' },
        order_date: { type: 'string', description: 'The day of the order, YYYY-MM-DD. Today when left out.' },
        order_number: { type: 'string', description: "The shop's order number, when known." },
        currency: { type: 'string', description: 'A 3-letter currency code; USD when left out.' },
        tax: { type: 'number', description: 'Tax in dollars.' },
        shipping: { type: 'number', description: 'Shipping in dollars.' },
        discount: { type: 'number', description: 'Discount in dollars, as a positive amount.' },
        lines: {
          type: 'array',
          maxItems: ADD_MAX,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'What was bought.' },
              variant: { type: 'string', description: 'A colour, size or model.' },
              quantity: { type: 'integer', description: 'How many, 1 when left out.' },
              unit_price: { type: 'number', description: 'The price of one, in dollars.' },
              category: { type: 'string', description: 'The name of one of their Shopping categories.' },
            },
            required: ['name', 'unit_price'],
            additionalProperties: false,
          },
          description: 'One line per thing bought.',
        },
        from_receipt: { type: 'boolean', description: 'True when the order is read from a receipt photo.' },
        message_ref: { type: 'string', description: 'The public.inbox_messages ref of the waiting email the order is read from.' },
      },
      required: ['lines'],
      additionalProperties: false,
    },
    run: addOrder,
  },
  {
    name: 'order_item_tags',
    runs: sameAs(
      ['app/shopping/orders/actions.ts#addOrderItemTag', 'lib/tags/ensure.ts#ensureItemTags'],
      ['app/shopping/orders/actions.ts#removeOrderItemTag', 'app/shopping/orders/actions.ts#removeOrderItemTag'],
    ),
    description:
      'Put a tag on a line of one of their Shopping orders, or take one off, when they ask ("tag the lamp as a gift"). change add tags the line, making the tag when they have none by that name; remove takes it off. Name the line by order_item_ref, from an order lookup, and the tag by its name.',
    input_schema: {
      type: 'object',
      properties: {
        change: { type: 'string', enum: [...TAG_CHANGES], description: 'add or remove.' },
        order_item_ref: { type: 'string', description: 'The public.order_items ref of the line, from an order lookup.' },
        tag: { type: 'string', description: 'The tag by its name, 2 to 40 characters.' },
      },
      required: ['change', 'order_item_ref', 'tag'],
      additionalProperties: false,
    },
    run: orderItemTags,
  },
  {
    name: 'review_orders',
    runs: sameAs(
      ['app/shopping/orders/actions.ts#restoreDeletedOrder', 'app/shopping/orders/actions.ts#restoreDeletedOrder'],
      ['app/shopping/review/actions.ts#confirmOrderReview', 'app/shopping/review/actions.ts#confirmOrderReview'],
      ['app/shopping/review/actions.ts#discardOrderReview', 'app/shopping/review/actions.ts#discardOrderReview'],
      ['app/shopping/review/actions.ts#dismissEmailReview', 'app/shopping/review/actions.ts#dismissEmailReview'],
      ['app/shopping/review/actions.ts#attachEmailToOrder', 'lib/orders/apply-lifecycle.ts#applyLifecycleToOrder'],
      ['app/shopping/review/actions.ts#confirmOrdersReview', 'app/shopping/review/actions.ts#confirmOrdersReview'],
      ['app/shopping/review/actions.ts#unconfirmOrdersReview', 'app/shopping/review/actions.ts#unconfirmOrdersReview'],
      ['app/shopping/review/actions.ts#discardOrdersReview', 'app/shopping/review/actions.ts#discardOrdersReview'],
      ['app/shopping/review/actions.ts#restoreDiscardedOrders', 'app/shopping/review/actions.ts#restoreDiscardedOrders'],
      ['app/shopping/review/actions.ts#dismissEmailsReview', 'app/shopping/review/actions.ts#dismissEmailsReview'],
      ['app/shopping/review/actions.ts#restoreDismissedEmails', 'app/shopping/review/actions.ts#restoreDismissedEmails'],
    ),
    description: `Work the Shopping review queue and deleted orders, when they ask. On orders (order_refs, at most ${REVIEW_MAX}): confirm keeps an imported order that looks right and takes it out of the queue; unconfirm puts a confirmed one back in the queue; discard sends a bad import to Deleted orders and stops its email bringing it back; restore brings back a deleted or discarded order (review_again true puts it back in the queue too). On waiting emails (message_refs): dismiss takes an email that is not an order out of the queue; undismiss puts a dismissed one back. attach links one waiting shipping, delivery, return or confirmation email (message_ref) to the order it is about (order_ref) and writes the shipment or return it describes. Deleting an order for good stays on the page.`,
    input_schema: {
      type: 'object',
      properties: {
        move: { type: 'string', enum: [...REVIEW_MOVES], description: 'confirm, unconfirm, discard, restore, dismiss, undismiss or attach.' },
        order_refs: {
          type: 'array',
          items: { type: 'string' },
          maxItems: REVIEW_MAX,
          description: 'For confirm, unconfirm, discard and restore: the public.orders refs.',
        },
        message_refs: {
          type: 'array',
          items: { type: 'string' },
          maxItems: REVIEW_MAX,
          description: 'For dismiss and undismiss: the public.inbox_messages refs of the emails.',
        },
        message_ref: { type: 'string', description: 'For attach: the public.inbox_messages ref of the waiting email.' },
        order_ref: { type: 'string', description: 'For attach: the public.orders ref of the order it belongs to.' },
        review_again: { type: 'boolean', description: 'For restore: true to put the order back in the review queue.' },
      },
      required: ['move'],
      additionalProperties: false,
    },
    run: reviewOrders,
  },
  {
    name: 'change_recurring',
    runs: sameAs(
      ['app/shopping/recurring/actions.ts#renameRecurringPayment', 'lib/recurring/corrections.ts#renamePayment'],
      ['app/shopping/recurring/actions.ts#mergeRecurringPayment', 'lib/recurring/corrections.ts#mergePayments'],
      ['app/shopping/recurring/actions.ts#moveRecurringCharges', 'lib/recurring/corrections.ts#moveCharges'],
      ['app/shopping/recurring/actions.ts#setRecurringCounted', 'lib/recurring/corrections.ts#setPaymentCounted'],
    ),
    description:
      "Tidy their recurring payments in Shopping, the subscriptions and bills read from their mail, when they ask. Name a payment by payment, the name it shows under on the Recurring page. change rename gives it rename_to as its name; leave_out takes it off the monthly total and the agenda, and count puts it back; merge folds it into the payment named by into, moving every charge there, when the two are the same thing under two names; move takes some of its charges, named by charged_on (the days they were charged, YYYY-MM-DD), to the payment named by into or to a new one named by new_payee, when one row holds more than one subscription. A merge and a move have no Undo, so say so. A refusal lists their payments and a payment's charges.",
    input_schema: {
      type: 'object',
      properties: {
        change: { type: 'string', enum: [...RECURRING_CHANGES], description: 'rename, leave_out, count, merge or move.' },
        payment: { type: 'string', description: 'The payment by the name it shows under.' },
        rename_to: { type: 'string', description: 'For rename: the new name.' },
        into: { type: 'string', description: 'For merge, and for a move to a payment they have: that payment by its name.' },
        new_payee: { type: 'string', description: 'For a move to a new payment: its name, such as "Apple TV+".' },
        charged_on: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 500,
          description: 'For move: the days the charges to move were charged, YYYY-MM-DD.',
        },
      },
      required: ['change', 'payment'],
      additionalProperties: false,
    },
    run: changeRecurring,
  },
  {
    name: 'return_window',
    runs: sameAs(
      ['app/shopping/returns/actions.ts#saveMerchantReturnPolicy', 'app/shopping/returns/actions.ts#saveMerchantReturnPolicy'],
      ['app/shopping/returns/actions.ts#createMerchantReturnPolicy', 'app/shopping/returns/actions.ts#createMerchantReturnPolicy'],
    ),
    description:
      "Set how long a shop gives them to return things, as Shopping's settings do, when they say (\"Target gives me 90 days\"). Name the shop by shop; give days (1 to 730), no_window when the shop takes no returns, or use_default to go back to the window Shopping knows for it. A shop Shopping does not know is added as one of theirs when new_shop is true, with the window given.",
    input_schema: {
      type: 'object',
      properties: {
        shop: { type: 'string', description: 'The shop by its name.' },
        days: { type: 'integer', minimum: 1, maximum: 730, description: 'The return window in days.' },
        no_window: { type: 'boolean', description: 'True when the shop takes no returns.' },
        use_default: { type: 'boolean', description: 'True to use the window Shopping knows for the shop.' },
        new_shop: { type: 'boolean', description: 'True to add the shop when Shopping does not know it.' },
      },
      required: ['shop'],
      additionalProperties: false,
    },
    run: returnWindow,
  },
  {
    name: 'change_person',
    runs: sameAs(
      ['app/shopping/settings/people-actions.ts#addPerson', 'app/shopping/settings/people-actions.ts#addPerson'],
      ['app/shopping/settings/people-actions.ts#updatePerson', 'app/shopping/settings/people-actions.ts#updatePerson'],
    ),
    description: `Work the list of people they shop for in Shopping (the household members orders and items are put on), when they ask. change add puts someone on it by name, with an optional colour for their badge; edit renames the person named by person to rename_to or gives them another colour. Colours: ${PERSON_COLOURS.join(', ')}. Removing someone is done in Shopping's settings, not by you.`,
    input_schema: {
      type: 'object',
      properties: {
        change: { type: 'string', enum: [...PERSON_CHANGES], description: 'add or edit.' },
        name: { type: 'string', description: 'For add: their name, up to 60 characters.' },
        person: { type: 'string', description: 'For edit: the person by the name on the list.' },
        rename_to: { type: 'string', description: 'For edit: the new name.' },
        colour: { type: 'string', enum: [...PERSON_COLOURS], description: 'The colour of their badge.' },
      },
      required: ['change'],
      additionalProperties: false,
    },
    run: changePerson,
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
  runs: write.runs,
  definition: { name: write.name, description: `${write.description} ${ASK_NOTE}`, input_schema: write.input_schema },
  apply: async (ctx: DashWriteContext, input: unknown): Promise<DashWriteResult> => {
    if (!shoppingOn(ctx.enabledModules)) return { ok: false, error: SHOPPING_OFF };
    const made = await runShoppingWrite(write, { userId: ctx.userId, shop: await ctx.db('public'), db: ctx.db }, input);
    if ('ok' in made) return made;
    return {
      ok: true,
      ...made,
      input: made.input as unknown as Record<string, unknown>,
      undo: made.undo as unknown as Record<string, unknown>,
    };
  },
}));
