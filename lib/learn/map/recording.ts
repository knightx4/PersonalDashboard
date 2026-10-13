import type { IdeaMapView } from './load';

/**
 * Recording mode on Idea Space (plan #1997.9): while a video is being made,
 * the places the person chose and the ideas in them go by a stand-in name.
 *
 * The view is rewritten once, before anything draws it, so the sky, the
 * graph, the card and every list in the rail read the same stand-ins and no
 * surface can forget one.
 */

export const PRIVATE_PLACE = 'A private place';
export const PRIVATE_IDEA = 'Private idea';

export type Recording = { on: boolean; hidden: string[] };

export const NOT_RECORDING: Recording = { on: false, hidden: [] };

/** `view` with the hidden places and their ideas made private; the same object when none is. */
export function redactView(view: IdeaMapView, hidden: ReadonlySet<string>): IdeaMapView {
  if (hidden.size === 0) return view;
  const places = view.places.map((place) =>
    hidden.has(place.id) ? { ...place, name: PRIVATE_PLACE } : place,
  );
  const ideas = view.ideas.map((idea) =>
    idea.placeId && hidden.has(idea.placeId)
      ? { ...idea, name: PRIVATE_IDEA, claim: '', track: null, field: null }
      : idea,
  );
  return { ...view, places, ideas };
}

/** The view to draw: redacted while recording is on, whole otherwise. */
export function viewFor(view: IdeaMapView, recording: Recording): IdeaMapView {
  return recording.on ? redactView(view, new Set(recording.hidden)) : view;
}
