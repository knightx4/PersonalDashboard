'use server';

import { revalidatePath } from 'next/cache';
import { createClient, requireUser } from '@/lib/auth/server';
import { insertOwned, manualItemRow } from '@/lib/inventory/add-owned';
import { parseDollarsToCents, todayInTimezone } from '@/lib/money';

export type ItemActionState = {
  error?: string;
  message?: string;
  savedId?: string;
};

/**
 * Add something you own that no capture flow covers.
 *
 * Books and board games have their own screens because they have a catalog
 * behind them -- an ISBN or a BGG id turns into a sell-ready unit on its own.
 * Everything else a person owns has no catalog to ask, so the only honest way
 * in is to type it. Without this the inventory could only ever contain what an
 * order email, a barcode or a shelf photo happened to produce.
 *
 * The row is deliberately the same shape a manual book produces: display
 * fields derived by the same helper, a loose fingerprint so the already-own
 * check works, and no detail row, which is what makes `manual_expected_price`
 * the price the sell page reads for it.
 */
// latency: pending
export async function saveManualItem(
  _prev: ItemActionState,
  formData: FormData,
): Promise<ItemActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { error: 'Name is required.' };

  const categoryId = String(formData.get('category_id') ?? '').trim() || null;

  let costCents: number;
  try {
    costCents = parseDollarsToCents(String(formData.get('cost') ?? ''));
  } catch {
    return { error: 'Cost must be a dollar amount, like 24.99.' };
  }
  if (costCents < 0) return { error: 'Cost cannot be negative.' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('timezone')
    .eq('id', user.id)
    .single();
  const today = todayInTimezone(profile?.timezone ?? 'UTC');

  const acquiredRaw = String(formData.get('acquired_at') ?? '').trim();
  if (acquiredRaw && !/^\d{4}-\d{2}-\d{2}$/.test(acquiredRaw)) {
    return { error: 'Acquired date must be a calendar date.' };
  }

  // The category's slug and name feed the search tags, so an item filed under
  // "Kitchen" is findable by the words that category implies.
  let category: { id: string; slug: string; name: string } | null = null;
  if (categoryId) {
    const { data } = await supabase
      .from('categories')
      .select('slug, name')
      .eq('id', categoryId)
      .maybeSingle();
    if (!data) return { error: 'That category no longer exists.' };
    category = { id: categoryId, slug: data.slug as string, name: data.name as string };
  }

  const row = manualItemRow({
    userId: user.id,
    name,
    variant: String(formData.get('variant') ?? '').trim() || null,
    notes: String(formData.get('notes') ?? '').trim() || null,
    category,
    costCents,
    acquiredOn: acquiredRaw || today,
  });
  const saved = await insertOwned(supabase, { userId: user.id, items: [row] });
  if (!saved.ok) return { error: saved.error };
  const id = row.id as string;

  revalidatePath('/shopping/inventory');
  revalidatePath('/shopping/sell');
  return { message: 'Added to your inventory.', savedId: id };
}
