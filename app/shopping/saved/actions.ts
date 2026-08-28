'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { fingerprintLoose } from '@/lib/fingerprint';
import { formatCentsAsDollarsInput, parseDollarsToCents } from '@/lib/money';
import { findMerchantByUrl } from '@/lib/saved/resolve-merchant';
import { ScrapeUrlError, scrapeProductUrl } from '@/lib/saved/scrape-product';

export interface ActionState {
  error?: string;
  message?: string;
}

export interface OwnedMatch {
  id: string;
  name: string;
  variant: string | null;
  costCents: number | null;
  acquiredAt: string | null;
}

export interface PreviewState {
  error?: string;
  url?: string;
  title?: string;
  imageUrl?: string;
  price?: string;
  currency?: string;
  merchantId?: string | null;
  merchantName?: string | null;
  source?: string;
  ownedMatches?: OwnedMatch[];
}

function moneyFieldOptional(label: string) {
  return z.string().transform((value, ctx) => {
    try {
      if (value.trim() === '') return null;
      return parseDollarsToCents(value);
    } catch {
      ctx.addIssue({
        code: 'custom',
        message: `${label} must be a dollar amount like 12.99.`,
      });
      return z.NEVER;
    }
  });
}

async function loadMerchants(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase.from('merchants').select('id, slug, name, domains');
  return (data ?? []).map((row) => ({
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    domains: (row.domains ?? []) as string[],
  }));
}

async function findOwnedMatches(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  title: string | null | undefined,
): Promise<OwnedMatch[]> {
  if (!title?.trim()) return [];
  const fp = fingerprintLoose(title);
  const { data } = await supabase
    .from('inventory_items')
    .select('id, name, variant, cost_cents, acquired_at')
    .eq('user_id', userId)
    .eq('status', 'owned')
    .eq('fingerprint_loose', fp)
    .order('acquired_at', { ascending: false })
    .limit(10);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    variant: (row.variant as string | null) ?? null,
    costCents: (row.cost_cents as number | null) ?? null,
    acquiredAt: (row.acquired_at as string | null) ?? null,
  }));
}

export async function previewSavedUrl(
  _prev: PreviewState,
  formData: FormData,
): Promise<PreviewState> {
  const user = await requireUser();
  const supabase = await createClient();

  const rawUrl = String(formData.get('url') ?? '').trim();
  if (!rawUrl) return { error: 'Paste a product URL to look up.' };

  let scraped;
  try {
    scraped = await scrapeProductUrl(rawUrl);
  } catch (error) {
    const message =
      error instanceof ScrapeUrlError
        ? error.message
        : 'Could not look up that URL. You can still save it manually.';
    return { error: message };
  }

  const merchants = await loadMerchants(supabase);
  const merchant = findMerchantByUrl(scraped.url, merchants);
  const ownedMatches = await findOwnedMatches(supabase, user.id, scraped.title);

  return {
    url: scraped.url,
    title: scraped.title ?? '',
    imageUrl: scraped.imageUrl ?? '',
    price:
      scraped.priceCents != null ? formatCentsAsDollarsInput(scraped.priceCents) : '',
    currency: scraped.currency,
    merchantId: merchant?.id ?? null,
    merchantName: merchant?.name ?? null,
    source: scraped.source,
    ownedMatches,
  };
}

const saveSchema = z.object({
  url: z.string().url('Paste a valid product URL.'),
  title: z.string().trim().min(1, 'Add a title so we can match this later.'),
  imageUrl: z
    .string()
    .trim()
    .transform((value, ctx) => {
      if (!value) return null;
      try {
        return new URL(value).toString();
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Image URL looks invalid.' });
        return z.NEVER;
      }
    }),
  priceCents: moneyFieldOptional('Price'),
  currency: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase() || 'USD')
    .pipe(z.string().length(3, 'Currency must be a 3-letter code.')),
  notes: z.string().optional(),
  merchantId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal('').transform(() => undefined))
    .or(z.literal('null').transform(() => undefined)),
});

export async function createSavedItem(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const parsed = saveSchema.safeParse({
    url: String(formData.get('url') ?? ''),
    title: String(formData.get('title') ?? ''),
    imageUrl: String(formData.get('image_url') ?? ''),
    priceCents: String(formData.get('price') ?? ''),
    currency: String(formData.get('currency') ?? 'USD'),
    notes: String(formData.get('notes') ?? ''),
    merchantId: String(formData.get('merchant_id') ?? ''),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  let merchantId = parsed.data.merchantId ?? null;
  if (!merchantId) {
    const merchants = await loadMerchants(supabase);
    merchantId = findMerchantByUrl(parsed.data.url, merchants)?.id ?? null;
  }

  const { data, error } = await supabase
    .from('saved_items')
    .insert({
      user_id: user.id,
      url: parsed.data.url,
      title: parsed.data.title,
      image_url: parsed.data.imageUrl,
      price_cents: parsed.data.priceCents,
      currency: parsed.data.currency,
      notes: parsed.data.notes?.trim() ? parsed.data.notes.trim() : null,
      merchant_id: merchantId,
      fingerprint_loose: fingerprintLoose(parsed.data.title),
      status: 'saved',
    })
    .select('id')
    .single();

  if (error) return { error: error.message };
  revalidatePath('/shopping/saved');
  redirect(`/shopping/saved/${data.id}`);
}

export async function updateSavedItem(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const parsed = saveSchema
    .extend({ id: z.string().uuid() })
    .safeParse({
      id: formData.get('id'),
      url: String(formData.get('url') ?? ''),
      title: String(formData.get('title') ?? ''),
      imageUrl: String(formData.get('image_url') ?? ''),
      priceCents: String(formData.get('price') ?? ''),
      currency: String(formData.get('currency') ?? 'USD'),
      notes: String(formData.get('notes') ?? ''),
      merchantId: String(formData.get('merchant_id') ?? ''),
    });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  const { error } = await supabase
    .from('saved_items')
    .update({
      url: parsed.data.url,
      title: parsed.data.title,
      image_url: parsed.data.imageUrl,
      price_cents: parsed.data.priceCents,
      currency: parsed.data.currency,
      notes: parsed.data.notes?.trim() ? parsed.data.notes.trim() : null,
      merchant_id: parsed.data.merchantId ?? null,
      fingerprint_loose: fingerprintLoose(parsed.data.title),
    })
    .eq('id', parsed.data.id)
    .eq('user_id', user.id);

  if (error) return { error: error.message };

  revalidatePath('/shopping/saved');
  revalidatePath(`/shopping/saved/${parsed.data.id}`);
  return { message: 'Saved.' };
}

async function setSavedStatus(
  id: string,
  status: 'saved' | 'purchased' | 'dismissed',
): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('saved_items')
    .update({ status })
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return { error: error.message };

  revalidatePath('/shopping/saved');
  revalidatePath(`/shopping/saved/${id}`);
  return { message: status === 'saved' ? 'Moved back to saved.' : `Marked ${status}.` };
}

export async function markSavedPurchased(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = String(formData.get('id') ?? '');
  if (!z.string().uuid().safeParse(id).success) return { error: 'Missing item.' };
  return setSavedStatus(id, 'purchased');
}

export async function dismissSavedItem(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = String(formData.get('id') ?? '');
  if (!z.string().uuid().safeParse(id).success) return { error: 'Missing item.' };
  return setSavedStatus(id, 'dismissed');
}

export async function restoreSavedItem(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = String(formData.get('id') ?? '');
  if (!z.string().uuid().safeParse(id).success) return { error: 'Missing item.' };
  return setSavedStatus(id, 'saved');
}

export async function deleteSavedItem(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();
  const id = String(formData.get('id') ?? '');
  if (!z.string().uuid().safeParse(id).success) return { error: 'Missing item.' };

  const { error } = await supabase
    .from('saved_items')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return { error: error.message };

  revalidatePath('/shopping/saved');
  redirect('/shopping/saved');
}
