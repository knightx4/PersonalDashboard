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
import { TopicWhy } from './why-lit';
import type { Layers } from '@/lib/learn/map/layers';

/**
 * The rail beside an open graph on Idea Space (plan #1997.7): with a
 * topic's neighbourhood open, its topics, best known first. With a subject's
 * territory open (plan #2187.3, #2317.2), its topics, furthest from their
 * target first, each with the level held and the target. On the whole map it
 * draws nothing: the subjects card lists the subjects, which are the places.
 */

/** How many rows show before the rest fold away. */
const SHOWN = 6;

export function PlaceRail({
  view,
  layers,
  onLayers,
  holdQuote,
}: {
  view: IdeaMapView;
  layers: Layers;
  onLayers: (next: Layers) => void;
  /** The gallery draws the open topic's quote open, as a tap would. */
  holdQuote?: boolean;
}) {
  const graph = useOpenGraph(view);
  if (graph?.ladders) {
    return (
      <OpenTerritory
        view={view}
        graph={graph}
        ladders={graph.ladders}
        layers={layers}
        onLayers={onLayers}
        holdQuote={holdQuote}
      />
    );
  }
  // The whole map lists no places: a subject is one, and the subjects card above lists them.
  return graph ? <OpenPlace view={view} graph={graph} /> : null;
}

/** How far a topic is from its target; a topic with none sorts last. */
function gap(ladder: Ladder): number {
  return ladder.target === null ? -Infinity : ladder.target - ladder.held;
}

function OpenTerritory({
  view,
  graph,
  ladders,
  layers,
  onLayers,
  holdQuote,
}: {
  view: IdeaMapView;
  graph: IdeaGraph;
  ladders: ReadonlyMap<string, Ladder>;
  layers: Layers;
  onLayers: (next: Layers) => void;
  holdQuote?: boolean;
}) {
  const { params, set } = usePick();
  const opened = graph.opened.kind === 'territory' ? graph.opened : null;
  const topics = [...ladders.values()].sort(
    (a, b) => gap(b) - gap(a) || a.name.localeCompare(b.name),
  );
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
  const territory = opened ? view.territories?.find((t) => t.id === opened.id) : undefined;
  return (
    <>
      {territory && opened && (
        <TopicWhy
          territory={territory}
          topicId={opened.topic}
          star={view.ideas.find((idea) => idea.id === opened.topic)}
          asOf={view.asOf}
          layers={layers}
          onLayers={onLayers}
          holdQuote={holdQuote}
        />
      )}
      <Card padding="standard">
        <h2 className="text-ui font-semibold text-ink">
          In this subject
          <span className="tabular ml-2 font-normal text-ink-muted">{topics.length}</span>
        </h2>
        <p className="text-small text-ink-muted">
          Furthest from the target first, with the level you hold of it.
        </p>
        <ul className="mt-1 divide-y divide-border">{topics.slice(0, SHOWN).map(row)}</ul>
        {topics.length > SHOWN && (
          <Disclosure title={`${topics.length - SHOWN} more`} className="mt-1" bodyClassName="pl-0">
            <ul className="divide-y divide-border">{topics.slice(SHOWN).map(row)}</ul>
          </Disclosure>
        )}
      </Card>
    </>
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
