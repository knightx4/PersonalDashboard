import { notFound } from 'next/navigation';
import { MonitorPlay } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { SearchField } from '@/components/shell/search-field';
import { EmptyState } from '@/components/ui/empty-state';
import { getUser } from '@/lib/auth/server';
import { isOwner } from '@/lib/dev/owner';
import { createLearnClient } from '@/lib/learn/auth/server';
import { filterVideos, loadListVideos } from '@/lib/learn/youtube/videos';
import { VideoRows } from './video-rows';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Videos' };

/**
 * Videos: the ones you saved to your Dash playlist (plan #1069), newest added
 * first. Only your list, never the channel videos the YouTube library
 * catalogues. The owner's alone, like the library the playlist is set on.
 */
export default async function VideosPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await getUser();
  if (!user || !(await isOwner({ user }))) notFound();
  const { q } = await searchParams;

  const learn = await createLearnClient();
  const all = await loadListVideos(learn, user.id);
  const videos = filterVideos(all, { q });

  if (all.length === 0) {
    return (
      <>
        <PageHeader title="Videos" />
        <EmptyState
          icon={MonitorPlay}
          title="No videos yet"
          description="Save videos to a YouTube playlist of your own and paste its link on the YouTube page. Every video on it is listed here with a short summary, read again four times a day."
          action={{ label: 'Set your playlist', href: '/learn/youtube' }}
        />
      </>
    );
  }

  const watched = all.filter((video) => video.watchedAt !== null).length;
  return (
    <>
      <PageHeader
        title="Videos"
        description={`${all.length} on your list${watched > 0 ? `, ${watched} watched` : ''}`}
      />
      <div className="mb-3 max-w-md">
        <SearchField placeholder="Search titles and channels" />
      </div>
      {videos.length > 0 ? (
        <VideoRows videos={videos} />
      ) : (
        <p className="text-ui text-ink-muted">Nothing on your list matches “{q}”.</p>
      )}
    </>
  );
}
