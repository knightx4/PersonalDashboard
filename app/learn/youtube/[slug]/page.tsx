import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { SearchField } from '@/components/shell/search-field';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { ConfirmStep } from '@/components/ui/confirm-step';
import { Disclosure } from '@/components/ui/disclosure';
import { cn } from '@/lib/cn';
import { isOwner } from '@/lib/dev/owner';
import { SEARCH_PARAM } from '@/lib/list-search';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadChannelPage } from '@/lib/learn/youtube/load';
import { relistChannelAction, removeChannelAction, setAutoTranscribeAction } from '../actions';
import { Press } from '../press';
import { VideoList } from '../video-list';

export const dynamic = 'force-dynamic';
// Re-listing walks every playlist; transcribing a video can take a minute.
export const maxDuration = 300;

/**
 * One channel: its playlists, then its videos newest first.
 *
 * The playlists fold when there are more than a dozen, with the count on the
 * closed line. The videos are paged fifty at a time and searchable by title,
 * both in the URL (law 5).
 */

/** Past this many, the playlists start folded. */
const OPEN_PLAYLISTS = 12;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return { title: `YouTube · ${slug}` };
}

export default async function ChannelPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  if (!(await isOwner())) notFound();
  const { slug } = await params;
  const { q, page: pageParam } = await searchParams;
  const search = q?.trim() ?? '';
  const page = Math.max(0, Number.parseInt(pageParam ?? '0', 10) || 0);

  const learn = await createLearnClient();
  const data = await loadChannelPage(learn, slug, { page, search });
  if (!data) notFound();
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
            className="flex items-baseline justify-between gap-3 px-4 py-2 hover:bg-sunken"
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
    <>
      <p className="mb-3">
        <Link href="/learn/youtube" className="inline-flex items-center gap-1 text-ui text-ink-muted hover:text-ink">
          <ArrowLeft className="size-3.5" strokeWidth={2} aria-hidden />
          YouTube
        </Link>
      </p>

      <PageHeader
        title={channel.name}
        description={
          <a href={channel.homeUrl} className="hover:underline" target="_blank" rel="noreferrer">
            {channel.handle ?? 'Open on YouTube'}
          </a>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Press
          action={relistChannelAction}
          fields={{ providerId: channel.id }}
          label="Look for new videos"
          pendingLabel="Listing…"
        />
        <form action={setAutoTranscribeAction}>
          <input type="hidden" name="providerId" value={channel.id} />
          <input type="hidden" name="on" value={channel.autoTranscribe ? 'false' : 'true'} />
          <Button type="submit" size="sm" variant="ghost" aria-pressed={channel.autoTranscribe}>
            {channel.autoTranscribe ? 'New uploads are transcribed · turn off' : 'Transcribe new uploads'}
          </Button>
        </form>
        <ConfirmStep
          action={removeChannelAction}
          fields={{ providerId: channel.id }}
          prompt="Stop following this channel and delete its listed videos and playlists from the catalogue. Stored transcripts stay in storage."
          confirmLabel="Yes, stop following"
          align="start"
        >
          Stop following
        </ConfirmStep>
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
              Videos <span className="tabular-nums font-normal">{channel.videos.toLocaleString('en-GB')}</span>
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
                <Link href={pageHref(page - 1)} className="text-ink-muted hover:text-ink">
                  Newer
                </Link>
              ) : (
                <span />
              )}
              {more && (
                <Link href={pageHref(page + 1)} className="text-ink-muted hover:text-ink">
                  Older
                </Link>
              )}
            </nav>
          )}
        </section>
      </div>
    </>
  );
}
