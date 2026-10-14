import { linkVariants } from '@/components/ui/link';
import { PageHeader } from '@/components/shell/page-header';
import type { PlaylistPage } from '@/lib/learn/youtube/load';
import { transcribePlaylistAction } from '../../actions';
import { Press } from '../../press';
import { VideoList } from '../../video-list';
import { PageColumn } from '@/components/shell/page-width';
import type { Subject as PageSubject } from '@/components/shell/page-header';

/**
 * One playlist, in the order the channel published it, with one button for
 * every transcript it is missing.
 *
 * The button names what it costs. A playlist's videos that already have a
 * transcript cost nothing, and the ones with no captions cost nothing either,
 * but the count is only known after asking, so the label gives the most it
 * can spend.
 */
export function PlaylistView({ data, path }: { data: PlaylistPage; path?: PageSubject }) {
  const { channel, playlist, videos } = data;

  const missing = videos.filter((video) => video.state !== 'fetched').length;
  const stored = videos.length - missing;

  return (
    <PageColumn>
      <PageHeader
        subject={path}
        back={{ label: channel.name, href: `/learn/youtube/${channel.slug}` }}
        title={playlist.title}
        description={
          <>
            {videos.length} {videos.length === 1 ? 'video' : 'videos'}
            {stored > 0 ? ` · ${stored} with a transcript` : ''} ·{' '}
            <a href={playlist.url} className={linkVariants({ tone: 'quiet' })} target="_blank" rel="noreferrer">
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
    </PageColumn>
  );
}
