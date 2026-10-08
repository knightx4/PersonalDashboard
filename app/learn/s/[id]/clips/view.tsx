import Link from 'next/link';
import { ArrowLeft, Clapperboard } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { MainRail } from '@/components/patterns/main-rail';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import type { SubjectClipCounts } from '@/lib/learn/clips/subject-counts';
import type { PlayerClip } from '@/lib/learn/clips/stream';
import { ClipStream } from '@/app/learn/clips/clip-stream';
import { CLIPS_HREF } from '@/app/learn/videos/clips-section';

/**
 * One subject's Clips page (plan #1697): the player, holding only the clips
 * that serve the subject, and beside it from laptop width how many there are
 * and where they came from. Drawn by the page and by the gallery, which
 * passes `fixed` so the player fetches no more.
 *
 * Main plus rail: the player is what you came for and sits in the main
 * column; the counts are what you glance at. A subject no clip serves yet
 * shows the empty state in one column, since a rail of zeros says nothing the
 * empty state does not.
 */

export type SubjectClipsProps = {
  subject: { id: string; name: string };
  clips: PlayerClip[];
  counts: SubjectClipCounts;
  fixed?: boolean;
};

export function SubjectClipsView({ subject, clips, counts, fixed = false }: SubjectClipsProps) {
  const header = (
    <>
      <p className="mb-3">
        <Link
          href={`/learn/s/${subject.id}`}
          className="press-area inline-flex items-center gap-1 text-ui text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="size-3.5" strokeWidth={2} aria-hidden />
          {subject.name}
        </Link>
      </p>
      <PageHeader title="Clips" />
    </>
  );

  if (clips.length === 0) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        {header}
        <SubjectClipsEmpty />
      </div>
    );
  }

  return (
    <MainRail
      main={
        <>
          {header}
          <ClipStream initial={clips} fixed={fixed} subjectId={subject.id} />
        </>
      }
      rail={<SubjectClipsCounts counts={counts} />}
    />
  );
}

/** What serves this subject, by source, and how much is left to play. */
function SubjectClipsCounts({ counts }: { counts: SubjectClipCounts }) {
  const rows: [string, number][] = [
    ['From Watch later', counts.watchLater],
    ['From channels you follow', counts.channels],
    ['Not played yet', counts.unplayed],
  ];
  return (
    <Card padding="standard">
      <h2 className="text-ui font-semibold text-ink">These clips</h2>
      <dl className="mt-2 divide-y divide-border">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 py-2">
            <dt className="text-ui text-ink-muted">{label}</dt>
            <dd className="text-ui font-medium tabular-nums text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      <Link href={CLIPS_HREF} className="press-area mt-2 inline-block text-ui text-accent hover:underline">
        Play all your clips
      </Link>
    </Card>
  );
}

/** No clip serves the subject yet: say how they arrive, and offer every clip instead. */
export function SubjectClipsEmpty() {
  return (
    <EmptyState
      icon={Clapperboard}
      title="No clips for this subject yet"
      description="Dash tags each clip it cuts with every subject it serves, from Watch later and the channels you follow. None serve this subject yet. They play here once some do."
      action={{ label: 'Play all your clips', href: CLIPS_HREF }}
    />
  );
}
