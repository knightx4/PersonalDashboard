/**
 * Filtering inventory by the structured details on items.
 *
 * The details themselves live in `inventory_items.attributes` and are described
 * per category by the templates in lib/inventory/attributes.ts. Which fields
 * exist is therefore a property of the user's data, not of this file — so the
 * filter offers whatever the loaded items actually carry ("Genre: Fantasy"),
 * rather than a fixed list that would go stale the moment a template changes.
 *
 * Filters ride in the URL as repeated `attr=key:value` params, so a filtered
 * view is linkable and survives a reload like every other inventory filter.
 */
import {
  builtInTemplateFor,
  humanizeKey,
  parseAttributeValues,
  type AttributeField,
  type AttributeValues,
} from './attributes';

export type AttributeFilter = { key: string; value: string };

/** One filterable field and the values that appear on the current items. */
export type AttributeFacet = { key: string; label: string; values: string[] };

/** Keys are produced by attributeKey(), so anything else is not ours. */
const KEY_RE = /^[a-z0-9_]{1,40}$/;

/** How many distinct values one field may offer before the list is trimmed. */
const MAX_FACET_VALUES = 60;

export function serializeAttributeFilter(filter: AttributeFilter): string {
  return `${filter.key}:${filter.value}`;
}

/**
 * Read `attr` off the query string. Values may contain colons, so only the
 * first one separates the key. Malformed and duplicate entries are dropped
 * rather than thrown on — a hand-edited URL should not 500 the page.
 */
export function parseAttributeFilters(
  raw: string | string[] | undefined,
): AttributeFilter[] {
  const entries = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
  const filters: AttributeFilter[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (typeof entry !== 'string') continue;
    const separator = entry.indexOf(':');
    if (separator <= 0) continue;
    const key = entry.slice(0, separator).trim().toLowerCase();
    const value = entry.slice(separator + 1).trim();
    if (!KEY_RE.test(key) || !value) continue;
    const id = `${key}:${value.toLowerCase()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    filters.push({ key, value });
  }
  return filters;
}

/** Every filter must match; values compare case-insensitively. */
export function matchesAttributeFilters(
  values: AttributeValues,
  filters: AttributeFilter[],
): boolean {
  return filters.every((filter) => {
    const value = values[filter.key];
    return typeof value === 'string' && value.toLowerCase() === filter.value.toLowerCase();
  });
}

/**
 * Field labels for the keys stored on items: the user's saved templates first,
 * then the built-in ones, then the key made readable.
 *
 * A saved template wins because it is what the user sees on the item page —
 * the filter must call the field the same thing that page does.
 */
export function attributeLabelMap(
  savedTemplates: AttributeField[][],
  categorySlugs: (string | null | undefined)[],
): Map<string, string> {
  const labels = new Map<string, string>();
  for (const slug of categorySlugs) {
    for (const field of builtInTemplateFor(slug)) {
      if (!labels.has(field.key)) labels.set(field.key, field.label);
    }
  }
  for (const template of savedTemplates) {
    for (const field of template) labels.set(field.key, field.label);
  }
  return labels;
}

/**
 * The fields worth offering, built from the items in hand.
 *
 * Values are de-duplicated case-insensitively, keeping the first spelling seen,
 * so "Fantasy" and "fantasy" are one option rather than two.
 */
export function attributeFacets(
  items: { attributes?: unknown }[],
  labels: Map<string, string> = new Map(),
): AttributeFacet[] {
  const byKey = new Map<string, Map<string, string>>();

  for (const item of items) {
    const values = parseAttributeValues(item.attributes);
    for (const [key, value] of Object.entries(values)) {
      if (!KEY_RE.test(key)) continue;
      const trimmed = value.trim();
      if (!trimmed) continue;
      let seen = byKey.get(key);
      if (!seen) {
        seen = new Map<string, string>();
        byKey.set(key, seen);
      }
      const lower = trimmed.toLowerCase();
      if (!seen.has(lower)) seen.set(lower, trimmed);
    }
  }

  return [...byKey.entries()]
    .map(([key, seen]) => ({
      key,
      label: labels.get(key) ?? humanizeKey(key),
      values: [...seen.values()]
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .slice(0, MAX_FACET_VALUES),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
