'use client';

import Link from '@/components/ui/link';
import { X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Tooltip } from '@/components/ui/tooltip';
import type { IdeaOnMap } from '@/lib/learn/map/load';
import { STATE_MARK_LABEL, mapHref, markOf, similarityText } from '@/lib/learn/map/view';
import { levelsText } from '@/lib/learn/map/topic-stars';
import { StarSwatch } from './swatch';
import { pickOnClick, usePick, viewOnClick } from './pick';
import { buttonVariants } from '@/components/ui/button';
import { iconButtonVariants } from '@/components/ui/icon-button';
import { cn } from '@/lib/cn';
import { openFor, paramsFor } from '@/lib/learn/map/place-graph';
import { ValueList } from '@/components/ui/value-row';
import type { Layers } from '@/lib/learn/map/layers';
import { IdeasUnder, IdeaWhy } from './why-lit';

const TOPIC_HREF = (id: string) => `/learn/topics/${id}`;

/**
 * The open topic in the rail: its scope, the levels you hold, where it sits,
 * the ideas under it and its six nearest (plan #1857, #2317.2). Drawn from
 * the topics already on the page, so a tap on the map or on a neighbour here
 * shows at once (plan #1883).
 */
export function ChosenIdea({
  ideas,
  places,
  asOf,
  layers,
  onLayers,
  moreOpen,
}: {
  ideas: readonly IdeaOnMap[];
  places: readonly { id: string; name: string }[];
  asOf: string;
  layers: Layers;
  onLayers: (next: Layers) => void;
  moreOpen?: boolean;
}) {
  const { selectedId, params, pick, set } = usePick();
  const idea = selectedId ? ideas.find((other) => other.id === selectedId) : undefined;
  if (!idea) return null;

  // Its place opened as a graph, or its neighbourhood when it is in none
  // (plan #1997.7); not offered while that graph is already open.
  const to = openFor(idea, new Set(places.map((place) => place.id)));
  const placeName = to.kind === 'place' ? places.find((place) => place.id === to.id)?.name : null;
  const openNow =
    to.kind === 'place'
      ? params.place === to.id || (params.goal === to.id && params.topic !== null)
      : params.around === to.id;
  const change = paramsFor(to);

  const byId = new Map(ideas.map((other) => [other.id, other]));
  const facts: [string, string | null][] = [
    idea.levels
      ? ['Level', levelsText(idea.levels)]
      : ['State', STATE_MARK_LABEL[markOf(idea.state)]],
    ['Strength', idea.strength > 0 ? `${Math.round(idea.strength * 100)}%` : null],
    ['Subject', idea.track?.name ?? placeName ?? null],
    ['Field', idea.field?.name ?? null],
    ['Domain', idea.domain?.name ?? null],
  ];

  return (
    <Card padding="standard" id="chosen">
      <div className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 text-body font-medium text-ink">
          <Link href={TOPIC_HREF(idea.id)} className="press-area hover:text-accent">
            {idea.name}
          </Link>
        </h2>
        <Tooltip label="Close this topic" align="end" className="-mr-1 shrink-0">
          <Link
            href={mapHref(params, { idea: null })}
            scroll={false}
            onClick={pickOnClick(pick, null)}
            aria-label="Close this topic"
            className={iconButtonVariants({ size: 'md' })}
          >
            <X strokeWidth={1.75} aria-hidden />
          </Link>
        </Tooltip>
      </div>
      <p className="mt-1 line-clamp-4 text-ui text-ink-muted">{idea.claim}</p>
      {/* Label and value on one line, the label whole and the value wrapping
          at the right edge: a place's name runs long in a rail this narrow. */}
      <ValueList className="mt-3">
        {facts.map(([label, value]) =>
          value ? (
            <div key={label} className="flex items-baseline justify-between gap-4">
              <dt className="shrink-0 text-small text-ink-muted">{label}</dt>
              <dd className="tabular min-w-0 text-right text-ui text-ink">{value}</dd>
            </div>
          ) : null,
        )}
      </ValueList>
      {!openNow && (
        <Link
          href={mapHref(params, change)}
          scroll={false}
          onClick={viewOnClick(() => set(change))}
          className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'mt-3')}
        >
          {placeName ? 'Open its subject' : 'Open its neighbourhood'}
        </Link>
      )}

      <IdeaWhy idea={idea} asOf={asOf} layers={layers} onLayers={onLayers} moreOpen={moreOpen} className="mt-4" />

      <IdeasUnder ideas={idea.ideasUnder} className="mt-4" />

      {idea.neighbours.length > 0 && (
        <>
          <h3 className="mt-4 text-ui font-semibold text-ink">Nearest topics</h3>
          <ol className="mt-1 divide-y divide-border">
            {idea.neighbours.map((neighbour) => {
              const other = byId.get(neighbour.id);
              return (
                <li key={neighbour.id}>
                  <Link
                    href={mapHref(params, { idea: neighbour.id })}
                    scroll={false}
                    onClick={pickOnClick(pick, neighbour.id)}
                    className="flex min-h-11 items-center gap-2 py-1.5 text-ui text-ink hover:text-accent"
                  >
                    <StarSwatch
                      strength={other?.strength ?? 0}
                      haze={other?.haze ?? 0}
                      mixedUp={other?.state === 'misconception'}
                    />
                    <span className="min-w-0 flex-1">{other?.name ?? 'A topic'}</span>
                    <span className="tabular shrink-0 text-small text-ink-muted">
                      {similarityText(neighbour.similarity)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </Card>
  );
}
