import type { SchemaClient } from '@/lib/ask/db';
import { fingerprintLoose } from '@/lib/fingerprint';
import { findMerchantByUrl } from './resolve-merchant';

/**
 * The saved-for-later list's writes, as its pages and Dash's
 * change_saved_item both make them (plan #2473.4). Each takes the user
 * explicitly, so it works the same on the page's client (RLS) and on the
 * connector's service role, and hands back the row as it is now. Values come
 * in checked by the caller.
 */

type Row = Record<string, unknown>;

export type SavedWrite = { item: Row; error?: undefined } | { item?: undefined; error: string };

/** The shop a product link is from, among the merchants they can see, or null. */
export async function merchantForLink(supabase: SchemaClient, link: string): Promise<{ id: string; name: string } | null> {
  const { data, error } = await supabase.from('merchants').select('id, slug, name, domains');
  if (error) throw new Error(`Reading the merchants failed: ${error.message}`);
  return findMerchantByUrl(
    link,
    ((data ?? []) as Row[]).map((m) => ({
      id: m.id as string,
      slug: m.slug as string,
      name: m.name as string,
      domains: (m.domains ?? []) as string[],
    })),
  );
}

/** Save a product for later, matched to its shop by the link when no shop is given. */
export async function saveForLater(
  supabase: SchemaClient,
  opts: {
    userId: string;
    url: string;
    title: string;
    imageUrl: string | null;
    priceCents: number | null;
    currency: string;
    notes: string | null;
    merchantId?: string | null;
  },
): Promise<SavedWrite> {
  const merchantId = opts.merchantId || ((await merchantForLink(supabase, opts.url))?.id ?? null);
  const { data, error } = await supabase
    .from('saved_items')
    .insert({
      user_id: opts.userId,
      url: opts.url,
      title: opts.title,
      image_url: opts.imageUrl,
      price_cents: opts.priceCents,
      currency: opts.currency,
      notes: opts.notes?.trim() ? opts.notes.trim() : null,
      merchant_id: merchantId,
      fingerprint_loose: fingerprintLoose(opts.title),
      status: 'saved',
    })
    .select('*')
    .single();
  if (error || !data) return { error: error?.message ?? 'The item was not saved.' };
  return { item: data as Row };
}

/** The columns an edit may change. */
export type SavedPatch = Partial<{
  url: string;
  title: string;
  image_url: string | null;
  price_cents: number | null;
  currency: string;
  notes: string | null;
  merchant_id: string | null;
}>;

/** Change a saved item's details. A new title gets the fingerprint it is matched by. */
export async function updateSaved(
  supabase: SchemaClient,
  opts: { userId: string; id: string; patch: SavedPatch },
): Promise<SavedWrite> {
  const values: Row = { ...opts.patch };
  if ('notes' in values) values.notes = typeof values.notes === 'string' && values.notes.trim() ? values.notes.trim() : null;
  if (typeof opts.patch.title === 'string') values.fingerprint_loose = fingerprintLoose(opts.patch.title);
  return write(supabase, opts.userId, opts.id, values);
}

/** Mark a saved item bought, put it aside, or move it back to saved. */
export async function setSavedStatus(
  supabase: SchemaClient,
  opts: { userId: string; id: string; status: 'saved' | 'purchased' | 'dismissed' },
): Promise<SavedWrite> {
  return write(supabase, opts.userId, opts.id, { status: opts.status });
}

async function write(supabase: SchemaClient, userId: string, id: string, values: Row): Promise<SavedWrite> {
  const { data, error } = await supabase.from('saved_items').update(values).eq('id', id).eq('user_id', userId).select('*').maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: 'That saved item is not there any more.' };
  return { item: data as Row };
}
