/**
 * Structured details on an inventory item, and the per-category template that
 * says which details to expect.
 *
 * The identity tables (book_details, game_details) hold what a catalog can
 * confirm — an ISBN, a BoardGameGeek id — and drive pricing. These attributes
 * are the rest: player counts, a genre, a brand, a size. Anything the user
 * wants to record, on any category, without a migration per field.
 *
 * The built-in templates below are what a category shows before anyone has
 * edited it. Editing writes a row in category_attribute_templates, and that
 * row then wins outright — a user who deletes a built-in field means it.
 */

export type AttributeFieldType = 'text' | 'number' | 'url';

export type AttributeField = {
  /** Stable key the value is stored under. Renaming the label keeps it. */
  key: string;
  label: string;
  type: AttributeFieldType;
  /**
   * Whether this field's value joins the eBay search for the item.
   *
   * Off by default, and it has to be: the search is a title, and every word
   * added to it narrows the result set. "Brand" usually helps and "Warranty
   * until" would find nothing at all -- which of the two a field is, is a
   * judgement only the person who added it can make. What it is for is the
   * detail that decides which listing is the right one: an edition, a
   * pressing, a model number.
   */
  inSearch: boolean;
};

export type AttributeValues = Record<string, string>;

export const ATTRIBUTE_FIELD_TYPES: AttributeFieldType[] = ['text', 'number', 'url'];

/** Field keys are derived from the label once, then never move. */
export function attributeKey(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

const field = (
  label: string,
  type: AttributeFieldType = 'text',
  inSearch = false,
): AttributeField => ({
  key: attributeKey(label),
  label,
  type,
  inSearch,
});

/**
 * What each category starts with. Keyed by slug; a child slug falls back to its
 * parent's prefix, so `clothing-shoes` gets the clothing template.
 */
export const BUILT_IN_TEMPLATES: Record<string, AttributeField[]> = {
  'board-games': [
    field('Players'),
    field('Playing time (min)', 'number'),
    field('BGG rating', 'number'),
    field('BGG link', 'url'),
  ],
  books: [field('ISBN'), field('Genre'), field('Format')],
  clothing: [field('Brand'), field('Size'), field('Color'), field('Material')],
  electronics: [field('Brand'), field('Model'), field('Serial number'), field('Warranty until')],
  kitchen: [field('Brand'), field('Material')],
  beauty: [field('Brand'), field('Shade'), field('Size')],
};

/** The template a category has before anyone edits it. */
export function builtInTemplateFor(categorySlug: string | null | undefined): AttributeField[] {
  if (!categorySlug) return [];
  const exact = BUILT_IN_TEMPLATES[categorySlug];
  if (exact) return exact;
  const parent = categorySlug.split('-')[0] ?? '';
  return BUILT_IN_TEMPLATES[parent] ?? [];
}

function isFieldType(value: unknown): value is AttributeFieldType {
  return typeof value === 'string' && (ATTRIBUTE_FIELD_TYPES as string[]).includes(value);
}

/**
 * Read a template out of jsonb, dropping anything malformed.
 *
 * Rows are written by this app, but a bad row must not take down an item page,
 * so a field without a usable key or label is skipped rather than thrown on.
 */
export function parseTemplateFields(raw: unknown): AttributeField[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const fields: AttributeField[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const label = typeof record.label === 'string' ? record.label.trim() : '';
    const key =
      typeof record.key === 'string' && record.key.trim()
        ? attributeKey(record.key)
        : attributeKey(label);
    if (!key || !label || seen.has(key)) continue;
    seen.add(key);
    fields.push({
      key,
      label,
      type: isFieldType(record.type) ? record.type : 'text',
      // Absent means off: every template written before this existed keeps
      // searching on the title alone, which is what it was doing.
      inSearch: record.inSearch === true,
    });
  }
  return fields;
}

/** Read stored values out of jsonb. Everything is kept as a string. */
export function parseAttributeValues(raw: unknown): AttributeValues {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const values: AttributeValues = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value == null || value === '') continue;
    if (typeof value === 'string') values[key] = value;
    else if (typeof value === 'number' || typeof value === 'boolean') values[key] = String(value);
  }
  return values;
}

/** The template a category actually uses: the saved row, or the built-in one. */
export function templateFor(input: {
  categorySlug: string | null | undefined;
  savedFields: unknown;
  /** True when a template row exists — an empty saved template is deliberate. */
  hasSavedTemplate: boolean;
}): AttributeField[] {
  if (input.hasSavedTemplate) return parseTemplateFields(input.savedFields);
  return builtInTemplateFor(input.categorySlug);
}

/**
 * The fields to render for one item: the template, then anything the item
 * carries that the template has since dropped.
 *
 * A value whose field was removed from the template still belongs to the item.
 * Showing it is how the user gets to clear it, rather than finding it years
 * later in a jsonb column nothing renders.
 */
export function fieldsForItem(
  template: AttributeField[],
  values: AttributeValues,
): AttributeField[] {
  const known = new Set(template.map((f) => f.key));
  const extras = Object.keys(values)
    .filter((key) => !known.has(key))
    .sort()
    .map((key) => ({ key, label: humanizeKey(key), type: 'text' as const, inSearch: false }));
  return [...template, ...extras];
}

/**
 * The values that should join this item's product search, in template order.
 *
 * A field marked for search but left blank on this item contributes nothing --
 * the whole point of the marking is that the detail identifies the listing, and
 * a detail nobody filled in identifies nothing.
 */
export function searchTermsFor(
  template: readonly AttributeField[],
  values: AttributeValues,
): string[] {
  const terms: string[] = [];
  for (const field of template) {
    if (!field.inSearch) continue;
    // A URL is an address, not a description of the thing. Putting one in a
    // keyword search returns nothing at all.
    if (field.type === 'url') continue;
    const value = (values[field.key] ?? '').trim();
    if (value) terms.push(value);
  }
  return terms;
}

/** A readable label for a key that has no field definition left. */
export function humanizeKey(key: string): string {
  const words = key.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Which categories have a real product search behind them. */
export function searchProviderFor(
  categorySlug: string | null | undefined,
): 'bgg' | null {
  return categorySlug === 'board-games' ? 'bgg' : null;
}

/** Merge submitted values over the stored ones, dropping the ones cleared. */
export function mergeAttributeValues(
  current: AttributeValues,
  submitted: AttributeValues,
): AttributeValues {
  const next: AttributeValues = { ...current };
  for (const [key, value] of Object.entries(submitted)) {
    const trimmed = value.trim();
    if (trimmed === '') delete next[key];
    else next[key] = trimmed;
  }
  return next;
}
