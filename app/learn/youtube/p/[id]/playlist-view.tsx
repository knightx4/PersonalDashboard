import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import type { PlaylistPage } from '@/lib/learn/youtube/load';
import { transcribePlaylistAction } from '../../actions';
import { Press } from '../../press';
import { VideoList } from '../../video-list';

/**
 * One playlist, in the order the channel published it, with one button for
 * every transcript it is missing.
 *
 * The button names what it costs. A playlist's videos that already have a
 * transcript cost nothing, and the ones with no captions cost nothing either,
 * but the count is only known after asking, so the label gives the most it
 * can spend.
 */
export function PlaylistView({ data }: { data: PlaylistPage }) {
  const { channel, playlist, videos } = data;

  const missing = videos.filter((video) => video.state !== 'fetched').length;
  const stored = videos.length - missing;

  return (
    <>
      <p className="mb-3">
        <Link
          href={`/learn/youtube/${channel.slug}`}
          className="press-area inline-flex items-center gap-1 text-ui text-ink-muted hover:text-ink"
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
          cost="app/learn/youtube/actions.ts#transcribePlaylistAction"
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
