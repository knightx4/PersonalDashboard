'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { attachBookDetailsForInventory } from '@/lib/books/attach-order-books';
import { parseDollarsToCents } from '@/lib/money';

export type SellActionState = {
  error?: string;
  message?: string;
};

export async function updateSellSettings(
  _prev: SellActionState,
  formData: FormData,
): Promise<SellActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  let floorCents: number | null = null;
  const floorRaw = String(formData.get('net_floor') ?? '').trim();
  if (floorRaw !== '') {
    try {
      floorCents = parseDollarsToCents(floorRaw);
    } catch {
      return { error: 'Net floor must be a dollar amount like 10.00.' };
    }
  }

  let effortCents = 500;
  const effortRaw = String(formData.get('effort') ?? '').trim();
  if (effortRaw !== '') {
    try {
      effortCents = parseDollarsToCents(effortRaw);
    } catch {
      return { error: 'Effort cost must be a dollar amount like 5.00.' };
    }
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      sell_net_floor_cents: floorCents,
      sell_effort_cents: effortCents,
    })
    .eq('id', user.id);
  if (error) return { error: error.message };

  revalidatePath('/sell');
  return { message: 'Sell settings saved.' };
}

export async function noteListingIntent(
  _prev: SellActionState,
  formData: FormData,
): Promise<SellActionState> {
  const user = await requireUser();
  const supabase = await createClient();
  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing item.' };

  const note = String(formData.get('note') ?? '').trim() || 'Planning to list myself.';

  const { data: item } = await supabase
    .from('inventory_items')
    .select('id, notes')
    .eq('id', id.data)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!item) return { error: 'Item not found.' };

  const nextNotes = item.notes ? `${item.notes}\n${note}` : note;
  const { error } = await supabase
    .from('inventory_items')
    .update({ notes: nextNotes })
    .eq('id', item.id);
  if (error) return { error: error.message };

  revalidatePath('/sell');
  revalidatePath(`/inventory/${item.id}`);
  return { message: 'Noted — draft only; nothing was posted.' };
}


/** How many owned units one scan looks at; book lookups are third-party HTTP. */
const SCAN_LIMIT = 150;

/**
 * Find books among inventory the user already has — orders imported before
 * book detection existed, or manual entries — and give them ISBN identity.
 * New email imports do this automatically during ingestion.
 */
export async function importBooksFromOrders(
  // Signature is fixed by useActionState; the scan takes no input of its own.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prev: SellActionState, _formData: FormData,
): Promise<SellActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: items, error } = await supabase
    .from('inventory_items')
    .select(
      `
      id, name, variant, image_url, search_tags,
      categories ( slug ),
      order_items ( product_url )
    `,
    )
    .eq('user_id', user.id)
    .eq('status', 'owned')
    .order('created_at', { ascending: false })
    .limit(SCAN_LIMIT);
  if (error) return { error: error.message };
  if (!items || items.length === 0) return { message: 'No owned items to scan yet.' };

  const first = <T,>(value: T | T[] | null | undefined): T | null => {
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  };

  const result = await attachBookDetailsForInventory(supabase, {
    userId: user.id,
    autoImported: true,
    googleBooksApiKey: process.env.GOOGLE_BOOKS_API_KEY ?? null,
    isbndbApiKey: process.env.ISBNDB_API_KEY ?? null,
    lines: items.map((item) => ({
      inventoryItemId: item.id as string,
      name: item.name as string,
      variant: (item.variant as string | null) ?? null,
      imageUrl: (item.image_url as string | null) ?? null,
      searchTags: (item.search_tags as string[] | null) ?? [],
      categorySlug: first(item.categories as { slug: string } | { slug: string }[] | null)?.slug ?? null,
      productUrl:
        first(item.order_items as { product_url: string | null } | { product_url: string | null }[] | null)
          ?.product_url ?? null,
    })),
  });

  revalidatePath('/sell');
  revalidatePath('/inventory');

  if (result.attached === 0) {
    return {
      message:
        result.unresolved > 0
          ? `No new books added — ${result.unresolved} book-looking item(s) had no catalog match.`
          : 'No new books found in your recent items.',
    };
  }
  return {
    message: `Added book details for ${result.attached} item(s)${
      result.unresolved > 0 ? `; ${result.unresolved} had no catalog match` : ''
    }.`,
  };
}
