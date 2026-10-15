import Link, { linkVariants } from '@/components/ui/link';
import { PageHeader } from '@/components/shell/page-header';
import { SearchField } from '@/components/shell/search-field';
import { ActionMenu } from '@/components/ui/action-menu';
import { cardVariants } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { cn } from '@/lib/cn';
import { SEARCH_PARAM } from '@/lib/list-search';
import { relistChannelAction, removeChannelAction, setAutoTranscribeAction } from '../actions';
import type { ChannelPage } from '@/lib/learn/youtube/load';
import { Press } from '../press';
import { VideoList } from '../video-list';
import { PageColumn } from '@/components/shell/page-width';
import type { Subject as PageSubject } from '@/components/shell/page-header';
import { formatNumber } from '@/lib/money';

/**
 * One channel: its playlists, then its videos newest first.
 *
 * The playlists fold when there are more than a dozen, with the count on the
 * closed line. The videos are paged fifty at a time and searchable by title,
 * both in the URL (law 5).
 */

/** Past this many, the playlists start folded. */
const OPEN_PLAYLISTS = 12;

/** One channel's page from what was read, with the page number and the search (plan #1602). */
export function ChannelView({
  slug,
  data,
  page,
  search,
  path,
}: {
  slug: string;
  data: ChannelPage;
  page: number;
  search: string;
  /** The path to this page, from the page (rowSubject); the gallery passes none. */
  path?: PageSubject;
}) {
  const { channel, playlists, videos, more } = data;

  const pageHref = (to: number) => {
    const next = new URLSearchParams();
    if (search) next.set(SEARCH_PARAM, search);
    if (to > 0) next.set('page', String(to));
    const query = next.toString();
    return `/learn/youtube/${slug}${query ? `?${query}` : ''}`;
  };

  const playlistList = (
    <ul className={cn(cardVariants(), 'mt-2 divide-y divide-border overflow-hidden')}>
      {playlists.map((playlist) => (
        <li key={playlist.itemId}>
          <Link
            href={`/learn/youtube/p/${playlist.itemId}`}
            className="flex items-baseline justify-between gap-3 px-4 py-3 hover:bg-sunken"
          >
            <span className="min-w-0 truncate text-ui text-ink">{playlist.title}</span>
            <span className="shrink-0 text-small tabular-nums text-ink-muted">
              {playlist.videos} {playlist.videos === 1 ? 'video' : 'videos'}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <PageColumn>
      <PageHeader
        subject={path}
        title={channel.name}
        description={
          <>
            <a href={channel.homeUrl} className={cn('press-area', linkVariants({ tone: 'quiet' }))} target="_blank" rel="noreferrer">
              {channel.handle ?? 'Open on YouTube'}
            </a>
          </>
        }
      />

      <div className="mb-6 flex items-center gap-2">
        <Press
          action={relistChannelAction}
          fields={{ providerId: channel.id }}
          label="Look for new videos"
          pendingLabel="Listing…"
        />
        <ActionMenu
          label="Channel settings"
          align="start"
          items={[
            {
              id: 'transcribe',
              label: channel.autoTranscribe ? 'Stop transcribing new uploads' : 'Transcribe new uploads',
              formAction: setAutoTranscribeAction,
              formFields: { providerId: channel.id, on: channel.autoTranscribe ? 'false' : 'true' },
            },
            {
              id: 'remove',
              label: 'Stop following',
              destructive: true,
              confirm:
                'Stop following this channel and delete its listed videos and playlists from the catalogue. Stored transcripts stay in storage.',
              formAction: removeChannelAction,
              formFields: { providerId: channel.id },
            },
          ]}
        />
      </div>

      <div className="space-y-6">
        {playlists.length > 0 &&
          (playlists.length > OPEN_PLAYLISTS ? (
            <Disclosure title="Playlists" meta={`${playlists.length}`}>
              {playlistList}
            </Disclosure>
          ) : (
            <section>
              <h2 className="text-ui font-semibold text-ink-muted">Playlists</h2>
              {playlistList}
            </section>
          ))}

        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-ui font-semibold text-ink-muted">
              Videos <span className="tabular-nums font-normal">{formatNumber(channel.videos)}</span>
            </h2>
            <div className="w-full max-w-xs">
              <SearchField placeholder="Search this channel's videos" />
            </div>
          </div>

          {videos.length === 0 ? (
            <p className="text-ui text-ink-muted">
              {search ? `No video title here contains “${search}”.` : 'No videos listed yet. Look for new videos above.'}
            </p>
          ) : (
            <VideoList videos={videos} />
          )}

          {(page > 0 || more) && (
            <nav className="mt-3 flex items-center justify-between text-ui" aria-label="Pages">
              {page > 0 ? (
                <Link href={pageHref(page - 1)} className="press-area text-ink-muted hover:text-ink">
                  Newer
                </Link>
              ) : (
                <span />
              )}
              {more && (
                <Link href={pageHref(page + 1)} className="press-area text-ink-muted hover:text-ink">
                  Older
                </Link>
              )}
            </nav>
          )}
        </section>
      </div>
    </PageColumn>
  );
}
