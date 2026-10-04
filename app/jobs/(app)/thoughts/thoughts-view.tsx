import { PageHeader } from '@/components/shell/page-header';
import type { StartedTrackView, SuggestedTrackView } from '@/lib/jobs/learning/payload';
import { ThoughtList, type ThoughtView } from './thoughts';
import { LearningTracks } from './tracks';

/**
 * Career goals as the page draws them, from what it read (plan #1601): the
 * learning tracks, when they could be read, above the dated entries. The
 * gallery draws it from fixtures.
 */
export function ThoughtsView({
  tracks,
  thoughts,
}: {
  tracks: { suggested: SuggestedTrackView[]; started: StartedTrackView[] } | null;
  thoughts: ThoughtView[];
}) {
  return (
    <>
      <PageHeader
        title="Career goals"
        description="What you want from the next job and where you are now, in your own words. Add a new entry when your thinking changes; the newest one counts."
      />
      {tracks && (
        <div className="mb-3 max-w-3xl">
          <LearningTracks
            suggested={tracks.suggested}
            started={tracks.started}
            hasEntries={thoughts.length > 0}
          />
        </div>
      )}
      <ThoughtList thoughts={thoughts} />
    </>
  );
}
