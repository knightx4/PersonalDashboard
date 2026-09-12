import Link from 'next/link';
import { BookOpen, CornerDownRight, Plus } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadTracks, type TrackProgress } from '@/lib/learn/tracks/load';
import { nestTracks } from '@/lib/learn/tracks/tree';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';

export const dynamic = 'force-dynamic';

/**
 * The tracks.
 *
 * Newest first, because a reading queue is a stack of current interests rather
 * than a library: the thing you started on Tuesday is the thing you are most
 * likely to want on Wednesday.
 *
 * A track kept out of a broad topic, or branched off one step of a route, is
 * drawn under the one it came from and inset. Ten rows that are really three
 * subjects and seven parts of them read as ten unrelated topics otherwise.
 */

function ProgressBar({ progress }: { progress: TrackProgress }) {
  const percent = Math.round(progress.fraction * 100);

  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-28 overflow-hidden rounded-pill bg-sunken"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Progress through this track"
      >
        <div className="h-full rounded-pill bg-accent" style={{ width: `${percent}%` }} />
      </div>
      <span className="text-small tabular-nums text-ink-muted">
        {progress.read}/{progress.read + progress.remaining}
      </span>
    </div>
  );
}

export default async function LearnPage() {
  const supabase = await createLearnClient();
  const tracks = await loadTracks(supabase);
  const rows = nestTracks(tracks);

  return (
    <>
      <PageHeader
        title="Learn"
        description="Things worth reading, resolved to real links and pointed at the part that matters."
        actions={
          <Link href="/learn/new" className={buttonVariants({ variant: 'primary', size: 'sm' })}>
            <Plus className="size-4" strokeWidth={2} aria-hidden />
            New track
          </Link>
        }
      />

      {tracks.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Nothing queued"
          description="Paste what someone told you to read — a reply from a chat, a syllabus, a footnote — and each item gets resolved to somewhere you can actually open, with a note on which part to read."
          action={{ label: 'Paste a reading list', href: '/learn/new' }}
        />
      ) : (
        <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
          {rows.map(({ track, depth, rolled }) => (
            <li key={track.id}>
              <Link
                href={`/learn/t/${track.id}`}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3.5 pr-4 transition-colors duration-150 hover:bg-canvas"
                style={{ paddingLeft: `${1 + depth * 1.25}rem` }}
              >
                <span className="min-w-0">
                  <span className="block text-body font-medium text-ink">
                    {depth > 0 && (
                      <CornerDownRight
                        className="mr-1.5 inline size-3.5 shrink-0 align-[-0.15em] text-ink-muted"
                        strokeWidth={2}
                        aria-hidden
                      />
                    )}
                    {track.title}
                  </span>
                  {track.question && (
                    // The question, not a summary of the track. It is what you
                    // were actually stuck on, and it is what makes this row
                    // recognisable six weeks later.
                    <span className="mt-0.5 block text-ui text-ink-muted">{track.question}</span>
                  )}
                </span>
                <ProgressBar progress={rolled} />
              </Link>
            </li>
          ))}
        </ul>
      )}

    </>
  );
}
