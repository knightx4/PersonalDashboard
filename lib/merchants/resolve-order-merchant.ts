import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { domainFromAddress } from '@/lib/email/extract/classify';
import { displayNameFromAddress } from '@/lib/email/extract/heuristic';
import {
  isPlatformMerchantSlug,
  isPlatformSenderDomain,
} from '@/lib/merchants/platform';

export type ResolvedMerchant = {
  id: string;
  slug: string;
  name: string;
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function titleFromDomain(domain: string): string {
  const base = domain.replace(/^mail\./, '').replace(/^orders?\./, '').replace(/^noreply\./, '');
  const label = base.split('.')[0] ?? base;
  return label
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Global + this user's merchants (for domain matching on re-import). */
export async function loadMerchantsForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<Array<{ id: string; slug: string; name: string; domains: string[] }>> {
  const { data, error } = await supabase
    .from('merchants')
    .select('id, slug, name, domains, is_global, created_by_user_id')
    .or(`is_global.eq.true,created_by_user_id.eq.${userId}`);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    domains: (row.domains as string[]) ?? [],
  }));
}

/**
 * Prefer a classified/seeded merchant; otherwise find-or-create a user merchant
 * from the From display name and sender domain (Shopify boutiques, etc.).
 *
 * Platform senders (Shopify email relay) classify as "Shopify" for filtering,
 * but the order merchant should be the boutique name from From/body.
 */
export async function resolveOrderMerchant(
  supabase: SupabaseClient,
  input: {
    userId: string;
    classified?: { id: string; slug: string; name: string } | null;
    fromAddress?: string | null;
    extractedName?: string | null;
  },
): Promise<ResolvedMerchant | null> {
  if (input.classified?.id && !isPlatformMerchantSlug(input.classified.slug)) {
    return {
      id: input.classified.id,
      slug: input.classified.slug,
      name: input.classified.name,
    };
  }

  const domain = domainFromAddress(input.fromAddress ?? null);
  const display = displayNameFromAddress(input.fromAddress);
  const name = (
    input.extractedName?.trim() ||
    display?.trim() ||
    (domain && !isPlatformSenderDomain(domain) ? titleFromDomain(domain) : '')
  ).trim();

  if (!name && !domain) return null;

  // Shared platform relays (shopifyemail.com) must not map every boutique to
  // the same merchant via domain match.
  if (domain && !isPlatformSenderDomain(domain)) {
    const merchants = await loadMerchantsForUser(supabase, input.userId);
    for (const merchant of merchants) {
      if (isPlatformMerchantSlug(merchant.slug)) continue;
      for (const d of merchant.domains) {
        const needle = d.toLowerCase();
        if (domain === needle || domain.endsWith(`.${needle}`)) {
          return { id: merchant.id, slug: merchant.slug, name: merchant.name };
        }
      }
    }
  }

  if (!name) return null;

  const baseSlug = slugify(name) || (domain ? slugify(domain) : 'merchant') || 'merchant';
  const slug = `${baseSlug}-${input.userId.slice(0, 8)}`;
  const domains = domain && !isPlatformSenderDomain(domain) ? [domain] : [];

  const { data: existing } = await supabase
    .from('merchants')
    .select('id, slug, name')
    .eq('created_by_user_id', input.userId)
    .eq('slug', slug)
    .maybeSingle();

  if (existing) {
    if (domains.length > 0) {
      await supabase
        .from('merchants')
        .update({ domains })
        .eq('id', existing.id)
        .eq('created_by_user_id', input.userId);
    }
    return {
      id: existing.id as string,
      slug: existing.slug as string,
      name: existing.name as string,
    };
  }

  const { data: created, error } = await supabase
    .from('merchants')
    .insert({
      name: name.slice(0, 120),
      slug,
      domains,
      created_by_user_id: input.userId,
      is_global: false,
    })
    .select('id, slug, name')
    .single();

  if (error || !created) {
    console.error('resolveOrderMerchant insert failed', error?.message);
    return null;
  }

  return {
    id: created.id as string,
    slug: created.slug as string,
    name: created.name as string,
  };
}
