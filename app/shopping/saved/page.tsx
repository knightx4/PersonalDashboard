import { createClient, requireUser } from '@/lib/auth/server';
import { SavedQueueView, STATUSES, type SavedStatus } from './saved-view';

export const metadata = { title: 'Saved' };

export default async function SavedPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const params = await searchParams;
  const status: SavedStatus = STATUSES.some((entry) => entry.id === params.status)
    ? (params.status as SavedStatus)
    : 'saved';

  const { data: items, error } = await supabase
    .from('saved_items')
    .select(
      `
      id, title, url, image_url, price_cents, currency, status, created_at, notes,
      merchants ( name )
    `,
    )
    .eq('user_id', user.id)
    .eq('status', status)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (
    <SavedQueueView
      status={status}
      items={(items ?? []).map((item) => ({
        id: item.id,
        title: item.title,
        image_url: item.image_url,
        price_cents: item.price_cents,
        currency: item.currency,
        created_at: item.created_at,
        merchant: (Array.isArray(item.merchants) ? item.merchants[0] : item.merchants) ?? null,
      }))}
    />
  );
}
