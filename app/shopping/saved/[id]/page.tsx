import { notFound } from 'next/navigation';
import { createClient, requireUser } from '@/lib/auth/server';
import { fingerprintLoose } from '@/lib/fingerprint';
import { SavedItemView, type OwnedMatch } from './saved-item-view';

export const metadata = { title: 'Saved item' };

export default async function SavedItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const { id } = await params;

  const { data: item } = await supabase
    .from('saved_items')
    .select(
      `
      id, url, title, image_url, price_cents, currency, notes, status,
      merchant_id, fingerprint_loose, created_at,
      merchants ( id, name )
    `,
    )
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!item) notFound();

  const merchant = Array.isArray(item.merchants) ? item.merchants[0] : item.merchants;

  let ownedMatches: OwnedMatch[] = [];

  if (item.title) {
    const fp = item.fingerprint_loose ?? fingerprintLoose(item.title);
    const { data } = await supabase
      .from('inventory_items')
      .select('id, name, variant, cost_cents, acquired_at')
      .eq('user_id', user.id)
      .eq('status', 'owned')
      .eq('fingerprint_loose', fp)
      .limit(5);
    ownedMatches = data ?? [];
  }

  return (
    <SavedItemView
      item={{ ...item, status: item.status as 'saved' | 'purchased' | 'dismissed' }}
      merchant={merchant ?? null}
      ownedMatches={ownedMatches}
    />
  );
}
