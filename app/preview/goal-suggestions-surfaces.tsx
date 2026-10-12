import { GoalSuggestions } from '@/app/goals/[goalId]/goal-suggestions';
import type { Suggestion } from '@/lib/goals/suggestions';

/**
 * A goal's Suggestions section (plan #1739), on its Overview in place of the
 * weekly help block. Fixtures: a goal with suggested steps (one with a long
 * title and a reason), an event it asks for, one marked going and the help
 * it asks for beneath; then a goal with nothing suggested yet. The Overview
 * surface draws the same section in place.
 */

function suggestion(over: Partial<Suggestion> & Pick<Suggestion, 'id' | 'title'>): Suggestion {
  return {
    itemId: 'g-city',
    kind: 'step',
    acceptedStepId: null,
    detail: null,
    url: null,
    place: null,
    source: null,
    happensOn: null,
    startsAt: null,
    reaction: null,
    attended: null,
    createdAt: '2026-10-11T08:00:00Z',
    ...over,
  };
}

export const CITY_SUGGESTIONS: Suggestion[] = [
  suggestion({
    id: 'sg-minutes',
    title: 'Read the community board minutes on the Gowanus rezoning, from the first hearing to the vote',
    detail:
      'You closed the overview article last week, and the minutes are where the fight is argued in its own words.',
  }),
  suggestion({
    id: 'sg-map',
    title: 'Sketch who sided with whom on the rezoning',
    detail: 'Two names came up three times in what you logged.',
  }),
  suggestion({
    id: 'sg-hearing',
    kind: 'events',
    title: 'Public hearing: the Atlantic Avenue mixed-use plan',
    url: 'https://example.test/hearing',
    place: 'Brooklyn Borough Hall',
    source: 'NYC Planning',
    happensOn: '2026-10-15',
  }),
  suggestion({
    id: 'sg-talk',
    kind: 'events',
    title: 'Talk: how a zoning change gets made',
    url: 'https://example.test/talk',
    place: 'Brooklyn Public Library, Central',
    happensOn: '2026-10-17',
    reaction: 'going',
  }),
];

export function GoalSuggestionsSurface() {
  return (
    <div className="space-y-8">
      <GoalSuggestions
        goalId="g-city"
        suggestions={CITY_SUGGESTIONS}
        helpKinds={[
          { kind: 'events', note: 'Brooklyn, weeknights' },
          { kind: 'reading', note: null },
        ]}
      />
      <GoalSuggestions goalId="g-clean" suggestions={[]} helpKinds={[]} />
    </div>
  );
}
