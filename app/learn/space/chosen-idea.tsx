'use client';

import Link from '@/components/ui/link';
import { X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Tooltip } from '@/components/ui/tooltip';
import type { IdeaOnMap } from '@/lib/learn/map/load';
import { STATE_MARK_LABEL, mapHref, markOf, similarityText } from '@/lib/learn/map/view';
import { StarSwatch } from './swatch';
import { pickOnClick, usePick, viewOnClick } from './pick';
import { buttonVariants } from '@/components/ui/button';
import { iconButtonVariants } from '@/components/ui/icon-button';
import { cn } from '@/lib/cn';
import { openFor, paramsFor } from '@/lib/learn/map/place-graph';
import { ValueList, ValueRow } from '@/components/ui/value-row';

const CONCEPT_HREF = (id: string) => `/learn/c/${id}`;

/**
 * The open idea in the rail: its claim, where it sits, and its six nearest
 * (plan #1857). Drawn from the ideas already on the page, so a tap on the map
 * or on a neighbour here shows at once (plan #1883).
 */
export function ChosenIdea({
  ideas,
  places,
}: {
  ideas: readonly IdeaOnMap[];
  places: readonly { id: string; name: string }[];
}) {
  const { selectedId, params, pick, set } = usePick();
  const idea = selectedId ? ideas.find((other) => other.id === selectedId) : undefined;
  if (!idea) return null;

  // Its place opened as a graph, or its neighbourhood when it is in none
  // (plan #1997.7); not offered while that graph is already open.
  const to = openFor(idea, new Set(places.map((place) => place.id)));
  const placeName = to.kind === 'place' ? places.find((place) => place.id === to.id)?.name : null;
  const openNow = to.kind === 'place' ? params.place === to.id : params.around === to.id;
  const change = paramsFor(to);

  const byId = new Map(ideas.map((other) => [other.id, other]));
  const facts: [string, string | null][] = [
    ['State', STATE_MARK_LABEL[markOf(idea.state)]],
    ['Strength', idea.strength > 0 ? `${Math.round(idea.strength * 100)}%` : null],
    ['Subject', idea.track?.name ?? null],
    ['Field', idea.field?.name ?? null],
    ['Domain', idea.domain?.name ?? null],
    ['Place', placeName ?? null],
  ];

  return (
    <Card padding="standard" id="chosen">
      <div className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 text-body font-medium text-ink">
          <Link href={CONCEPT_HREF(idea.id)} className="press-area hover:text-accent">
            {idea.name}
          </Link>
        </h2>
        <Tooltip label="Close this idea" align="end" className="-mr-1 shrink-0">
          <Link
            href={mapHref(params, { idea: null })}
            scroll={false}
            onClick={pickOnClick(pick, null)}
            aria-label="Close this idea"
            className={iconButtonVariants({ size: 'md' })}
          >
            <X strokeWidth={1.75} aria-hidden />
          </Link>
        </Tooltip>
      </div>
      <p className="mt-1 line-clamp-4 text-ui text-ink-muted">{idea.claim}</p>
      <ValueList className="mt-3">
        {facts.map(([label, value]) =>
          value ? <ValueRow key={label} label={label} value={value} align="end" /> : null,
        )}
      </ValueList>
      {!openNow && (
        <Link
          href={mapHref(params, change)}
          scroll={false}
          onClick={viewOnClick(() => set(change))}
          className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'mt-3')}
        >
          {placeName ? 'Open its place' : 'Open its neighbourhood'}
        </Link>
      )}

      {idea.neighbours.length > 0 && (
        <>
          <h3 className="mt-4 text-ui font-semibold text-ink">Nearest ideas</h3>
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
                    <span className="min-w-0 flex-1">{other?.name ?? 'An idea'}</span>
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
