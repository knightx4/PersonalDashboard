import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MonitorPlay } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { cardVariants } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { TranscriptCredits } from '@/components/learn/transcript-credits';
import { cn } from '@/lib/cn';
import { getUser } from '@/lib/auth/server';
import { isOwner } from '@/lib/dev/owner';
import { createLearnClient } from '@/lib/learn/auth/server';
import { playlistUrl } from '@/lib/learn/providers/youtube';
import { loadChannelSummaries, loadUsage, type ChannelSummary } from '@/lib/learn/youtube/load';
import { loadWatchListSettings, type WatchListSettings } from '@/lib/learn/youtube/watch-list';
import { AddChannel } from './add-channel';
import { WatchListPlaylist } from './watch-list-playlist';

export const dynamic = 'force-dynamic';
// Following a channel lists every video and playlist it has, which for a big
// channel is a few hundred Data API calls.
export const maxDuration = 300;
export const metadata = { title: 'YouTube' };

/**
 * The YouTube library: the channels you follow, and what their transcripts
 * have cost this month.
 *
 * The owner's alone. Every transcript fetched from here spends the owner's
 * TranscriptAPI credits, so another account gets a 404 rather than a page of
 * buttons that would refuse them.
 *
 * Listing a channel is free, so every video and playlist it has is stored and
 * browsable. Transcripts are fetched only when asked for, from a channel,
 * playlist or video page, or for new uploads on a channel set to transcribe
 * automatically.
 */

function listedLine(channel: ChannelSummary): string {
  const parts = [
    `${channel.videos.toLocaleString('en-GB')} ${channel.videos === 1 ? 'video' : 'videos'}`,
    `${channel.playlists} ${channel.playlists === 1 ? 'playlist' : 'playlists'}`,
  ];
  if (channel.autoTranscribe) parts.push('new uploads transcribed');
  return parts.join(' · ');
}

function hoursAgo(iso: string, now: number): string {
  const hours = Math.floor((now - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return 'within the hour';
  if (hours < 48) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

function listLine(list: WatchListSettings, now: number): string {
  if (!list.playlistId) {
    return 'YouTube does not let apps read Watch later. Save videos to a playlist of your own instead, set it to unlisted, and paste its link here; it is read four times a day.';
  }
  const count = `${list.videos.toLocaleString('en-GB')} ${list.videos === 1 ? 'video' : 'videos'} on your list`;
  return list.readAt ? `${count}, read ${hoursAgo(list.readAt, now)}.` : `${count}; not read yet.`;
}

export default async function YouTubeLibraryPage() {
  if (!(await isOwner())) notFound();
  const user = await getUser();
  if (!user) notFound();

  const learn = await createLearnClient();
  const [channels, usage, list] = await Promise.all([
    loadChannelSummaries(learn),
    loadUsage(learn),
    loadWatchListSettings(learn, user.id),
  ]);
  // eslint-disable-next-line react-hooks/purity -- a server component, rendered once per request
  const now = Date.now();

  return (
    <>
      <PageHeader title="YouTube" />

      <div className="space-y-6">
        <TranscriptCredits usage={usage} />

        <section>
          <h2 className="mb-2 text-ui font-semibold text-ink-muted">Your playlist</h2>
          <p className="mb-2 text-small text-ink-muted">{listLine(list, now)}</p>
          {list.error && (
            <p role="alert" className="mb-2 text-small text-danger">
              The last read failed: {list.error}
            </p>
          )}
          <WatchListPlaylist current={list.playlistId ? playlistUrl(list.playlistId) : null} />
        </section>

        {channels.length === 0 ? (
          <EmptyState
            icon={MonitorPlay}
            title="No channels yet"
            description="Follow a channel and every video and playlist it has published is listed here, for free, through the YouTube Data API. Transcripts cost one TranscriptAPI credit each and are fetched only when you ask for them."
          >
            <AddChannel />
          </EmptyState>
        ) : (
          <section>
            <h2 className="mb-2 text-ui font-semibold text-ink-muted">Channels</h2>
            <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
              {channels.map((channel) => (
                <li key={channel.id}>
                  <Link
                    href={`/learn/youtube/${channel.slug}`}
                    className="flex items-baseline justify-between gap-3 px-4 py-2.5 hover:bg-sunken"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-ui text-ink">{channel.name}</span>
                      <span className="block truncate text-small text-ink-muted">{listedLine(channel)}</span>
                    </span>
                    {channel.handle && (
                      <span className="shrink-0 text-small text-ink-muted">{channel.handle}</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-3">
              <AddChannel />
            </div>
          </section>
        )}
      </div>
    </>
  );
}
