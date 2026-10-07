import { createLearnClient } from '@/lib/learn/auth/server';
import { loadTracks } from '@/lib/learn/tracks/load';
import { nestTracks } from '@/lib/learn/tracks/tree';
import { ListsView } from './lists-view';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reading lists' };

/** The reading lists; lists-view.tsx says how they are drawn. */
export default async function ReadingListsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const search = q?.trim() ?? '';

  const supabase = await createLearnClient();
  const tracks = await loadTracks(supabase, { search });
  const rows = nestTracks(tracks);

  return <ListsView rows={rows} search={search} />;
}
