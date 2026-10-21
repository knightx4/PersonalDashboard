import type { SchemaClient } from '@/lib/ask/db';

/**
 * Setting a shop's return window, and adding a shop of the person's own with
 * one, as Shopping's settings and Dash's return_window both do it (plan
 * #2473.4). Each takes the user explicitly, so it works the same on the
 * page's client (RLS) and on the connector's service role, and each hands
 * back the rows as they were and are so Dash can keep its Undo.
 */

type Row = Record<string, unknown>;

/** A shop's slug before the owner's suffix, as the settings page has always made one. */
export function shopSlug(name: string): string {
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

/** The slug of a shop this person added: their own, so two accounts can each add a shop of the same name. */
export const ownShopSlug = (name: string, userId: string) => `${shopSlug(name)}-${userId.slice(0, 8)}`;

export const OWN_SHOP_TAKEN = 'You already have a merchant with that name.';

/** Add a shop of their own with this window (null for none). The name comes in trimmed and checked. */
export async function addOwnShop(
  supabase: SchemaClient,
  opts: { userId: string; name: string; days: number | null },
): Promise<{ shop: Row; error?: undefined } | { shop?: undefined; error: string }> {
  const slug = ownShopSlug(opts.name, opts.userId);
  const { data: conflict, error: readError } = await supabase
    .from('merchants')
    .select('id')
    .eq('created_by_user_id', opts.userId)
    .eq('slug', slug)
    .maybeSingle();
  if (readError) return { error: readError.message };
  if (conflict) return { error: OWN_SHOP_TAKEN };
  const { data, error } = await supabase
    .from('merchants')
    .insert({
      name: opts.name,
      slug,
      domains: [],
      created_by_user_id: opts.userId,
      is_global: false,
      default_return_window_days: opts.days,
    })
    .select('*')
    .single();
  if (error || !data) return { error: error?.message ?? 'Could not create that merchant.' };
  return { shop: data as Row };
}

/**
 * Set this person's window for a shop: days, or null for none. With
 * `dropAtDefault`, a window equal to the shop's own is kept by taking theirs
 * away, so the shop's stays the source, as the settings page does; Dash never
 * deletes, so it writes the default in instead.
 */
export async function setReturnWindow(
  supabase: SchemaClient,
  opts: { userId: string; merchantId: string; days: number | null; shopDays: number | null; dropAtDefault: boolean },
): Promise<{ before: Row | null; after: Row | null; error?: undefined } | { error: string }> {
  const { data: existing, error: readError } = await supabase
    .from('merchant_return_policies')
    .select('*')
    .eq('user_id', opts.userId)
    .eq('merchant_id', opts.merchantId)
    .maybeSingle();
  if (readError) return { error: readError.message };
  const before = (existing as Row | null) ?? null;

  if (opts.dropAtDefault && opts.days === opts.shopDays) {
    const { error } = await supabase
      .from('merchant_return_policies')
      .delete()
      .eq('user_id', opts.userId)
      .eq('merchant_id', opts.merchantId);
    if (error) return { error: error.message };
    return { before, after: null };
  }

  const { data, error } = before
    ? await supabase
        .from('merchant_return_policies')
        .update({ return_window_days: opts.days })
        .eq('id', before.id)
        .eq('user_id', opts.userId)
        .select('*')
        .single()
    : await supabase
        .from('merchant_return_policies')
        .insert({ user_id: opts.userId, merchant_id: opts.merchantId, return_window_days: opts.days })
        .select('*')
        .single();
  if (error || !data) return { error: error?.message ?? 'The return window was not saved.' };
  return { before, after: data as Row };
}
