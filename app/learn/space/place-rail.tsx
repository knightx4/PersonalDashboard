'use client';

import Link from '@/components/ui/link';
import { Card } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import type { IdeaMapView } from '@/lib/learn/map/load';
import {
  paramsFor,
  readableName,
  type IdeaGraph,
  type Ladder,
  type Opened,
} from '@/lib/learn/map/place-graph';
import { countText, mapHref } from '@/lib/learn/map/view';
import { useOpenGraph } from './map-section';
import { pickOnClick, usePick, viewOnClick } from './pick';
import { StarSwatch } from './swatch';

/**
 * The rail beside Idea Space's places (plan #1997.7): on the whole map, every
 * named place, each opening as a graph; with a place open, its ideas, best
 * known first, and the places next door. The map's places are drawn on a
 * canvas, so this list is also how they are reached from the keyboard.
 * With a goal's territory open (plan #2187.3), its topics, furthest from
 * their target first, each with the level held and the target.
 */

/** How many rows show before the rest fold away. */
const SHOWN = 6;

export function PlaceRail({ view }: { view: IdeaMapView }) {
  const graph = useOpenGraph(view);
  if (graph?.ladders) return <OpenTerritory graph={graph} ladders={graph.ladders} />;
  return graph ? <OpenPlace view={view} graph={graph} /> : <Places view={view} />;
}

/** How far a topic is from its target; a topic with none sorts last. */
function gap(ladder: Ladder): number {
  return ladder.target === null ? -Infinity : ladder.target - ladder.held;
}

function OpenTerritory({ graph, ladders }: { graph: IdeaGraph; ladders: ReadonlyMap<string, Ladder> }) {
  const { params, set } = usePick();
  const opened = graph.opened.kind === 'territory' ? graph.opened : null;
  const topics = [...ladders.values()].sort((a, b) => gap(b) - gap(a) || a.name.localeCompare(b.name));
  const row = (ladder: Ladder) => {
    const change = opened ? paramsFor({ ...opened, topic: ladder.id }) : {};
    return (
      <li key={ladder.id}>
        <Link
          href={mapHref(params, change)}
          scroll={false}
          onClick={viewOnClick(() => set(change))}
          aria-current={opened?.topic === ladder.id ? 'true' : undefined}
          className="flex min-h-11 items-center gap-2 py-1.5 text-ui text-ink hover:text-accent aria-[current]:font-medium"
        >
          <span className="min-w-0 flex-1">{ladder.name}</span>
          <span className="tabular shrink-0 text-small text-ink-muted">
            {ladder.target === null ? `level ${ladder.held}` : `${ladder.held} of ${ladder.target}`}
          </span>
        </Link>
      </li>
    );
  };
  return (
    <Card padding="standard">
      <h2 className="text-ui font-semibold text-ink">
        In this goal
        <span className="tabular ml-2 font-normal text-ink-muted">{topics.length}</span>
      </h2>
      <p className="text-small text-ink-muted">Furthest from the target first, with the level you hold of it.</p>
      <ul className="mt-1 divide-y divide-border">{topics.slice(0, SHOWN).map(row)}</ul>
      {topics.length > SHOWN && (
        <Disclosure title={`${topics.length - SHOWN} more`} className="mt-1" bodyClassName="pl-0">
          <ul className="divide-y divide-border">{topics.slice(SHOWN).map(row)}</ul>
        </Disclosure>
      )}
    </Card>
  );
}

function Places({ view }: { view: IdeaMapView }) {
  const { params, set } = usePick();
  if (view.places.length === 0) return null;
  const strengthOf = new Map(view.ideas.map((idea) => [idea.id, idea.strength]));
  const knownIn = new Map<string, number>();
  for (const idea of view.ideas) {
    if (idea.placeId && (strengthOf.get(idea.id) ?? 0) > 0)
      knownIn.set(idea.placeId, (knownIn.get(idea.placeId) ?? 0) + 1);
  }
  const row = (place: IdeaMapView['places'][number]) => {
    const change = paramsFor({ kind: 'place', id: place.id });
    return (
      <li key={place.id}>
        <Link
          href={mapHref(params, change)}
          scroll={false}
          onClick={viewOnClick(() => set(change))}
          className="flex min-h-11 items-center gap-2 py-1.5 text-ui text-ink hover:text-accent"
        >
          <span className="min-w-0 flex-1">{place.name}</span>
          <span className="tabular shrink-0 text-small text-ink-muted">
            {countText(knownIn.get(place.id) ?? 0)} of {countText(place.ideaCount)} known
          </span>
        </Link>
      </li>
    );
  };
  return (
    <Card padding="standard">
      <h2 className="text-ui font-semibold text-ink">
        Places
        <span className="tabular ml-2 font-normal text-ink-muted">{view.places.length}</span>
      </h2>
      <ul className="mt-1 divide-y divide-border">{view.places.slice(0, SHOWN).map(row)}</ul>
      {view.places.length > SHOWN && (
        <Disclosure
          title={`${view.places.length - SHOWN} more`}
          className="mt-1"
          bodyClassName="pl-0"
        >
          <ul className="divide-y divide-border">{view.places.slice(SHOWN).map(row)}</ul>
        </Disclosure>
      )}
    </Card>
  );
}

function OpenPlace({ view, graph }: { view: IdeaMapView; graph: IdeaGraph }) {
  const { params, pick, set } = usePick();
  const byId = new Map(view.ideas.map((idea) => [idea.id, idea]));
  const ideas = graph.core
    .map((id) => byId.get(id))
    .filter((idea) => idea !== undefined)
    .sort((a, b) => b.strength - a.strength || a.name.localeCompare(b.name));

  // The places next door, by how many of the links out lead to each.
  const doors = new Map<string, { to: Opened; name: string; count: number }>();
  for (const id of graph.next) {
    const door = graph.doors.get(id);
    if (!door || !door.placeName || door.opened.kind !== 'place') continue;
    const entry = doors.get(door.opened.id) ?? { to: door.opened, name: door.placeName, count: 0 };
    entry.count += 1;
    doors.set(door.opened.id, entry);
  }
  const nextDoor = [...doors.values()]
    .filter((door) => !(graph.opened.kind === 'place' && door.to.id === graph.opened.id))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const row = (idea: (typeof ideas)[number]) => (
    <li key={idea.id}>
      <Link
        href={mapHref(params, { idea: idea.id })}
        scroll={false}
        onClick={pickOnClick(pick, idea.id)}
        aria-current={params.idea === idea.id ? 'true' : undefined}
        className="flex min-h-11 items-center gap-2 py-1.5 text-ui text-ink hover:text-accent aria-[current]:font-medium"
      >
        <StarSwatch
          strength={idea.strength}
          haze={idea.haze}
          mixedUp={idea.state === 'misconception'}
        />
        <span className="min-w-0 flex-1">{readableName(idea.name)}</span>
        {idea.strength > 0 && (
          <span className="tabular shrink-0 text-small text-ink-muted">
            {Math.round(idea.strength * 100)}%
          </span>
        )}
      </Link>
    </li>
  );

  return (
    <Card padding="standard">
      <h2 className="text-ui font-semibold text-ink">
        {graph.opened.kind === 'place' ? 'In this place' : 'In this neighbourhood'}
        <span className="tabular ml-2 font-normal text-ink-muted">{ideas.length}</span>
      </h2>
      <p className="text-small text-ink-muted">Best known first, with how well you know each.</p>
      <ul className="mt-1 divide-y divide-border">{ideas.slice(0, SHOWN).map(row)}</ul>
      {ideas.length > SHOWN && (
        <Disclosure title={`${ideas.length - SHOWN} more`} className="mt-1" bodyClassName="pl-0">
          <ul className="divide-y divide-border">{ideas.slice(SHOWN).map(row)}</ul>
        </Disclosure>
      )}
      {nextDoor.length > 0 && (
        <>
          <h3 className="mt-4 text-ui font-semibold text-ink">Next door</h3>
          <ul className="mt-1 divide-y divide-border">
            {nextDoor.map((door) => {
              const change = paramsFor(door.to);
              return (
                <li key={door.to.id}>
                  <Link
                    href={mapHref(params, change)}
                    scroll={false}
                    onClick={viewOnClick(() => set(change))}
                    className="flex min-h-11 items-center gap-2 py-1.5 text-ui text-ink hover:text-accent"
                  >
                    <span className="min-w-0 flex-1">{door.name}</span>
                    <span className="tabular shrink-0 text-small text-ink-muted">
                      {door.count === 1 ? '1 link' : `${countText(door.count)} links`}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}
