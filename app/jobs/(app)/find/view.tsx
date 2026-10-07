import type { ComponentProps } from 'react';
import type { OpenSuggestion } from '@/lib/jobs/suggest/load';
import type { StartedTrackView, SuggestedTrackView } from '@/lib/jobs/learning/payload';
import { RecommendedPeople, RecommendedRoles } from '../recommend/sections';
import { SearchAim } from './aim';
import { ThoughtList, type ThoughtView } from './thoughts';
import { LearningTracks } from './tracks';

/**
 * The Find tab below its header, drawn from what the page loaded so the
 * gallery can draw it from fixtures (surface `jobs-find`).
 *
 * In reading order: what the search aims at, the roles and the people Dash
 * found against it, the career goals entries the searches read, and the
 * learning tracks suggested from them. Every panel takes the page's full
 * width, so their right edges line up (law 18). The anchors are where the phone
 * notification for a search opens (lib/jobs/suggest/notify.ts).
 */
export function FindView({
  aim,
  roles,
  people,
  tracks,
  thoughts,
}: {
  aim: ComponentProps<typeof SearchAim>;
  roles: ComponentProps<typeof RecommendedRoles>;
  people: OpenSuggestion[];
  /** Null when the tracks could not be read, which hides them. */
  tracks: { suggested: SuggestedTrackView[]; started: StartedTrackView[] } | null;
  thoughts: ThoughtView[];
}) {
  return (
    <div className="space-y-6">
      <SearchAim {...aim} />

      <div id="roles" className="scroll-mt-4">
        <RecommendedRoles {...roles} />
      </div>

      <div id="people" className="scroll-mt-4">
        <RecommendedPeople suggestions={people} />
      </div>

      <div id="career-goals" className="scroll-mt-4">
        <ThoughtList thoughts={thoughts} />
      </div>

      {tracks && (
        <LearningTracks
          suggested={tracks.suggested}
          started={tracks.started}
          hasEntries={thoughts.length > 0}
        />
      )}
    </div>
  );
}
