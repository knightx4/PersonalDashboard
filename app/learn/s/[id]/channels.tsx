import Link from 'next/link';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { Press } from '@/app/learn/youtube/press';
import { unfollowSubjectChannelAction } from '@/app/learn/youtube/actions';
import { PILE_LABEL } from '@/lib/learn/youtube/videos';
import type { ChannelState, SubjectChannelView } from '@/lib/learn/youtube/subject-channels';
import { FindChannels } from './find-channels';

/**
 * The Channels section of a subject page (plan #1199, under #1185).
 *
 * Each channel found for the subject, with its verdict, the reason written
 * about your level in the subject, and the videos it was judged on with the
 * judge's line on each. A sampled video that went into your Videos section
 * links to it there. A channel Learn followed has Unfollow beside it, as
 * #1200 settled.
 *
 * Shown to the owner only, since the press spends the owner's YouTube quota
 * and transcript credits.
 */

const STATE_LABEL: Record<ChannelState, string> = {
  judging: 'Being judged',
  retrying: 'Worth following',
  following: 'Worth following',
  unfollowed: 'Worth following',
  passed: 'Pass',
};

/** The line under the label that says what Learn did about the verdict. */
function stateNote(channel: SubjectChannelView): string | null {
  switch (channel.state) {
    case 'judging': {
      if (channel.picked === null) return 'Picking three videos to judge it by.';
      return `${channel.samples.length} of ${channel.picked} videos judged. The rest wait on transcripts, and the scheduled run finishes them.`;
    }
    case 'retrying':
      return 'YouTube would not add it to your library yet. It is tried again on the next run.';
    case 'following':
      return null;
    case 'unfollowed':
      return 'You unfollowed it for this subject, and it is not suggested again.';
    case 'passed':
      return null;
  }
}

function ChannelRow({ channel, kept }: { channel: SubjectChannelView; kept: ReadonlySet<string> }) {
  const note = stateNote(channel);
  const good = channel.verdict === 'follow';
  return (
    <li className="card-pad">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-body font-semibold text-ink">
          {channel.title}
          {channel.handle && <span className="ml-1.5 font-normal text-ink-muted">{channel.handle}</span>}
        </h3>
        <span
          className={cn(
            'rounded-pill px-1.5 py-0.5 text-small font-medium',
            good ? 'bg-accent-tint text-accent' : 'text-ink-muted',
          )}
        >
          {STATE_LABEL[channel.state]}
        </span>
      </div>

      {channel.why ? (
        <p className="mt-1 text-ui text-ink">{channel.why}</p>
      ) : (
        channel.foundWhy && <p className="mt-1 text-ui text-ink-muted">{channel.foundWhy}</p>
      )}
      {note && <p className="mt-1 text-small text-ink-muted">{note}</p>}
      {channel.state === 'following' && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link href="/learn/youtube" className="text-small text-accent hover:underline">
            In your YouTube library
          </Link>
          <Press
            action={unfollowSubjectChannelAction}
            fields={{ channelId: channel.id }}
            label="Unfollow"
            pendingLabel="Unfollowing…"
            variant="ghost"
          />
        </div>
      )}

      {channel.samples.length > 0 && (
        <ol className="mt-2 space-y-1.5">
          {channel.samples.map((sample) => (
            <li key={sample.video_id} className="text-ui">
              <span className="mr-1.5 text-small font-medium text-ink-muted">{PILE_LABEL[sample.verdict]}</span>
              {kept.has(sample.video_id) ? (
                <Link href={`/learn/videos/${sample.video_id}`} className="text-accent hover:underline">
                  {sample.title}
                </Link>
              ) : (
                <span className="text-ink">{sample.title}</span>
              )}
              <p className="text-small text-ink-muted">{sample.line}</p>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

export function ChannelsSection({
  subjectId,
  channels,
  kept,
}: {
  subjectId: string;
  channels: readonly SubjectChannelView[];
  kept: ReadonlySet<string>;
}) {
  return (
    <section className="mt-8">
      <h2 className="mb-1 text-ui font-semibold text-ink-muted">Channels</h2>
      <p className="mb-3 text-ui text-ink-muted">
        {channels.length === 0
          ? 'Dash can look for up to five YouTube channels that teach this subject, judge three videos from each against what you know, and follow the ones worth following.'
          : 'Channels found for this subject, judged on three of their videos against what you know. The ones worth following are in your YouTube library, and their good videos are in Videos.'}
      </p>
      <FindChannels subjectId={subjectId} found={channels.length > 0} />
      {channels.length > 0 && (
        <ol className={cn(cardVariants(), 'divide-y divide-border')}>
          {channels.map((channel) => (
            <ChannelRow key={channel.id} channel={channel} kept={kept} />
          ))}
        </ol>
      )}
    </section>
  );
}
