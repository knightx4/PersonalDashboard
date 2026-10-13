'use client';

import Link from 'next/link';
import { X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import type { IdeaOnMap } from '@/lib/learn/map/load';
import { STATE_MARK_LABEL, mapHref, markOf, similarityText } from '@/lib/learn/map/view';
import { Mark } from './idea-plot';
import { pickOnClick, usePick } from './pick';

const CONCEPT_HREF = (id: string) => `/learn/c/${id}`;

/**
 * The open idea in the rail: its claim, where it sits, and its six nearest
 * (plan #1857). Drawn from the ideas already on the page, so a tap on the map
 * or on a neighbour here shows at once (plan #1883).
 */
export function ChosenIdea({ ideas }: { ideas: readonly IdeaOnMap[] }) {
  const { selectedId, params, pick } = usePick();
  const idea = selectedId ? ideas.find((other) => other.id === selectedId) : undefined;
  if (!idea) return null;

  const byId = new Map(ideas.map((other) => [other.id, other]));
  const facts: [string, string | null][] = [
    ['State', STATE_MARK_LABEL[markOf(idea.state)]],
    ['Subject', idea.track?.name ?? null],
    ['Field', idea.field?.name ?? null],
    ['Domain', idea.domain?.name ?? null],
  ];

  return (
    <Card padding="standard" id="chosen">
      <div className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 text-body font-medium text-ink">
          <Link href={CONCEPT_HREF(idea.id)} className="press-area hover:text-accent">
            {idea.name}
          </Link>
        </h2>
        <Link
          href={mapHref(params, { idea: null })}
          scroll={false}
          onClick={pickOnClick(pick, null)}
          aria-label="Close this idea"
          className="press-area -mr-1 shrink-0 rounded-control p-1 text-ink-muted hover:bg-sunken hover:text-ink"
        >
          <X className="size-4" strokeWidth={2} aria-hidden />
        </Link>
      </div>
      <p className="mt-1 line-clamp-4 text-ui text-ink-muted">{idea.claim}</p>
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-ui">
        {facts.map(([label, value]) =>
          value ? (
            <div key={label} className="contents">
              <dt className="text-ink-muted">{label}</dt>
              <dd className="text-ink">{value}</dd>
            </div>
          ) : null,
        )}
      </dl>

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
                    <svg viewBox="-2 -2 4 4" className="size-3 shrink-0" aria-hidden>
                      <g transform="scale(1.4)">
                        <Mark
                          dot={{ mark: markOf(other?.state ?? 'unknown'), slot: 'none' }}
                          colour="state"
                        />
                      </g>
                    </svg>
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
