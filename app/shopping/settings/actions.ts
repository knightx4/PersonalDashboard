'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { decryptToken } from '@/lib/crypto/tokens';
import { gmailOAuthEnv } from '@/lib/email/gmail-env';
import { gmailProvider } from '@/lib/email/providers/gmail';
import { pickCategoryColor, slugifyCategoryName } from '@/lib/categories/slugify';
import { pickListGradient } from '@/lib/lists/gradients';

export type CategoryActionState = {
  error?: string;
  message?: string;
};

/** Revoke Google's grant and remove the email_accounts row (cascades sync data). */
export async function disconnectInbox(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = z.object({ id: z.string().uuid() }).safeParse({ id: formData.get('id') });
  if (!parsed.success) return;

  const core = await createCoreClient();
  const { data: account, error: fetchError } = await core
    .from('email_accounts')
    .select('id, oauth_refresh_token')
    .eq('id', parsed.data.id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (fetchError || !account) {
    return;
  }

  if (account.oauth_refresh_token) {
    try {
      const { TOKEN_ENCRYPTION_KEY } = gmailOAuthEnv();
      const refresh = decryptToken(account.oauth_refresh_token, TOKEN_ENCRYPTION_KEY);
      await gmailProvider.revokeToken(refresh);
    } catch {
      // Still delete locally if Google revoke fails (token may already be dead).
    }
  }

  const { error: deleteError } = await core
    .from('email_accounts')
    .delete()
    .eq('id', account.id)
    .eq('user_id', user.id);

  if (deleteError) {
    return;
  }

  revalidatePath('/shopping/settings');
}

/**
 * Wipe import state for one inbox so a fresh backfill can re-read Gmail.
 * Deletes email-sourced orders created from this inbox (and cascaded inventory),
 * clears ingested_messages / sync cursor, and leaves the Gmail connection intact.
 */
export async function resetInboxImport(accountId: string): Promise<{
  ok: boolean;
  deletedOrders: number;
  error?: string;
}> {
  const user = await requireUser();
  const parsed = z.string().uuid().safeParse(accountId);
  if (!parsed.success) return { ok: false, deletedOrders: 0, error: 'Invalid inbox.' };

  const supabase = await createClient();
  const core = await createCoreClient();
  const { data: account } = await core
    .from('email_accounts')
    .select('id')
    .eq('id', parsed.data)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!account) return { ok: false, deletedOrders: 0, error: 'Inbox not found.' };

  const { data: linked } = await supabase
    .from('ingested_messages')
    .select('resulting_order_id')
    .eq('email_account_id', account.id)
    .not('resulting_order_id', 'is', null);

  const orderIds = [
    ...new Set(
      (linked ?? [])
        .map((row) => row.resulting_order_id as string | null)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  await core
    .from('sync_jobs')
    .update({
      status: 'failed',
      error: 'Superseded by reset & re-scan',
      finished_at: new Date().toISOString(),
    })
    .eq('email_account_id', account.id)
    .in('status', ['queued', 'running']);

  const { error: ingestError } = await supabase
    .from('ingested_messages')
    .delete()
    .eq('email_account_id', account.id);
  if (ingestError) {
    return { ok: false, deletedOrders: 0, error: ingestError.message };
  }

  // Prefer deleting orders this inbox created; also remove orphan email orders
  // no longer referenced by any inbox (e.g. duplicates from earlier imports).
  const { data: stillLinked } = await supabase
    .from('ingested_messages')
    .select('resulting_order_id')
    .not('resulting_order_id', 'is', null);
  const keep = new Set(
    (stillLinked ?? [])
      .map((row) => row.resulting_order_id as string | null)
      .filter((id): id is string => Boolean(id)),
  );

  const { data: emailOrders } = await supabase
    .from('orders')
    .select('id')
    .eq('user_id', user.id)
    .eq('source', 'email');

  const toDelete = (emailOrders ?? [])
    .map((row) => row.id as string)
    .filter((id) => orderIds.includes(id) || !keep.has(id));

  if (toDelete.length > 0) {
    const { error: orderError } = await supabase
      .from('orders')
      .delete()
      .eq('user_id', user.id)
      .eq('source', 'email')
      .in('id', toDelete);
    if (orderError) {
      return { ok: false, deletedOrders: 0, error: orderError.message };
    }
  }

  await core
    .from('email_accounts')
    .update({
      sync_cursor: null,
      sync_page_token: null,
      backfill_completed_at: null,
      last_synced_at: null,
    })
    .eq('id', account.id)
    .eq('user_id', user.id);

  revalidatePath('/shopping/settings');
  revalidatePath('/shopping/orders');
  revalidatePath('/shopping/inventory');
  revalidatePath('/shopping/dashboard');

  return { ok: true, deletedOrders: toDelete.length };
}

/**
 * Re-run the latest parser on already-imported confirmation emails for this
 * inbox. Re-fetches Gmail bodies and updates orders in place — does not delete
 * orders or reset the sync cursor.
 */
export async function reparseInboxOrders(accountId: string): Promise<{
  ok: boolean;
  considered: number;
  updated: number;
  skipped: number;
  errors: number;
  error?: string;
}> {
  const user = await requireUser();
  const parsed = z.string().uuid().safeParse(accountId);
  if (!parsed.success) {
    return { ok: false, considered: 0, updated: 0, skipped: 0, errors: 0, error: 'Invalid inbox.' };
  }

  const supabase = await createClient();
  const core = await createCoreClient();
  const { data: account } = await core
    .from('email_accounts')
    .select(
      'id, user_id, email_address, oauth_refresh_token, oauth_access_token, token_expires_at, backfill_window_days, sync_cursor, last_synced_at, status',
    )
    .eq('id', parsed.data)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!account) {
    return { ok: false, considered: 0, updated: 0, skipped: 0, errors: 0, error: 'Inbox not found.' };
  }

  try {
    const { TOKEN_ENCRYPTION_KEY } = gmailOAuthEnv();
    const { ensureAccessToken } = await import('@/lib/core/inbox/sync-account');
    const { loadCategoryContext } = await import('@/lib/inbox/context');
    const { loadMerchantsForUser } = await import('@/lib/merchants/resolve-order-merchant');
    const { loadMerchantExclusions } = await import('@/lib/inbox/merchant-exclusions');
    const { reparseInboxConfirmations } = await import('@/lib/inbox/reparse-confirmations');

    const accessToken = await ensureAccessToken(core, account, TOKEN_ENCRYPTION_KEY);
    const merchants = (await loadMerchantsForUser(supabase, user.id)).map((m) => ({
      id: m.id,
      slug: m.slug,
      name: m.name,
      domains: m.domains,
    }));
    const exclusions = await loadMerchantExclusions(supabase, user.id);
    const { categoryIdsBySlug, categoryOptions } = await loadCategoryContext(supabase, user.id);

    const counters = await reparseInboxConfirmations(supabase, {
      userId: user.id,
      accountId: account.id,
      accessToken,
      merchants,
      exclusions,
      categoryIdsBySlug,
      categoryOptions,
      onlyOutdated: true,
    });

    revalidatePath('/shopping/settings');
    revalidatePath('/shopping/orders');
    revalidatePath('/shopping/inventory');
    revalidatePath('/shopping/dashboard');
    revalidatePath('/shopping/review');

    return { ok: true, ...counters };
  } catch (err) {
    return {
      ok: false,
      considered: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      error: err instanceof Error ? err.message : 'Reparse failed',
    };
  }
}

const createCategorySchema = z.object({
  name: z.string().trim().min(2).max(40),
});

export async function createCustomCategory(
  _prev: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const user = await requireUser();
  const parsed = createCategorySchema.safeParse({
    name: formData.get('name'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  const slug = slugifyCategoryName(parsed.data.name);
  if (!slug) return { error: 'Use letters or numbers in the category name.' };

  const supabase = await createClient();
  const { data: conflicts } = await supabase
    .from('categories')
    .select('id, user_id')
    .eq('slug', slug);
  if ((conflicts ?? []).some((row) => row.user_id == null || row.user_id === user.id)) {
    return { error: 'That category name is already used. Try another.' };
  }

  const { data: existingCustom } = await supabase
    .from('categories')
    .select('color')
    .eq('user_id', user.id);
  const color = pickCategoryColor((existingCustom ?? []).map((row) => row.color));

  const { error } = await supabase.from('categories').insert({
    user_id: user.id,
    parent_id: null,
    name: parsed.data.name,
    slug,
    color,
  });
  if (error) return { error: error.message };

  revalidatePath('/shopping/settings');
  revalidatePath('/shopping/inventory');
  revalidatePath('/shopping/orders');
  revalidatePath('/shopping/dashboard');
  return { message: 'Category added. New imports can use it automatically.' };
}

export async function renameCustomCategory(
  _prev: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const user = await requireUser();
  const parsed = z
    .object({
      id: z.string().uuid(),
      name: z.string().trim().min(2).max(40),
    })
    .safeParse({
      id: formData.get('id'),
      name: formData.get('name'),
    });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('categories')
    .update({ name: parsed.data.name })
    .eq('id', parsed.data.id)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePath('/shopping/settings');
  revalidatePath('/shopping/inventory');
  revalidatePath('/shopping/orders');
  revalidatePath('/shopping/dashboard');
  return { message: 'Category renamed.' };
}

export async function deleteCustomCategory(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = z.object({ id: z.string().uuid() }).safeParse({ id: formData.get('id') });
  if (!parsed.success) return;

  const supabase = await createClient();
  await supabase.from('categories').delete().eq('id', parsed.data.id).eq('user_id', user.id);

  revalidatePath('/shopping/settings');
  revalidatePath('/shopping/inventory');
  revalidatePath('/shopping/orders');
  revalidatePath('/shopping/dashboard');
}

export type ListActionState = {
  error?: string;
  message?: string;
};

const createListSchema = z.object({
  name: z.string().trim().min(2).max(40),
});

export async function createItemList(
  _prev: ListActionState,
  formData: FormData,
): Promise<ListActionState> {
  const user = await requireUser();
  const parsed = createListSchema.safeParse({
    name: formData.get('name'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  const slug = slugifyCategoryName(parsed.data.name);
  if (!slug) return { error: 'Use letters or numbers in the list name.' };

  const supabase = await createClient();
  const { data: conflict } = await supabase
    .from('item_lists')
    .select('id')
    .eq('user_id', user.id)
    .eq('slug', slug)
    .maybeSingle();
  if (conflict) return { error: 'That list name is already used. Try another.' };

  const { data: existing } = await supabase
    .from('item_lists')
    .select('color')
    .eq('user_id', user.id);
  const color = pickListGradient((existing ?? []).map((row) => row.color));

  const { error } = await supabase.from('item_lists').insert({
    user_id: user.id,
    name: parsed.data.name,
    slug,
    color,
  });
  if (error) return { error: error.message };

  revalidatePath('/shopping/settings');
  revalidatePath('/shopping/inventory');
  return { message: 'List created. Add items from any inventory detail page.' };
}

export async function renameItemList(
  _prev: ListActionState,
  formData: FormData,
): Promise<ListActionState> {
  const user = await requireUser();
  const parsed = z
    .object({
      id: z.string().uuid(),
      name: z.string().trim().min(2).max(40),
    })
    .safeParse({
      id: formData.get('id'),
      name: formData.get('name'),
    });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('item_lists')
    .update({ name: parsed.data.name })
    .eq('id', parsed.data.id)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePath('/shopping/settings');
  revalidatePath('/shopping/inventory');
  return { message: 'List renamed.' };
}

export async function deleteItemList(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = z.object({ id: z.string().uuid() }).safeParse({ id: formData.get('id') });
  if (!parsed.success) return;

  const supabase = await createClient();
  await supabase.from('item_lists').delete().eq('id', parsed.data.id).eq('user_id', user.id);

  revalidatePath('/shopping/settings');
  revalidatePath('/shopping/inventory');
}

export async function deleteItemTag(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = z.object({ id: z.string().uuid() }).safeParse({ id: formData.get('id') });
  if (!parsed.success) return;

  const supabase = await createClient();
  await supabase.from('item_tags').delete().eq('id', parsed.data.id).eq('user_id', user.id);

  revalidatePath('/shopping/settings');
  revalidatePath('/shopping/orders');
}

export type DisplayCurrencyState = {
  error?: string;
  message?: string;
};

export async function updateDisplayCurrency(
  _prev: DisplayCurrencyState,
  formData: FormData,
): Promise<DisplayCurrencyState> {
  const user = await requireUser();
  const { isSupportedDisplayCurrency, normalizeCurrencyCode } = await import(
    '@/lib/fx/money-fx'
  );
  const parsed = z
    .object({
      display_currency: z
        .string()
        .trim()
        .transform((value) => normalizeCurrencyCode(value))
        .refine((value) => isSupportedDisplayCurrency(value), 'Unsupported currency'),
    })
    .safeParse({ display_currency: formData.get('display_currency') });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Pick a valid currency.' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('profiles')
    .update({ display_currency: parsed.data.display_currency })
    .eq('id', user.id);
  if (error) return { error: error.message };

  revalidatePath('/shopping/settings');
  revalidatePath('/shopping/dashboard');
  revalidatePath('/shopping/orders');
  revalidatePath('/shopping/review');
  revalidatePath('/shopping/inventory');
  return { message: `Display currency set to ${parsed.data.display_currency}.` };
}
