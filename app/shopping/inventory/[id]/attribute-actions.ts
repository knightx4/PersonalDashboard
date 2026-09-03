'use server';

/**
 * The structured details on an item, the category template behind them, and
 * the one search that can fill them in.
 *
 * Kept apart from app/shopping/inventory/actions.ts because the search reaches
 * for the game resolver and its providers, which the rest of that file has no
 * business importing.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import {
  attributeKey,
  mergeAttributeValues,
  parseAttributeValues,
  parseTemplateFields,
  searchProviderFor,
  type AttributeField,
  type AttributeValues,
} from '@/lib/inventory/attributes';
import { createBggProvider } from '@/lib/games/providers/bgg';
import { resolveGame } from '@/lib/games/resolve';
import { serverEnv } from '@/lib/env';

export interface AttributeActionState {
  error?: string;
  message?: string;
}

/** Same shape and same fallback as the other server actions in this module. */
function envKeys() {
  try {
    const env = serverEnv();
    return {
      upcApiKey: env.UPCITEMDB_API_KEY ?? null,
      bggApiToken: env.BGG_API_TOKEN ?? null,
    };
  } catch {
    return {
      upcApiKey: process.env.UPCITEMDB_API_KEY ?? null,
      bggApiToken: process.env.BGG_API_TOKEN ?? null,
    };
  }
}

type ItemContext = {
  id: string;
  name: string;
  categoryId: string | null;
  categorySlug: string | null;
  categoryName: string | null;
  values: AttributeValues;
};

async function loadItem(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  itemId: string,
): Promise<ItemContext | null> {
  const { data } = await supabase
    .from('inventory_items')
    .select('id, name, attributes, category_id, categories ( slug, name )')
    .eq('id', itemId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return null;
  const category = Array.isArray(data.categories) ? data.categories[0] : data.categories;
  return {
    id: data.id as string,
    name: data.name as string,
    categoryId: (data.category_id as string | null) ?? null,
    categorySlug: (category?.slug as string | null) ?? null,
    categoryName: (category?.name as string | null) ?? null,
    values: parseAttributeValues(data.attributes),
  };
}

/** Save the values typed into the item's detail fields. */
export async function updateItemAttributes(
  _prev: AttributeActionState,
  formData: FormData,
): Promise<AttributeActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing item.' };

  const item = await loadItem(supabase, user.id, id.data);
  if (!item) return { error: 'Item not found.' };

  const submitted: AttributeValues = {};
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith('attr_') || typeof value !== 'string') continue;
    const key = attributeKey(name.slice('attr_'.length));
    if (key) submitted[key] = value;
  }

  // One-off field added from the item itself, without touching the template:
  // the shape of a single object is not always the shape of its category.
  const newLabel = String(formData.get('new_label') ?? '').trim();
  const newValue = String(formData.get('new_value') ?? '').trim();
  if (newLabel && newValue) {
    const key = attributeKey(newLabel);
    if (!key) return { error: 'That field name has no letters or numbers in it.' };
    submitted[key] = newValue;
  }

  const next = mergeAttributeValues(item.values, submitted);
  const { error } = await supabase
    .from('inventory_items')
    .update({ attributes: next })
    .eq('id', item.id)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePath(`/shopping/inventory/${item.id}`);
  return { message: 'Details saved.' };
}

/**
 * Rewrite the template for this item's category.
 *
 * Every item in the category renders from it, so this is the "applies to all
 * within that category" half of the ask. Values are keyed, not positional, so
 * renaming a field's label keeps the values already recorded under it.
 */
export async function saveCategoryTemplate(
  _prev: AttributeActionState,
  formData: FormData,
): Promise<AttributeActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const categoryId = z.string().uuid().safeParse(formData.get('category_id'));
  if (!categoryId.success) return { error: 'Give the item a category first.' };

  const labels = formData.getAll('field_label').map((value) => String(value));
  const types = formData.getAll('field_type').map((value) => String(value));
  const keys = formData.getAll('field_key').map((value) => String(value));

  const draft = labels.map((label, index) => ({
    // An existing key is carried in a hidden input so a relabelled field keeps
    // the values already stored under it.
    key: keys[index]?.trim() || attributeKey(label),
    label: label.trim(),
    type: types[index] ?? 'text',
  }));
  const fields: AttributeField[] = parseTemplateFields(
    draft.filter((entry) => entry.label !== ''),
  );

  const { error } = await supabase.from('category_attribute_templates').upsert(
    {
      user_id: user.id,
      category_id: categoryId.data,
      fields,
    },
    { onConflict: 'user_id,category_id' },
  );
  if (error) return { error: error.message };

  revalidatePath('/shopping/inventory');
  return {
    message:
      fields.length === 0
        ? 'Template cleared for this category.'
        : `Template saved — ${fields.length} field(s) on every item in this category.`,
  };
}

/**
 * Fill the details in from a product search.
 *
 * Board games have one: BoardGameGeek, already used when a game is added. No
 * other category does yet, and saying so plainly beats a button that looks
 * live and does nothing.
 */
export async function lookupItemAttributes(
  _prev: AttributeActionState,
  formData: FormData,
): Promise<AttributeActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing item.' };

  const item = await loadItem(supabase, user.id, id.data);
  if (!item) return { error: 'Item not found.' };

  if (searchProviderFor(item.categorySlug) !== 'bgg') {
    return {
      error: `Search is not set up for the ${item.categoryName ?? 'uncategorized'} category yet.`,
    };
  }

  const keys = envKeys();

  // The identity table is the better key when it is there: the game was
  // already matched and confirmed once, so there is nothing to guess.
  const { data: gameRow } = await supabase
    .from('game_details')
    .select('bgg_id')
    .eq('inventory_item_id', item.id)
    .maybeSingle();

  let bggId = (gameRow?.bgg_id as number | null) ?? null;
  if (bggId == null) {
    const resolved = await resolveGame(
      { title: item.name },
      { upcApiKey: keys.upcApiKey, bggApiToken: keys.bggApiToken },
    );
    bggId = resolved?.bggId ?? null;
  }
  if (bggId == null) {
    return { error: 'No BoardGameGeek match for this title.' };
  }

  let thing;
  try {
    thing = await createBggProvider({ apiToken: keys.bggApiToken }).thing(bggId);
  } catch (error) {
    console.error('bgg lookup failed', item.id, error);
    return { error: 'BoardGameGeek did not answer. Try again in a moment.' };
  }
  if (!thing) return { error: 'BoardGameGeek had nothing for that game.' };

  const players =
    thing.minPlayers && thing.maxPlayers
      ? thing.minPlayers === thing.maxPlayers
        ? String(thing.minPlayers)
        : `${thing.minPlayers}–${thing.maxPlayers}`
      : (thing.minPlayers ?? thing.maxPlayers)?.toString() ?? '';

  // Written under the built-in keys. A user who has renamed those in their own
  // template sees the looked-up values as extra fields rather than losing them.
  const found: AttributeValues = {
    players,
    playing_time_min: thing.playingTimeMinutes ? String(thing.playingTimeMinutes) : '',
    bgg_rating: thing.averageRating ? thing.averageRating.toFixed(1) : '',
    bgg_link: `https://boardgamegeek.com/boardgame/${thing.bggId}`,
  };
  const filled = Object.entries(found).filter(([, value]) => value !== '');

  const { error } = await supabase
    .from('inventory_items')
    .update({ attributes: mergeAttributeValues(item.values, Object.fromEntries(filled)) })
    .eq('id', item.id)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePath(`/shopping/inventory/${item.id}`);
  return { message: `Filled in ${filled.length} field(s) from BoardGameGeek.` };
}
