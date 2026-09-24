import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { isOwner } from '@/lib/dev/owner';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadPlaylistPage } from '@/lib/learn/youtube/load';
import { transcribePlaylistAction } from '../../actions';
import { Press } from '../../press';
import { VideoList } from '../../video-list';

export const dynamic = 'force-dynamic';
// Transcribing a playlist fetches for up to two and a half minutes and queues
// the rest.
export const maxDuration = 300;
export const metadata = { title: 'YouTube playlist' };

/**
 * One playlist, in the order the channel published it, with one button for
 * every transcript it is missing.
 *
 * The button names what it costs. A playlist's videos that already have a
 * transcript cost nothing, and the ones with no captions cost nothing either,
 * but the count is only known after asking, so the label gives the most it
 * can spend.
 */
export default async function PlaylistPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isOwner())) notFound();
  const { id } = await params;

  const learn = await createLearnClient();
  const data = await loadPlaylistPage(learn, id);
  if (!data) notFound();
  const { channel, playlist, videos } = data;

  const missing = videos.filter((video) => video.state !== 'fetched').length;
  const stored = videos.length - missing;

  return (
    <>
      <p className="mb-3">
        <Link
          href={`/learn/youtube/${channel.slug}`}
          className="inline-flex items-center gap-1 text-ui text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="size-3.5" strokeWidth={2} aria-hidden />
          {channel.name}
        </Link>
      </p>

      <PageHeader
        title={playlist.title}
        description={
          <>
            {videos.length} {videos.length === 1 ? 'video' : 'videos'}
            {stored > 0 ? ` · ${stored} with a transcript` : ''} ·{' '}
            <a href={playlist.url} className="hover:underline" target="_blank" rel="noreferrer">
              Open on YouTube
            </a>
          </>
        }
      />

      {missing > 0 && (
        <Press
          className="mb-4"
          action={transcribePlaylistAction}
          fields={{ courseItemId: playlist.itemId }}
          label={`Get ${missing === 1 ? 'the missing transcript' : `all ${missing} missing transcripts`} · up to ${missing} ${missing === 1 ? 'credit' : 'credits'}`}
          pendingLabel="Fetching transcripts…"
          variant="primary"
        />
      )}

      {videos.length > 0 && <VideoList videos={videos} numbered />}
    </>
  );
}
