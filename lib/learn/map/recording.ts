import type { IdeaMapView } from './load';

/**
 * Recording mode on Idea Space (plan #1997.9): while a video is being made,
 * the places the person chose (their subjects, plan #2317.2) and the topics in
 * them go by a stand-in name.
 *
 * The view is rewritten once, before anything draws it, so the sky, the
 * graph, the card and every list in the rail read the same stand-ins and no
 * surface can forget one.
 */

export const PRIVATE_PLACE = 'A private subject';
/** A star in a hidden place: a topic since plan #2317.2. */
export const PRIVATE_IDEA = 'Private topic';
export const PRIVATE_TOPIC = 'A private topic';

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
      ? { ...idea, name: PRIVATE_IDEA, claim: '', track: null, field: null, ideasUnder: [], evidence: [] }
      : idea,
  );
  // A topic over an idea in a hidden place would name what the place is about.
  const hiddenIdeas = new Set(view.ideas.filter((idea) => idea.placeId && hidden.has(idea.placeId)).map((idea) => idea.id));
  const topics = view.topics && {
    ...view.topics,
    topics: view.topics.topics.map((topic) =>
      topic.ideaIds.some((id) => hiddenIdeas.has(id)) ? { ...topic, title: PRIVATE_TOPIC } : topic,
    ),
  };
  // A place is a subject's territory (plan #2317.2): its name and its topics' go
  // by stand-ins in the subjects card, the territory and the goal's rings too.
  const all = (territory: { id: string }) => hidden.has(territory.id);
  const topicName = (id: string, name: string) => (hiddenIdeas.has(id) ? PRIVATE_IDEA : name);
  const territories = view.territories?.map((territory) => ({
    ...territory,
    name: all(territory) ? PRIVATE_PLACE : territory.name,
    topics: territory.topics.map((t) => ({ ...t, name: all(territory) ? PRIVATE_IDEA : topicName(t.id, t.name) })),
    // The words of an answer, or the name of the topic it was given on, would say what the subject is.
    standing: territory.standing?.map((s) =>
      all(territory) || hiddenIdeas.has(s.topicId)
        ? { ...s, quote: null, via: s.via && { ...s.via, topicName: PRIVATE_IDEA } }
        : s,
    ),
  }));
  const goals =
    view.goals &&
    view.goals.map((goal) =>
      hidden.has(goal.id)
        ? { ...goal, name: PRIVATE_PLACE, goalNames: [], next: null, stars: goal.stars.map((s) => ({ ...s, name: PRIVATE_IDEA })) }
        : { ...goal, stars: goal.stars.map((s) => ({ ...s, name: topicName(s.topicId, s.name) })) },
    );
  return { ...view, places, ideas, topics, territories, goals };
}

/** The view to draw: redacted while recording is on, whole otherwise. */
export function viewFor(view: IdeaMapView, recording: Recording): IdeaMapView {
  return recording.on ? redactView(view, new Set(recording.hidden)) : view;
}
