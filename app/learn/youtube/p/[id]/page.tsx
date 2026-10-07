import { notFound } from 'next/navigation';
import { isOwner } from '@/lib/dev/owner';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadPlaylistPage } from '@/lib/learn/youtube/load';
import { PlaylistView } from './playlist-view';

export const dynamic = 'force-dynamic';
// Transcribing a playlist fetches for up to two and a half minutes and queues
// the rest.
export const maxDuration = 300;
export const metadata = { title: 'YouTube playlist' };

/** One playlist; playlist-view.tsx draws it. */
export default async function PlaylistPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isOwner())) notFound();
  const { id } = await params;

  const learn = await createLearnClient();
  const data = await loadPlaylistPage(learn, id);
  if (!data) notFound();
  return <PlaylistView data={data} />;
}
