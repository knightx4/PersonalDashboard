/**
 * A goal's own lists (plan #2330.2): things a goal is about that live nowhere
 * else in the app, such as pantries to compare or volunteer groups to try.
 *
 * A list is a collection (lib/goals/collections.ts) with `goal_id` set
 * (supabase/migrations-goals/0080_goal_lists.sql), and its rows are records,
 * so every value goes through the same checks and a draft waits for the
 * person to confirm it, as on an information step. The database also makes
 * the list serve its goal, so a goal's number can be counted from it.
 *
 * Lists over rows another workspace already holds (readings, events, saved
 * products, contacts) are goals.links rows instead (plan #2330.1), and the
 * goal page shows both kinds side by side.
 *
 * This file is the pure part: the fields a new list starts with, and how a
 * product read from a pasted link fills a row. The reads and writes are in
 * lib/goals/lists-store.ts.
 */

import {
  FIELD_KEY_PATTERN,
  liveFields,
  type CollectionField,
  type FieldType,
} from '@/lib/goals/collections';

/** The most lists one goal holds, so a page of chips stays a row of chips. */
export const LISTS_PER_GOAL_MAX = 20;

/** A list Dash or the person names without saying what it holds: a name, a link and notes. */
export const DEFAULT_LIST_FIELDS: CollectionField[] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'link', label: 'Link', type: 'link' },
  { key: 'notes', label: 'Notes', type: 'long_text' },
];

/** What a product page gives a row, and the field each part goes in when the list has none. */
const PRODUCT_PARTS = [
  { part: 'name', type: 'text', field: { key: 'name', label: 'Name', type: 'text' }, words: /^(name|title|product|item)$/i },
  { part: 'picture', type: 'image', field: { key: 'picture', label: 'Picture', type: 'image' }, words: /picture|photo|image/i },
  { part: 'price', type: 'money', field: { key: 'price', label: 'Price', type: 'money' }, words: /price|cost/i },
  { part: 'link', type: 'link', field: { key: 'link', label: 'Link', type: 'link' }, words: /link|url|page/i },
] as const satisfies readonly {
  part: string;
  type: FieldType;
  field: CollectionField;
  words: RegExp;
}[];

export type ProductPart = (typeof PRODUCT_PARTS)[number]['part'];

/** A product as lib/saved/parse-product.ts reads it from a page. */
export type ReadProduct = {
  url: string;
  title: string | null;
  imageUrl: string | null;
  priceCents: number | null;
};

/**
 * The live field of a type a part goes in: one whose key or label names the
 * part, else the first of that type. A name goes only in a text field.
 */
function fieldFor(fields: CollectionField[], type: FieldType, words: RegExp): CollectionField | null {
  const of = liveFields(fields).filter((f) => f.type === type);
  return of.find((f) => words.test(f.key) || words.test(f.label)) ?? of[0] ?? null;
}

/** A key not yet used in the list, from the one wanted. */
function freeKey(fields: CollectionField[], wanted: string): string {
  const taken = new Set(fields.map((f) => f.key));
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; ; n++) {
    const key = `${wanted}_${n}`;
    if (FIELD_KEY_PATTERN.test(key) && !taken.has(key)) return key;
  }
}

/**
 * The list's fields with whatever a product row needs added: a name, a
 * picture, a price and a link. A list of groups that is pasted a product
 * link gains those columns rather than losing what the page gave.
 */
export function fieldsForProduct(fields: CollectionField[]): CollectionField[] {
  const out = [...fields];
  for (const { type, field, words } of PRODUCT_PARTS) {
    if (fieldFor(out, type, words)) continue;
    out.push({ ...field, key: freeKey(out, field.key) });
  }
  return out;
}

/**
 * A row's values from a product read off its page, keyed by the list's own
 * fields, and the parts the page did not give. The link is always filled,
 * since it is what was pasted.
 */
export function productValues(
  fields: CollectionField[],
  product: ReadProduct,
): { values: Record<string, unknown>; missing: ProductPart[] } {
  const given: Record<ProductPart, unknown> = {
    name: product.title?.replace(/\s+/g, ' ').trim().slice(0, 500) || null,
    picture: product.imageUrl,
    price: product.priceCents === null ? null : product.priceCents / 100,
    link: product.url,
  };
  const values: Record<string, unknown> = {};
  const missing: ProductPart[] = [];
  for (const { part, type, words } of PRODUCT_PARTS) {
    const field = fieldFor(fields, type, words);
    const value = given[part];
    if (value === null || value === undefined || value === '') {
      if (part !== 'link') missing.push(part);
      continue;
    }
    if (field) values[field.key] = value;
  }
  return { values, missing };
}

/** How the missing parts of a read product are said: "the picture and the price". */
export function sayMissing(missing: ProductPart[]): string {
  const words = missing.map((part) => `the ${part}`);
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}
